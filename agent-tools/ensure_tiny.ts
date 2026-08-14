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
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
export type SendEmailResult = { success: boolean; provider?: string; error?: string; result?: unknown };
export async function sendEmail(toEmail: string, subject: string, htmlContent: string, maxRetries = 2): Promise<SendEmailResult> {
let lastError: string | null = null;
for (let attempt = 1; attempt <= maxRetries; attempt++) {
try {
if (BREVO_API_KEY) {
const brevoResponse = await fetch("https://api.brevo.com/v3/smtp/email", {
method: "POST",
headers: { "api-key": BREVO_API_KEY, "Content-Type": "application/json" },
body: JSON.stringify({ sender: { email: BREVO_FROM_EMAIL, name: "U-Fill Dumpsters" }, to: [{ email: toEmail }], subject, htmlContent }),
});
if (brevoResponse.ok) return { success: true, provider: "brevo", result: await brevoResponse.json() };
lastError = `Brevo API error: ${await brevoResponse.text()}`;
}
if (RESEND_API_KEY) {
const resendResponse = await fetch("https://api.resend.com/emails", {
method: "POST",
headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
body: JSON.stringify({ from: "U-Fill Dumpsters <noreply@u-filldumpsters.com>", to: [toEmail], subject, html: htmlContent }),
});
if (resendResponse.ok) return { success: true, provider: "resend", result: await resendResponse.json() };
lastError = `Resend API error: ${await resendResponse.text()}`;
}
if (!BREVO_API_KEY && !RESEND_API_KEY) return { success: false, error: "No email service configured" };
if (attempt < maxRetries) await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 1000));
} catch (err) {
lastError = err instanceof Error ? err.message : String(err);
if (attempt < maxRetries) await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 1000));
}
}
return { success: false, error: lastError || "Unknown email error" };
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
export const IGLOOHOME_OAUTH_URL = "https://auth.igloohome.co/oauth2/token";
export const GENERATE_PIN_SCOPES = [
"igloohomeapi/create-pin-bridge-proxied-job",
"igloohomeapi/get-devices",
"igloohomeapi/get-job-status",
"igloohomeapi/algopin-onetime",
"igloohomeapi/store-device-activity",
] as const;
export const OPTIONAL_OAUTH_SCOPES = ["igloohomeapi/create-bridge-proxied-job"] as const;
export type OAuthResult = { token: string | null; reason?: string; scopesUsed?: string };
async function readResponse(res: Response) {
const text = await res.text();
try { return { text, json: text ? JSON.parse(text) : null }; } catch { return { text, json: null }; }
}
export async function requestOAuthToken(clientId: string, clientSecret: string, scopes: readonly string[] = []): Promise<OAuthResult> {
const credentials = btoa(`${clientId}:${clientSecret}`);
const form = new URLSearchParams({ grant_type: "client_credentials" });
if (scopes.length) form.set("scope", scopes.join(" "));
let res: Response;
try {
res = await fetch(IGLOOHOME_OAUTH_URL, {
method: "POST",
headers: { Authorization: `Basic ${credentials}`, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
body: form,
});
} catch (err) {
return { token: null, reason: `network error: ${err}` };
}
const body = await readResponse(res);
if (!res.ok || !body.json?.access_token) {
const detail = body.json?.error_description || body.json?.error || body.text || "(empty)";
return { token: null, reason: `Igloohome OAuth HTTP ${res.status}: ${String(detail).slice(0, 300)}`, scopesUsed: scopes.length ? scopes.join(" ") : "(none)" };
}
return { token: body.json.access_token as string, scopesUsed: scopes.length ? scopes.join(" ") : "(none)" };
}
export async function getOAuthToken(clientId: string, clientSecret: string, scopes: readonly string[] = GENERATE_PIN_SCOPES): Promise<OAuthResult> {
const full = await requestOAuthToken(clientId, clientSecret, scopes);
if (full.token) return full;
const optional = new Set<string>(OPTIONAL_OAUTH_SCOPES);
const reduced = scopes.filter((s) => !optional.has(s));
if (reduced.length && reduced.length !== scopes.length) {
const retry = await requestOAuthToken(clientId, clientSecret, reduced);
if (retry.token) return retry;
}
if (scopes.includes("igloohomeapi/algopin-onetime")) {
const algo = await requestOAuthToken(clientId, clientSecret, ["igloohomeapi/algopin-onetime","igloohomeapi/get-devices","igloohomeapi/get-job-status"]);
if (algo.token) return algo;
}
const unscoped = await requestOAuthToken(clientId, clientSecret, []);
if (unscoped.token) return unscoped;
return full;
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
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
const IGLOOHOME_API_BASE_URL = "https://api.igloodeveloper.co/igloohome";
const FINAL_HOUR_MS = 60 * 60 * 1000;
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const ALERT_ATTEMPTS_THRESHOLD = 3;
const RETRY_BUDGET_MS = 15 * 60 * 1000;
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
function isTrailerRental(booking: Record<string, unknown>) {
const plan = (booking.plan || {}) as Record<string, unknown>;
const addons = (booking.addons || {}) as Record<string, unknown>;
if (addons.isDelivery || addons.deliveryService) return false;
if (plan.customer_pickup === true) return true;
const id = Number(plan.id);
if (id === 2 || id === 5) return true;
const planName = String(plan.name ?? booking.service_name ?? "").toLowerCase();
const serviceType = String(plan.service_type ?? booking.service_type ?? "");
return serviceType === "trailer_rental" || planName.includes("dump loader") || planName.includes("trailer");
}
async function getOAuthTokenForWatchdog(clientId: string, clientSecret: string) {
const result = await getOAuthToken(clientId, clientSecret, GENERATE_PIN_SCOPES);
if (!result.token) {
return null;
}
return result.token;
}
async function createAlgoPin(
accessToken: string,
lockId: string,
booking: Record<string, unknown>,
) {
const startDate = getPinActivationStart(booking as { drop_off_date?: string; drop_off_time_slot?: string });
const startDateHourOnly = startDate.replace(/T(\d{2}):\d{2}:00/, "T$1:00:00");
const pickupDate = String(booking.pickup_date || "");
const startUnix = new Date(startDateHourOnly).getTime() / 1000;
const endUnix = new Date(pickupDate + "T23:59:59Z").getTime() / 1000;
const variance = Math.min(5, Math.max(1, Math.ceil((endUnix - startUnix) / 86400)));
const res = await fetch(`${IGLOOHOME_API_BASE_URL}/devices/${lockId}/algopin/onetime`, {
method: "POST",
headers: {
Authorization: `Bearer ${accessToken}`,
"Content-Type": "application/json",
Accept: "application/json",
},
body: JSON.stringify({
accessName: `Dump Loader Rental - Order #${booking.id} (AlgoPIN fallback)`,
startDate: startDateHourOnly,
variance,
}),
});
const body = await readResponse(res);
if (!res.ok && res.status !== 201) {
return { success: false as const, error: `AlgoPIN HTTP ${res.status}`, raw: body.json };
}
const pin = String(body.json?.pin || body.json?.access_code || body.json?.code || "");
if (!pin) return { success: false as const, error: "AlgoPIN response missing pin", raw: body.json };
return {
success: true as const,
pin,
pinId: String(body.json?.pinId || body.json?.id || ""),
startDate: startDateHourOnly,
};
}
async function logSyncError(
supabase: any,
orderId: number,
notes: string,
) {
await supabase.from("rental_tracking_logs").insert({
order_id: orderId,
event_type: "sync_error",
event_timestamp: new Date().toISOString(),
notes,
});
}
async function alertAdmin(subject: string, html: string) {
const adminEmail = Deno.env.get("BREVO_FROM_EMAIL");
if (!adminEmail) {
return;
}
const result = await sendEmail(adminEmail, subject, html);
if (!result.success) {
}
}
async function alertCustomerChat(
supabase: any,
booking: Record<string, unknown>,
message: string,
) {
const customerId = Number(booking.customer_id);
if (!customerId) {
return;
}
const { error } = await supabase.from("chat_messages").insert({
conversation_id: `cust_${customerId}`,
customer_id: customerId,
booking_id: Number(booking.id),
sender_type: "admin",
message_content: message,
is_read: false,
message_severity: "urgent",
message_context: {
action: "pin_failed",
order_id: Number(booking.id),
source: "ensure-lock-pin-ready",
},
});
if (error) {
}
}
async function maybeNotifyCustomer(
supabase: any,
booking: Record<string, unknown>,
pin: string,
startTime: string,
endTime: string,
) {
if (booking.pin_notification_sent_at) return;
const { error } = await supabase.functions.invoke("send-booking-confirmation", {
body: {
booking_id: booking.id,
email_type: "pin_update",
pin,
start_time: startTime,
end_time: endTime,
},
});
if (error) {
}
}
function shouldUseAlgoPinFallback(
activePin: Record<string, unknown> | null,
attempts: number,
nowMs: number,
msToPickup: number,
): boolean {
if (attempts >= ALERT_ATTEMPTS_THRESHOLD) return true;
if (msToPickup <= FINAL_HOUR_MS && msToPickup > -FINAL_HOUR_MS) return true;
if (activePin?.created_at) {
const age = nowMs - new Date(String(activePin.created_at)).getTime();
if (age >= RETRY_BUDGET_MS && !activePin.lock_confirmed_at) return true;
}
return false;
}
Deno.serve(async (req) => {
const corsHeaders = getCorsHeaders(req);
const jsonResponse = makeJsonResponse(corsHeaders);
if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
try {
const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const clientId = Deno.env.get("IGLOOHOME_CLIENT_ID") ?? "";
const clientSecret = Deno.env.get("IGLOOHOME_CLIENT_SECRET") ?? "";
const lockId = Deno.env.get("IGLOOHOME_LOCK_ID") || Deno.env.get("IGLOOHOME_DEVICE_ID") || "";
const bridgeId = Deno.env.get("IGLOOHOME_BRIDGE_ID") || "";
const authHeader = req.headers.get("Authorization");
const incomingKey = authHeader?.replace("Bearer ", "").trim();
if (!incomingKey || incomingKey !== serviceRoleKey) {
return jsonResponse({ success: false, error: "Unauthorized" }, 401);
}
if (!supabaseUrl || !serviceRoleKey || !clientId || !clientSecret || !lockId || !bridgeId) {
return jsonResponse({ success: false, error: "Missing env" }, 500);
}
const supabase = createClient(supabaseUrl, serviceRoleKey, {
auth: { autoRefreshToken: false, persistSession: false },
});
const accessToken = await getOAuthTokenForWatchdog(clientId, clientSecret);
if (!accessToken) {
return jsonResponse({ success: false, error: "OAuth failed" }, 502);
}
const now = new Date();
const nowMs = now.getTime();
const horizonIso = new Date(nowMs + PIN_LEAD_TIME_MS).toISOString().slice(0, 10);
const today = now.toISOString().slice(0, 10);
const { data: bookings, error: fetchError } = await supabase
.from("bookings")
.select("*")
.eq("status", "Confirmed")
.gte("drop_off_date", today)
.lte("drop_off_date", horizonIso)
.order("drop_off_date", { ascending: true });
if (fetchError) {
return jsonResponse({ success: false, error: fetchError.message }, 500);
}
const candidates = (bookings || []).filter((b: Record<string, unknown>) => {
if (!isTrailerRental(b)) return false;
if (!isWithinPinGenerationWindow(b, now)) return false;
return true;
});
const results: Array<Record<string, unknown>> = [];
for (const booking of candidates) {
const orderId = Number(booking.id);
const window = getBookingWindow(booking);
const msToPickup = window.startMs - nowMs;
const underTwoHours = msToPickup <= TWO_HOURS_MS && msToPickup > -FINAL_HOUR_MS;
const { data: activePin } = await supabase
.from("rental_access_codes")
.select("*")
.eq("order_id", orderId)
.eq("status", "active")
.order("created_at", { ascending: false })
.limit(1)
.maybeSingle();
if (activePin?.lock_confirmed_at && activePin?.access_pin) {
if (!booking.pin_notification_sent_at) {
await maybeNotifyCustomer(
supabase,
booking,
String(activePin.access_pin),
String(activePin.start_time || window.activationIso),
String(activePin.end_time || window.graceEndIso),
);
}
results.push({ orderId, action: "skip_confirmed" });
continue;
}
if (activePin?.pin_id && activePin.pin_type === "bridge_proxied") {
const poll = await pollJob(accessToken, activePin.pin_id, 20_000, 2500);
if (poll.state === "completed") {
const nowIso = new Date().toISOString();
await supabase
.from("rental_access_codes")
.update({ lock_confirmed_at: nowIso })
.eq("id", activePin.id);
await maybeNotifyCustomer(
supabase,
booking,
String(activePin.access_pin),
String(activePin.start_time || window.activationIso),
String(activePin.end_time || window.graceEndIso),
);
results.push({ orderId, action: "confirmed_existing" });
continue;
}
}
const startDate = getPinActivationStart(booking);
const endDate = addGraceHour(
buildBookingDateUTC(booking.pickup_date, booking.pickup_time_slot, 5),
);
const attempts = (activePin?.confirm_attempts || 0) + 1;
const useAlgo = shouldUseAlgoPinFallback(activePin, attempts, nowMs, msToPickup);
if (useAlgo) {
const algo = await createAlgoPin(accessToken, lockId, booking);
if (algo.success) {
await supabase
.from("rental_access_codes")
.update({ status: "expired" })
.eq("order_id", orderId)
.eq("status", "active");
const nowIso = new Date().toISOString();
const { error: insertError } = await supabase.from("rental_access_codes").insert({
order_id: orderId,
customer_email: booking.email,
customer_phone: booking.phone || "",
access_pin: algo.pin,
pin_id: algo.pinId,
pin_type: "algopin",
lock_id: lockId,
start_time: algo.startDate,
end_time: endDate,
status: "active",
lock_confirmed_at: nowIso,
confirm_attempts: attempts,
});
if (insertError) {
await alertCustomerChat(
supabase,
booking,
`URGENT: Access PIN for Order #${orderId} could not be saved after AlgoPIN fallback (${insertError.message}). Staff must generate a PIN before pickup on ${booking.drop_off_date} ${booking.drop_off_time_slot || ""}.`,
);
await alertAdmin(
`PIN save failed after AlgoPIN — Order #${orderId}`,
`<p>AlgoPIN was issued but DB insert failed: ${insertError.message}</p>`,
);
results.push({ orderId, action: "algopin_insert_failed", error: insertError.message });
continue;
}
await supabase.from("bookings").update({ pin_generated_at: nowIso }).eq("id", orderId);
await maybeNotifyCustomer(supabase, booking, algo.pin, algo.startDate, endDate);
const notes =
`AlgoPIN fallback issued for order #${orderId} — bridge never confirmed within retry budget. ` +
`PIN ${algo.pin} (single-use offline).`;
await logSyncError(supabase, orderId, notes);
await alertAdmin(
`AlgoPIN fallback — Order #${orderId}`,
`<p>See logs / admin alert for order details.</p>`,
);
results.push({ orderId, action: "algopin_fallback", pin: algo.pin });
continue;
}
const failMsg =
`URGENT: Access PIN has NOT been generated for Order #${orderId}. ` +
`Bridge retries exhausted and AlgoPIN fallback failed (${algo.error || "unknown"}). ` +
`Pickup: ${booking.drop_off_date} ${booking.drop_off_time_slot || ""}. ` +
`Generate a PIN manually before the customer arrives.`;
await logSyncError(supabase, orderId, failMsg);
await alertCustomerChat(supabase, booking, failMsg);
await alertAdmin(
`PIN generation FAILED — Order #${orderId}`,
`<p>See logs / admin alert for order details.</p>`,
);
results.push({ orderId, action: "failed_alerted", error: algo.error });
continue;
}
const ensured = await ensurePinOnLock(supabase, accessToken, {
orderId,
lockId,
bridgeId,
startDate,
endDate,
accessName: `Dump Loader Rental - Order #${orderId}`,
clearBudgetMs: 40_000,
createBudgetMs: 50_000,
});
const nowIso = new Date().toISOString();
if (!ensured.jobId && !ensured.lockConfirmed) {
const algo = await createAlgoPin(accessToken, lockId, booking);
if (algo.success) {
await supabase
.from("rental_access_codes")
.update({ status: "expired" })
.eq("order_id", orderId)
.eq("status", "active");
const { error: insertError } = await supabase.from("rental_access_codes").insert({
order_id: orderId,
customer_email: booking.email,
customer_phone: booking.phone || "",
access_pin: algo.pin,
pin_id: algo.pinId,
pin_type: "algopin",
lock_id: lockId,
start_time: algo.startDate,
end_time: endDate,
status: "active",
lock_confirmed_at: nowIso,
confirm_attempts: attempts,
});
if (!insertError) {
await supabase.from("bookings").update({ pin_generated_at: nowIso }).eq("id", orderId);
await maybeNotifyCustomer(supabase, booking, algo.pin, algo.startDate, endDate);
await logSyncError(
supabase,
orderId,
`AlgoPIN issued after hard bridge failure for #${orderId}: ${ensured.error || ensured.createState}`,
);
results.push({ orderId, action: "algopin_hard_fail_fallback", pin: algo.pin });
continue;
}
}
}
await supabase
.from("rental_access_codes")
.update({ status: "expired" })
.eq("order_id", orderId)
.eq("status", "active");
const { error: insertError } = await supabase.from("rental_access_codes").insert({
order_id: orderId,
customer_email: booking.email,
customer_phone: booking.phone || "",
access_pin: ensured.pin,
pin_id: ensured.jobId || "",
pin_type: "bridge_proxied",
lock_id: lockId,
start_time: startDate,
end_time: endDate,
status: "active",
lock_confirmed_at: ensured.lockConfirmed ? nowIso : null,
confirm_attempts: attempts,
});
if (insertError) {
await logSyncError(supabase, orderId, `Bridge PIN insert failed: ${insertError.message}`);
if (underTwoHours || attempts >= ALERT_ATTEMPTS_THRESHOLD) {
await alertCustomerChat(
supabase,
booking,
`URGENT: Access PIN for Order #${orderId} was queued on the lock but failed to save in the portal (${insertError.message}). Staff must verify/generate before pickup.`,
);
await alertAdmin(
`PIN DB insert failed — Order #${orderId}`,
`<p>Insert failed: ${insertError.message}</p>`,
);
}
results.push({ orderId, action: "insert_failed", error: insertError.message });
continue;
}
await supabase.from("bookings").update({ pin_generated_at: nowIso }).eq("id", orderId);
if (ensured.lockConfirmed) {
await maybeNotifyCustomer(supabase, booking, ensured.pin, startDate, endDate);
results.push({ orderId, action: "created_confirmed", pin: ensured.pin });
} else {
await logSyncError(
supabase,
orderId,
`Bridge PIN not confirmed (attempt ${attempts}): ${ensured.error || ensured.createState}. jobId=${ensured.jobId}`,
);
if (attempts >= ALERT_ATTEMPTS_THRESHOLD || underTwoHours) {
const msg =
`Access PIN for Order #${orderId} is not confirmed on the lock yet ` +
`(attempt ${attempts}). Pickup: ${booking.drop_off_date} ${booking.drop_off_time_slot || ""}. ` +
`Watchdog will retry / issue AlgoPIN backup. Job: ${ensured.jobId || "n/a"}.`;
await alertCustomerChat(supabase, booking, msg);
await alertAdmin(
`PIN not confirmed on lock — Order #${orderId}`,
`<p>See logs / admin alert for order details.</p>`,
);
}
results.push({
orderId,
action: "created_unconfirmed",
pin: ensured.pin,
jobId: ensured.jobId,
attempts,
});
}
}
return jsonResponse({
success: true,
processed: results.length,
results,
});
} catch (error) {
return jsonResponse({
success: false,
error: error instanceof Error ? error.message : String(error),
}, 500);
}
});