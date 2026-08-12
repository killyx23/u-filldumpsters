/**
 * test-lock-lifecycle (admin only)
 *
 * Compress a booking into a short live window and exercise the lock rental flow
 * without waiting days.
 *
 * Actions:
 *   status            — booking + active PIN + recent tracking logs + stale PIN counts
 *   setup             — shift booking to NOW…NOW+N min, clear verified, create confirmed PIN
 *   clear_lock_pins   — delete every known PIN for this booking from the lock (verified)
 *   confirm_pin       — short poll of pending bridge job (call repeatedly from UI)
 *   restore           — restore original booking dates from snapshot
 *   simulate_unlock   — inject unlock event → mark Rented + notify
 *   simulate_lock     — inject lock at/after scheduled end → mark Returned + notify
 *   simulate_webhook  — run the type-5 activity path in-process (kind: unlock|lock|breakin)
 *                       without HTTP self-fetch (avoids edge-runtime deadlock)
 *   sync              — pull real activity logs from the Wi-Fi bridge
 *   probe             — raw jobType 15 response (payload discovery)
 *   algopin           — offline one-time AlgoPIN (no bridge)
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getCorsHeaders } from "./cors.ts";
import { applyLockEvent, sweepGraceHourReturns } from "../_shared/lockEventState.ts";
import { recordDeviceEvents } from "../_shared/lockDeviceState.ts";
import { alertBreakInAttempt } from "../_shared/lockAlerts.ts";
import { getBookingWindow, clampIgloohomeStart } from "../_shared/pinTiming.ts";
import {
  fetchDeviceActivityRows,
  mergeActivityEvents,
  isEmptyActivityLogPayload,
  parseFailedPinAttempt,
  parseActivityLogEntry,
  type LockActivityEvent,
} from "../_shared/iglooActivity.ts";
import { ensurePinOnLock, clearKnownPins } from "../_shared/lockPin.ts";
import {
  getOAuthToken,
  diagnoseOAuth,
  bridgeOfflineHint,
  GENERATE_PIN_SCOPES,
  getActivitySyncToken,
  getDeviceActivityToken,
  getRemoteLockJobToken,
  tokenScopes,
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
/** Format a Date as MST calendar date + "h:mm AM/PM" slot (matches booking storage). */
function toMstDateAndSlot(d: Date): { date: string; timeSlot: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Denver",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(d);

  const get = (type: string) => parts.find((p) => p.type === type)?.value || "";
  const month = get("month");
  const day = get("day");
  const year = get("year");
  const hour = get("hour");
  const minute = get("minute");
  const dayPeriod = get("dayPeriod");
  return {
    date: `${year}-${month}-${day}`,
    timeSlot: `${hour}:${minute} ${dayPeriod}`,
  };
}

function isoPlusMinutes(minutes: number, from = new Date()): string {
  return new Date(from.getTime() + minutes * 60 * 1000)
    .toISOString()
    .replace(/\.\d{3}Z$/, "+00:00");
}

/**
 * Backdate slightly so a freshly created PIN is immediately usable, then clamp
 * to Igloohome's current-hour rule via the shared helper.
 */
function pinStartIso(backdateMinutes = 2): string {
  return clampIgloohomeStart(isoPlusMinutes(-backdateMinutes));
}

async function requireAdmin(req: Request) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return { error: "Missing Authorization", status: 401 as const };
  const token = authHeader.replace("Bearer ", "");
  const anon = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: `Bearer ${token}` } } },
  );
  const { data: { user }, error } = await anon.auth.getUser();
  if (error || !user) return { error: "Unauthorized", status: 401 as const };
  if (user.app_metadata?.is_admin !== true) {
    return {
      error:
        "Admin access required (app_metadata.is_admin must be true — sign out and back in after it is set)",
      status: 403 as const,
    };
  }
  return { user };
}

async function deleteBridgePin(
  accessToken: string,
  lockId: string,
  bridgeId: string,
  pin: string,
): Promise<{ ok: boolean; jobId: string }> {
  const url = `${IGLOOHOME_API_BASE_URL}/devices/${lockId}/jobs/bridges/${bridgeId}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ jobType: 5, jobData: { pin } }),
  });
  const body = await readResponse(res);
  const ok = res.ok || res.status === 201;
  const jobId = String(body.json?.jobId || body.json?.pinId || body.json?.id || "");
  return { ok, jobId };
}

async function createBridgeDurationPin(
  accessToken: string,
  lockId: string,
  bridgeId: string,
  pin: string,
  startDate: string,
  endDate: string,
  accessName: string,
) {
  const url = `${IGLOOHOME_API_BASE_URL}/devices/${lockId}/jobs/bridges/${bridgeId}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      jobType: 4,
      jobData: { accessName, pin, pinType: 4, startDate, endDate },
    }),
  });
  const body = await readResponse(res);
  if (!res.ok && res.status !== 201) {
    return { success: false as const, error: body.text, raw: body.json };
  }
  return {
    success: true as const,
    pinId: String(body.json?.jobId || body.json?.pinId || body.json?.id || ""),
    raw: body.json,
  };
}

/**
 * Bridge jobs are queued, so a 201 only means Igloohome accepted the request.
 * The PIN is not usable until the job completes (lock awake + in bridge range).
 * Keep each edge invoke short — Kong/Vite returns HTTP 504 around ~150s.
 */
async function waitForJobCompletion(
  accessToken: string,
  jobId: string,
  attempts = 3,
  delayMs = 2500,
): Promise<{
  state: "completed" | "failed" | "pending";
  raw: unknown;
  polls: Array<Record<string, unknown>>;
}> {
  let raw: unknown = null;
  const polls: Array<Record<string, unknown>> = [];
  for (let i = 0; i < attempts; i++) {
    await sleep(delayMs);
    const res = await fetch(`${IGLOOHOME_API_BASE_URL}/jobs/${jobId}`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    });
    const body = await readResponse(res);
    raw = body.json ?? body.text;
    const jobResponse = body.json?.jobResponse;
    const jobStatus = jobResponse?.jobStatus;
    const completed = body.json?.completed;
    const pollRow = {
      attempt: i + 1,
      httpStatus: res.status,
      completed: completed ?? null,
      jobStatus: jobStatus ?? null,
      hasPayload: !!body.json,
      topKeys: body.json && typeof body.json === "object" ? Object.keys(body.json).slice(0, 12) : [],
      jobResponseKeys: jobResponse && typeof jobResponse === "object"
        ? Object.keys(jobResponse).slice(0, 12)
        : [],
      jobResponseSnippet: jobResponse && typeof jobResponse === "object"
        ? JSON.stringify(jobResponse).slice(0, 240)
        : null,
    };
    polls.push(pollRow);
    if (body.json?.completed === true || body.json?.jobResponse?.jobStatus === 0) {
      return { state: "completed", raw, polls };
    }
    if (body.json?.jobResponse?.jobStatus === 2) return { state: "failed", raw, polls };
  }
  return { state: "pending", raw, polls };
}

