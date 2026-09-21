/**
 * Shared Igloohome duration (hourly) AlgoPIN helper with collision-safe variance
 * allocation.
 *
 * Hourly AlgoPIN is the bridge-down fallback. The algorithm is deterministic:
 * the same deviceId + startDate + endDate + variance always yields the same
 * code. Igloo allows 3 variances (1-3) per exact duration (start AND end).
 *
 * startDate is floored to the UTC hour; endDate is ceiled to the next UTC hour
 * so we never cut a rental short. Duration must be 1–672 hours.
 *
 * Collision guarantee: a partial unique index on
 * `rental_access_codes (lock_id, start_time, end_time, variance)
 *  WHERE status = 'active'` is the source of truth. The pre-insert query is an
 * optimization only. A concurrent race is handled by catching unique-violation
 * (23505) and retrying the next free variance.
 */

import {
  ALGOPIN_HOURLY_MAX_HOURS,
  ALGOPIN_HOURLY_MIN_HOURS,
  formatAlgoPinEndIso,
  formatAlgoPinStartIso,
} from "./pinTiming.ts";

export const IGLOOHOME_ALGOPIN_API_BASE_URL = "https://api.igloodeveloper.co/igloohome";

const MIN_VARIANCE = 1;
const MAX_VARIANCE = 3;

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

async function readResponse(res: Response) {
  const text = await res.text();
  try {
    return { text, json: text ? JSON.parse(text) : null };
  } catch {
    return { text, json: null };
  }
}

type IglooAlgoPinResponse =
  | { success: true; pin: string; pinId: string }
  | { success: false; error: string; rawResponse?: unknown };

async function requestHourlyAlgoPinFromIgloo(
  accessToken: string,
  lockId: string,
  startDate: string,
  endDate: string,
  variance: number,
  accessName: string,
): Promise<IglooAlgoPinResponse> {
  const res = await fetch(`${IGLOOHOME_ALGOPIN_API_BASE_URL}/devices/${lockId}/algopin/hourly`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ accessName, startDate, endDate, variance }),
  });
  const body = await readResponse(res);
  if (!res.ok && res.status !== 201) {
    return {
      success: false,
      error: `Hourly AlgoPIN failed with status ${res.status}`,
      rawResponse: body.json ?? body.text,
    };
  }
  const pin = String(body.json?.pin || body.json?.access_code || body.json?.code || body.json?.data?.pin || "");
  if (!pin) {
    return { success: false, error: "Hourly AlgoPIN succeeded but no PIN value in response", rawResponse: body.json };
  }
  return { success: true, pin, pinId: String(body.json?.pinId || body.json?.id || "") };
}

/**
 * Variances already claimed by other *active* hourly AlgoPINs on this lock for
 * this exact (hour-aligned) start+end duration. Optimization only.
 */
async function usedVariances(
  supabase: SupabaseClient,
  lockId: string,
  startDate: string,
  endDate: string,
): Promise<Set<number>> {
  const { data, error } = await supabase
    .from("rental_access_codes")
    .select("variance")
    .eq("lock_id", lockId)
    .eq("start_time", startDate)
    .eq("end_time", endDate)
    .eq("status", "active")
    .not("variance", "is", null);
  if (error) {
    console.warn("[algoPin] Failed to query used variances, trying full 1-3 range:", error.message);
    return new Set();
  }
  return new Set(
    (data ?? [])
      .map((row: { variance: number | null }) => Number(row.variance))
      .filter((v: number) => Number.isFinite(v)),
  );
}

function isUniqueViolation(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === "23505") return true;
  return /duplicate key value violates unique constraint/i.test(error.message || "");
}

export type CreateAlgoPinWithVarianceOptions = {
  supabase: SupabaseClient;
  accessToken: string;
  lockId: string;
  /** Raw ISO start; floored to the top of the UTC hour before use. */
  startDate: string;
  /** Raw ISO end; ceiled to the next UTC hour before use. */
  endDate: string;
  accessName: string;
  /**
   * Remaining `rental_access_codes` columns for the insert (order_id,
   * customer_email, status, etc). Do not include `access_pin`, `pin_id`,
   * `pin_type`, `lock_id`, `variance`, `start_time`, or `end_time` — this
   * helper fills those in.
   */
  insertRow: Record<string, unknown>;
};

