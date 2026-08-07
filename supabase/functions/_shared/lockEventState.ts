/**
 * Lock-event state machine for self-pickup rentals.
 * - First unlock at/after booking start → Mark Rented (status Delivered + rented_out_at)
 * - Lock at/after scheduled end → Mark Returned (status pending_checklist + returned_at)
 * - Grace-hour sweep closes rentals whose last lock fell in/after the end window
 */

import { getBookingWindow } from "./pinTiming.ts";

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

export type LockEventInput = {
  orderId: number;
  eventType: "unlock" | "lock" | "breakin";
  eventTimestamp: string;
  notes?: string;
};

function isCustomerPickupBooking(booking: Record<string, unknown>): boolean {
  const plan = (booking.plan || {}) as Record<string, unknown>;
  const addons = (booking.addons || {}) as Record<string, unknown>;
  if (addons.isDelivery || addons.deliveryService) return false;
  if (plan.customer_pickup === true) return true;
  const id = Number(plan.id);
  return id === 2 || id === 5;
}

async function invokeNotify(
  supabase: SupabaseClient,
  functionName: string,
  body: Record<string, unknown>,
): Promise<void> {
  const base = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!base || !key) {
    console.error(`[lockEventState] Missing SUPABASE_URL/SERVICE_ROLE_KEY for ${functionName}`);
    return;
  }
  try {
    const res = await fetch(`${base}/functions/v1/${functionName}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.error(`[lockEventState] ${functionName} failed:`, await res.text());
    }
  } catch (err) {
    console.error(`[lockEventState] ${functionName} exception:`, err);
  }
}

/** Insert a tracking log, ignoring unique-constraint duplicates. Returns true if inserted. */
export async function insertTrackingLog(
  supabase: SupabaseClient,
  event: LockEventInput,
): Promise<boolean> {
  const { error } = await supabase.from("rental_tracking_logs").insert({
    order_id: event.orderId,
    event_type: event.eventType,
    event_timestamp: event.eventTimestamp,
    api_sync_timestamp: new Date().toISOString(),
    notes: event.notes || `${event.eventType} event via lock sync`,
  });
  if (error) {
    // Unique violation = already ingested
    if (error.code === "23505" || String(error.message || "").includes("duplicate")) {
      return false;
    }
    console.error(`[lockEventState] insertTrackingLog error:`, error);
    return false;
  }
  return true;
}

async function markRented(
  supabase: SupabaseClient,
  booking: Record<string, unknown>,
  eventTimestamp: string,
): Promise<boolean> {
  if (booking.rented_out_at) return false;
  const { error } = await supabase
    .from("bookings")
    .update({
      rented_out_at: eventTimestamp,
      status: "Delivered",
    })
    .eq("id", booking.id)
    .is("rented_out_at", null);
  if (error) {
    console.error(`[lockEventState] markRented failed for #${booking.id}:`, error);
    return false;
  }
  console.log(`[lockEventState] Booking #${booking.id} marked Rented at ${eventTimestamp}`);

  if (!booking.rental_started_notified_at) {
    await invokeNotify(supabase, "send-rental-started", {
      order_id: booking.id,
      unlock_timestamp: eventTimestamp,
    });
  }
  return true;
}

async function markReturned(
  supabase: SupabaseClient,
  booking: Record<string, unknown>,
  eventTimestamp: string,
): Promise<boolean> {
  if (!booking.rented_out_at || booking.returned_at) return false;
  const { error } = await supabase
    .from("bookings")
    .update({
      returned_at: eventTimestamp,
      status: "pending_checklist",
    })
    .eq("id", booking.id)
    .is("returned_at", null)
    .not("rented_out_at", "is", null);
  if (error) {
    console.error(`[lockEventState] markReturned failed for #${booking.id}:`, error);
    return false;
  }
  console.log(`[lockEventState] Booking #${booking.id} marked Returned at ${eventTimestamp}`);

  if (!booking.return_notified_at) {
    await invokeNotify(supabase, "send-return-confirmation", {
      order_id: booking.id,
      lock_event_timestamp: eventTimestamp,
    });
  }
  return true;
}

/**
 * Apply a single lock/unlock event to the matching booking.
 * Returns a short action description for logging.
 */
