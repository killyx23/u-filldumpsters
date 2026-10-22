import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { getCorsHeaders } from "./cors.ts";
import { BrevoSmsError, toBrevoRecipient } from "./brevo-sms.ts";

const MAX_BODY_BYTES = 4096;

export class SmsHttpError extends Error {
  readonly status: number;
  readonly logDetail: string | null;

  constructor(status: number, message: string, logDetail: string | null = null) {
    super(message);
    this.name = "SmsHttpError";
    this.status = status;
    this.logDetail = logDetail;
  }
}

export type SmsConfig = {
  apiKey: string;
  sender: string;
  hmacSecret: string;
  allowedCountryCodes: readonly string[];
  dailyGlobalCap: number;
};

export type SmsCaller = {
  userId: string;
  admin: SupabaseClient;
};

export type SmsKind = "notification" | "verification";

export type ReserveSmsInput = {
  admin: SupabaseClient;
  userId: string;
  type: SmsKind;
  template: string | null;
  phoneDigits: string;
  userHourLimit: number | null;
  userDayLimit: number | null;
  phoneHourLimit: number | null;
  globalDailyCap: number;
  codeHash: string | null;
};

export type ReservedSms = {
  logId: string;
  codeId: string | null;
};

type JsonObject = Record<string, unknown>;

function requiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim() ?? "";
  if (!value) {
    console.error(`[sms] missing configuration: ${name}`);
    throw new SmsHttpError(500, "SMS is not configured");
  }
  return value;
}

function parseSender(sender: string): string {
  const alphanumeric = /^[A-Za-z0-9]{1,11}$/;
  const numeric = /^[0-9]{1,15}$/;
  if (alphanumeric.test(sender) || numeric.test(sender)) return sender;
  console.error("[sms] BREVO_SMS_SENDER is not a valid sender id");
  throw new SmsHttpError(500, "SMS is not configured");
}

function parseCountryCodes(raw: string): readonly string[] {
  const codes = raw
    .split(",")
    .map((code) => code.trim())
    .filter((code) => code.length > 0);
  if (codes.length === 0 || codes.some((code) => !/^[0-9]{1,3}$/.test(code))) {
    console.error("[sms] SMS_ALLOWED_COUNTRY_CODES is invalid");
    throw new SmsHttpError(500, "SMS is not configured");
  }
  return [...new Set(codes)].sort((left, right) => right.length - left.length);
}

function parseCap(raw: string): number {
  if (!/^[0-9]+$/.test(raw)) {
    console.error("[sms] SMS_DAILY_GLOBAL_CAP is invalid");
    throw new SmsHttpError(500, "SMS is not configured");
  }
  const cap = Number(raw);
  if (!Number.isSafeInteger(cap) || cap < 1) {
    console.error("[sms] SMS_DAILY_GLOBAL_CAP is invalid");
    throw new SmsHttpError(500, "SMS is not configured");
  }
  return cap;
}

export function readSmsConfig(): SmsConfig {
  return {
    apiKey: requiredEnv("BREVO_API_KEY"),
    sender: parseSender(requiredEnv("BREVO_SMS_SENDER")),
    hmacSecret: requiredEnv("SMS_CODE_HMAC_SECRET"),
    allowedCountryCodes: parseCountryCodes(requiredEnv("SMS_ALLOWED_COUNTRY_CODES")),
    dailyGlobalCap: parseCap(requiredEnv("SMS_DAILY_GLOBAL_CAP")),
  };
}

export function jsonResponse(
  cors: Record<string, string>,
  status: number,
  body: JsonObject,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

export function openSmsPost(req: Request): { cors: Record<string, string>; response: Response | null } {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return { cors, response: new Response("ok", { headers: cors }) };
  }
  if (req.method !== "POST") {
    return { cors, response: jsonResponse(cors, 405, { error: "Method not allowed" }) };
  }
  return { cors, response: null };
}

export async function readJsonObject(req: Request): Promise<JsonObject> {
  const raw = await req.text();
  if (raw.length === 0 || raw.length > MAX_BODY_BYTES) {
    throw new SmsHttpError(400, "Invalid request", "body size");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new SmsHttpError(400, "Invalid request", "malformed json");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new SmsHttpError(400, "Invalid request", "json shape");
  }
  return parsed as JsonObject;
}

export function rejectUnknownKeys(body: JsonObject, allowed: readonly string[]): void {
  const extra = Object.keys(body).filter((key) => !allowed.includes(key));
  if (extra.length > 0) {
    throw new SmsHttpError(400, "Invalid request", "unexpected fields");
  }
}

export function assertAllowedDestination(input: string, allowedCountryCodes: readonly string[]): string {
  let recipient: string;
  try {
    recipient = toBrevoRecipient(input);
  } catch {
    throw new SmsHttpError(400, "Invalid request", "invalid phone");
  }

  // A 10-digit national number is prefixed with 1 only when country code 1 is allowed.
  // Area codes do not start with 1, so this does not rewrite a short international number.
  if (
    recipient.length === 10 &&
    !recipient.startsWith("1") &&
    allowedCountryCodes.includes("1")
  ) {
    recipient = `1${recipient}`;
  }

  const matched = allowedCountryCodes.find((code) => recipient.startsWith(code));
  if (!matched || (matched === "1" && recipient.length !== 11)) {
    throw new SmsHttpError(400, "Invalid request", "country not allowed");
  }
  return recipient;
}

export function last4(phoneDigits: string): string {
  return phoneDigits.slice(-4);
}

