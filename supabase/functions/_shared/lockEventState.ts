/**
 * Lock-event state machine for self-pickup rentals.
 * - First unlock at/after booking start → Mark Rented (status Delivered + rented_out_at)
 *   and send the rental-started email/SMS.
 * - The auto-lock a couple of minutes after an unlock only closes the lock icon.
 * - A later lock finishes the rental once the scheduled return time has arrived,
 *   including a lock that happened earlier while the trailer was away.
 * - The sweep uses that later lock when the clock reaches the scheduled return
 *   and nobody has to open the lock again.
 */

import { BOOKING_WINDOW_COLUMNS, getBookingWindow } from "./pinTiming.ts";
import { isDeliveryBooking } from "./deliveryBooking.ts";

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

export type LockEventInput = {
  orderId: number;
  eventType: "unlock" | "lock" | "breakin";
  eventTimestamp: string;
  notes?: string;
};

/** A close this soon after an unlock is the padlock auto-locking, not a return. */
export const AUTOLOCK_DWELL_MS = 2 * 60 * 1000;
/** Wake the bridge this long before drop-off so the pickup unlock is heard. */
export const PICKUP_LISTEN_LEAD_MS = 30 * 60 * 1000;
/** Keep listening this long after drop-off if they have not unlocked yet. */
export const PICKUP_LISTEN_TAIL_MS = 12 * 60 * 60 * 1000;
/** Wake the bridge this long before the scheduled return to catch the backlog. */
export const RETURN_LISTEN_LEAD_MS = 2 * 60 * 60 * 1000;
/** Stop the return wake a day after the scheduled end if they still have not come back. */
export const RETURN_LISTEN_TAIL_MS = 24 * 60 * 60 * 1000;

export type BridgeWakeReason = "pickup" | "return";

/** True when this close belongs to the unlock that just happened. */
export function isAutolockDwell(unlockMs: number, lockMs: number): boolean {
  return lockMs >= unlockMs && lockMs - unlockMs <= AUTOLOCK_DWELL_MS;
}

/**
 * The bridge should be woken for a pickup that has not unlocked yet, or for a
 * return that is due. It should stay asleep for the days in between.
 */
export function bookingNeedsBridgeWake(
  booking: Record<string, unknown>,
  now: Date = new Date(),
): BridgeWakeReason | null {
  if (!isCustomerPickupBooking(booking)) return null;
  if (booking.returned_at) return null;
  const status = String(booking.status || "");
  if (status === "Cancelled" || status === "Completed" || status === "flagged") return null;

  const window = getBookingWindow(booking);
  const nowMs = now.getTime();
  if (!Number.isFinite(window.startMs) || !Number.isFinite(window.endMs)) return null;

  if (
    !booking.rented_out_at &&
    nowMs >= window.startMs - PICKUP_LISTEN_LEAD_MS &&
    nowMs < window.startMs + PICKUP_LISTEN_TAIL_MS &&
    nowMs < window.endMs
  ) {
    return "pickup";
  }

  if (
    booking.rented_out_at &&
    nowMs >= window.endMs - RETURN_LISTEN_LEAD_MS &&
    nowMs < window.endMs + RETURN_LISTEN_TAIL_MS
  ) {
    return "return";
  }

  return null;
}

function isCustomerPickupBooking(booking: Record<string, unknown>): boolean {
  if (isDeliveryBooking(booking)) return false;
  const plan = (booking.plan || {}) as Record<string, unknown>;
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
      `id, status, plan, addons, ${BOOKING_WINDOW_COLUMNS}, rented_out_at, returned_at, rental_started_notified_at, return_notified_at`,
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

  const pairedUnlockMs = await latestUnlockMsBefore(supabase, event.orderId, eventMs);
  if (pairedUnlockMs !== null && isAutolockDwell(pairedUnlockMs, eventMs)) {
    return inserted ? "logged_autolock" : "duplicate_autolock";
  }

  // A later close, once the scheduled return has arrived. The close itself may
  // have happened earlier, while the trailer was away from the bridge.
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

async function latestUnlockMsBefore(
  supabase: SupabaseClient,
  orderId: number,
  lockMs: number,
): Promise<number | null> {
  const { data } = await supabase
    .from("rental_tracking_logs")
    .select("event_timestamp")
    .eq("order_id", orderId)
    .eq("event_type", "unlock")
    .lte("event_timestamp", new Date(lockMs).toISOString())
    .order("event_timestamp", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data?.event_timestamp) return null;
  const ms = new Date(data.event_timestamp).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Once the scheduled return time has arrived, finish a rental from its latest
 * real lock. The pickup auto-lock does not count. An earlier close from while
 * the trailer was away does, so they do not have to open the lock again.
 */
export async function sweepGraceHourReturns(
  supabase: SupabaseClient,
  now: Date = new Date(),
): Promise<number> {
  const { data: candidates, error } = await supabase
    .from("bookings")
    .select(
      `id, status, plan, addons, ${BOOKING_WINDOW_COLUMNS}, rented_out_at, returned_at, rental_started_notified_at, return_notified_at`,
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
    if (nowMs < window.endMs) continue;

    const { data: lockEvent } = await supabase
      .from("rental_tracking_logs")
      .select("event_timestamp")
      .eq("order_id", booking.id)
      .eq("event_type", "lock")
      .order("event_timestamp", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!lockEvent?.event_timestamp) continue;
    const lockMs = new Date(lockEvent.event_timestamp).getTime();
    if (Number.isNaN(lockMs)) continue;
    const pairedUnlockMs = await latestUnlockMsBefore(supabase, Number(booking.id), lockMs);
    if (pairedUnlockMs !== null && isAutolockDwell(pairedUnlockMs, lockMs)) continue;

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

/**
 * A padlock auto-lock has no PIN. Attach it to the booking the preceding
 * unlock on this device already matched, and only while that rental is still open.
 */
export async function resolvePrecedingUnlockOrderId(
  supabase: SupabaseClient,
  deviceId: string,
  eventTimestamp: string,
): Promise<number | null> {
  const { data: unlock, error } = await supabase
    .from("lock_device_events")
    .select("order_id")
    .eq("device_id", deviceId)
    .eq("event_kind", "unlock")
    .not("order_id", "is", null)
    .lte("occurred_at", eventTimestamp)
    .order("occurred_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !unlock?.order_id) return null;

  const orderId = Number(unlock.order_id);
  const { data: booking } = await supabase
    .from("bookings")
    .select("id, returned_at")
    .eq("id", orderId)
    .maybeSingle();
  if (!booking || booking.returned_at) return null;
  return orderId;
}
