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


export function getCorsHeaders(req: Request): Record<string, string> {
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



const BREVO_API_KEY = Deno.env.get("BREVO_API_KEY");
const BREVO_FROM_EMAIL = Deno.env.get("BREVO_FROM_EMAIL") || "noreply@u-filldumpsters.com";
const BREVO_SMS_SENDER = Deno.env.get("BREVO_SMS_SENDER") || "UFillDump";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const SMS_PROVIDER = (Deno.env.get("SMS_PROVIDER") || "brevo").toLowerCase();
const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID");
const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN");
const TWILIO_FROM_NUMBER = Deno.env.get("TWILIO_FROM_NUMBER");

export type SendEmailResult = {
  success: boolean;
  provider?: string;
  error?: string;
  result?: unknown;
};

export type SendSmsResult = {
  success: boolean;
  provider?: string;
  skipped?: boolean;
  reason?: string;
  error?: string;
  result?: unknown;
};


export function normalizePhoneE164(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (phone.trim().startsWith("+") && digits.length >= 10) return `+${digits}`;
  return null;
}

export async function sendEmail(
  toEmail: string,
  subject: string,
  htmlContent: string,
  maxRetries = 2,
): Promise<SendEmailResult> {
  let lastError: string | null = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const ts = new Date().toISOString();
    try {
      if (BREVO_API_KEY) {
        const brevoResponse = await fetch("https://api.brevo.com/v3/smtp/email", {
          method: "POST",
          headers: {
            "api-key": BREVO_API_KEY,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            sender: { email: BREVO_FROM_EMAIL, name: "U-Fill Dumpsters" },
            to: [{ email: toEmail }],
            subject,
            htmlContent,
          }),
        });
        if (brevoResponse.ok) {
          const result = await brevoResponse.json();
          return { success: true, provider: "brevo", result };
        }
        lastError = `Brevo API error: ${await brevoResponse.text()}`;
        console.error(`[${ts}] [notify] Brevo email failed:`, lastError);
      }

      if (RESEND_API_KEY) {
        const resendResponse = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: "U-Fill Dumpsters <noreply@u-filldumpsters.com>",
            to: [toEmail],
            subject,
            html: htmlContent,
          }),
        });
        if (resendResponse.ok) {
          const result = await resendResponse.json();
          return { success: true, provider: "resend", result };
        }
        lastError = `Resend API error: ${await resendResponse.text()}`;
        console.error(`[${ts}] [notify] Resend email failed:`, lastError);
      }

      if (!BREVO_API_KEY && !RESEND_API_KEY) {
        return { success: false, error: "No email service configured" };
      }

      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 1000));
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      console.error(`[${ts}] [notify] Email exception:`, lastError);
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 1000));
      }
    }
  }
  return { success: false, error: lastError || "Unknown email error" };
}


export async function sendSms(..._args: unknown[]): Promise<{success:boolean;skipped?:boolean}> {
  return { success: true, skipped: true };
}

export const PIN_LEAD_TIME_MS = 12 * 60 * 60 * 1000;

export const RETURN_GRACE_MS = 60 * 60 * 1000;

export const PIN_EARLY_ACTIVATION_MS = 5 * 60 * 1000;

export type BookingWindowFields = {
  drop_off_date?: string | null;
  drop_off_time_slot?: string | null;
  pickup_date?: string | null;
  pickup_time_slot?: string | null;
};


export function buildBookingDateUTC(
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


export function addGraceHour(isoDate: string): string {
  const ms = new Date(isoDate).getTime() + RETURN_GRACE_MS;
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "+00:00");
}


export function clampIgloohomeStart(isoDate: string, now: Date = new Date()): string {
  const hourFloor = new Date(now.getTime());
  hourFloor.setUTCMinutes(0, 0, 0);
  const ms = Math.max(new Date(isoDate).getTime(), hourFloor.getTime());
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "+00:00");
}

export function getBookingWindow(booking: BookingWindowFields) {
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
    graceEndIso,
  };
}


export function getPinActivationStart(
  booking: BookingWindowFields,
  now: Date = new Date(),
): string {
  const { activationIso } = getBookingWindow(booking);
  return clampIgloohomeStart(activationIso, now);
}


export function getCustomerVisibleEndIso(booking: BookingWindowFields): string {
  return getBookingWindow(booking).endIso;
}

