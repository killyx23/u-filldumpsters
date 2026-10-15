/**
 * AlgoPIN for a yard rental whose return moved while the padlock is away
 * from the bridge. The original custom PIN stays active.
 */

import { createAlgoPinWithVariance } from "./algoPin.ts";
import { bookingNeedsYardLockPin } from "./deliveryBooking.ts";
import { getOAuthToken, GENERATE_PIN_SCOPES } from "./iglooAuth.ts";
import { addGraceHour, buildBookingDateUTC } from "./pinTiming.ts";

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

export type ExtensionPinResult = {
  skipped?: boolean;
  ok: boolean;
  exhausted?: boolean;
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

export async function issueExtensionReturnPin(
  supabase: SupabaseClient,
  booking: Record<string, unknown>,
  newPickupDate: string,
): Promise<ExtensionPinResult> {
  if (!bookingNeedsYardLockPin(booking)) return { ok: true, skipped: true };

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
