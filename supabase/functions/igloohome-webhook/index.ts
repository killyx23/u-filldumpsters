/**
 * igloohome-webhook
 *
 * Public endpoint for igloohome webhook deliveries. Routes on the event type
 * in `payload.payload.event.type`:
 *
 *   3  Job Complete           — result of a command we issued (lock_jobs)
 *   5  Activity Log Received  — real activity at the lock (the primary event)
 *   10 Bridge Connection      — bridge network connectivity heartbeat
 *
 * Register in the igloohome portal:
 *   https://<project>.supabase.co/functions/v1/igloohome-webhook
 *
 * Requires `verify_jwt = false` (see supabase/config.toml) because igloohome
 * authenticates with the x-igloocompany-sha256 signature, not a JWT.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getCorsHeaders } from "./cors.ts";
import {
  type LockActivityEvent,
  parseActivityLogEntry,
  redactPins,
} from "../_shared/iglooActivity.ts";
import { applyLockEvent, sweepGraceHourReturns } from "../_shared/lockEventState.ts";
import {
  defaultBridgeId,
  defaultDeviceId,
  type RecordedEvent,
  recordDeviceEvents,
} from "../_shared/lockDeviceState.ts";
import { verifyIglooWebhook } from "../_shared/iglooWebhookAuth.ts";
import { alertBreakInAttempt, alertBridgeOfflineWhileUnlocked } from "../_shared/lockAlerts.ts";

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

const EVENT_JOB_COMPLETE = 3;
const EVENT_ACTIVITY_LOG = 5;
const EVENT_BRIDGE_CONNECTION = 10;

function makeJsonResponse(corsHeaders: Record<string, string>) {
  return (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function pickString(obj: Record<string, unknown> | null, keys: string[]): string | null {
  if (!obj) return null;
  for (const key of keys) {
    const val = obj[key];
    if (typeof val === "string" && val.trim()) return val.trim();
    if (typeof val === "number") return String(val);
  }
  return null;
}

/** Igloohome nests as `{ payload: { event: {...} } }`; tolerate a flatter shape too. */
function extractEvent(body: unknown): Record<string, unknown> | null {
  const root = asRecord(body);
  if (!root) return null;
  return asRecord(asRecord(root.payload)?.event) ||
    asRecord(root.event) ||
    asRecord(root.payload) ||
    root;
}

function eventTypeOf(event: Record<string, unknown> | null): number | null {
  if (!event) return null;
  const val = event.type ?? event.eventType;
  if (typeof val === "number") return val;
  if (typeof val === "string" && /^\d+$/.test(val.trim())) return Number(val.trim());
  return null;
}

async function handleJobComplete(
  supabase: SupabaseClient,
  event: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const data = asRecord(event.data) || event;
  const jobId = pickString(data, ["jobId", "job_id", "id"]);
  if (!jobId) return { handled: false, reason: "missing jobId" };

  const jobStatusRaw = data.jobStatus ?? data.job_status ?? asRecord(data.jobResponse)?.jobStatus;
  const jobTypeRaw = data.jobType ?? data.job_type;
  const deviceId = pickString(data, ["deviceId", "device_id", "lockId"]) || defaultDeviceId();

  const { error } = await supabase.from("lock_jobs").upsert({
    job_id: jobId,
    device_id: deviceId,
    job_type: typeof jobTypeRaw === "number" ? jobTypeRaw : null,
    job_status: typeof jobStatusRaw === "number" ? jobStatusRaw : null,
    raw: redactPins(event),
    updated_at: new Date().toISOString(),
  }, { onConflict: "job_id" });

  if (error) console.error("[igloohome-webhook] lock_jobs upsert failed:", error.message);
  return { handled: !error, jobId, jobStatus: jobStatusRaw ?? null };
}

async function handleBridgeConnection(
  supabase: SupabaseClient,
  event: Record<string, unknown>,
): Promise<{ result: Record<string, unknown>; alerts: Array<() => Promise<void>> }> {
  const data = asRecord(event.data) || event;
  const bridgeId = pickString(data, ["bridgeId", "bridge_id", "deviceId", "id"]) ||
    defaultBridgeId();
  if (!bridgeId) return { result: { handled: false, reason: "missing bridgeId" }, alerts: [] };

  const rawOnline = data.isOnline ?? data.online ?? data.connected ?? data.connectionStatus ??
    data.status;
  let isOnline: boolean | null = null;
  if (typeof rawOnline === "boolean") isOnline = rawOnline;
  else if (typeof rawOnline === "number") isOnline = rawOnline === 1;
  else if (typeof rawOnline === "string") {
    isOnline = /^(1|true|online|connected)$/i.test(rawOnline.trim());
  }

  const now = new Date().toISOString();
  const { data: previous } = await supabase
    .from("lock_bridges")
    .select("bridge_id, is_online")
    .eq("bridge_id", bridgeId)
    .maybeSingle();

  const changed = previous?.is_online !== isOnline;
  const { error } = await supabase.from("lock_bridges").upsert({
    bridge_id: bridgeId,
    is_online: isOnline,
    last_event_at: now,
    ...(changed ? { last_changed_at: now } : {}),
  }, { onConflict: "bridge_id" });
  if (error) console.error("[igloohome-webhook] lock_bridges upsert failed:", error.message);

  // Losing connectivity while a lock is still open is the worst case: the
  // equipment is accessible and we will not hear about further activity.
  const alerts: Array<() => Promise<void>> = [];
  if (isOnline === false && changed) {
    const { data: openDevices } = await supabase
      .from("lock_devices")
      .select("device_id, label, state_changed_at")
      .eq("bridge_id", bridgeId)
      .eq("current_state", "unlocked")
      .eq("is_active", true);
    for (const device of openDevices ?? []) {
      alerts.push(() =>
        alertBridgeOfflineWhileUnlocked({
          bridgeId,
          deviceId: device.device_id,
          label: device.label,
          lastStateChangedAt: device.state_changed_at,
        })
      );
    }
  }

  return { result: { handled: !error, bridgeId, isOnline, changed }, alerts };
}

