/**
 * Yard-rental extension codes.
 *
 * Before the customer has taken the trailer (`rented_out_at` is empty), the
 * custom PIN has not been shown yet, or can still be replaced on the bridge.
 * That path expires the stored custom PIN and saves one new custom PIN for the
 * full extended window. After the trailer is out, the padlock is away from the
 * bridge, so the original custom PIN stays and an AlgoPIN covers the extra time.
 */

import { createAlgoPinWithVariance } from "./algoPin.ts";
import { bookingNeedsYardLockPin } from "./deliveryBooking.ts";
import { BRIDGE_PIN_SCOPES, GENERATE_PIN_SCOPES, getOAuthToken } from "./iglooAuth.ts";
import { ensurePinOnLock } from "./lockPin.ts";
import { addGraceHour, buildBookingDateUTC, clampIgloohomeStart, getPinActivationStart } from "./pinTiming.ts";

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

export type ExtensionPinResult = {
  skipped?: boolean;
  ok: boolean;
  exhausted?: boolean;
  /** True when the unused custom PIN was replaced. No AlgoPIN was created. */
  replacedCustom?: boolean;
  pin?: string;
  start?: string;
  end?: string;
  activationRequired?: boolean;
  originalPin?: string | null;
  originalEnd?: string | null;
  error?: string;
};

function toIso(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toISOString().replace(/\.\d{3}Z$/, "+00:00");
}

function randomPin(): string {
  return String(Math.floor(Math.random() * 900000) + 100000);
}

/**
 * The trailer is still at the yard. Replace the stored custom PIN with one
 * code that covers pickup through the new return. Program the lock only when
 * the previous code was already confirmed there.
 */
async function replaceCustomPinForExtension(
  supabase: SupabaseClient,
  booking: Record<string, unknown>,
  newPickupDate: string,
): Promise<ExtensionPinResult> {
  const orderId = Number(booking.id);
  const lockId = Deno.env.get("IGLOOHOME_LOCK_ID") || Deno.env.get("IGLOOHOME_DEVICE_ID") || "";
  const { data: original } = await supabase
    .from("rental_access_codes")
    .select("id, access_pin, start_time, end_time, lock_confirmed_at")
    .eq("order_id", orderId)
    .eq("status", "active")
    .eq("pin_type", "bridge_proxied")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const startDate = original?.start_time
    ? toIso(String(original.start_time))
    : getPinActivationStart(booking as never);
  const endDate = addGraceHour(
    buildBookingDateUTC(newPickupDate, booking.pickup_time_slot as string | null, 5),
  );
  const pin = randomPin();
  const wasOnLock = Boolean(original?.lock_confirmed_at);
  let lockConfirmedAt: string | null = null;
  let pinId = "";
  let lockError = "";

  if (wasOnLock) {
    const clientId = Deno.env.get("IGLOOHOME_CLIENT_ID");
    const clientSecret = Deno.env.get("IGLOOHOME_CLIENT_SECRET");
    const bridgeId = Deno.env.get("IGLOOHOME_BRIDGE_ID");
    if (!clientId || !clientSecret || !lockId || !bridgeId) {
      lockError = "Lock credentials are not configured";
    } else {
      const oauth = await getOAuthToken(clientId, clientSecret, BRIDGE_PIN_SCOPES);
      if (!oauth.token) {
        lockError = oauth.reason || "Could not reach the lock service";
      } else {
        const ensured = await ensurePinOnLock(supabase, oauth.token, {
          orderId,
          lockId,
          bridgeId,
          pin,
          startDate: clampIgloohomeStart(startDate),
          endDate,
          accessName: `Dump Trailer Rental - Order #${orderId}`,
          clearBudgetMs: 30_000,
          createBudgetMs: 40_000,
          settleMs: 5_000,
        });
        pinId = ensured.jobId || "";
        if (ensured.lockConfirmed) {
          lockConfirmedAt = new Date().toISOString();
        } else if (ensured.createState === "failed") {
          lockError = ensured.error || "Lock rejected the replacement PIN";
        }
      }
    }
  }

  if (original?.id) {
    await supabase.from("rental_access_codes").update({ status: "expired" }).eq("id", original.id).eq("status", "active");
  }

  const { error: insertError } = await supabase.from("rental_access_codes").insert({
    order_id: orderId,
    customer_email: booking.email || "",
    customer_phone: booking.phone || "",
    access_pin: pin,
    pin_id: pinId,
    pin_type: "bridge_proxied",
    lock_id: lockId,
    start_time: startDate,
    end_time: endDate,
    status: "active",
    lock_deleted_at: null,
    lock_confirmed_at: lockConfirmedAt,
    confirm_attempts: 0,
  });
  if (insertError) {
    return { ok: false, replacedCustom: true, error: insertError.message };
  }

  await supabase.from("rental_tracking_logs").insert({
    order_id: orderId,
    event_type: "pin_generated",
    event_timestamp: new Date().toISOString(),
    notes:
      `Extension replaced custom PIN ${original?.access_pin || "none"} with ${pin} ` +
      `through ${endDate}. ${wasOnLock ? "Previous code was on the lock." : "Previous code was not on the lock yet."}` +
      (lockError ? ` Lock update failed: ${lockError}` : ""),
  });

  if (lockError) {
    return { ok: false, replacedCustom: true, pin, start: startDate, end: endDate, error: lockError };
  }

  return { ok: true, replacedCustom: true, pin, start: startDate, end: endDate };
}

