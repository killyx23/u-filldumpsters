/**
 * sync-lock-activity
 *
 * 1) Bridge jobType 15 (GET_LOGS) — uploads on-device logs to Igloohome cloud
 * 2) GET /devices/{id}/activity — reads stored unlock/lock history
 * 3) Match PINs → bookings, apply rented/returned state machine
 *
 * Probe mode: POST { "probe": true } or ?probe=1 — returns raw payloads
 * without applying state changes.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getCorsHeaders } from "./cors.ts";
import {
  fetchDeviceActivityRows,
  mergeActivityEvents,
  parseActivityLogsFromPayload,
  isEmptyActivityLogPayload,
} from "../_shared/iglooActivity.ts";
import {
  applyLockEvent,
  resolveOrderIdByPin,
  sweepGraceHourReturns,
} from "../_shared/lockEventState.ts";
import { recordDeviceEvents } from "../_shared/lockDeviceState.ts";
import {
  getActivitySyncToken,
  getDeviceActivityToken,
  ACTIVITY_SYNC_SCOPE_HINT,
  DEVICE_ACTIVITY_SCOPE_HINT,
} from "../_shared/iglooAuth.ts";

const IGLOOHOME_API_BASE_URL = "https://api.igloodeveloper.co/igloohome";

function makeJsonResponse(corsHeaders: Record<string, string>) {
  return (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
}

async function readResponse(res: Response) {
  const text = await res.text();
  try {
    return { text, json: text ? JSON.parse(text) : null };
  } catch {
    return { text, json: null };
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function createActivityLogJob(
  accessToken: string,
  lockId: string,
  bridgeId: string,
) {
  const url = `${IGLOOHOME_API_BASE_URL}/devices/${lockId}/jobs/bridges/${bridgeId}`;
  const payload = {
    jobType: 15,
    jobData: {
      lockTime: new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00"),
    },
  };
  console.log("[sync-lock-activity] Creating activity-log job:", payload);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
  });
  const body = await readResponse(res);
  if (!res.ok && res.status !== 201) {
    return { success: false as const, error: body.text, raw: body.json };
  }
  const jobId = body.json?.jobId || body.json?.id || null;
  if (!jobId) {
    return { success: false as const, error: "No jobId in response", raw: body.json };
  }
  return { success: true as const, jobId: String(jobId), raw: body.json };
}

async function pollJobStatus(
  accessToken: string,
  jobId: string,
  maxAttempts = 24,
  intervalMs = 2500,
) {
  let last: unknown = null;
  for (let i = 0; i < maxAttempts; i++) {
    const res = await fetch(`${IGLOOHOME_API_BASE_URL}/jobs/${jobId}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });
    const body = await readResponse(res);
    last = body.json;
    if (!res.ok) {
      console.warn(`[sync-lock-activity] Job poll ${i + 1} status ${res.status}:`, body.text);
      await sleep(intervalMs);
      continue;
    }
    if (body.json?.completed === true || body.json?.jobResponse?.jobStatus === 0) {
      return { completed: true as const, raw: body.json };
    }
    if (body.json?.jobResponse?.jobStatus === 2) {
      return { completed: false as const, expired: true as const, raw: body.json };
    }
    await sleep(intervalMs);
  }
  return { completed: false as const, timedOut: true as const, raw: last };
}

function syncEmptyHint(activityRows: number, eventsParsed: number): string | undefined {
  if (eventsParsed > 0) return undefined;
  if (activityRows === 0) {
    return (
      "Bridge pull finished, but Igloohome cloud has no activity rows yet. " +
      "Unlock/lock with this booking’s PIN while the padlock is near the Bridge, wait ~30–60s, then Sync again."
    );
  }
  return (
    `Fetched ${activityRows} activity row(s) from Igloohome, but none were unlock/lock events ` +
    "we could match to a booking PIN. Confirm the PIN was used (not Bluetooth app unlock)."
  );
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  const jsonResponse = makeJsonResponse(corsHeaders);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    let probe = url.searchParams.get("probe") === "1";
    if (req.method === "POST") {
      try {
        const body = await req.json();
        if (body?.probe === true || body?.probe === 1 || body?.probe === "1") {
          probe = true;
        }
      } catch {
        // empty body is fine (cron)
      }
    }

    const clientId = Deno.env.get("IGLOOHOME_CLIENT_ID");
    const clientSecret = Deno.env.get("IGLOOHOME_CLIENT_SECRET");
    const lockId = Deno.env.get("IGLOOHOME_LOCK_ID") || Deno.env.get("IGLOOHOME_DEVICE_ID");
    const bridgeId = Deno.env.get("IGLOOHOME_BRIDGE_ID");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!clientId || !clientSecret || !lockId || !bridgeId) {
      return jsonResponse({
        success: false,
        error: "Missing IGLOOHOME_CLIENT_ID / SECRET / LOCK_ID / BRIDGE_ID",
      }, 500);
    }
    if (!supabaseUrl || !serviceKey) {
      return jsonResponse({ success: false, error: "Missing Supabase env" }, 500);
    }

    const oauth = await getActivitySyncToken(clientId, clientSecret);
    if (!oauth.token) {
      return jsonResponse({
        success: false,
        error: oauth.reason || "OAuth failed",
        hint: ACTIVITY_SYNC_SCOPE_HINT,
      }, 502);
    }
    const accessToken = oauth.token;

    const jobCreate = await createActivityLogJob(accessToken, lockId, bridgeId);
    if (!jobCreate.success) {
      const forbidden = /403|401|Forbidden/i.test(String(jobCreate.error || ""));
      return jsonResponse({
        success: false,
        error: forbidden
          ? `Activity log job failed: ${jobCreate.error}. ${ACTIVITY_SYNC_SCOPE_HINT}`
          : `Activity log job failed: ${jobCreate.error}`,
        hint: forbidden ? ACTIVITY_SYNC_SCOPE_HINT : undefined,
        raw: jobCreate.raw,
        probe,
      }, 502);
    }

    const jobResult = await pollJobStatus(accessToken, jobCreate.jobId);
    if (!jobResult.completed && !probe) {
      return jsonResponse({
        success: false,
        error: jobResult.expired ? "Job expired" : "Job timed out",
        jobId: jobCreate.jobId,
        raw: jobResult.raw,
      }, 504);
    }

    // Bridge job body usually has no log array (opResult.result=0 = success).
    // Real history is on GET /devices/{id}/activity with a solo-scope token.
    const activityOauth = await getDeviceActivityToken(clientId, clientSecret);
    let activityRows: unknown[] = [];
    let activityError: string | undefined;
    if (!activityOauth.token) {
      activityError = activityOauth.reason || DEVICE_ACTIVITY_SCOPE_HINT;
    } else {
      const fetched = await fetchDeviceActivityRows(activityOauth.token, lockId, {
        maxPages: 5,
        pageSize: 50,
      });
      activityRows = fetched.rows;
      if (fetched.error) activityError = fetched.error;
    }

    const events = mergeActivityEvents(jobResult.raw, activityRows);
    const emptyBridgePayload = isEmptyActivityLogPayload(jobResult.raw);

    if (probe) {
      return jsonResponse({
        success: true,
        probe: true,
        jobId: jobCreate.jobId,
        jobCreate: jobCreate.raw,
        jobResult: jobResult.raw,
        emptyBridgePayload,
        activityRowsFetched: activityRows.length,
        activityError,
        activitySample: activityRows.slice(0, 3),
        parsedEvents: events,
        message:
          "Probe complete — unlock/lock events come from GET /devices/.../activity after jobType 15",
      });
    }

    if (activityError && events.length === 0) {
      return jsonResponse({
        success: false,
        error: activityError,
        hint: DEVICE_ACTIVITY_SCOPE_HINT,
        jobId: jobCreate.jobId,
        emptyBridgePayload,
      }, 502);
    }

    console.log(
      `[sync-lock-activity] Parsed ${events.length} events (activityRows=${activityRows.length}) from job ${jobCreate.jobId}`,
    );

    const supabase = createClient(supabaseUrl, serviceKey);

    // Keep device-level presence current even when the webhook missed a
    // delivery. Duplicates are dropped by the unique index.
    const deviceTracking = await recordDeviceEvents(supabase, events, { deviceId: lockId, bridgeId });

    const actions: Array<{ pin: string | null; orderId: number | null; action: string }> = [];

    for (const event of events) {
      const orderId = await resolveOrderIdByPin(supabase, event.pinCode, event.eventTimestamp);
      if (!orderId) {
        actions.push({ pin: event.pinCode, orderId: null, action: "unmatched_pin" });
        continue;
      }
      const action = await applyLockEvent(supabase, {
        orderId,
        eventType: event.eventType,
        eventTimestamp: event.eventTimestamp,
        notes: `${event.eventType} via sync-lock-activity job ${jobCreate.jobId}`,
      });
      actions.push({ pin: event.pinCode, orderId, action });
    }

    const swept = await sweepGraceHourReturns(supabase);

    return jsonResponse({
      success: true,
      jobId: jobCreate.jobId,
      eventsParsed: events.length,
      activityRowsFetched: activityRows.length,
      emptyBridgePayload,
      bridgeHint: syncEmptyHint(activityRows.length, events.length),
      actions,
      deviceEventsStored: deviceTracking.stored,
      graceHourClosed: swept,
    });
  } catch (error) {
    console.error("[sync-lock-activity] Unhandled:", error);
    return jsonResponse({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }, 500);
  }
});
