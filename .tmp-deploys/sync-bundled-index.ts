// === inlined _shared/cors.ts ===
const ALLOWED_HEADERS = 'authorization, x-client-info, apikey, content-type';
const ALLOWED_METHODS = 'GET, POST, PUT, PATCH, DELETE, OPTIONS';

function parseAllowedOrigins(): Set<string> {
  const raw = Deno.env.get('ALLOWED_ORIGINS') ?? '';
  return new Set(
    raw
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
}

let cachedOrigins: Set<string> | null = null;

function getAllowedOrigins(): Set<string> {
  if (!cachedOrigins) {
    cachedOrigins = parseAllowedOrigins();
  }
  return cachedOrigins;
}

/** Origin-aware CORS headers. Set ALLOWED_ORIGINS (comma-separated) in env. */
function getCorsHeaders(req: Request): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': ALLOWED_HEADERS,
    'Access-Control-Allow-Methods': ALLOWED_METHODS,
  };

  const origin = req.headers.get('Origin');
  if (origin && getAllowedOrigins().has(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Vary'] = 'Origin';
  }

  return headers;
}


// === inlined _shared/pinTiming.ts ===
const PIN_LEAD_TIME_MS = 12 * 60 * 60 * 1000;
/** Extra hour the padlock PIN stays valid after the scheduled booking end. */
const RETURN_GRACE_MS = 60 * 60 * 1000;

type BookingWindowFields = {
  drop_off_date?: string | null;
  drop_off_time_slot?: string | null;
  pickup_date?: string | null;
  pickup_time_slot?: string | null;
};

/**
 * Parse a time slot like "6:00 AM" and convert MST -> UTC.
 * MST is UTC-6, so we add 6 hours. Falls back to fallbackHourUTC if unparseable.
 */
function buildBookingDateUTC(
  date: string,
  timeSlot: string | null | undefined,
  fallbackHourUTC: number,
): string {
  const pad = (n: number) => String(n).padStart(2, "0");

  if (timeSlot) {
    const match = timeSlot.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (match) {
      let hour = parseInt(match[1], 10);
      const minute = parseInt(match[2], 10);
      const meridiem = match[3].toUpperCase();
      if (meridiem === "PM" && hour !== 12) hour += 12;
      if (meridiem === "AM" && hour === 12) hour = 0;
      const utcHour = hour + 6;
      if (utcHour >= 24) {
        const nextDay = new Date(date + "T00:00:00Z");
        nextDay.setUTCDate(nextDay.getUTCDate() + 1);
        const nextDayStr = nextDay.toISOString().split("T")[0];
        return `${nextDayStr}T${pad(utcHour - 24)}:${pad(minute)}:00+00:00`;
      }
      return `${date}T${pad(utcHour)}:${pad(minute)}:00+00:00`;
    }
  }

  return `${date}T${pad(fallbackHourUTC)}:00:00+00:00`;
}

/** Add RETURN_GRACE_MS to an ISO date string and return a new ISO (+00:00) string. */
function addGraceHour(isoDate: string): string {
  const ms = new Date(isoDate).getTime() + RETURN_GRACE_MS;
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "+00:00");
}

function getBookingWindow(booking: BookingWindowFields) {
  const startIso = buildBookingDateUTC(
    booking.drop_off_date ?? "",
    booking.drop_off_time_slot,
    12,
  );
  const endIso = buildBookingDateUTC(
    booking.pickup_date ?? "",
    booking.pickup_time_slot,
    5,
  );

  const startMs = new Date(startIso).getTime();
  const endMs = new Date(endIso).getTime();
  const graceEndMs = endMs + RETURN_GRACE_MS;
  const graceEndIso = new Date(graceEndMs).toISOString().replace(/\.\d{3}Z$/, "+00:00");

  return {
    startMs,
    endMs,
    graceEndMs,
    pinEligibleFromMs: startMs - PIN_LEAD_TIME_MS,
    startIso,
    endIso,
    graceEndIso,
  };
}

function isWithinPinGenerationWindow(
  booking: BookingWindowFields,
  now: Date = new Date(),
): boolean {
  if (!booking.drop_off_date || !booking.pickup_date) return false;
  const { pinEligibleFromMs, graceEndMs } = getBookingWindow(booking);
  const nowMs = now.getTime();
  return nowMs >= pinEligibleFromMs && nowMs < graceEndMs;
}

