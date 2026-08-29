// index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

// cors_shared.ts
var ALLOWED_HEADERS = "authorization, x-client-info, apikey, content-type";
var ALLOWED_METHODS = "GET, POST, PUT, PATCH, DELETE, OPTIONS";
function parseAllowedOrigins() {
  const raw = Deno.env.get("ALLOWED_ORIGINS") ?? "";
  return new Set(
    raw.split(",").map((origin) => origin.trim()).filter(Boolean)
  );
}
var cachedOrigins = null;
function getAllowedOrigins() {
  if (!cachedOrigins) {
    cachedOrigins = parseAllowedOrigins();
  }
  return cachedOrigins;
}
function getCorsHeaders(req) {
  const headers = {
    "Access-Control-Allow-Headers": ALLOWED_HEADERS,
    "Access-Control-Allow-Methods": ALLOWED_METHODS
  };
  const origin = req.headers.get("Origin");
  if (origin && getAllowedOrigins().has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Vary"] = "Origin";
  }
  return headers;
}

// pinTiming.ts
var PIN_LEAD_TIME_MS = 12 * 60 * 60 * 1e3;
var RETURN_GRACE_MS = 60 * 60 * 1e3;
var PIN_EARLY_ACTIVATION_MS = 5 * 60 * 1e3;
function buildBookingDateUTC(date, timeSlot, fallbackHourUTC) {
  const pad = (n) => String(n).padStart(2, "0");
  if (timeSlot) {
    const match = timeSlot.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (match) {
      let hour = parseInt(match[1], 10);
      const minute = parseInt(match[2], 10);
      const meridiem = match[3].toUpperCase();
      if (meridiem === "PM" && hour !== 12)
        hour += 12;
      if (meridiem === "AM" && hour === 12)
        hour = 0;
      const utcHour = hour + 6;
      if (utcHour >= 24) {
        const nextDay = /* @__PURE__ */ new Date(date + "T00:00:00Z");
        nextDay.setUTCDate(nextDay.getUTCDate() + 1);
        const nextDayStr = nextDay.toISOString().split("T")[0];
        return `${nextDayStr}T${pad(utcHour - 24)}:${pad(minute)}:00+00:00`;
      }
      return `${date}T${pad(utcHour)}:${pad(minute)}:00+00:00`;
    }
  }
  return `${date}T${pad(fallbackHourUTC)}:00:00+00:00`;
}
function addGraceHour(isoDate) {
  const ms = new Date(isoDate).getTime() + RETURN_GRACE_MS;
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "+00:00");
}
function clampIgloohomeStart(isoDate, now = /* @__PURE__ */ new Date()) {
  const hourFloor = new Date(now.getTime());
  hourFloor.setUTCMinutes(0, 0, 0);
  const ms = Math.max(new Date(isoDate).getTime(), hourFloor.getTime());
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "+00:00");
}
function getBookingWindow(booking) {
  const startIso = buildBookingDateUTC(
    booking.drop_off_date ?? "",
    booking.drop_off_time_slot,
    12
  );
  const endIso = buildBookingDateUTC(
    booking.pickup_date ?? "",
    booking.pickup_time_slot,
    5
  );
  const startMs = new Date(startIso).getTime();
  const endMs = new Date(endIso).getTime();
  const graceEndMs = endMs + RETURN_GRACE_MS;
  const graceEndIso = new Date(graceEndMs).toISOString().replace(/\.\d{3}Z$/, "+00:00");
  const activationMs = startMs - PIN_EARLY_ACTIVATION_MS;
  const activationIso = new Date(activationMs).toISOString().replace(/\.\d{3}Z$/, "+00:00");
  return {
    startMs,
    endMs,
    graceEndMs,
    pinEligibleFromMs: startMs - PIN_LEAD_TIME_MS,
    activationMs,
    activationIso,
    startIso,
    endIso,
    graceEndIso
  };
}
function getPinActivationStart(booking, now = /* @__PURE__ */ new Date()) {
  const { activationIso } = getBookingWindow(booking);
  return clampIgloohomeStart(activationIso, now);
}
function isWithinPinGenerationWindow(booking, now = /* @__PURE__ */ new Date()) {
  if (!booking.drop_off_date || !booking.pickup_date)
    return false;
  const { pinEligibleFromMs, graceEndMs } = getBookingWindow(booking);
  const nowMs = now.getTime();
  return nowMs >= pinEligibleFromMs && nowMs < graceEndMs;
}
function isBookingEnded(booking, now = /* @__PURE__ */ new Date()) {
  if (!booking.pickup_date)
    return false;
  const { graceEndMs } = getBookingWindow(booking);
  return now.getTime() >= graceEndMs;
}