async function handleActivityLogs(
  supabase: SupabaseClient,
  event: Record<string, unknown>,
): Promise<{ recorded: RecordedEvent[]; parsed: number; stored: number }> {
  const data = asRecord(event.data) || event;
  const logs = Array.isArray(data.activityLogs)
    ? data.activityLogs
    : Array.isArray(data.activity_logs)
    ? data.activity_logs
    : Array.isArray(data.logs)
    ? data.logs
    : [];

  const parsedEvents: LockActivityEvent[] = [];
  for (const entry of logs) {
    const parsed = parseActivityLogEntry(entry);
    if (parsed) parsedEvents.push(parsed);
  }

  const { recorded, stored } = await recordDeviceEvents(supabase, parsedEvents, {
    deviceId: pickString(data, ["deviceId", "device_id", "lockId", "productId"]),
    bridgeId: pickString(data, ["bridgeId", "bridge_id"]),
  });

  return { recorded, parsed: parsedEvents.length, stored };
}

/**
 * Booking state changes and notifications run after the 200 so igloohome never
 * retries because an email provider was slow.
 */
async function processDeferred(
  supabase: SupabaseClient,
  recorded: RecordedEvent[],
  bridgeAlerts: Array<() => Promise<void>>,
): Promise<void> {
  try {
    for (const { event, deviceId, orderId } of recorded) {
      if (event.eventType === "breakin") {
        const { data: device } = await supabase
          .from("lock_devices")
          .select("label")
          .eq("device_id", deviceId)
          .maybeSingle();
        await alertBreakInAttempt({
          deviceId,
          label: device?.label ?? null,
          occurredAt: event.eventTimestamp,
          orderId,
        });
      }

      if (!orderId) continue;
      const action = await applyLockEvent(supabase, {
        orderId,
        eventType: event.eventType,
        eventTimestamp: event.eventTimestamp,
        notes: `${event.eventType} via igloohome-webhook (logType ${event.logType ?? "n/a"})`,
      });
      console.log(`[igloohome-webhook] Booking #${orderId}: ${action}`);
    }

    for (const alert of bridgeAlerts) await alert();

    if (recorded.length > 0) {
      await sweepGraceHourReturns(supabase);
    }
  } catch (err) {
    console.error("[igloohome-webhook] Deferred processing failed:", err);
  }
}

function runDeferred(work: Promise<unknown>): void {
  // deno-lint-ignore no-explicit-any
  const runtime = (globalThis as any).EdgeRuntime;
  if (runtime && typeof runtime.waitUntil === "function") {
    runtime.waitUntil(work);
    return;
  }
  work.catch((err) => console.error("[igloohome-webhook] Deferred work rejected:", err));
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  const jsonResponse = makeJsonResponse(corsHeaders);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ success: false, error: "Method not allowed" }, 405);
  }

  try {
    const rawBody = await req.text();
    const verification = await verifyIglooWebhook(req, rawBody);
    if (!verification.valid) {
      console.warn(
        `[igloohome-webhook] Signature rejected (${verification.method}): ${verification.reason}`,
      );
      return jsonResponse({ success: false, error: "Invalid signature" }, 401);
    }

    let body: unknown = null;
    try {
      body = rawBody ? JSON.parse(rawBody) : null;
    } catch {
      return jsonResponse({ success: false, error: "Invalid JSON" }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) {
      return jsonResponse({ success: false, error: "Missing Supabase env" }, 500);
    }
    const supabase = createClient(supabaseUrl, serviceKey);

    const event = extractEvent(body);
    const type = eventTypeOf(event);
    console.log("[igloohome-webhook] Verified event", JSON.stringify({
      verifiedBy: verification.method,
      eventType: type,
      payload: redactPins(body),
    }));

    if (type === EVENT_JOB_COMPLETE) {
      const result = await handleJobComplete(supabase, event!);
      return jsonResponse({ success: true, eventType: type, ...result });
    }

    if (type === EVENT_BRIDGE_CONNECTION) {
      const { result, alerts } = await handleBridgeConnection(supabase, event!);
      if (alerts.length > 0) runDeferred(processDeferred(supabase, [], alerts));
      return jsonResponse({ success: true, eventType: type, ...result });
    }

    if (type === EVENT_ACTIVITY_LOG) {
      const { recorded, parsed, stored } = await handleActivityLogs(supabase, event!);
      runDeferred(processDeferred(supabase, recorded, []));
      return jsonResponse({
        success: true,
        eventType: type,
        eventsParsed: parsed,
        eventsStored: stored,
        verifiedBy: verification.method,
      });
    }

    console.log(`[igloohome-webhook] Unhandled event type: ${type}`);
    return jsonResponse({ success: true, eventType: type, handled: false });
  } catch (error) {
    console.error("[igloohome-webhook] Unhandled:", error);
    return jsonResponse({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }, 500);
  }
});