function isBookingEnded(
  booking: BookingWindowFields,
  now: Date = new Date(),
): boolean {
  if (!booking.pickup_date) return false;
  const { graceEndMs } = getBookingWindow(booking);
  return now.getTime() >= graceEndMs;
}

function getPinWindowSkipReason(
  booking: BookingWindowFields,
  now: Date = new Date(),
): "too_early" | "ended" | null {
  if (!booking.drop_off_date || !booking.pickup_date) return "too_early";
  const { pinEligibleFromMs, graceEndMs } = getBookingWindow(booking);
  const nowMs = now.getTime();
  if (nowMs < pinEligibleFromMs) return "too_early";
  if (nowMs >= graceEndMs) return "ended";
  return null;
}


// === inlined _shared/iglooActivity.ts ===
/**
 * Flexible parsers for Igloohome bridge activity-log payloads.
 * Field names vary across API versions — probe mode logs the raw shape.
 */

type LockActivityEvent = {
  eventType: "unlock" | "lock";
  eventTimestamp: string;
  pinCode: string | null;
  raw: Record<string, unknown>;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function pickString(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const val = obj[key];
    if (typeof val === "string" && val.trim()) return val.trim();
    if (typeof val === "number") return String(val);
  }
  return null;
}

function normalizeEventType(raw: string | null): "unlock" | "lock" | null {
  if (!raw) return null;
  const lower = raw.toLowerCase().replace(/[\s_-]+/g, "");
  if (
    lower.includes("unlock") ||
    lower === "open" ||
    lower === "unlocked" ||
    lower === "pinunlock" ||
    lower === "accessgranted"
  ) {
    return "unlock";
  }
  if (
    lower.includes("lock") ||
    lower === "close" ||
    lower === "locked" ||
    lower === "relock" ||
    lower === "autolock"
  ) {
    // "unlock" already matched above; bare "lock" / "relock"
    if (lower.includes("unlock")) return "unlock";
    return "lock";
  }
  return null;
}

function extractTimestamp(entry: Record<string, unknown>): string | null {
  const raw = pickString(entry, [
    "timestamp",
    "eventTimestamp",
    "event_timestamp",
    "time",
    "date",
    "createdAt",
    "created_at",
    "lockTime",
    "activityTime",
  ]);
  if (!raw) return null;
  const ms = new Date(raw).getTime();
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString();
}

function extractPin(entry: Record<string, unknown>): string | null {
  return pickString(entry, [
    "pin",
    "pinCode",
    "pin_code",
    "accessCode",
    "access_code",
    "code",
    "pinValue",
  ]);
}

function extractTypeRaw(entry: Record<string, unknown>): string | null {
  const typeVal = entry.type ?? entry.eventType ?? entry.event_type ?? entry.action ??
    entry.activityType ?? entry.activity_type ?? entry.operation ?? entry.op;
  if (typeof typeVal === "number") {
    // Common numeric mappings seen in lock vendors: unlock-ish vs lock-ish
    // We treat odd/even heuristically only as last resort via string path.
    return String(typeVal);
  }
  if (typeof typeVal === "string") return typeVal;
  return null;
}

/** Parse a single activity log entry into a normalized event, or null if unusable. */
function parseActivityLogEntry(entry: unknown): LockActivityEvent | null {
  const obj = asRecord(entry);
  if (!obj) return null;

  // Nested data wrappers
  const nested = asRecord(obj.data) || asRecord(obj.event) || asRecord(obj.activity) || obj;
  const eventType = normalizeEventType(extractTypeRaw(nested) || extractTypeRaw(obj));
  const eventTimestamp = extractTimestamp(nested) || extractTimestamp(obj);
  if (!eventType || !eventTimestamp) return null;

  return {
    eventType,
    eventTimestamp,
    pinCode: extractPin(nested) || extractPin(obj),
    raw: obj,
  };
}

/**
 * Walk a job response / webhook body and collect activity log arrays from
 * common nesting locations.
 */