// lockPin.ts
var IGLOOHOME_API_BASE_URL = "https://api.igloodeveloper.co/igloohome";
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
async function readResponse(res) {
  const text = await res.text();
  try {
    return { text, json: text ? JSON.parse(text) : null };
  } catch {
    return { text, json: null };
  }
}
async function pollJob(accessToken, jobId, budgetMs = 45e3, delayMs = 2500) {
  const polls = [];
  let raw = null;
  const deadline = Date.now() + budgetMs;
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt += 1;
    await sleep(delayMs);
    if (Date.now() >= deadline && attempt > 1)
      break;
    const res = await fetch(`${IGLOOHOME_API_BASE_URL}/jobs/${jobId}`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" }
    });
    const body = await readResponse(res);
    raw = body.json ?? body.text;
    const jobResponse = body.json?.jobResponse;
    const jobStatus = jobResponse?.jobStatus;
    const completed = body.json?.completed;
    polls.push({
      attempt,
      httpStatus: res.status,
      completed: completed ?? null,
      jobStatus: jobStatus ?? null
    });
    if (completed === true || jobStatus === 0) {
      return { state: "completed", raw, polls };
    }
    if (jobStatus === 2) {
      return { state: "failed", raw, polls };
    }
  }
  return { state: "pending", raw, polls };
}
async function deletePinVerified(accessToken, lockId, bridgeId, pin, budgetMs = 45e3) {
  const url = `${IGLOOHOME_API_BASE_URL}/devices/${lockId}/jobs/bridges/${bridgeId}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({ jobType: 5, jobData: { pin } })
  });
  const body = await readResponse(res);
  if (!res.ok && res.status !== 201) {
    return {
      ok: false,
      jobId: "",
      state: "failed",
      polls: [],
      error: `Delete failed HTTP ${res.status}: ${body.json?.error ?? body.text}`
    };
  }
  const jobId = String(body.json?.jobId || body.json?.pinId || body.json?.id || "");
  if (!jobId) {
    return { ok: false, jobId: "", state: "pending", polls: [], error: "Delete accepted but no jobId returned" };
  }
  const poll = await pollJob(accessToken, jobId, budgetMs);
  return {
    ok: poll.state === "completed",
    jobId,
    state: poll.state,
    polls: poll.polls,
    error: poll.state === "failed" ? "Lock rejected delete job" : void 0
  };
}
async function clearKnownPins(supabase, accessToken, orderId, opts) {
  const budgetMs = opts.budgetMs ?? 6e4;
  const settleMs = opts.settleMs ?? 15e3;
  const deadline = Date.now() + budgetMs;
  const details = [];
  const { data: rows } = await supabase.from("rental_access_codes").select("id, access_pin, pin_type, status, lock_deleted_at").eq("order_id", orderId).is("lock_deleted_at", null);
  let attempted = 0;
  let confirmed = 0;
  let failed = 0;
  let pending = 0;
  for (const row of rows || []) {
    if (Date.now() >= deadline) {
      pending += 1;
      details.push({ id: row.id, pin: row.access_pin, skipped: true, reason: "budget_exhausted" });
      continue;
    }
    if (row.pin_type === "algopin") {
      await supabase.from("rental_access_codes").update({
        status: row.status === "active" ? "expired" : row.status,
        lock_deleted_at: (/* @__PURE__ */ new Date()).toISOString()
      }).eq("id", row.id);
      confirmed += 1;
      details.push({ id: row.id, pin: row.access_pin, pin_type: "algopin", state: "db_only" });
      continue;
    }
    if (!row.access_pin)
      continue;
    attempted += 1;
    const remaining = Math.max(5e3, deadline - Date.now());
    const perJobBudget = Math.min(45e3, remaining);
    const result = await deletePinVerified(
      accessToken,
      opts.lockId,
      opts.bridgeId,
      row.access_pin,
      perJobBudget
    );
    details.push({
      id: row.id,
      pin: row.access_pin,
      jobId: result.jobId,
      state: result.state,
      error: result.error ?? null
    });
    if (result.ok) {
      confirmed += 1;
      await supabase.from("rental_access_codes").update({
        status: "expired",
        lock_deleted_at: (/* @__PURE__ */ new Date()).toISOString()
      }).eq("id", row.id);
    } else if (result.state === "failed") {
      failed += 1;
      await supabase.from("rental_access_codes").update({ status: "expired" }).eq("id", row.id).eq("status", "active");
    } else {
      pending += 1;
      await supabase.from("rental_access_codes").update({ status: "expired" }).eq("id", row.id).eq("status", "active");
    }
    if (Date.now() + settleMs < deadline && attempted < (rows || []).length) {
      await sleep(settleMs);
    }
  }
  return { attempted, confirmed, failed, pending, details };
}
async function createPinVerified(accessToken, lockId, bridgeId, pin, startDate, endDate, accessName, budgetMs = 6e4) {
  const url = `${IGLOOHOME_API_BASE_URL}/devices/${lockId}/jobs/bridges/${bridgeId}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({
      jobType: 4,
      jobData: { accessName, pin, pinType: 4, startDate, endDate }
    })
  });
  const body = await readResponse(res);
  if (!res.ok && res.status !== 201) {
    return {
      success: false,
      pin,
      jobId: "",
      state: "failed",
      polls: [],
      raw: body.json ?? body.text,
      error: `Create failed HTTP ${res.status}: ${body.json?.error ?? body.text}`
    };
  }
  const jobId = String(body.json?.jobId || body.json?.pinId || body.json?.id || "");
  if (!jobId) {
    return {
      success: false,
      pin,
      jobId: "",
      state: "pending",
      polls: [],
      raw: body.json,
      error: "Create accepted but no jobId returned"
    };
  }
  const poll = await pollJob(accessToken, jobId, budgetMs);
  return {
    success: poll.state === "completed",
    pin,
    jobId,
    state: poll.state,
    polls: poll.polls,
    raw: poll.raw,
    error: poll.state === "failed" ? "Lock rejected PIN create job" : poll.state === "pending" ? "Bridge has not confirmed PIN delivery yet" : void 0
  };
}
async function ensurePinOnLock(supabase, accessToken, opts) {
  const pin = opts.pin || String(Math.floor(Math.random() * 9e5) + 1e5);
  const clear = await clearKnownPins(supabase, accessToken, opts.orderId, {
    lockId: opts.lockId,
    bridgeId: opts.bridgeId,
    budgetMs: opts.clearBudgetMs ?? 5e4,
    settleMs: opts.settleMs ?? 15e3
  });
  if (clear.pending > 0) {
    await sleep(opts.settleMs ?? 15e3);
  }
  const created = await createPinVerified(
    accessToken,
    opts.lockId,
    opts.bridgeId,
    pin,
    opts.startDate,
    opts.endDate,
    opts.accessName,
    opts.createBudgetMs ?? 6e4
  );
  return {
    success: created.state === "completed",
    pin,
    jobId: created.jobId,
    pinType: "bridge_proxied",
    startDate: opts.startDate,
    endDate: opts.endDate,
    lockConfirmed: created.state === "completed",
    clear,
    createState: created.state,
    polls: created.polls,
    error: created.error
  };
}

