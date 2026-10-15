/**
 * Save one custom duration PIN on a confirmed yard-pickup booking.
 * Does not call Igloohome and does not email the customer. The overnight
 * reconcile sends this same code until the lock confirms it.
 */

import { bookingNeedsYardLockPin } from "./deliveryBooking.ts";
import {
  addGraceHour,
  buildBookingDateUTC,
  denverCalendarDate,
  getPinActivationStart,
  isBookingEnded,
} from "./pinTiming.ts";

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

function randomPin(): string {
  return String(Math.floor(Math.random() * 900000) + 100000);
}

export async function reserveYardPinForBooking(
  supabase: SupabaseClient,
  booking: Record<string, unknown>,
  lockId = "",
): Promise<{ action: string; pin?: string; error?: string }> {
  if (!bookingNeedsYardLockPin(booking)) return { action: "skip_not_yard" };
  if (String(booking.status || "") !== "Confirmed") return { action: "skip_status" };
  if (isBookingEnded(booking as never)) return { action: "skip_ended" };
  if (!booking.drop_off_date || !booking.pickup_date) return { action: "skip_dates" };

  const orderId = Number(booking.id);
  const { data: existing, error: existingError } = await supabase
    .from("rental_access_codes")
    .select("id, access_pin")
    .eq("order_id", orderId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingError) return { action: "lookup_failed", error: existingError.message };

  if (existing?.access_pin) {
    if (!booking.pin_generated_at) {
      await supabase
        .from("bookings")
        .update({ pin_generated_at: new Date().toISOString() })
        .eq("id", orderId);
    }
    return { action: "exists", pin: String(existing.access_pin) };
  }

  const pin = randomPin();
  const startDate = getPinActivationStart(booking as never);
  const endDate = addGraceHour(
    buildBookingDateUTC(String(booking.pickup_date), booking.pickup_time_slot as string | null, 5),
  );
  const { error: insertError } = await supabase.from("rental_access_codes").insert({
    order_id: orderId,
    customer_email: booking.email || "",
    customer_phone: booking.phone || "",
    access_pin: pin,
    pin_id: "",
    pin_type: "bridge_proxied",
    lock_id: lockId,
    start_time: startDate,
    end_time: endDate,
    status: "active",
    lock_deleted_at: null,
    lock_confirmed_at: null,
    confirm_attempts: 0,
  });
  if (insertError) return { action: "insert_failed", error: insertError.message };

  await supabase
    .from("bookings")
    .update({ pin_generated_at: new Date().toISOString() })
    .eq("id", orderId);

  return { action: "reserved", pin };
}

/** Reserve a custom PIN for every confirmed future yard pickup that does not have one. */
export async function reserveMissingYardPins(
  supabase: SupabaseClient,
  focusOrderId: number | null,
): Promise<{ reserved: Array<Record<string, unknown>>; error?: string }> {
  const today = denverCalendarDate();
  const lockId = Deno.env.get("IGLOOHOME_LOCK_ID") || Deno.env.get("IGLOOHOME_DEVICE_ID") || "";
  let query = supabase
    .from("bookings")
    .select("*")
    .eq("status", "Confirmed")
    .gte("drop_off_date", today);
  if (focusOrderId) query = query.eq("id", focusOrderId);
  const { data, error } = await query;
  if (error) return { reserved: [], error: error.message };

  const reserved: Array<Record<string, unknown>> = [];
  for (const booking of data ?? []) {
    const result = await reserveYardPinForBooking(supabase, booking, lockId);
    if (result.action === "reserved") {
      reserved.push({ bookingId: booking.id, pin: result.pin });
    }
  }
  return { reserved };
}
