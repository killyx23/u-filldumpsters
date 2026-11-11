/**
 * Yard-return Bridge confirmation for unlocks inside the return window.
 *
 * When a matched unlock happens within T_return − 2h, we require the yard
 * Bridge to reach the padlock (GET_LOGS jobType 15) before marking returned.
 * Retries every 5 minutes until the job succeeds. Bridge-sourced activity
 * (webhook type 5 / sync pull) already proves contact and can confirm immediately.
 */

import { getActivitySyncToken } from "./iglooAuth.ts";
import { BOOKING_WINDOW_COLUMNS } from "./pinTiming.ts";

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

export const BRIDGE_RETURN_PENDING_KEY = "bridgeReturnPending";
export const BRIDGE_RETURN_RETRY_MS = 5 * 60 * 1000;
export const JOB_TYPE_GET_LOGS = 15;
export const BRIDGE_RETURN_JOB_PURPOSE = "bridge_return_confirm";

const IGLOOHOME_API_BASE_URL = "https://api.igloodeveloper.co/igloohome";

export type BridgeReturnPending = {
  unlockedAt: string;
  requestedAt: string;
  lastAttemptAt: string | null;
  attempts: number;
  lastJobId?: string | null;
};

export function getBridgeReturnPending(
  addons: unknown,
): BridgeReturnPending | null {
  if (!addons || typeof addons !== "object" || Array.isArray(addons)) return null;
  const raw = (addons as Record<string, unknown>)[BRIDGE_RETURN_PENDING_KEY];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const unlockedAt = typeof obj.unlockedAt === "string" ? obj.unlockedAt : null;
  if (!unlockedAt) return null;
  return {
    unlockedAt,
    requestedAt: typeof obj.requestedAt === "string" ? obj.requestedAt : unlockedAt,
    lastAttemptAt: typeof obj.lastAttemptAt === "string" ? obj.lastAttemptAt : null,
    attempts: Number(obj.attempts) || 0,
    lastJobId: typeof obj.lastJobId === "string" ? obj.lastJobId : null,
  };
}

export function bookingHasBridgeReturnPending(booking: Record<string, unknown>): boolean {
  return getBridgeReturnPending(booking.addons) != null && !booking.returned_at;
}

function mergeAddons(
  addons: unknown,
  patch: Record<string, unknown> | null,
): Record<string, unknown> {
  const base =
    addons && typeof addons === "object" && !Array.isArray(addons)
      ? { ...(addons as Record<string, unknown>) }
      : {};
  if (patch === null) {
    delete base[BRIDGE_RETURN_PENDING_KEY];
    return base;
  }
  return { ...base, ...patch };
}

export async function setBridgeReturnPending(
  supabase: SupabaseClient,
  booking: Record<string, unknown>,
  unlockedAt: string,
  extras: Partial<BridgeReturnPending> = {},
): Promise<BridgeReturnPending> {
  const existing = getBridgeReturnPending(booking.addons);
  const now = new Date().toISOString();
  const pending: BridgeReturnPending = {
    unlockedAt: existing?.unlockedAt || unlockedAt,
    requestedAt: existing?.requestedAt || now,
    lastAttemptAt: extras.lastAttemptAt ?? existing?.lastAttemptAt ?? null,
    attempts: extras.attempts ?? existing?.attempts ?? 0,
    lastJobId: extras.lastJobId ?? existing?.lastJobId ?? null,
  };
  const addons = mergeAddons(booking.addons, { [BRIDGE_RETURN_PENDING_KEY]: pending });
  const { error } = await supabase
    .from("bookings")
    .update({ addons })
    .eq("id", booking.id);
  if (error) {
    console.error(`[bridgeReturnConfirm] set pending failed for #${booking.id}:`, error.message);
  } else {
    booking.addons = addons;
  }
  return pending;
}

export async function clearBridgeReturnPending(
  supabase: SupabaseClient,
  booking: Record<string, unknown>,
): Promise<void> {
  if (!getBridgeReturnPending(booking.addons)) return;
  const addons = mergeAddons(booking.addons, null);
  const { error } = await supabase
    .from("bookings")
    .update({ addons })
    .eq("id", booking.id);
  if (error) {
    console.error(`[bridgeReturnConfirm] clear pending failed for #${booking.id}:`, error.message);
  } else {
    booking.addons = addons;
  }
}

async function readResponse(res: Response) {
  const text = await res.text();
  try {
    return { text, json: text ? JSON.parse(text) : null };
  } catch {
    return { text, json: null };
  }
}

/** Create a Bridge GET_LOGS job. Success means the yard Bridge reached the padlock. */
export async function createBridgeGetLogsJob(): Promise<
  { ok: true; jobId: string; raw: unknown } | { ok: false; error: string }