function extractActivityLogArrays(payload: unknown): unknown[][] {
  const arrays: unknown[][] = [];
  const root = asRecord(payload);
  if (!root) return arrays;

  const candidates = [
    root.activityLogs,
    root.activity_logs,
    root.logs,
    root.events,
    root.history,
    root.payload,
    asRecord(root.jobResponse)?.activityLogs,
    asRecord(root.jobResponse)?.activity_logs,
    asRecord(root.jobResponse)?.logs,
    asRecord(root.jobResponse)?.events,
    asRecord(asRecord(root.jobResponse)?.opResult || {})?.activityLogs,
    asRecord(asRecord(root.jobResponse)?.opResult || {})?.logs,
    asRecord(root.event)?.data,
    asRecord(asRecord(root.event)?.data || {})?.activityLogs,
    asRecord(asRecord(root.event)?.data || {})?.logs,
  ];

  for (const c of candidates) {
    if (Array.isArray(c)) arrays.push(c);
    else if (asRecord(c) && Array.isArray((c as Record<string, unknown>).logs)) {
      arrays.push((c as Record<string, unknown>).logs as unknown[]);
    }
  }

  // Deep scan one level for any array of objects that look like log entries
  if (arrays.length === 0) {
    for (const value of Object.values(root)) {
      if (Array.isArray(value) && value.length > 0 && asRecord(value[0])) {
        arrays.push(value);
      }
      const nested = asRecord(value);
      if (nested) {
        for (const inner of Object.values(nested)) {
          if (Array.isArray(inner) && inner.length > 0 && asRecord(inner[0])) {
            arrays.push(inner);
          }
        }
      }
    }
  }

  return arrays;
}

function parseActivityLogsFromPayload(payload: unknown): LockActivityEvent[] {
  const events: LockActivityEvent[] = [];
  const seen = new Set<string>();
  for (const arr of extractActivityLogArrays(payload)) {
    for (const entry of arr) {
      const parsed = parseActivityLogEntry(entry);
      if (!parsed) continue;
      const key = `${parsed.eventType}|${parsed.eventTimestamp}|${parsed.pinCode || ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      events.push(parsed);
    }
  }
  // Also try treating the payload itself as a single event (webhook)
  const single = parseActivityLogEntry(payload) ||
    parseActivityLogEntry(asRecord(payload)?.event) ||
    parseActivityLogEntry(asRecord(asRecord(payload)?.event || {})?.data);
  if (single) {
    const key = `${single.eventType}|${single.eventTimestamp}|${single.pinCode || ""}`;
    if (!seen.has(key)) events.push(single);
  }
  return events.sort(
    (a, b) => new Date(a.eventTimestamp).getTime() - new Date(b.eventTimestamp).getTime(),
  );
}


// === inlined _shared/lockEventState.ts ===
/**
 * Lock-event state machine for self-pickup rentals.
 * - First unlock at/after booking start → Mark Rented (status Delivered + rented_out_at)
 * - Lock at/after scheduled end → Mark Returned (status pending_checklist + returned_at)
 * - Grace-hour sweep closes rentals whose last lock fell in/after the end window
 */

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

type LockEventInput = {
  orderId: number;
  eventType: "unlock" | "lock";
  eventTimestamp: string;
  notes?: string;
};

function isCustomerPickupBooking(booking: Record<string, unknown>): boolean {
  const plan = (booking.plan || {}) as Record<string, unknown>;
  const addons = (booking.addons || {}) as Record<string, unknown>;
  if (addons.isDelivery || addons.deliveryService) return false;
  if (plan.customer_pickup === true) return true;
  const id = Number(plan.id);
  return id === 2 || id === 5;
}

async function invokeNotify(
  supabase: SupabaseClient,
  functionName: string,
  body: Record<string, unknown>,
): Promise<void> {
  const base = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!base || !key) {
    console.error(`[lockEventState] Missing SUPABASE_URL/SERVICE_ROLE_KEY for ${functionName}`);
    return;
  }
  try {
    const res = await fetch(`${base}/functions/v1/${functionName}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.error(`[lockEventState] ${functionName} failed:`, await res.text());
    }
  } catch (err) {
    console.error(`[lockEventState] ${functionName} exception:`, err);
  }
}

/** Insert a tracking log, ignoring unique-constraint duplicates. Returns true if inserted. */
async function insertTrackingLog(
  supabase: SupabaseClient,
  event: LockEventInput,
): Promise<boolean> {
  const { error } = await supabase.from("rental_tracking_logs").insert({
    order_id: event.orderId,
    event_type: event.eventType,
    event_timestamp: event.eventTimestamp,
    api_sync_timestamp: new Date().toISOString(),
    notes: event.notes || `${event.eventType} event via lock sync`,
  });
  if (error) {
    // Unique violation = already ingested
    if (error.code === "23505" || String(error.message || "").includes("duplicate")) {
      return false;
    }
    console.error(`[lockEventState] insertTrackingLog error:`, error);
    return false;
  }
  return true;
}