export function redactForLog(value: string): string {
  return value
    .replace(/xkeysib-[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/\b\d{6}\b/g, "[code]")
    .replace(/\b\d{8,15}\b/g, (phone) => `***${phone.slice(-4)}`);
}

export async function requireSmsUser(req: Request): Promise<SmsCaller> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim() ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")?.trim() ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim() ?? "";
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    console.error("[sms] missing Supabase configuration");
    throw new SmsHttpError(500, "SMS is not configured");
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    throw new SmsHttpError(401, "Authentication required");
  }
  const token = authHeader.slice("Bearer ".length).trim();
  if (!token || token === anonKey) {
    throw new SmsHttpError(401, "Authentication required");
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await userClient.auth.getUser(token);
  if (error || !data.user) {
    throw new SmsHttpError(401, "Authentication required");
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return { userId: data.user.id, admin };
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function hashVerificationCode(
  secret: string,
  userId: string,
  phoneDigits: string,
  code: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const payload = new TextEncoder().encode(`${userId}\n${phoneDigits}\n${code}`);
  const signature = await crypto.subtle.sign("HMAC", key, payload);
  return bytesToHex(new Uint8Array(signature));
}

export function timingSafeEqual(left: string, right: string): boolean {
  const width = 64;
  let mismatch = left.length === right.length ? 0 : 1;
  for (let index = 0; index < width; index++) {
    const leftCode = index < left.length ? left.charCodeAt(index) : 0;
    const rightCode = index < right.length ? right.charCodeAt(index) : 0;
    mismatch |= leftCode ^ rightCode;
  }
  return mismatch === 0;
}

export function generateVerificationCode(): string {
  const limit = 4_294_000_000;
  const buffer = new Uint32Array(1);
  let value = limit;
  while (value >= limit) {
    crypto.getRandomValues(buffer);
    value = buffer[0] ?? limit;
  }
  return String(value % 1_000_000).padStart(6, "0");
}

function readReserve(data: unknown): { allowed: boolean; reason: string | null; logId: string | null; codeId: string | null } {
  if (data === null || typeof data !== "object") {
    throw new SmsHttpError(500, "Unable to send SMS", "reserve result shape");
  }
  const record = data as JsonObject;
  const allowed = record.allowed === true;
  const reason = typeof record.reason === "string" ? record.reason : null;
  const logId = typeof record.log_id === "string" ? record.log_id : null;
  const codeId = typeof record.code_id === "string" ? record.code_id : null;
  return { allowed, reason, logId, codeId };
}

export async function reserveSmsSend(input: ReserveSmsInput): Promise<ReservedSms> {
  const { data, error } = await input.admin.rpc("reserve_sms_send", {
    p_user_id: input.userId,
    p_type: input.type,
    p_template: input.template,
    p_phone_last4: last4(input.phoneDigits),
    p_phone_digits: input.phoneDigits,
    p_user_hour_limit: input.userHourLimit,
    p_user_day_limit: input.userDayLimit,
    p_phone_hour_limit: input.phoneHourLimit,
    p_global_daily_cap: input.globalDailyCap,
    p_code_hash: input.codeHash,
  });
  if (error) {
    console.error("[sms] reserve failed", redactForLog(error.message));
    throw new SmsHttpError(500, "Unable to send SMS");
  }

  const reserved = readReserve(data);
  if (!reserved.allowed || !reserved.logId) {
    const reason = reserved.reason ?? "limit";
    if (reason === "global_cap") {
      console.warn("[sms] daily global cap reached");
    } else {
      console.warn(`[sms] send refused: ${reason} user=${input.userId} last4=${last4(input.phoneDigits)}`);
    }
    throw new SmsHttpError(429, "Too many requests");
  }
  return { logId: reserved.logId, codeId: reserved.codeId };
}

export async function markSmsSent(
  admin: SupabaseClient,
  logId: string,
  messageId: string,
): Promise<void> {
  const { error } = await admin
    .from("sms_log")
    .update({ status: "sent", brevo_message_id: messageId })
    .eq("id", logId);
  if (error) {
    console.error("[sms] sent status was not recorded", redactForLog(error.message));
  }
}

export async function markSmsFailed(
  admin: SupabaseClient,
  logId: string,
  codeId: string | null,
): Promise<void> {
  const { error } = await admin.from("sms_log").update({ status: "failed" }).eq("id", logId);
  if (error) {
    console.error("[sms] failed status was not recorded", redactForLog(error.message));
  }
  if (!codeId) return;
  const consumed = await admin
    .from("sms_verification_codes")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", codeId)
    .is("consumed_at", null);
  if (consumed.error) {
    console.error("[sms] unused code was not invalidated", redactForLog(consumed.error.message));
  }
}

export function smsErrorResponse(
  cors: Record<string, string>,
  error: unknown,
  fallback: string,
): Response {
  if (error instanceof SmsHttpError) {
    if (error.logDetail) {
      console.warn(`[sms] ${error.status} ${redactForLog(error.logDetail)}`);
    }
    return jsonResponse(cors, error.status, { error: error.message });
  }
  if (error instanceof BrevoSmsError) {
    console.error(`[sms] Brevo ${error.status} ${redactForLog(error.message)}`);
    const status = error.status === 400 ? 400 : 500;
    const message = error.status === 400 ? "Invalid request" : fallback;
    return jsonResponse(cors, status, { error: message });
  }
  const message = error instanceof Error ? error.message : "unknown error";
  console.error("[sms]", redactForLog(message));
  return jsonResponse(cors, 500, { error: fallback });
}