export type CreateAlgoPinWithVarianceResult =
  | {
    success: true;
    exhausted: false;
    pin: string;
    pinId: string;
    variance: number;
    startDate: string;
    endDate: string;
    kind: "hourly";
    /** rental_access_codes.id (uuid) of the inserted row. */
    rowId: string | null;
    error?: undefined;
  }
  | {
    success: false;
    /**
     * True when every variance slot (1-3) for this lock + duration is
     * already claimed. Callers should fall back to the bridge path rather
     * than treat this as a hard failure.
     */
    exhausted: boolean;
    error: string;
  };

/**
 * Create a duration (hourly) AlgoPIN using an unused variance (1-3) for this
 * lock + exact start/end, and persist it to `rental_access_codes` in the same
 * call (the insert is what lets us detect and retry past a collision race).
 *
 * Returns `exhausted: true` (not a hard failure) when all 3 variances are
 * already active for this lock + duration.
 */
export async function createAlgoPinWithVariance(
  opts: CreateAlgoPinWithVarianceOptions,
): Promise<CreateAlgoPinWithVarianceResult> {
  const { supabase, accessToken, lockId, accessName, insertRow } = opts;
  const startDate = formatAlgoPinStartIso(opts.startDate);
  const endDate = formatAlgoPinEndIso(opts.endDate);

  const startMs = new Date(startDate).getTime();
  const endMs = new Date(endDate).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return {
      success: false,
      exhausted: false,
      error: `Hourly AlgoPIN window is invalid (start=${startDate}, end=${endDate})`,
    };
  }
  const hours = (endMs - startMs) / (60 * 60 * 1000);
  if (hours < ALGOPIN_HOURLY_MIN_HOURS || hours > ALGOPIN_HOURLY_MAX_HOURS) {
    return {
      success: false,
      exhausted: false,
      error:
        `Hourly AlgoPIN duration ${hours}h is outside ${ALGOPIN_HOURLY_MIN_HOURS}–${ALGOPIN_HOURLY_MAX_HOURS} hours`,
    };
  }

  const used = await usedVariances(supabase, lockId, startDate, endDate);
  const candidates: number[] = [];
  for (let v = MIN_VARIANCE; v <= MAX_VARIANCE; v++) {
    if (!used.has(v)) candidates.push(v);
  }

  if (candidates.length === 0) {
    return {
      success: false,
      exhausted: true,
      error:
        `All ${MAX_VARIANCE} hourly AlgoPIN variance slots are already active for lock ${lockId} ${startDate}→${endDate}`,
    };
  }

  const { end_time: _ignoredEnd, start_time: _ignoredStart, ...insertRest } = insertRow;

  let lastError = "";
  for (const variance of candidates) {
    const algo = await requestHourlyAlgoPinFromIgloo(
      accessToken,
      lockId,
      startDate,
      endDate,
      variance,
      accessName,
    );
    if (!algo.success) {
      return { success: false, exhausted: false, error: algo.error };
    }

    const { data: inserted, error: insertError } = await supabase
      .from("rental_access_codes")
      .insert({
        ...insertRest,
        access_pin: algo.pin,
        pin_id: algo.pinId || "",
        pin_type: "algopin",
        lock_id: lockId,
        variance,
        start_time: startDate,
        end_time: endDate,
      })
      .select("id")
      .single();

    if (!insertError) {
      return {
        success: true,
        exhausted: false,
        pin: algo.pin,
        pinId: algo.pinId,
        variance,
        startDate,
        endDate,
        kind: "hourly",
        rowId: inserted?.id ?? null,
      };
    }

    if (isUniqueViolation(insertError)) {
      console.warn(
        `[algoPin] Variance ${variance} lost the race for lock ${lockId} ${startDate}→${endDate} — retrying next slot`,
      );
      lastError = insertError.message;
      continue;
    }

    return { success: false, exhausted: false, error: insertError.message };
  }

  return {
    success: false,
    exhausted: true,
    error: lastError ||
      `All available hourly AlgoPIN variance slots collided for lock ${lockId} ${startDate}→${endDate}`,
  };
}