async function markRented(
  supabase: SupabaseClient,
  booking: Record<string, unknown>,
  eventTimestamp: string,
): Promise<boolean> {
  if (booking.rented_out_at) return false;
  const { error } = await supabase
    .from("bookings")
    .update({
      rented_out_at: eventTimestamp,
      status: "Delivered",
    })
    .eq("id", booking.id)
    .is("rented_out_at", null);
  if (error) {
    console.error(`[lockEventState] markRented failed for #${booking.id}:`, error);
    return false;
  }
  console.log(`[lockEventState] Booking #${booking.id} marked Rented at ${eventTimestamp}`);

  if (!booking.rental_started_notified_at) {
    await invokeNotify(supabase, "send-rental-started", {
      order_id: booking.id,
      unlock_timestamp: eventTimestamp,
    });
  }
  return true;
}

async function markReturned(
  supabase: SupabaseClient,
  booking: Record<string, unknown>,
  eventTimestamp: string,
): Promise<boolean> {
  if (!booking.rented_out_at || booking.returned_at) return false;
  const { error } = await supabase
    .from("bookings")
    .update({
      returned_at: eventTimestamp,
      status: "pending_checklist",
    })
    .eq("id", booking.id)
    .is("returned_at", null)
    .not("rented_out_at", "is", null);
  if (error) {
    console.error(`[lockEventState] markReturned failed for #${booking.id}:`, error);
    return false;
  }
  console.log(`[lockEventState] Booking #${booking.id} marked Returned at ${eventTimestamp}`);

  if (!booking.return_notified_at) {
    await invokeNotify(supabase, "send-return-confirmation", {
      order_id: booking.id,
      lock_event_timestamp: eventTimestamp,
    });
  }
  return true;
}

/**
 * Apply a single lock/unlock event to the matching booking.
 * Returns a short action description for logging.
 */
async function applyLockEvent(
  supabase: SupabaseClient,
  event: LockEventInput,
): Promise<string> {
  const inserted = await insertTrackingLog(supabase, event);

  const { data: booking, error } = await supabase
    .from("bookings")
    .select(
      "id, status, plan, addons, drop_off_date, drop_off_time_slot, pickup_date, pickup_time_slot, rented_out_at, returned_at, rental_started_notified_at, return_notified_at",
    )
    .eq("id", event.orderId)
    .single();

  if (error || !booking) {
    return inserted ? "logged_no_booking" : "skipped";
  }

  if (!isCustomerPickupBooking(booking)) {
    return inserted ? "logged_not_self_pickup" : "skipped";
  }

  const window = getBookingWindow(booking);
  const eventMs = new Date(event.eventTimestamp).getTime();
  if (Number.isNaN(eventMs)) return "invalid_timestamp";

  if (event.eventType === "unlock") {
    if (eventMs >= window.startMs && !booking.rented_out_at) {
      await markRented(supabase, booking, event.eventTimestamp);
      return "marked_rented";
    }
    return inserted ? "logged_unlock" : "duplicate_unlock";
  }

  // lock event
  if (
    eventMs >= window.endMs &&
    booking.rented_out_at &&
    !booking.returned_at
  ) {
    await markReturned(supabase, booking, event.eventTimestamp);
    return "marked_returned";
  }
  return inserted ? "logged_lock" : "duplicate_lock";
}

/**
 * After ingesting events, close any self-pickup rental whose grace hour has
 * passed and that has a lock event at/after the scheduled end but no returned_at.
 */
async function sweepGraceHourReturns(
  supabase: SupabaseClient,
  now: Date = new Date(),
): Promise<number> {
  const { data: candidates, error } = await supabase
    .from("bookings")
    .select(
      "id, status, plan, addons, drop_off_date, drop_off_time_slot, pickup_date, pickup_time_slot, rented_out_at, returned_at, rental_started_notified_at, return_notified_at",
    )
    .not("rented_out_at", "is", null)
    .is("returned_at", null)
    .not("status", "in", '("Cancelled","Completed","flagged")');

  if (error || !candidates?.length) {
    if (error) console.error("[lockEventState] sweepGraceHourReturns query error:", error);
    return 0;
  }

  let closed = 0;
  const nowMs = now.getTime();

  for (const booking of candidates) {
    if (!isCustomerPickupBooking(booking)) continue;
    const window = getBookingWindow(booking);
    if (nowMs < window.graceEndMs) continue;

    const { data: lockEvent } = await supabase
      .from("rental_tracking_logs")
      .select("event_timestamp")
      .eq("order_id", booking.id)
      .eq("event_type", "lock")
      .gte("event_timestamp", new Date(window.endMs).toISOString())
      .order("event_timestamp", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!lockEvent?.event_timestamp) continue;

    const ok = await markReturned(supabase, booking, lockEvent.event_timestamp);
    if (ok) closed += 1;
  }

  return closed;
}