export async function issueExtensionReturnPin(
  supabase: SupabaseClient,
  booking: Record<string, unknown>,
  newPickupDate: string,
): Promise<ExtensionPinResult> {
  if (!bookingNeedsYardLockPin(booking)) return { ok: true, skipped: true };

  if (!booking.rented_out_at) {
    return replaceCustomPinForExtension(supabase, booking, newPickupDate);
  }

  const clientId = Deno.env.get("IGLOOHOME_CLIENT_ID");
  const clientSecret = Deno.env.get("IGLOOHOME_CLIENT_SECRET");
  const lockId = Deno.env.get("IGLOOHOME_LOCK_ID") || Deno.env.get("IGLOOHOME_DEVICE_ID");
  if (!clientId || !clientSecret || !lockId) {
    return { ok: false, error: "Lock credentials are not configured" };
  }

  const orderId = Number(booking.id);
  const { data: original } = await supabase
    .from("rental_access_codes")
    .select("id, access_pin, end_time, lock_confirmed_at, programmed_end_time")
    .eq("order_id", orderId)
    .eq("status", "active")
    .eq("pin_type", "bridge_proxied")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const nowMs = Date.now();
  const storedEnd = original?.end_time ? toIso(String(original.end_time)) : null;
  const programmedEnd = original?.programmed_end_time
    ? toIso(String(original.programmed_end_time))
    : null;
  const originalEnd = programmedEnd || storedEnd;
  const originalEndMs = originalEnd ? new Date(originalEnd).getTime() : nowMs;
  const earlierMs = Math.min(nowMs, Number.isFinite(originalEndMs) ? originalEndMs : nowMs);
  const startDate = toIso(new Date(earlierMs < nowMs - 60_000 ? nowMs : earlierMs).toISOString());
  const endDate = addGraceHour(
    buildBookingDateUTC(newPickupDate, booking.pickup_time_slot as string | null, 23),
  );
  const hours = (new Date(endDate).getTime() - new Date(startDate).getTime()) / (60 * 60 * 1000);
  const activationRequired = hours > 24;

  const oauth = await getOAuthToken(clientId, clientSecret, GENERATE_PIN_SCOPES);
  if (!oauth.token) return { ok: false, error: oauth.reason || "Could not reach the lock service" };

  const algo = await createAlgoPinWithVariance({
    supabase,
    accessToken: oauth.token,
    lockId,
    startDate,
    endDate,
    accessName: `Dump Trailer Rental - Order #${orderId} (extension return)`,
    insertRow: {
      order_id: orderId,
      customer_email: booking.email || "",
      customer_phone: booking.phone || "",
      status: "active",
      lock_confirmed_at: new Date().toISOString(),
      confirm_attempts: 0,
    },
  });

  if (!algo.success) {
    return {
      ok: false,
      exhausted: algo.exhausted,
      originalPin: original?.access_pin ? String(original.access_pin) : null,
      originalEnd,
      error: algo.exhausted
        ? "Three return codes are already active for this window. Use one of those codes."
        : algo.error,
    };
  }

  if (original?.id && algo.endDate) {
    const nextEndMs = new Date(algo.endDate).getTime();
    const storedEndMs = storedEnd ? new Date(storedEnd).getTime() : 0;
    if (Number.isFinite(nextEndMs) && nextEndMs > storedEndMs) {
      const patch: Record<string, string> = { end_time: algo.endDate };
      if (original.lock_confirmed_at && !programmedEnd && storedEnd) {
        patch.programmed_end_time = storedEnd;
      }
      await supabase.from("rental_access_codes").update(patch).eq("id", original.id);
    }
  }

  await supabase.from("rental_tracking_logs").insert({
    order_id: orderId,
    event_type: "pin_generated",
    event_timestamp: new Date().toISOString(),
    notes:
      `Extension return AlgoPIN ${algo.pin} through ${algo.endDate}. ` +
      `Original custom PIN ${original?.access_pin || "none"} lock end ${originalEnd || "n/a"}, stored end ${algo.endDate}. ` +
      (activationRequired ? "Customer must enter the new code once within 24 hours of its start." : "Code is 24 hours or less."),
  });

  return {
    ok: true,
    pin: algo.pin,
    start: algo.startDate,
    end: algo.endDate,
    activationRequired,
    originalPin: original?.access_pin ? String(original.access_pin) : null,
    originalEnd,
  };
}
