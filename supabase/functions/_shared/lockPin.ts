/**
 * Shared Igloohome bridge PIN helpers.
 *
 * A 201 from the bridge only means the job was queued. Deletes and creates must
 * be polled to completion or they silently block each other (bridge ≈ 2 jobs/min).
 * All helpers take a time budget so edge invocations stay under the ~150s gateway limit.
 */

const IGLOOHOME_API_BASE_URL = "https://api.igloodeveloper.co/igloohome";

export type JobState = "completed" | "failed" | "pending";

export type PollResult = {
  state: JobState;
  raw: unknown;
  polls: Array<Record<string, unknown>>;
};

// deno-lint-ignore no-explicit-any
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

/**
 * Poll an Igloohome job until completed/failed or the budget is exhausted.
 * Defaults: 2.5s between polls, ~45s total budget.
 */
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

/** Queue a jobType 5 delete and poll until the lock confirms removal. */
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
    // Some responses succeed without a jobId — treat as accepted but unverified.
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

/**
 * Delete every PIN we've issued for an order that still lacks lock_deleted_at.
 * Only stamps lock_deleted_at when the bridge confirms removal.
 * AlgoPIN rows are marked deleted in DB only (cannot remotely revoke).
 */
export async function clearKnownPins(
  supabase: SupabaseClient,
  accessToken: string,
  orderId: number,
  opts: {
    lockId: string;
    bridgeId: string;
    /** Max ms spent on all deletes combined. */
    budgetMs?: number;
    /** Settle pause between bridge jobs (Igloohome ~2/min). */
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
      // Cannot remotely revoke AlgoPIN; mark DB as deleted so we don't keep trying.
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
      // Still expire in DB so a new PIN can be issued; lock may need another clear later.
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

    // Settle between bridge jobs when more remain.
    if (Date.now() + settleMs < deadline && attempted < (rows || []).length) {
      await sleep(settleMs);
    }
  }

  return { attempted, confirmed, failed, pending, details };
}

/** Queue a jobType 4 custom-duration PIN and poll until the lock confirms. */
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

/**
 * Clear known PINs (verified), then create a new bridge PIN and poll for confirmation.
 * Bounded: clear budget + create budget should stay under ~120s total.
 */
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
    /** When upgrading from AlgoPIN, do not expire the fallback until bridge confirms. */
    skipClear?: boolean;
  },
): Promise<EnsurePinResult> {
  const pin = opts.pin || String(Math.floor(Math.random() * 900000) + 100000);
  const emptyClear = { attempted: 0, confirmed: 0, failed: 0, pending: 0, details: [] as Array<Record<string, unknown>> };
  const clear = opts.skipClear
    ? emptyClear
    : await clearKnownPins(supabase, accessToken, opts.orderId, {
      lockId: opts.lockId,
      bridgeId: opts.bridgeId,
      budgetMs: opts.clearBudgetMs ?? 50_000,
      settleMs: opts.settleMs ?? 15_000,
    });

  // If a delete is still pending, wait a short settle then proceed — create may still
  // fail if the old PIN is on the lock, but the watchdog will retry.
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