// iglooAuth.ts
var IGLOOHOME_OAUTH_URL = "https://auth.igloohome.co/oauth2/token";
var BRIDGE_PIN_SCOPES = [
  "igloohomeapi/create-pin-bridge-proxied-job",
  "igloohomeapi/delete-pin-bridge-proxied-job",
  "igloohomeapi/get-devices",
  "igloohomeapi/get-job-status",
  "igloohomeapi/store-device-activity"
];
var GENERATE_PIN_SCOPES = [
  "igloohomeapi/create-pin-bridge-proxied-job",
  "igloohomeapi/get-devices",
  "igloohomeapi/get-job-status",
  "igloohomeapi/algopin-onetime",
  "igloohomeapi/store-device-activity"
];
var OPTIONAL_OAUTH_SCOPES = [
  "igloohomeapi/create-bridge-proxied-job"
];
async function readResponse2(res) {
  const text = await res.text();
  try {
    return { text, json: text ? JSON.parse(text) : null };
  } catch {
    return { text, json: null };
  }
}
async function requestOAuthToken(clientId, clientSecret, scopes = BRIDGE_PIN_SCOPES) {
  const credentials = btoa(`${clientId}:${clientSecret}`);
  const form = new URLSearchParams({ grant_type: "client_credentials" });
  if (scopes.length)
    form.set("scope", scopes.join(" "));
  let res;
  try {
    res = await fetch(IGLOOHOME_OAUTH_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json"
      },
      body: form
    });
  } catch (err) {
    return { token: null, reason: `network error reaching auth.igloohome.co: ${err}` };
  }
  const body = await readResponse2(res);
  if (!res.ok || !body.json?.access_token) {
    const detail = body.json?.error_description || body.json?.error || body.text || "(empty response)";
    return {
      token: null,
      reason: `Igloohome OAuth HTTP ${res.status}: ${String(detail).slice(0, 300)}`,
      scopesUsed: scopes.length ? scopes.join(" ") : "(none)"
    };
  }
  return {
    token: body.json.access_token,
    scopesUsed: scopes.length ? scopes.join(" ") : "(none \u2014 Cognito default grant)"
  };
}
async function getOAuthToken(clientId, clientSecret, scopes = BRIDGE_PIN_SCOPES) {
  const full = await requestOAuthToken(clientId, clientSecret, scopes);
  if (full.token)
    return full;
  const optional = new Set(OPTIONAL_OAUTH_SCOPES);
  const reduced = scopes.filter((s) => !optional.has(s));
  if (reduced.length && reduced.length !== scopes.length) {
    const retry = await requestOAuthToken(clientId, clientSecret, reduced);
    if (retry.token)
      return retry;
  }
  if (scopes.includes("igloohomeapi/algopin-onetime")) {
    const algoOnly = [
      "igloohomeapi/algopin-onetime",
      "igloohomeapi/get-devices",
      "igloohomeapi/get-job-status"
    ];
    const algo = await requestOAuthToken(clientId, clientSecret, algoOnly);
    if (algo.token)
      return algo;
  }
  const unscoped = await requestOAuthToken(clientId, clientSecret, []);
  if (unscoped.token)
    return unscoped;
  return full;
}