async function fetchDevicesSummary(
  accessToken: string,
  lockId: string,
  bridgeId: string,
) {
  const res = await fetch(`${IGLOOHOME_API_BASE_URL}/devices`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  const body = await readResponse(res);
  const payload = Array.isArray(body.json?.payload)
    ? body.json.payload
    : Array.isArray(body.json)
      ? body.json
      : [];
  const lock = payload.find((d: { deviceId?: string }) => d.deviceId === lockId) || null;
  const bridge = payload.find((d: { deviceId?: string }) => d.deviceId === bridgeId) ||
    payload.find((d: { type?: string }) => d.type === "Bridge") ||
    null;
  const bridgeLinks = Array.isArray(bridge?.linkedDevices) ? bridge.linkedDevices : [];
  return {
    httpStatus: res.status,
    deviceCount: payload.length,
    lockFound: !!lock,
    bridgeFound: !!bridge,
    lockType: lock?.type ?? null,
    bridgeType: bridge?.type ?? null,
    lockBatteryLevel: lock?.batteryLevel ?? null,
    bridgeLinkedDevices: bridgeLinks.length,
    bridgeLinksLock: bridgeLinks.some((d: unknown) =>
      typeof d === "string" ? d === lockId : (d as { deviceId?: string })?.deviceId === lockId
    ),
    bridgeLinkSnippet: JSON.stringify(bridgeLinks).slice(0, 200),
    lockKeys: lock && typeof lock === "object" ? Object.keys(lock).slice(0, 16) : [],
    bridgeKeys: bridge && typeof bridge === "object" ? Object.keys(bridge).slice(0, 16) : [],
  };
}

/**
 * AlgoPIN codes are computed by the lock itself, so they work with no bridge and
 * no connectivity at the padlock. startDate must be hour-aligned.
 */
async function createOneTimeAlgoPin(
  accessToken: string,
  lockId: string,
  startDate: string,
  variance: number,
  accessName: string,
) {
  const res = await fetch(`${IGLOOHOME_API_BASE_URL}/devices/${lockId}/algopin/onetime`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ variance, startDate, accessName }),
  });
  const body = await readResponse(res);
  if (!res.ok && res.status !== 201) {
    return { success: false as const, error: `AlgoPIN failed (HTTP ${res.status})`, raw: body.json ?? body.text };
  }
  const pin = String(body.json?.pin || body.json?.access_code || body.json?.code || "");
  if (!pin) {
    return { success: false as const, error: "AlgoPIN succeeded but no PIN in response", raw: body.json };
  }
  return {
    success: true as const,
    pin,
    pinId: String(body.json?.pinId || body.json?.id || ""),
    raw: body.json,
  };
}

/** Floor an ISO timestamp to the top of its UTC hour (AlgoPIN requires zeroed minutes). */
function floorToHourIso(d = new Date()): string {
  const f = new Date(d.getTime());
  f.setUTCMinutes(0, 0, 0);
  return f.toISOString().replace(/\.\d{3}Z$/, "+00:00");
}

async function activateConfirmedPin(
  supabase: ReturnType<typeof createClient>,
  booking: Record<string, unknown>,
  pending: {
    pin: string;
    jobId: string;
    startIso: string;
    endIso: string;
    durationMinutes: number;
    lockId: string;
  },
) {
  const now = new Date().toISOString();
  const bookingId = Number(booking.id);
  await supabase.from("rental_access_codes").insert({
    order_id: bookingId,
    customer_email: booking.email,
    customer_phone: booking.phone || "",
    access_pin: pending.pin,
    pin_id: pending.jobId,
    pin_type: "bridge_proxied",
    lock_id: pending.lockId,
    start_time: pending.startIso,
    end_time: pending.endIso,
    status: "active",
    lock_confirmed_at: now,
    confirm_attempts: 0,
  });
  const archive = {
    ...((booking.archive_details as Record<string, unknown>) || {}),
  };
  delete archive.test_lock_pending_pin;
  await supabase
    .from("bookings")
    .update({ pin_generated_at: now, archive_details: archive })
    .eq("id", bookingId);
  await supabase.from("rental_tracking_logs").insert({
    order_id: bookingId,
    event_type: "admin_override",
    event_timestamp: now,
    notes:
      `TEST setup: ${pending.durationMinutes}min window, PIN ${pending.pin} ` +
      `valid ${pending.startIso} → ${pending.endIso}`,
  });
}