export function isWithinPinGenerationWindow(
  booking: BookingWindowFields,
  now: Date = new Date(),
): boolean {
  if (!booking.drop_off_date || !booking.pickup_date) return false;
  const { pinEligibleFromMs, graceEndMs } = getBookingWindow(booking);
  const nowMs = now.getTime();
  return nowMs >= pinEligibleFromMs && nowMs < graceEndMs;
}

export function isBookingEnded(
  booking: BookingWindowFields,
  now: Date = new Date(),
): boolean {
  if (!booking.pickup_date) return false;
  const { graceEndMs } = getBookingWindow(booking);
  return now.getTime() >= graceEndMs;
}

export function getPinWindowSkipReason(
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


export const GENERATE_PIN_SCOPES = ["igloohomeapi/create-pin-bridge-proxied-job","igloohomeapi/get-devices","igloohomeapi/get-job-status","igloohomeapi/algopin-onetime","igloohomeapi/store-device-activity"] as const;
export type OAuthResult = { token: string | null; reason?: string; scopesUsed?: string };
export async function getOAuthToken(clientId: string, clientSecret: string, scopes: readonly string[] = GENERATE_PIN_SCOPES): Promise<OAuthResult> {
  const credentials = btoa(`${clientId}:${clientSecret}`);
  async function req(scopesArr: readonly string[]) {
    const form = new URLSearchParams({ grant_type: "client_credentials" });
    if (scopesArr.length) form.set("scope", scopesArr.join(" "));
    const res = await fetch("https://auth.igloohome.co/oauth2/token", {
      method: "POST",
      headers: { Authorization: `Basic ${credentials}`, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: form,
    });
    const text = await res.text();
    let json=null; try { json = text ? JSON.parse(text) : null; } catch {}
    if (!res.ok || !json?.access_token) return { token: null as string|null, reason: `OAuth ${res.status}`, scopesUsed: scopesArr.join(" ") };
    return { token: json.access_token as string, scopesUsed: scopesArr.join(" ") };
  }
  for (const s of [scopes, scopes.filter(x=>x!=="igloohomeapi/create-bridge-proxied-job"), [] as string[]]) {
    const r = await req(s);
    if (r.token) return r;
  }
  return { token: null, reason: "OAuth failed" };
}



const IGLOOHOME_API_BASE_URL = "https://api.igloodeveloper.co/igloohome";

export type JobState = "completed" | "failed" | "pending";

export type PollResult = {
  state: JobState;
  raw: unknown;
  polls: Array<Record<string, unknown>>;
};

type SupabaseClient = any;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function readResponse(res: Response) {
  const text = await res.text();
  try {
    return { text, json: text ? JSON.parse(text) : null };
  } catch {
    return { text, json: null };
  }
}

function isoNow() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00");
}


export async function pollJob(
  accessToken: string,
  jobId: string,
  budgetMs = 45_000,
  delayMs = 2500,
): Promise<PollResult> {
  const polls: Array<Record<string, unknown>> = [];
  let raw: unknown = null;
  const deadline = Date.now() + budgetMs;
  let attempt = 0;

  while (Date.now() < deadline) {
    attempt += 1;
    await sleep(delayMs);
    if (Date.now() >= deadline && attempt > 1) break;

    const res = await fetch(`${IGLOOHOME_API_BASE_URL}/jobs/${jobId}`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
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
      jobStatus: jobStatus ?? null,
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


export async function deletePinVerified(
  accessToken: string,
  lockId: string,
  bridgeId: string,
  pin: string,
  budgetMs = 45_000,
): Promise<{ ok: boolean; jobId: string; state: JobState; polls: PollResult["polls"]; error?: string }> {
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
  if (!res.ok && res.status !== 201) {
    return {
      ok: false,
      jobId: "",
      state: "failed",
      polls: [],
      error: `Delete failed HTTP ${res.status}: ${body.json?.error ?? body.text}`,
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
    error: poll.state === "failed" ? "Lock rejected delete job" : undefined,
  };
}


export async function clearKnownPins(
  supabase: SupabaseClient,
  accessToken: string,
  orderId: number,
  opts: {
    lockId: string;
    bridgeId: string;
    
    budgetMs?: number;
    
    settleMs?: number;
  },
): Promise<{
  attempted: number;
  confirmed: number;
  failed: number;
  pending: number;
  details: Array<Record<string, unknown>>;
}> {
  const budgetMs = opts.budgetMs ?? 60_000;
  const settleMs = opts.settleMs ?? 15_000;
  const deadline = Date.now() + budgetMs;
  const details: Array<Record<string, unknown>> = [];

  const { data: rows } = await supabase
    .from("rental_access_codes")
    .select("id, access_pin, pin_type, status, lock_deleted_at")
    .eq("order_id", orderId)
    .is("lock_deleted_at", null);

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
      await supabase
        .from("rental_access_codes")
        .update({
          status: row.status === "active" ? "expired" : row.status,
          lock_deleted_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      confirmed += 1;
      details.push({ id: row.id, pin: row.access_pin, pin_type: "algopin", state: "db_only" });
      continue;
    }

    if (!row.access_pin) continue;
    attempted += 1;
    const remaining = Math.max(5_000, deadline - Date.now());
    const perJobBudget = Math.min(45_000, remaining);
    const result = await deletePinVerified(
      accessToken,
      opts.lockId,
      opts.bridgeId,
      row.access_pin,
      perJobBudget,
    );
    details.push({
      id: row.id,
      pin: row.access_pin,
      jobId: result.jobId,
      state: result.state,
      error: result.error ?? null,
    });

    if (result.ok) {
      confirmed += 1;
      await supabase
        .from("rental_access_codes")
        .update({
          status: "expired",
          lock_deleted_at: new Date().toISOString(),
        })
        .eq("id", row.id);
    } else if (result.state === "failed") {
      failed += 1;
      await supabase
        .from("rental_access_codes")
        .update({ status: "expired" })
        .eq("id", row.id)
        .eq("status", "active");
    } else {
      pending += 1;
      await supabase
        .from("rental_access_codes")
        .update({ status: "expired" })
        .eq("id", row.id)
        .eq("status", "active");
    }

    if (Date.now() + settleMs < deadline && attempted < (rows || []).length) {
      await sleep(settleMs);
    }
  }

  return { attempted, confirmed, failed, pending, details };
}


export async function createPinVerified(
  accessToken: string,
  lockId: string,
  bridgeId: string,
  pin: string,
  startDate: string,
  endDate: string,
  accessName: string,
  budgetMs = 60_000,
): Promise<{
  success: boolean;
  pin: string;
  jobId: string;
  state: JobState;
  polls: PollResult["polls"];
  raw: unknown;
  error?: string;
}> {
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
    return {
      success: false,
      pin,
      jobId: "",
      state: "failed",
      polls: [],
      raw: body.json ?? body.text,
      error: `Create failed HTTP ${res.status}: ${body.json?.error ?? body.text}`,
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
      error: "Create accepted but no jobId returned",
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
    error: poll.state === "failed"
      ? "Lock rejected PIN create job"
      : poll.state === "pending"
        ? "Bridge has not confirmed PIN delivery yet"
        : undefined,
  };
}

export type EnsurePinResult = {
  success: boolean;
  pin: string;
  jobId: string;
  pinType: "bridge_proxied";
  startDate: string;
  endDate: string;
  lockConfirmed: boolean;
  clear: Awaited<ReturnType<typeof clearKnownPins>>;
  createState: JobState;
  polls: PollResult["polls"];
  error?: string;
};


export async function ensurePinOnLock(
  supabase: SupabaseClient,
  accessToken: string,
  opts: {
    orderId: number;
    lockId: string;
    bridgeId: string;
    pin?: string;
    startDate: string;
    endDate: string;
    accessName: string;
    clearBudgetMs?: number;
    createBudgetMs?: number;
    settleMs?: number;
  },
): Promise<EnsurePinResult> {
  const pin = opts.pin || String(Math.floor(Math.random() * 900000) + 100000);
  const clear = await clearKnownPins(supabase, accessToken, opts.orderId, {
    lockId: opts.lockId,
    bridgeId: opts.bridgeId,
    budgetMs: opts.clearBudgetMs ?? 50_000,
    settleMs: opts.settleMs ?? 15_000,
  });

  if (clear.pending > 0) {
    await sleep(opts.settleMs ?? 15_000);
  }

  const created = await createPinVerified(
    accessToken,
    opts.lockId,
    opts.bridgeId,
    pin,
    opts.startDate,
    opts.endDate,
    opts.accessName,
    opts.createBudgetMs ?? 60_000,
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
    error: created.error,
  };
}

export { isoNow, IGLOOHOME_API_BASE_URL };