// index.ts
var IGLOOHOME_API_BASE_URL2 = "https://api.igloodeveloper.co/igloohome";
var ELIGIBLE_BOOKING_STATUSES = [
  "Confirmed",
  "confirmed",
  "Delivered",
  "delivered",
  "waiting_to_be_returned",
  "Rescheduled",
  "rescheduled",
  "pending_verification",
  "pending_review"
];
function makeJsonResponse(corsHeaders) {
  return (body, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
}
async function readResponse3(res) {
  const text = await res.text();
  try {
    return {
      text,
      json: text ? JSON.parse(text) : null
    };
  } catch {
    return {
      text,
      json: null
    };
  }
}
function buildIgloohomeDate(date, timeSlot, fallbackHourUTC) {
  if (timeSlot && !timeSlot.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i)) {
    console.warn(`[generate-pin] Could not parse time slot: "${timeSlot}" \u2014 using fallback`);
  }
  return buildBookingDateUTC(date, timeSlot, fallbackHourUTC);
}
async function maybeSendPinNotification(supabase, booking, pin, startTime, endTime) {
  if (booking.pin_notification_sent_at)
    return;
  const { error } = await supabase.functions.invoke("send-booking-confirmation", {
    body: {
      booking_id: booking.id,
      email_type: "pin_update",
      pin,
      start_time: startTime,
      end_time: endTime
    }
  });
  if (error) {
    console.error(`[generate-pin] PIN notification failed for booking #${booking.id}:`, error.message);
    return;
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  await supabase.from("bookings").update({ pin_notification_sent_at: now }).eq("id", booking.id);
  await supabase.from("rental_access_codes").update({ notified_at: now }).eq("order_id", booking.id).eq("status", "active");
}
async function getOAuthTokenForPin(clientId, clientSecret) {
  const result = await getOAuthToken(clientId, clientSecret, GENERATE_PIN_SCOPES);
  console.log("[generate-pin] OAuth:", result.token ? `ok (${result.scopesUsed})` : result.reason);
  return result.token;
}
async function isLockOnline(accessToken, lockId) {
  const res = await fetch(`${IGLOOHOME_API_BASE_URL2}/devices`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json"
    }
  });
  const body = await readResponse3(res);
  if (!res.ok || !body.json?.payload)
    return false;
  const lock = body.json.payload.find((d) => d.deviceId === lockId);
  if (!lock)
    return false;
  const bridge = body.json.payload.find((d) => d.type === "Bridge" && d.linkedDevices?.length > 0);
  return !!bridge;
}
async function createAlgoPin(accessToken, lockId, dropOffDate, dropOffTimeSlot, pickupDate, orderId) {
  const startDate = buildIgloohomeDate(dropOffDate, dropOffTimeSlot, 12);
  const startDateHourOnly = startDate.replace(/T(\d{2}):\d{2}:00/, "T$1:00:00");
  const startUnix = new Date(startDateHourOnly).getTime() / 1e3;
  const endUnix = (/* @__PURE__ */ new Date(pickupDate + "T23:59:59Z")).getTime() / 1e3;
  const variance = Math.min(5, Math.max(1, Math.ceil((endUnix - startUnix) / 86400)));
  const payload = {
    accessName: `Dump Loader Rental - Order #${orderId} (AlgoPIN)`,
    startDate: startDateHourOnly,
    variance
  };
  console.log("[generate-daily-pins] Creating AlgoPIN:", {
    url: `${IGLOOHOME_API_BASE_URL2}/devices/${lockId}/algopin/onetime`,
    payload
  });
  const res = await fetch(`${IGLOOHOME_API_BASE_URL2}/devices/${lockId}/algopin/onetime`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify(payload)
  });
  const body = await readResponse3(res);
  console.log("[generate-daily-pins] AlgoPIN response:", {
    status: res.status,
    body: body.json
  });
  if (!res.ok && res.status !== 201) {
    return {
      success: false,
      error: `AlgoPIN failed with status ${res.status}`,
      rawResponse: body.json
    };
  }
  const pin = body.json?.pin || body.json?.access_code || body.json?.code || body.json?.data?.pin || "";
  if (!pin)
    return {
      success: false,
      error: "AlgoPIN succeeded but no PIN value in response"
    };
  return {
    success: true,
    pin,
    pinId: body.json?.pinId || body.json?.id || ""
  };
}
async function generatePinWithFallback(accessToken, lockId, bridgeId, supabase, booking) {
  const orderId = booking.id;
  const startDate = getPinActivationStart(booking);
  const endDate = addGraceHour(buildIgloohomeDate(booking.pickup_date, booking.pickup_time_slot, 5));
  console.log("[generate-pin] PIN window:", { startDate, endDate });
  const accessName = `Dump Loader Rental - Order #${orderId}`;
  const bridgeResult = await ensurePinOnLock(supabase, accessToken, {
    orderId,
    lockId,
    bridgeId,
    startDate,
    endDate,
    accessName,
    clearBudgetMs: 5e4,
    createBudgetMs: 6e4
  });
  if (bridgeResult.lockConfirmed || bridgeResult.jobId) {
    console.log(
      `[generate-pin] Bridge PIN for order #${orderId}: state=${bridgeResult.createState} confirmed=${bridgeResult.lockConfirmed}`
    );
    return {
      success: true,
      pin: bridgeResult.pin,
      pinId: bridgeResult.jobId,
      pinType: "bridge_proxied",
      startDate,
      endDate,
      lockConfirmed: bridgeResult.lockConfirmed,
      createState: bridgeResult.createState,
      clear: bridgeResult.clear,
      error: bridgeResult.lockConfirmed ? void 0 : bridgeResult.error
    };
  }
  console.warn(`[generate-pin] Bridge failed for order #${orderId}, trying AlgoPIN. Error: ${bridgeResult.error}`);
  const algoResult = await createAlgoPin(
    accessToken,
    lockId,
    booking.drop_off_date,
    booking.drop_off_time_slot,
    booking.pickup_date,
    orderId
  );
  if (algoResult.success) {
    console.log(`[generate-pin] \u2713 AlgoPIN succeeded for order #${orderId}`);
    return {
      success: true,
      pin: algoResult.pin,
      pinId: algoResult.pinId,
      pinType: "algopin",
      startDate,
      endDate,
      lockConfirmed: true,
      createState: "completed"
    };
  }
  return {
    success: false,
    error: `Bridge: ${bridgeResult.error} | AlgoPIN: ${algoResult.error}`,
    startDate,
    endDate
  };
}
Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  const jsonResponse = makeJsonResponse(corsHeaders);
  if (req.method === "OPTIONS")
    return new Response(null, {
      headers: corsHeaders
    });
  if (req.method !== "POST")
    return jsonResponse({
      success: false,
      error: "Method not allowed"
    }, 405);
  try {
    console.log("[generate-pin] Started:", (/* @__PURE__ */ new Date()).toISOString());
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const clientId = Deno.env.get("IGLOOHOME_CLIENT_ID");
    const clientSecret = Deno.env.get("IGLOOHOME_CLIENT_SECRET");
    const lockId = Deno.env.get("IGLOOHOME_LOCK_ID") || Deno.env.get("IGLOOHOME_DEVICE_ID");
    const bridgeId = Deno.env.get("IGLOOHOME_BRIDGE_ID");
    if (!supabaseUrl || !serviceRoleKey || !clientId || !clientSecret || !lockId || !bridgeId) {
      return jsonResponse({
        success: false,
        error: "Missing required environment variables"
      }, 500);
    }
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
    let bookingId = null;
    let callerType = "admin";
    try {
      const body = await req.json();
      bookingId = body.bookingId ?? body.booking_id ?? null;
      callerType = body.callerType ?? "admin";
    } catch {
      return jsonResponse({
        success: false,
        error: "Invalid or missing JSON body"
      }, 400);
    }
    if (!bookingId) {
      return jsonResponse({
        success: false,
        error: "bookingId is required"
      }, 400);
    }
    console.log("[generate-pin] Caller:", callerType, "BookingId:", bookingId);
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({
        success: false,
        error: "Missing Authorization header"
      }, 401);
    }
    const token = authHeader.replace("Bearer ", "");
    const userSupabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY"), {
      global: {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    });
    const { data: { user }, error: authError } = await userSupabase.auth.getUser();
    if (authError || !user) {
      return jsonResponse({
        success: false,
        error: "Unauthorized"
      }, 401);
    }
    if (callerType === "admin") {
      if (user.app_metadata?.is_admin !== true) {
        return jsonResponse({
          success: false,
          error: "Admin access required"
        }, 403);
      }
    }
    if (callerType === "customer") {
      const metadataCustomerId = user.user_metadata?.customer_db_id;
      let customerId = null;
      if (metadataCustomerId != null && metadataCustomerId !== "") {
        const parsed = Number.parseInt(String(metadataCustomerId), 10);
        if (Number.isFinite(parsed))
          customerId = parsed;
      }
      if (!customerId) {
        const { data: customer } = await supabase.from("customers").select("id").eq("user_id", user.id).maybeSingle();
        customerId = customer?.id ?? null;
      }
      if (!customerId) {
        return jsonResponse({
          success: false,
          error: "Customer not found"
        }, 403);
      }
      const { data: ownerCheck } = await supabase.from("bookings").select("id").eq("id", bookingId).eq("customer_id", customerId).maybeSingle();
      if (!ownerCheck) {
        return jsonResponse({
          success: false,
          error: "Booking does not belong to this customer"
        }, 403);
      }
    }
    const { data: booking, error: fetchError } = await supabase.from("bookings").select("*").eq("id", bookingId).in("status", ELIGIBLE_BOOKING_STATUSES).single();
    if (fetchError || !booking) {
      return jsonResponse({
        success: false,
        error: "Booking not found or not eligible for PIN generation"
      }, 404);
    }
    if (callerType === "customer") {
      if (isBookingEnded(booking)) {
        return jsonResponse({
          success: false,
          error: "This rental period has ended."
        }, 403);
      }
      if (!isWithinPinGenerationWindow(booking)) {
        return jsonResponse({
          success: false,
          error: "Access PIN is not available yet. Codes are issued 12 hours before your scheduled pickup."
        }, 403);
      }
    }
    const accessToken = await getOAuthTokenForPin(clientId, clientSecret);
    if (!accessToken)
      return jsonResponse({
        success: false,
        error: "Failed to get OAuth token"
      }, 500);
    const lockOnline = await isLockOnline(accessToken, lockId);
    console.log(`[generate-pin] Lock online: ${lockOnline}`);
    console.log(`[generate-pin] Booking #${bookingId} | drop_off: ${booking.drop_off_date} ${booking.drop_off_time_slot} | pickup: ${booking.pickup_date} ${booking.pickup_time_slot}`);
    const pinResult = await generatePinWithFallback(accessToken, lockId, bridgeId, supabase, booking);
    if (!pinResult.success) {
      return jsonResponse({
        success: false,
        error: `PIN generation failed: ${pinResult.error}`
      }, 500);
    }
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const startTimeUTC = pinResult.startDate;
    const endTimeUTC = pinResult.endDate;
    await supabase.from("rental_access_codes").update({ status: "expired" }).eq("order_id", booking.id).eq("status", "active");
    const { error: insertError } = await supabase.from("rental_access_codes").insert({
      order_id: booking.id,
      customer_email: booking.email,
      customer_phone: booking.phone || "",
      access_pin: pinResult.pin,
      pin_id: pinResult.pinId || "",
      pin_type: pinResult.pinType,
      lock_id: lockId,
      start_time: startTimeUTC,
      end_time: endTimeUTC,
      status: "active",
      lock_confirmed_at: pinResult.lockConfirmed ? now : null,
      confirm_attempts: pinResult.lockConfirmed ? 0 : 1
    });
    if (insertError) {
      console.error(`[generate-pin] DB insert failed for booking #${bookingId}:`, insertError.message);
      return jsonResponse({
        success: false,
        error: `PIN was created on the lock but failed to save: ${insertError.message}`
      }, 500);
    }
    await supabase.from("bookings").update({
      pin_generated_at: now
    }).eq("id", bookingId);
    if (pinResult.lockConfirmed) {
      await maybeSendPinNotification(supabase, booking, pinResult.pin, startTimeUTC, endTimeUTC);
    }
    console.log(`[generate-pin] \u2713 PIN generated for booking #${bookingId} via ${pinResult.pinType} confirmed=${pinResult.lockConfirmed}`);
    return jsonResponse({
      success: true,
      bookingId,
      pin: pinResult.pin,
      pinType: pinResult.pinType,
      pinId: pinResult.pinId,
      lockConfirmed: !!pinResult.lockConfirmed,
      message: pinResult.lockConfirmed ? `PIN generated via ${pinResult.pinType}` : `PIN queued via ${pinResult.pinType} \u2014 waiting for bridge confirmation`
    });
  } catch (error) {
    console.error("[generate-pin] Unhandled exception:", error);
    return jsonResponse({
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }, 500);
  }
});