/**
 * Resolve order_id from a PIN by looking up active rental_access_codes whose
 * validity window covers the event timestamp.
 */
async function resolveOrderIdByPin(
  supabase: SupabaseClient,
  pinCode: string | null,
  eventTimestamp: string,
): Promise<number | null> {
  if (!pinCode) return null;
  const { data, error } = await supabase
    .from("rental_access_codes")
    .select("order_id, start_time, end_time, status")
    .eq("access_pin", pinCode)
    .in("status", ["active", "expired", "used"])
    .order("created_at", { ascending: false })
    .limit(10);

  if (error || !data?.length) return null;

  const eventMs = new Date(eventTimestamp).getTime();
  for (const row of data) {
    const start = new Date(row.start_time).getTime();
    const end = new Date(row.end_time).getTime();
    // Allow a small buffer before start (early unlock attempts) and after end
    if (eventMs >= start - 60 * 60 * 1000 && eventMs <= end + 2 * 60 * 60 * 1000) {
      return Number(row.order_id);
    }
  }
  // Fallback: most recent matching PIN
  return Number(data[0].order_id);
}


// === sync-lock-activity index ===
/**
 * sync-lock-activity
 *
 * Polls the Igloohome bridge for lock activity logs (jobType 15), matches PINs
 * to bookings, writes rental_tracking_logs, and advances the rented/returned
 * state machine.
 *
 * Probe mode: POST { "probe": true } or ?probe=1 — returns raw job response
 * without applying state changes (use once to confirm payload shape).
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
const IGLOOHOME_OAUTH_URL = "https://auth.igloohome.co/oauth2/token";
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

async function getOAuthToken(clientId: string, clientSecret: string) {
  const credentials = btoa(`${clientId}:${clientSecret}`);
  const res = await fetch(IGLOOHOME_OAUTH_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: [
        "igloohomeapi/create-pin-bridge-proxied-job",
        "igloohomeapi/create-bridge-proxied-job",
        "igloohomeapi/get-devices",
        "igloohomeapi/get-job-status",
        "igloohomeapi/algopin-onetime",
        "igloohomeapi/store-device-activity",
      ].join(" "),
    }),
  });
  const body = await readResponse(res);
  if (!res.ok || !body.json?.access_token) {
    console.error("[sync-lock-activity] OAuth failed:", body.text);
    return null;
  }
  return body.json.access_token as string;
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

    const accessToken = await getOAuthToken(clientId, clientSecret);
    if (!accessToken) {
      return jsonResponse({ success: false, error: "OAuth failed" }, 502);
    }

    const jobCreate = await createActivityLogJob(accessToken, lockId, bridgeId);
    if (!jobCreate.success) {
      return jsonResponse({
        success: false,
        error: `Activity log job failed: ${jobCreate.error}`,
        raw: jobCreate.raw,
        probe,
      }, 502);
    }

    const jobResult = await pollJobStatus(accessToken, jobCreate.jobId);
    if (probe) {
      return jsonResponse({
        success: true,
        probe: true,
        jobId: jobCreate.jobId,
        jobCreate: jobCreate.raw,
        jobResult: jobResult.raw,
        parsedEvents: parseActivityLogsFromPayload(jobResult.raw),
        message: "Probe complete — inspect jobResult / parsedEvents to confirm field mapping",
      });
    }

    if (!jobResult.completed) {
      return jsonResponse({
        success: false,
        error: jobResult.expired ? "Job expired" : "Job timed out",
        jobId: jobCreate.jobId,
        raw: jobResult.raw,
      }, 504);
    }

    const events = parseActivityLogsFromPayload(jobResult.raw);
    console.log(`[sync-lock-activity] Parsed ${events.length} events from job ${jobCreate.jobId}`);

    const supabase = createClient(supabaseUrl, serviceKey);
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
      actions,
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