> {
  const clientId = Deno.env.get("IGLOOHOME_CLIENT_ID") || "";
  const clientSecret = Deno.env.get("IGLOOHOME_CLIENT_SECRET") || "";
  const lockId = Deno.env.get("IGLOOHOME_LOCK_ID") || Deno.env.get("IGLOOHOME_DEVICE_ID") || "";
  const bridgeId = Deno.env.get("IGLOOHOME_BRIDGE_ID") || "";
  if (!clientId || !clientSecret || !lockId || !bridgeId) {
    return { ok: false, error: "Missing Igloohome env for Bridge GET_LOGS" };
  }
  const oauth = await getActivitySyncToken(clientId, clientSecret);
  if (!oauth.token) {
    return { ok: false, error: oauth.reason || "OAuth failed for Bridge GET_LOGS" };
  }
  const url = `${IGLOOHOME_API_BASE_URL}/devices/${lockId}/jobs/bridges/${bridgeId}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${oauth.token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      jobType: JOB_TYPE_GET_LOGS,
      jobData: {
        lockTime: new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00"),
      },
    }),
  });
  const body = await readResponse(res);
  if (!res.ok && res.status !== 201) {
    return { ok: false, error: body.text || `HTTP ${res.status}` };
  }
  const jobId = String(body.json?.jobId || body.json?.id || "");
  if (!jobId) return { ok: false, error: "No jobId in Bridge GET_LOGS response" };
  return { ok: true, jobId, raw: body.json };
}

/**
 * Stamp pending state and fire a Bridge GET_LOGS attempt.
 * Does not mark the booking returned.
 */
export async function requestBridgeReturnConfirm(
  supabase: SupabaseClient,
  booking: Record<string, unknown>,
  unlockTimestamp: string,
): Promise<{ pending: BridgeReturnPending; jobId: string | null; error?: string }> {
  const attemptAt = new Date().toISOString();
  let jobId: string | null = null;
  let error: string | undefined;
  try {
    const created = await createBridgeGetLogsJob();
    if (created.ok) {
      jobId = created.jobId;
      await supabase.from("lock_jobs").upsert({
        job_id: created.jobId,
        device_id: Deno.env.get("IGLOOHOME_LOCK_ID") || Deno.env.get("IGLOOHOME_DEVICE_ID") || null,
        job_type: JOB_TYPE_GET_LOGS,
        job_status: null,
        raw: {
          purpose: BRIDGE_RETURN_JOB_PURPOSE,
          order_id: booking.id,
          unlocked_at: unlockTimestamp,
        },
        updated_at: attemptAt,
      }, { onConflict: "job_id" });
    } else {
      error = created.error;
      console.warn(`[bridgeReturnConfirm] GET_LOGS failed for #${booking.id}:`, created.error);
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    console.error(`[bridgeReturnConfirm] GET_LOGS exception for #${booking.id}:`, err);
  }

  const existing = getBridgeReturnPending(booking.addons);
  const pending = await setBridgeReturnPending(supabase, booking, unlockTimestamp, {
    lastAttemptAt: attemptAt,
    attempts: (existing?.attempts || 0) + 1,
    lastJobId: jobId,
  });
  return { pending, jobId, error };
}

/**
 * Retry Bridge contact for every booking still awaiting yard confirmation.
 * Returns how many jobs were (re)issued.
 */
export async function processPendingBridgeReturns(
  supabase: SupabaseClient,
  now: Date = new Date(),
): Promise<{ attempted: number; due: number }> {
  const { data: candidates, error } = await supabase
    .from("bookings")
    .select(`id, status, plan, addons, ${BOOKING_WINDOW_COLUMNS}, rented_out_at, returned_at`)
    .not("rented_out_at", "is", null)
    .is("returned_at", null)
    .not("status", "in", '("Cancelled","Completed","flagged","pending_checklist")');
  if (error) {
    console.error("[bridgeReturnConfirm] pending query failed:", error.message);
    return { attempted: 0, due: 0 };
  }

  let attempted = 0;
  let due = 0;
  const nowMs = now.getTime();
  for (const booking of candidates ?? []) {
    const pending = getBridgeReturnPending(booking.addons);
    if (!pending) continue;
    due += 1;
    const lastMs = pending.lastAttemptAt ? new Date(pending.lastAttemptAt).getTime() : 0;
    if (Number.isFinite(lastMs) && nowMs - lastMs < BRIDGE_RETURN_RETRY_MS) continue;
    await requestBridgeReturnConfirm(supabase, booking, pending.unlockedAt);
    attempted += 1;
  }
  return { attempted, due };
}

/**
 * After a successful GET_LOGS job, resolve which booking (if any) was waiting.
 */
export async function orderIdFromBridgeReturnJob(
  supabase: SupabaseClient,
  jobId: string,
  raw: unknown,
): Promise<number | null> {
  const fromRaw = (value: unknown): number | null => {
    const obj = value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
    if (!obj) return null;
    if (obj.purpose !== BRIDGE_RETURN_JOB_PURPOSE && obj.purpose !== undefined) {
      // allow nested
    }
    const purpose = obj.purpose ?? (obj as { purpose?: unknown }).purpose;
    const orderId = obj.order_id ?? obj.orderId;
    if (purpose === BRIDGE_RETURN_JOB_PURPOSE && orderId != null) {
      const n = Number(orderId);
      return Number.isFinite(n) ? n : null;
    }
    return null;
  };

  const direct = fromRaw(raw);
  if (direct) return direct;

  const { data: row } = await supabase
    .from("lock_jobs")
    .select("raw")
    .eq("job_id", jobId)
    .maybeSingle();
  return fromRaw(row?.raw);
}