export async function applyLockEvent(
  supabase: SupabaseClient,
  event: LockEventInput,
): Promise<string> {
  const inserted = await insertTrackingLog(supabase, event);

  // Break-ins belong on the booking timeline but never move rental state.
  if (event.eventType === "breakin") {
    return inserted ? "logged_breakin" : "duplicate_breakin";
  }

  const { data: booking, error } = await supabase
    .from("bookings")
    .select(
      "id, status, plan, addons, drop_off_date, drop_off_time_slot, pickup_date, pickup_time_slot, rented_out_at, returned_at, rental_started_notified_at, return_notified_at",
    )
    .eq("id", event.orderId)
    .single();

  if (error || !booking) {
    return inserted ? "logged_no_booking" : "skipped";
  }

  if (!isCustomerPickupBooking(booking)) {
    return inserted ? "logged_not_self_pickup" : "skipped";
  }

  const window = getBookingWindow(booking);
  const eventMs = new Date(event.eventTimestamp).getTime();
  if (Number.isNaN(eventMs)) return "invalid_timestamp";

  if (event.eventType === "unlock") {
    if (eventMs >= window.startMs && !booking.rented_out_at) {
      await markRented(supabase, booking, event.eventTimestamp);
      return "marked_rented";
    }
    return inserted ? "logged_unlock" : "duplicate_unlock";
  }

  // lock event
  if (
    eventMs >= window.endMs &&
    booking.rented_out_at &&
    !booking.returned_at
  ) {
    await markReturned(supabase, booking, event.eventTimestamp);
    return "marked_returned";
  }
  return inserted ? "logged_lock" : "duplicate_lock";
}

/**
 * After ingesting events, close any self-pickup rental whose grace hour has
 * passed and that has a lock event at/after the scheduled end but no returned_at.
 */
export async function sweepGraceHourReturns(
  supabase: SupabaseClient,
  now: Date = new Date(),
): Promise<number> {
  const { data: candidates, error } = await supabase
    .from("bookings")
    .select(
      "id, status, plan, addons, drop_off_date, drop_off_time_slot, pickup_date, pickup_time_slot, rented_out_at, returned_at, rental_started_notified_at, return_notified_at",
    )
    .not("rented_out_at", "is", null)
    .is("returned_at", null)
    .not("status", "in", '("Cancelled","Completed","flagged")');

  if (error || !candidates?.length) {
    if (error) console.error("[lockEventState] sweepGraceHourReturns query error:", error);
    return 0;
  }

  let closed = 0;
  const nowMs = now.getTime();

  for (const booking of candidates) {
    if (!isCustomerPickupBooking(booking)) continue;
    const window = getBookingWindow(booking);
    if (nowMs < window.graceEndMs) continue;

    const { data: lockEvent } = await supabase
      .from("rental_tracking_logs")
      .select("event_timestamp")
      .eq("order_id", booking.id)
      .eq("event_type", "lock")
      .gte("event_timestamp", new Date(window.endMs).toISOString())
      .order("event_timestamp", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!lockEvent?.event_timestamp) continue;

    const ok = await markReturned(supabase, booking, lockEvent.event_timestamp);
    if (ok) closed += 1;
  }

  return closed;
}

/**
 * Resolve order_id from a PIN by looking up active rental_access_codes whose
 * validity window covers the event timestamp.
 */
export async function resolveOrderIdByPin(
  supabase: SupabaseClient,
  pinCode: string | null,
  eventTimestamp: string,
): Promise<number | null> {
  if (!pinCode) return null;
  const { data, error } = await supabase
    .from("rental_access_codes")
    .select("order_id, start_time, end_time, status")
    .eq("access_pin", pinCode)
    .in("status", ["active", "expired", "used"])
    .order("created_at", { ascending: false })
    .limit(10);

  if (error || !data?.length) return null;

  const eventMs = new Date(eventTimestamp).getTime();
  for (const row of data) {
    const start = new Date(row.start_time).getTime();
    const end = new Date(row.end_time).getTime();
    // Allow a small buffer before start (early unlock attempts) and after end
    if (eventMs >= start - 60 * 60 * 1000 && eventMs <= end + 2 * 60 * 60 * 1000) {
      return Number(row.order_id);
    }
  }
  // Fallback: most recent matching PIN
  return Number(data[0].order_id);
}