async function fetchBookingStatus(supabase: ReturnType<typeof createClient>, bookingId: number) {
  const { data: booking, error } = await supabase
    .from("bookings")
    .select(
      "id, name, email, phone, status, plan, addons, drop_off_date, drop_off_time_slot, pickup_date, pickup_time_slot, rented_out_at, returned_at, rental_started_notified_at, return_notified_at, pin_generated_at, archive_details",
    )
    .eq("id", bookingId)
    .single();
  if (error || !booking) return { error: error?.message || "Booking not found" };

  const { data: pin } = await supabase
    .from("rental_access_codes")
    .select("*")
    .eq("order_id", bookingId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: logs } = await supabase
    .from("rental_tracking_logs")
    .select("*")
    .eq("order_id", bookingId)
    .order("event_timestamp", { ascending: false })
    .limit(20);

  const { data: stalePins } = await supabase
    .from("rental_access_codes")
    .select("id, access_pin, status, lock_deleted_at, lock_confirmed_at, pin_type, created_at")
    .eq("order_id", bookingId)
    .is("lock_deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(10);

  const window = getBookingWindow(booking);
  const pendingPin = (booking.archive_details as Record<string, unknown> | null)
    ?.test_lock_pending_pin as { pin?: string; jobId?: string } | undefined;
  return {
    booking,
    pin,
    logs: logs || [],
    stalePins: stalePins || [],
    stalePinCount: (stalePins || []).filter(
      (p: { lock_deleted_at?: string | null; status?: string; lock_confirmed_at?: string | null }) =>
        !p.lock_deleted_at && !(p.status === "active" && p.lock_confirmed_at),
    ).length,
    window: {
      startIso: window.startIso,
      endIso: window.endIso,
      graceEndIso: window.graceEndIso,
      pinEligibleFromMs: window.pinEligibleFromMs,
    },
    snapshot: booking.archive_details?.test_lock_snapshot || null,
    needsConfirm: !!(pendingPin?.jobId && !pin?.lock_confirmed_at),
    lockJobState: pendingPin?.jobId && !pin ? "pending" : pin?.lock_confirmed_at ? "completed" : undefined,
    lockJobDiagnostics: pendingPin?.jobId
      ? { jobId: pendingPin.jobId }
      : undefined,
    // Surface queued PIN so the UI can show it before confirm activates the row
    ...(pendingPin?.pin && !pin
      ? { pin: pendingPin.pin }
      : {}),
  };
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  const jsonResponse = makeJsonResponse(corsHeaders);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return jsonResponse({ success: false, error: "Method not allowed" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const clientId = Deno.env.get("IGLOOHOME_CLIENT_ID") ?? "";
    const clientSecret = Deno.env.get("IGLOOHOME_CLIENT_SECRET") ?? "";
    const lockId = Deno.env.get("IGLOOHOME_LOCK_ID") || Deno.env.get("IGLOOHOME_DEVICE_ID") || "";
    const bridgeId = Deno.env.get("IGLOOHOME_BRIDGE_ID") || "";

    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const admin = await requireAdmin(req);
    if ("error" in admin && admin.error) {
      return jsonResponse({ success: false, error: admin.error }, admin.status);
    }

    const body = await req.json();
    const action = String(body.action || "status");

    // -------- oauth_diagnose (no booking needed) --------
    if (action === "oauth_diagnose") {
      if (!clientId || !clientSecret) {
        return jsonResponse({
          success: false,
          error: "Missing IGLOOHOME_CLIENT_ID / IGLOOHOME_CLIENT_SECRET",
        }, 500);
      }
      return jsonResponse({
        success: true,
        action,
        credentials: {
          clientIdLength: clientId.length,
          clientSecretLength: clientSecret.length,
          lockIdPresent: !!lockId,
          bridgeIdPresent: !!bridgeId,
        },
        interpretation: [
          "Green = Cognito accepted that exact scope list.",
          "Red on a multi-scope set usually means ONE scope in the list is not authorized — Cognito rejects the whole request.",
          "Per-job scopes are preferred (create-pin / get-activity-logs). Legacy create-bridge-proxied-job is often unauthorized and is dropped for PIN flows.",
          "If Setup fails with HTTP 406 / bridge offline, that is hardware connectivity — not OAuth. Use AlgoPIN until the Bridge is back online.",
        ],
        results: await diagnoseOAuth(clientId, clientSecret),
      });
    }

    // -------- remote_lock / remote_unlock (no booking needed) --------
    if (action === "remote_lock" || action === "remote_unlock") {
      if (!clientId || !clientSecret || !lockId || !bridgeId) {
        return jsonResponse({
          success: false,
          error: "Missing IGLOOHOME_CLIENT_ID / SECRET / LOCK_ID / BRIDGE_ID",
        }, 500);
      }

      const operation = action === "remote_lock" ? "lock" : "unlock";
      const jobType = operation === "lock" ? 1 : 2;
      const oauth = await getRemoteLockJobToken(clientId, clientSecret, operation);
      if (!oauth.token) {
        return jsonResponse({
          success: false,
          action,
          error: oauth.reason,
          scopesRequested: oauth.scopesUsed,
        }, 502);
      }

      const grantedScopes = tokenScopes(oauth.token);
      const createRes = await fetch(
        `${IGLOOHOME_API_BASE_URL}/devices/${lockId}/jobs/bridges/${bridgeId}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${oauth.token}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({ jobType, jobData: {} }),
        },
      );
      const createBody = await readResponse(createRes);
      const jobId = createBody.json?.jobId || createBody.json?.id;
      if (!createRes.ok || !jobId) {
        return jsonResponse({
          success: false,
          action,
          jobType,
          httpStatus: createRes.status,
          grantedScopes,
          error: createBody.json || createBody.text || "Bridge job request failed",
        }, 502);
      }

      const outcome = await waitForJobCompletion(oauth.token, jobId, 8, 2500);
      return jsonResponse({
        success: outcome.state === "completed",
        action,
        jobType,
        jobId,
        jobState: outcome.state,
        grantedScopes,
        polls: outcome.polls,
        raw: outcome.raw,
        webhookExpected: "Signed event.type 3 (Job Complete)",
      }, outcome.state === "failed" ? 502 : 200);
    }

    const bookingId = Number(body.bookingId ?? body.booking_id ?? body.order_id);
    if (!bookingId || Number.isNaN(bookingId)) {
      return jsonResponse({ success: false, error: "bookingId is required" }, 400);
    }

    // -------- status --------
    if (action === "status") {
      const status = await fetchBookingStatus(supabase, bookingId);
      if (status.error) return jsonResponse({ success: false, error: status.error }, 404);
      return jsonResponse({ success: true, action: "status", ...status });
    }

    // -------- clear_lock_pins --------
    if (action === "clear_lock_pins") {
      if (!clientId || !clientSecret || !lockId || !bridgeId) {
        return jsonResponse({
          success: false,
          error: "Missing IGLOOHOME_CLIENT_ID / SECRET / LOCK_ID / BRIDGE_ID",
        }, 500);
      }
      const oauth = await getOAuthToken(clientId, clientSecret);
      if (!oauth.token) return jsonResponse({ success: false, error: oauth.reason }, 502);
      const cleared = await clearKnownPins(supabase, oauth.token, bookingId, {
        lockId,
        bridgeId,
        budgetMs: 90_000,
        settleMs: 15_000,
      });
      const status = await fetchBookingStatus(supabase, bookingId);
      return jsonResponse({
        ...status,
        success: cleared.pending === 0 && cleared.failed === 0,
        action: "clear_lock_pins",
        cleared,
        error: cleared.pending > 0 || cleared.failed > 0
          ? `Cleared ${cleared.confirmed}/${cleared.attempted}; ${cleared.pending} still pending, ${cleared.failed} failed. Wait and retry Clear.`
          : undefined,
      }, cleared.pending === 0 && cleared.failed === 0 ? 200 : 502);
    }

    // -------- restore --------
    if (action === "restore") {
      const { data: booking } = await supabase
        .from("bookings")
        .select("id, archive_details")
        .eq("id", bookingId)
        .single();
      const snap = booking?.archive_details?.test_lock_snapshot;
      if (!snap) {
        return jsonResponse({
          success: false,
          error: "No test_lock_snapshot found on this booking — nothing to restore",
        }, 400);
      }
      const archive = { ...(booking.archive_details || {}) };
      delete archive.test_lock_snapshot;
      await supabase
        .from("bookings")
        .update({
          drop_off_date: snap.drop_off_date,
          drop_off_time_slot: snap.drop_off_time_slot,
          pickup_date: snap.pickup_date,
          pickup_time_slot: snap.pickup_time_slot,
          status: snap.status || "Confirmed",
          rented_out_at: snap.rented_out_at ?? null,
          returned_at: snap.returned_at ?? null,
          rental_started_notified_at: snap.rental_started_notified_at ?? null,
          return_notified_at: snap.return_notified_at ?? null,
          pin_generated_at: snap.pin_generated_at ?? null,
          archive_details: archive,
        })
        .eq("id", bookingId);

      // Expire test PINs in DB (best-effort delete from lock)
      const { data: activePins } = await supabase
        .from("rental_access_codes")
        .select("id, access_pin, pin_type")
        .eq("order_id", bookingId)
        .eq("status", "active");

      if (activePins?.length && clientId && clientSecret && lockId && bridgeId) {
        const { token } = await getOAuthToken(clientId, clientSecret);
        if (token) {
          for (const row of activePins) {
            if (row.pin_type === "bridge_proxied" && row.access_pin) {
              await deleteBridgePin(token, lockId, bridgeId, row.access_pin);
            }
          }
        }
      }
      await supabase
        .from("rental_access_codes")
        .update({ status: "expired", lock_deleted_at: new Date().toISOString() })
        .eq("order_id", bookingId)
        .eq("status", "active");

      const status = await fetchBookingStatus(supabase, bookingId);
      return jsonResponse({ success: true, restored: true, ...status });
    }

    // -------- setup --------
    if (action === "setup") {
      const durationMinutes = Math.min(180, Math.max(5, Number(body.durationMinutes) || 30));
      const { data: booking, error } = await supabase
        .from("bookings")
        .select("*")
        .eq("id", bookingId)
        .single();
      if (error || !booking) {
        return jsonResponse({ success: false, error: "Booking not found" }, 404);
      }

      if (!clientId || !clientSecret || !lockId || !bridgeId) {
        return jsonResponse({
          success: false,
          error: "Missing IGLOOHOME_CLIENT_ID / SECRET / LOCK_ID / BRIDGE_ID",
        }, 500);
      }

      const existingSnap = booking.archive_details?.test_lock_snapshot;
      const snapshot = existingSnap || {
        drop_off_date: booking.drop_off_date,
        drop_off_time_slot: booking.drop_off_time_slot,
        pickup_date: booking.pickup_date,
        pickup_time_slot: booking.pickup_time_slot,
        status: booking.status,
        rented_out_at: booking.rented_out_at,
        returned_at: booking.returned_at,
        rental_started_notified_at: booking.rental_started_notified_at,
        return_notified_at: booking.return_notified_at,
        pin_generated_at: booking.pin_generated_at,
        saved_at: new Date().toISOString(),
      };

      const startLocal = new Date(Date.now() - 2 * 60 * 1000);
      const endLocal = new Date(Date.now() + durationMinutes * 60 * 1000);
      const startMst = toMstDateAndSlot(startLocal);
      const endMst = toMstDateAndSlot(endLocal);

      const oauth = await getOAuthToken(clientId, clientSecret);
      if (!oauth.token) {
        return jsonResponse({ success: false, error: oauth.reason }, 502);
      }
      const accessToken = oauth.token;
      const devices = await fetchDevicesSummary(accessToken, lockId, bridgeId);
      const startIso = pinStartIso();
      const endIso = isoPlusMinutes(durationMinutes);

      await supabase
        .from("bookings")
        .update({
          drop_off_date: startMst.date,
          drop_off_time_slot: startMst.timeSlot,
          pickup_date: endMst.date,
          pickup_time_slot: endMst.timeSlot,
          status: "Confirmed",
          rented_out_at: null,
          returned_at: null,
          rental_started_notified_at: null,
          return_notified_at: null,
          pin_generated_at: null,
          pin_notification_sent_at: null,
          archive_details: {
            ...(booking.archive_details || {}),
            test_lock_snapshot: snapshot,
          },
        })
        .eq("id", bookingId);

      // Verified clear + create — fails loudly if the bridge does not confirm.
      const ensured = await ensurePinOnLock(supabase, accessToken, {
        orderId: bookingId,
        lockId,
        bridgeId,
        startDate: startIso,
        endDate: endIso,
        accessName: `TEST Lock Lifecycle - Order #${bookingId}`,
        clearBudgetMs: 45_000,
        createBudgetMs: 75_000,
        settleMs: 12_000,
      });

      // Job accepted but still in the bridge queue — keep the PIN and let the UI poll.
      if (!ensured.lockConfirmed && ensured.createState === "pending" && ensured.jobId) {
        const pendingPayload = {
          pin: ensured.pin,
          jobId: ensured.jobId,
          startIso,
          endIso,
          durationMinutes,
          lockId,
          queuedAt: new Date().toISOString(),
        };
        await supabase
          .from("bookings")
          .update({
            archive_details: {
              ...(booking.archive_details || {}),
              test_lock_snapshot: snapshot,
              test_lock_pending_pin: pendingPayload,
            },
          })
          .eq("id", bookingId);

        const status = await fetchBookingStatus(supabase, bookingId);
        return jsonResponse({
          ...status,
          success: true,
          action: "setup",
          pin: ensured.pin,
          durationMinutes,
          needsConfirm: true,
          lockJobState: "pending",
          devices,
          lockJobDiagnostics: {
            jobId: ensured.jobId,
            deleteAttempts: ensured.clear.attempted,
            deleteConfirmed: ensured.clear.confirmed,
            deletePending: ensured.clear.pending,
            polls: ensured.polls,
            devices,
            clear: ensured.clear,
          },
          instructions: [
            `PIN ${ensured.pin} is queued on the Bridge (job ${ensured.jobId}).`,
            "Do not try it on the padlock yet — wait for confirmation.",
            "Keep the padlock awake near the Bridge, then click Check Bridge Delivery (auto-retries).",
            "Or use Setup + AlgoPIN if you need a code immediately.",
          ],
        });
      }

      if (!ensured.lockConfirmed) {
        const hint = bridgeOfflineHint(ensured.error);
        return jsonResponse({
          success: false,
          error: hint
            ? `${ensured.error}. ${hint}`
            : (ensured.error ||
              "Bridge did not confirm the PIN. Use Clear PINs From Lock, wake the padlock, then Setup again — or use AlgoPIN."),
          hint: hint || undefined,
          pin: ensured.pin || undefined,
          lockJobState: ensured.createState,
          devices,
          lockJobDiagnostics: {
            jobId: ensured.jobId || null,
            deleteAttempts: ensured.clear.attempted,
            deleteConfirmed: ensured.clear.confirmed,
            deletePending: ensured.clear.pending,
            polls: ensured.polls,
            devices,
            clear: ensured.clear,
          },
        }, 502);
      }

      await activateConfirmedPin(supabase, booking, {
        pin: ensured.pin,
        jobId: ensured.jobId,
        startIso,
        endIso,
        durationMinutes,
        lockId,
      });

      const status = await fetchBookingStatus(supabase, bookingId);
      return jsonResponse({
        ...status,
        success: true,
        action: "setup",
        pin: ensured.pin,
        durationMinutes,
        needsConfirm: false,
        lockJobState: "completed",
        devices,
        lockJobDiagnostics: {
          jobId: ensured.jobId || null,
          deleteAttempts: ensured.clear.attempted,
          deleteConfirmed: ensured.clear.confirmed,
          startIso,
          endIso,
          polls: ensured.polls,
          devices,
          clear: ensured.clear,
        },
        instructions: [
          `PIN ${ensured.pin} is confirmed on the lock for ~${durationMinutes} minutes.`,
          "Walk to the lock, enter the PIN, and unlock.",
          "Then Sync Lock Activity — or Simulate Unlock / Simulate Lock.",
          "Click Restore Dates when finished.",
        ],
      });
    }

    // -------- confirm_pin (short poll; call repeatedly from the browser) --------
    if (action === "confirm_pin") {
      const status = await fetchBookingStatus(supabase, bookingId);
      if (status.error) return jsonResponse({ success: false, error: status.error }, 404);
      const bookingRow = status.booking!;
      const pending = (bookingRow.archive_details as Record<string, unknown> | null)
        ?.test_lock_pending_pin as {
          pin?: string;
          jobId?: string;
          startIso?: string;
          endIso?: string;
          durationMinutes?: number;
          lockId?: string;
        } | undefined;

      const jobId = String(body.jobId || pending?.jobId || "");
      if (!jobId) {
        return jsonResponse({
          success: false,
          error: "No pending bridge job to confirm. Run Setup first.",
        }, 400);
      }
      if (!clientId || !clientSecret) {
        return jsonResponse({ success: false, error: "Missing Igloohome credentials" }, 500);
      }
      const oauth = await getOAuthToken(clientId, clientSecret);
      if (!oauth.token) return jsonResponse({ success: false, error: oauth.reason }, 502);

      const jobOutcome = await waitForJobCompletion(oauth.token, jobId, 2, 2000);

      if (jobOutcome.state === "completed" && pending?.pin && pending.startIso && pending.endIso) {
        await activateConfirmedPin(supabase, bookingRow, {
          pin: pending.pin,
          jobId,
          startIso: pending.startIso,
          endIso: pending.endIso,
          durationMinutes: Number(pending.durationMinutes || 20),
          lockId: String(pending.lockId || lockId),
        });
      }

      const after = await fetchBookingStatus(supabase, bookingId);
      return jsonResponse({
        ...after,
        success: jobOutcome.state !== "failed",
        action: "confirm_pin",
        pin: pending?.pin || after.pin?.access_pin || null,
        durationMinutes: Number(pending?.durationMinutes || 20),
        needsConfirm: jobOutcome.state === "pending",
        lockJobState: jobOutcome.state,
        lockJobRaw: jobOutcome.raw,
        lockJobDiagnostics: {
          jobId,
          polls: jobOutcome.polls,
        },
        instructions: jobOutcome.state === "completed"
          ? [
            `PIN ${pending?.pin} is confirmed on the lock.`,
            "Walk to the lock, enter the PIN, and unlock.",
            "Then Sync Lock Activity — or Simulate Unlock / Simulate Lock.",
          ]
          : jobOutcome.state === "pending"
          ? [
            "Still waiting on the Bridge. Wake the padlock and try Check Bridge Delivery again.",
          ]
          : undefined,
        error: jobOutcome.state === "failed"
          ? "Bridge job failed. Wake the lock and run Setup again."
          : undefined,
      }, jobOutcome.state === "failed" ? 502 : 200);
    }

    // -------- algopin (bridge-free offline PIN) --------
    if (action === "algopin") {
      const durationMinutes = Math.min(
        Math.max(Number(body.durationMinutes ?? 20), 5),
        180,
      );
      const { data: booking, error } = await supabase
        .from("bookings")
        .select("*")
        .eq("id", bookingId)
        .single();
      if (error || !booking) {
        return jsonResponse({ success: false, error: "Booking not found" }, 404);
      }
      if (!clientId || !clientSecret || !lockId) {
        return jsonResponse({
          success: false,
          error: "Missing IGLOOHOME_CLIENT_ID / SECRET / LOCK_ID",
        }, 500);
      }
      const oauth = await getOAuthToken(clientId, clientSecret, GENERATE_PIN_SCOPES);
      if (!oauth.token) return jsonResponse({ success: false, error: oauth.reason }, 502);

      const existingSnap = booking.archive_details?.test_lock_snapshot;
      const snapshot = existingSnap || {
        drop_off_date: booking.drop_off_date,
        drop_off_time_slot: booking.drop_off_time_slot,
        pickup_date: booking.pickup_date,
        pickup_time_slot: booking.pickup_time_slot,
        status: booking.status,
        rented_out_at: booking.rented_out_at,
        returned_at: booking.returned_at,
        rental_started_notified_at: booking.rental_started_notified_at,
        return_notified_at: booking.return_notified_at,
        pin_generated_at: booking.pin_generated_at,
        saved_at: new Date().toISOString(),
      };
      const startLocal = new Date(Date.now() - 2 * 60 * 1000);
      const endLocal = new Date(Date.now() + durationMinutes * 60 * 1000);
      const startMst = toMstDateAndSlot(startLocal);
      const endMst = toMstDateAndSlot(endLocal);

      await supabase
        .from("rental_access_codes")
        .update({ status: "expired", lock_deleted_at: new Date().toISOString() })
        .eq("order_id", bookingId)
        .eq("status", "active");

      const startIso = floorToHourIso();
      const endIso = isoPlusMinutes(durationMinutes);
      const variance = Math.min(24, Math.max(1, Math.ceil(durationMinutes / 60)));
      const algo = await createOneTimeAlgoPin(
        oauth.token,
        lockId,
        startIso,
        variance,
        `TEST AlgoPIN - Order #${bookingId}`,
      );
      if (!algo.success) {
        return jsonResponse({ success: false, error: algo.error, raw: algo.raw }, 502);
      }

      const now = new Date().toISOString();
      await supabase
        .from("bookings")
        .update({
          drop_off_date: startMst.date,
          drop_off_time_slot: startMst.timeSlot,
          pickup_date: endMst.date,
          pickup_time_slot: endMst.timeSlot,
          status: "Confirmed",
          rented_out_at: null,
          returned_at: null,
          rental_started_notified_at: null,
          return_notified_at: null,
          pin_generated_at: now,
          pin_notification_sent_at: null,
          archive_details: {
            ...(booking.archive_details || {}),
            test_lock_snapshot: snapshot,
          },
        })
        .eq("id", bookingId);

      await supabase.from("rental_access_codes").insert({
        order_id: bookingId,
        customer_email: booking.email,
        customer_phone: booking.phone || "",
        access_pin: algo.pin,
        pin_id: algo.pinId,
        pin_type: "algopin",
        lock_id: lockId,
        start_time: startIso,
        end_time: endIso,
        status: "active",
        lock_confirmed_at: now,
        confirm_attempts: 0,
      });
      await supabase.from("rental_tracking_logs").insert({
        order_id: bookingId,
        event_type: "admin_override",
        event_timestamp: now,
        notes:
          `TEST algopin: one-time AlgoPIN ${algo.pin} (no bridge), ` +
          `${durationMinutes}min window from ${startIso}`,
      });

      const after = await fetchBookingStatus(supabase, bookingId);
      return jsonResponse({
        ...after,
        success: true,
        action: "algopin",
        pin: algo.pin,
        durationMinutes,
        lockJobState: "completed",
        needsConfirm: false,
        instructions: [
          `One-time AlgoPIN ${algo.pin} works offline — no bridge needed.`,
          "Enter it on the padlock followed by the unlock key to open.",
          "It is single-use: after unlocking, use Simulate Lock (or lock physically + Sync) to finish.",
          "Click Restore Dates when finished.",
        ],
      });
    }

    // -------- simulate_unlock --------
    if (action === "simulate_unlock") {
      const status = await fetchBookingStatus(supabase, bookingId);
      if (status.error) return jsonResponse({ success: false, error: status.error }, 404);
      const ts = body.eventTimestamp || new Date().toISOString();
      const result = await applyLockEvent(supabase, {
        orderId: bookingId,
        eventType: "unlock",
        eventTimestamp: ts,
        notes: "TEST simulate_unlock",
      });
      const after = await fetchBookingStatus(supabase, bookingId);
      return jsonResponse({ success: true, action: "simulate_unlock", result, ...after });
    }

    // -------- simulate_lock --------
    if (action === "simulate_lock") {
      const status = await fetchBookingStatus(supabase, bookingId);
      if (status.error) return jsonResponse({ success: false, error: status.error }, 404);
      const window = getBookingWindow(status.booking!);
      // Use max(now, scheduled end) so the return rule always fires
      const nowMs = Date.now();
      const eventMs = Math.max(nowMs, window.endMs);
      const ts = body.eventTimestamp || new Date(eventMs).toISOString();
      const result = await applyLockEvent(supabase, {
        orderId: bookingId,
        eventType: "lock",
        eventTimestamp: ts,
        notes: "TEST simulate_lock (timestamp forced to at/after scheduled end)",
      });
      const swept = await sweepGraceHourReturns(supabase);
      const after = await fetchBookingStatus(supabase, bookingId);
      return jsonResponse({
        success: true,
        action: "simulate_lock",
        result,
        graceHourClosed: swept,
        ...after,
      });
    }

    // -------- simulate_webhook --------
    // Runs the same device + booking path as igloohome-webhook in-process.
    // Do NOT HTTP-call the webhook from here: from inside the edge runtime that
    // self-fetch deadlocks until wall-clock kill, and the UI then shows a
    // misleading "Function not found (404)" toast.
    if (action === "simulate_webhook") {
      const status = await fetchBookingStatus(supabase, bookingId);
      if (status.error) {
        return jsonResponse({ success: false, error: status.error }, 400);
      }

      const kind = String(body.kind || "unlock");
      const logTypeByKind: Record<string, number> = { unlock: 50, lock: 49, breakin: 53 };
      const logType = Number(body.logType) || logTypeByKind[kind];
      if (!logType) {
        return jsonResponse({
          success: false,
          error: `Unknown kind "${kind}" — use unlock, lock or breakin, or pass logType.`,
        }, 400);
      }

      // Returns only register at/after the scheduled end, same as simulate_lock.
      const window = getBookingWindow(status.booking!);
      const eventMs = kind === "lock" ? Math.max(Date.now(), window.endMs) : Date.now();
      const entryDate = Math.floor(eventMs / 1000);
      const pin = status.pin?.access_pin || null;

      const rawEntry = {
        logType,
        entryDate,
        ...(pin && kind !== "breakin" ? { pin } : {}),
        keyId: `test-${bookingId}`,
        operationId: `test-${entryDate}-${kind}`,
        deviceId: lockId || undefined,
      };
      const parsed = parseActivityLogEntry(rawEntry);
      if (!parsed) {
        return jsonResponse({
          success: false,
          error: `Could not parse synthetic activity entry for logType ${logType}`,
          rawEntry,
        }, 400);
      }

      const events: LockActivityEvent[] = [parsed];
      const deviceTracking = await recordDeviceEvents(supabase, events, {
        deviceId: lockId || null,
        bridgeId: bridgeId || null,
      });

      const bookingActions: string[] = [];
      for (const recorded of deviceTracking.recorded) {
        if (recorded.event.eventType === "breakin") {
          await alertBreakInAttempt({
            deviceId: recorded.deviceId,
            occurredAt: recorded.event.eventTimestamp,
            orderId: recorded.orderId ?? bookingId,
          });
          bookingActions.push("alerted_breakin");
        }

        // Prefer the PIN-resolved booking; fall back to the test booking id so
        // Setup-less runs still exercise the state machine against this order.
        const orderId = recorded.orderId ?? bookingId;
        const actionResult = await applyLockEvent(supabase, {
          orderId,
          eventType: recorded.event.eventType,
          eventTimestamp: recorded.event.eventTimestamp,
          notes: `${recorded.event.eventType} via simulate_webhook (logType ${logType})`,
        });
        bookingActions.push(actionResult);
      }

      const swept = await sweepGraceHourReturns(supabase);
      const after = await fetchBookingStatus(supabase, bookingId);
      const { data: deviceState } = await supabase
        .from("lock_device_presence")
        .select("*")
        .eq("device_id", lockId || "")
        .maybeSingle();

      return jsonResponse({
        success: true,
        action: "simulate_webhook",
        kind,
        logType,
        pinUsed: pin ? "active booking PIN" : "none — matched to this booking id as fallback",
        mode: "in_process",
        deviceEventsStored: deviceTracking.stored,
        bookingActions,
        graceHourClosed: swept,
        deviceState,
        hint: !pin
          ? "No active PIN on this booking. Event still applied to this booking id. Run Setup for real PIN matching."
          : "Synthetic type-5 path ran in-process (same code as the webhook). Portal deliveries still hit /igloohome-webhook over HTTP.",
        ...after,
      });
    }

    // -------- sync / probe (bridge activity logs) --------
    if (action === "sync" || action === "probe") {
      if (!clientId || !clientSecret || !lockId || !bridgeId) {
        return jsonResponse({ success: false, error: "Missing Igloohome env" }, 500);
      }
      const oauth = await getActivitySyncToken(clientId, clientSecret);
      if (!oauth.token) {
        return jsonResponse({
          success: false,
          error: oauth.reason || ACTIVITY_SYNC_SCOPE_HINT,
          hint: ACTIVITY_SYNC_SCOPE_HINT,
        }, 502);
      }
      const accessToken = oauth.token;

      const createRes = await fetch(
        `${IGLOOHOME_API_BASE_URL}/devices/${lockId}/jobs/bridges/${bridgeId}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            jobType: 15,
            jobData: {
              lockTime: new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00"),
            },
          }),
        },
      );
      const createBody = await readResponse(createRes);
      const jobId = createBody.json?.jobId || createBody.json?.id;
      if ((!createRes.ok && createRes.status !== 201) || !jobId) {
        const detail = createBody.json?.message || createBody.json?.error ||
          createBody.text || "(empty response)";
        const hint = createRes.status === 401 || createRes.status === 403
          ? ` ${ACTIVITY_SYNC_SCOPE_HINT}`
          : "";
        return jsonResponse({
          success: false,
          error: `Activity log job failed: HTTP ${createRes.status}: ${
            String(detail).slice(0, 300)
          }.${hint}`,
          hint: createRes.status === 401 || createRes.status === 403
            ? ACTIVITY_SYNC_SCOPE_HINT
            : undefined,
          raw: createBody.json || createBody.text,
        }, 502);
      }

      let jobRaw: unknown = null;
      let completed = false;
      for (let i = 0; i < 24; i++) {
        await sleep(2500);
        const poll = await fetch(`${IGLOOHOME_API_BASE_URL}/jobs/${jobId}`, {
          headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
        });
        const pollBody = await readResponse(poll);
        jobRaw = pollBody.json;
        if (pollBody.json?.completed === true || pollBody.json?.jobResponse?.jobStatus === 0) {
          completed = true;
          break;
        }
        if (pollBody.json?.jobResponse?.jobStatus === 2) break;
      }

      // Bridge job body usually has no log array. Read cloud activity next.
      const activityOauth = await getDeviceActivityToken(clientId, clientSecret);
      let activityRows: unknown[] = [];
      let activityError: string | undefined;
      if (!activityOauth.token) {
        activityError = activityOauth.reason || DEVICE_ACTIVITY_SCOPE_HINT;
      } else {
        const fetched = await fetchDeviceActivityRows(activityOauth.token, lockId, {
          maxPages: 8,
          pageSize: 50,
        });
        activityRows = fetched.rows;
        if (fetched.error) activityError = fetched.error;
      }

      const events = mergeActivityEvents(jobRaw, activityRows);
      const emptyBridgePayload = isEmptyActivityLogPayload(jobRaw);
      const failedAttempts = (activityRows || [])
        .map(parseFailedPinAttempt)
        .filter(Boolean) as Array<{
          eventTimestamp: string;
          pinCode: string | null;
          activityType: string;
        }>;

      if (action === "probe") {
        return jsonResponse({
          success: true,
          probe: true,
          jobId,
          jobResult: jobRaw,
          emptyBridgePayload,
          activityRowsFetched: activityRows.length,
          activityError,
          activitySample: activityRows.slice(0, 3),
          parsedEvents: events,
        });
      }

      if (!completed) {
        return jsonResponse({
          success: false,
          error: "Activity log job did not complete — is the lock in bridge range?",
          jobId,
          raw: jobRaw,
        }, 504);
      }

      if (activityError && events.length === 0) {
        return jsonResponse({
          success: false,
          error: activityError,
          hint: DEVICE_ACTIVITY_SCOPE_HINT,
          jobId,
          emptyBridgePayload,
        }, 502);
      }

      // Match unlocks to this booking's PIN validity windows (not only the
      // compressed test schedule label). Pin-less AUTO_RELOCKs from months ago
      // must not count as "applied".
      const { data: pinRows } = await supabase
        .from("rental_access_codes")
        .select("access_pin, start_time, end_time, status")
        .eq("order_id", bookingId)
        .in("status", ["active", "expired", "used"])
        .order("created_at", { ascending: false })
        .limit(20);

      const bookingStatus = await fetchBookingStatus(supabase, bookingId);
      if ("error" in bookingStatus && bookingStatus.error && !bookingStatus.booking) {
        return jsonResponse({ success: false, error: bookingStatus.error }, 404);
      }
      const window = getBookingWindow(bookingStatus.booking || {});
      const pinSet = new Set(
        (pinRows || []).map((r: { access_pin?: string }) => String(r.access_pin || "")).filter(Boolean),
      );
      const activePinRow = (pinRows || []).find((r: { status?: string }) => r.status === "active") ||
        (pinRows || [])[0];
      const activePin = String(activePinRow?.access_pin || "");

      // Prefer each PIN's own validity; also allow booking window ±1h.
      const pinWindows = (pinRows || []).map((r: {
        access_pin?: string;
        start_time?: string;
        end_time?: string;
      }) => ({
        pin: String(r.access_pin || ""),
        lo: new Date(r.start_time || 0).getTime() - 60 * 60 * 1000,
        hi: new Date(r.end_time || 0).getTime() + 2 * 60 * 60 * 1000,
      })).filter((w: { pin: string; lo: number; hi: number }) =>
        w.pin && !Number.isNaN(w.lo) && !Number.isNaN(w.hi)
      );
      const windowLo = Math.min(
        window.startMs - 60 * 60 * 1000,
        ...pinWindows.map((w: { lo: number }) => w.lo),
      );
      const windowHi = Math.max(
        window.graceEndMs + 60 * 60 * 1000,
        ...pinWindows.map((w: { hi: number }) => w.hi),
      );

      function eventMatchesBooking(event: {
        eventType: string;
        eventTimestamp: string;
        pinCode: string | null;
      }): "ok" | "outside" | "pin_mismatch" | "no_pin" {
        const eventMs = new Date(event.eventTimestamp).getTime();
        if (Number.isNaN(eventMs)) return "outside";

        if (event.pinCode) {
          if (pinSet.size > 0 && !pinSet.has(event.pinCode)) return "pin_mismatch";
          const forPin = pinWindows.filter((w: { pin: string }) => w.pin === event.pinCode);
          if (forPin.length > 0) {
            if (forPin.some((w: { lo: number; hi: number }) => eventMs >= w.lo && eventMs <= w.hi)) {
              return "ok";
            }
            return "outside";
          }
          if (eventMs >= windowLo && eventMs <= windowHi) return "ok";
          return "outside";
        }

        if (event.eventType === "unlock") return "no_pin";

        // AUTO_RELOCK has no PIN — only after an unlock for this booking
        const alreadyRented = !!(bookingStatus.booking as { rented_out_at?: string } | null)
          ?.rented_out_at;
        const unlockInBatch = events.some(
          (e) =>
            e.eventType === "unlock" &&
            e.pinCode &&
            pinSet.has(e.pinCode) &&
            eventMatchesBooking(e) === "ok" &&
            new Date(e.eventTimestamp).getTime() <= eventMs,
        );
        if (!alreadyRented && !unlockInBatch) return "no_pin";
        if (eventMs < windowLo || eventMs > windowHi) return "outside";
        return "ok";
      }

      const actions: string[] = [];
      let skippedOutsideWindow = 0;
      let skippedPinMismatch = 0;
      let skippedNoPin = 0;
      for (const event of events) {
        const match = eventMatchesBooking(event);
        if (match === "outside") {
          skippedOutsideWindow += 1;
          continue;
        }
        if (match === "pin_mismatch") {
          skippedPinMismatch += 1;
          continue;
        }
        if (match === "no_pin") {
          skippedNoPin += 1;
          continue;
        }

        const result = await applyLockEvent(supabase, {
          orderId: bookingId,
          eventType: event.eventType,
          eventTimestamp: event.eventTimestamp,
          notes: `TEST sync job ${jobId}`,
        });
        actions.push(`${event.eventType}@${event.eventTimestamp}:${result}`);
      }

      // Raw cloud activity in the active PIN window (for diagnostics).
      const activeLo = activePinRow
        ? new Date(activePinRow.start_time).getTime() - 60 * 60 * 1000
        : windowLo;
      const activeHi = activePinRow
        ? new Date(activePinRow.end_time).getTime() + 2 * 60 * 60 * 1000
        : windowHi;
      let bridgeContactAt: string | null = null;
      let unlocksForActivePin = 0;
      for (const row of activityRows) {
        const rec = row as Record<string, unknown>;
        const ts = String(rec.localActionAt || rec.activityTimeAt || "");
        const ms = new Date(ts).getTime();
        if (Number.isNaN(ms) || ms < activeLo || ms > activeHi) continue;
        const type = String(rec.activityType || "");
        if (/SET_TIME|GENERATE_PIN/i.test(type) && (!bridgeContactAt || ts > bridgeContactAt)) {
          bridgeContactAt = ts;
        }
        if (/UNLOCK/i.test(type) && !/FAIL/i.test(type) && String(rec.pin || "") === activePin) {
          unlocksForActivePin += 1;
        }
      }

      const swept = await sweepGraceHourReturns(supabase);
      const after = await fetchBookingStatus(supabase, bookingId);
      const stateChanging = actions.filter((a) =>
        a.includes(":marked_rented") || a.includes(":marked_returned")
      );
      const failedInWindow = failedAttempts.filter((f) => {
        const ms = new Date(f.eventTimestamp).getTime();
        return ms >= activeLo && ms <= activeHi;
      });
      let bridgeHint: string | undefined;
      if (stateChanging.length > 0) {
        bridgeHint = undefined;
      } else if (failedInWindow.length > 0) {
        const last = failedInWindow.sort((a, b) =>
          a.eventTimestamp < b.eventTimestamp ? 1 : -1
        )[0];
        const tried = last.pinCode ? `…${last.pinCode.slice(-2)}` : "unknown";
        const expect = activePin ? `…${activePin.slice(-2)}` : "the Setup PIN";
        bridgeHint =
          `Igloohome recorded PIN_UNLOCK_FAILED at ${last.eventTimestamp} (tried PIN ending ${tried}). ` +
          `Active booking PIN ends with ${expect}. Use the exact PIN from Setup, unlock near the Bridge, wait ~30–60s, Sync again.`;
      } else if (activePin && unlocksForActivePin === 0) {
        bridgeHint = bridgeContactAt
          ? `Bridge reached the padlock (${bridgeContactAt}) but Igloohome has no unlock for PIN …${activePin.slice(-2)}. ` +
            `Stand within a few feet of the Bridge, unlock with ${activePin}, wait for the lock LED to finish, then Sync again. ` +
            `If it still fails: open the Igloo Home app → this lock → Logs → Sync (phone Bluetooth against the lock), then Sync here. ` +
            `Or use Simulate Unlock to advance admin without waiting on Igloohome logs.`
          : `Igloohome has no unlock for PIN …${activePin.slice(-2)} yet. Unlock with that PIN while the padlock is next to the Bridge, wait ~30–60s, Sync again. ` +
            `Or use Simulate Unlock.`;
      } else if (events.length === 0) {
        bridgeHint = activityRows.length === 0
          ? "Bridge pull finished, but Igloohome cloud has no activity rows yet."
          : `Fetched ${activityRows.length} activity row(s), but none were unlock/lock events.`;
      } else {
        bridgeHint =
          `No rented/returned update (skipped: ${skippedOutsideWindow} outside PIN window, ${skippedPinMismatch} other PIN, ${skippedNoPin} no PIN).`;
      }
      return jsonResponse({
        success: true,
        action: "sync",
        jobId,
        eventsParsed: events.length,
        eventsRelevant: actions.length,
        stateChanging: stateChanging.length,
        activityRowsFetched: activityRows.length,
        actions,
        skipped: {
          outsideWindow: skippedOutsideWindow,
          pinMismatch: skippedPinMismatch,
          noPin: skippedNoPin,
        },
        diagnostics: {
          activePinSuffix: activePin ? activePin.slice(-2) : null,
          unlocksForActivePin,
          bridgeContactAt,
        },
        failedUnlockAttemptsInWindow: failedInWindow.map((f) => ({
          eventTimestamp: f.eventTimestamp,
          pinSuffix: f.pinCode ? f.pinCode.slice(-2) : null,
          activityType: f.activityType,
        })),
        emptyBridgePayload,
        bridgeHint,
        graceHourClosed: swept,
        ...after,
      });
    }

    return jsonResponse({
      success: false,
      error: `Unknown action: ${action}. Use status|setup|restore|simulate_unlock|simulate_lock|sync|probe|remote_lock|remote_unlock`,
    }, 400);
  } catch (error) {
    console.error("[test-lock-lifecycle] Unhandled:", error);
    return jsonResponse({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }, 500);
  }
});
