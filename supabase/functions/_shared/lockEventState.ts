/**
 * Lock-event state machine for self-pickup rentals.
 * - First unlock at/after booking start → Mark Rented (status Delivered + rented_out_at)
 *   and send the rental-started email/SMS.
 * - Each open and close moves the lock's running state. Only the latest event counts.
 * - A close is a return only inside the return window: from two hours before the
 *   due time onward. Pickup-time lock fiddling is outside that window.
 * - An automatic lock inside the window counts. The 9:36 PM close on order 1369
 *   is a return, not an ignored auto-lock.
 * - After the due time, the sweep reconciles any close the live path missed.
 *   Late fees and stolen flags wait until that pass has run.
 */

import { BOOKING_WINDOW_COLUMNS, getBookingWindow, RETURN_GRACE_MS } from "./pinTiming.ts";
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
/** 5-minute checks start this long before the due time (10:30 when due is 11). */
export const RETURN_POLL_FAST_LEAD_MS = 30 * 60 * 1000;
/** 10-minute checks run for this long after the grace hour ends (midnight–2:00 AM). */
export const RETURN_POLL_POST_GRACE_MS = 2 * 60 * 60 * 1000;
export const RETURN_POLL_RELAXED_MS = 15 * 60 * 1000;
export const RETURN_POLL_TIGHT_MS = 5 * 60 * 1000;
export const RETURN_POLL_AFTER_MIDNIGHT_MS = 10 * 60 * 1000;

/**
 * How often to pull the lock while a return is still out.
 * Null means this booking is outside the watch (use the hourly cap, or skip).
 * For an 11:00 PM due time:
 *   9:00–10:30 PM every 15 minutes,
 *   10:30 PM–midnight every 5 minutes,
 *   midnight–2:00 AM every 10 minutes,
 *   2:00 AM until 24 hours after the due time every 15 minutes.
 * A recorded return is not passed in here: callers drop the booking first.
 */
export function returnPollMinMs(nowMs: number, endMs: number): number | null {
  if (!Number.isFinite(nowMs) || !Number.isFinite(endMs)) return null;
  const windowStart = endMs - RETURN_LISTEN_LEAD_MS;
  const watchEnd = endMs + RETURN_LISTEN_TAIL_MS;
  if (nowMs < windowStart || nowMs >= watchEnd) return null;
  const fastStart = endMs - RETURN_POLL_FAST_LEAD_MS;
  const graceEnd = endMs + RETURN_GRACE_MS;
  const afterTwo = graceEnd + RETURN_POLL_POST_GRACE_MS;
  if (nowMs >= afterTwo) return RETURN_POLL_RELAXED_MS;
  if (nowMs >= graceEnd) return RETURN_POLL_AFTER_MIDNIGHT_MS;
  if (nowMs >= fastStart) return RETURN_POLL_TIGHT_MS;
  return RETURN_POLL_RELAXED_MS;
}

/**
 * A close counts as a return only inside the return window, and only after the
 * rental has started. The window opens two hours before the due time and stays
 * open afterward, so a 9:36 PM automatic lock is a return and a 3:32 PM pickup
 * close is not.
 */
export function closeCountsAsReturn(
  lockMs: number,
  endMs: number,
  rentedOutMs: number | null,
): boolean {
  if (!Number.isFinite(lockMs) || !Number.isFinite(endMs)) return false;
  if (lockMs < endMs - RETURN_LISTEN_LEAD_MS) return false;
  if (rentedOutMs !== null && lockMs <= rentedOutMs) return false;
  return true;
}

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
  // A recorded return ends every return check for this booking.
  if (booking.returned_at) return null;
  const status = String(booking.status || "");
  if (
    status === "Cancelled" ||
    status === "Completed" ||
    status === "flagged" ||
    status === "pending_checklist"
  ) return null;

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
  const { data, error } = await supabase
    .from("bookings")
    .update({
      returned_at: eventTimestamp,
      return_lock_at: eventTimestamp,
      status: "pending_checklist",
    })
    .eq("id", booking.id)
    .is("returned_at", null)
    .not("rented_out_at", "is", null)
    .select("id")
    .maybeSingle();
  if (error || !data) {
    if (error) console.error(`[lockEventState] markReturned failed for #${booking.id}:`, error);
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

  const rentedOutMs = booking.rented_out_at
    ? new Date(String(booking.rented_out_at)).getTime()
    : null;
  const inReturnWindow = closeCountsAsReturn(eventMs, window.endMs, rentedOutMs);

  // Pickup-time auto-locks stay outside the return window and never finish the rental.
  if (!inReturnWindow) {
    const pairedUnlockMs = await latestUnlockMsBefore(supabase, event.orderId, eventMs);
    if (pairedUnlockMs !== null && isAutolockDwell(pairedUnlockMs, eventMs)) {
      return inserted ? "logged_autolock" : "duplicate_autolock";
    }
    return inserted ? "logged_lock" : "duplicate_lock";
  }

  if (!booking.rented_out_at || booking.returned_at) {
    return inserted ? "logged_lock" : "duplicate_lock";
  }

  // Only the latest event counts. An automatic lock inside the window is a
  // return when nothing newer has opened the lock again.
  const latest = await latestTrackingEvent(supabase, event.orderId);
  if (!latest || latest.event_type !== "lock") {
    return inserted ? "logged_lock_not_latest" : "duplicate_lock";
  }
  const latestMs = new Date(latest.event_timestamp).getTime();
  if (!closeCountsAsReturn(latestMs, window.endMs, rentedOutMs)) {
    return inserted ? "logged_lock" : "duplicate_lock";
  }

  await markReturned(supabase, booking, latest.event_timestamp);
  return "marked_returned";
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

async function latestTrackingEvent(
  supabase: SupabaseClient,
  orderId: number,
): Promise<{ event_type: string; event_timestamp: string } | null> {
  const { data } = await supabase
    .from("rental_tracking_logs")
    .select("event_type, event_timestamp")
    .eq("order_id", orderId)
    .in("event_type", ["unlock", "lock"])
    .order("event_timestamp", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data?.event_timestamp || !data?.event_type) return null;
  return data;
}

/**
 * After the due time, finish any rental whose latest event is a close inside
 * the return window. Automatic locks count. This runs before late fees.
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

    const latest = await latestTrackingEvent(supabase, Number(booking.id));
    if (!latest || latest.event_type !== "lock") continue;
    const lockMs = new Date(latest.event_timestamp).getTime();
    const rentedOutMs = booking.rented_out_at
      ? new Date(String(booking.rented_out_at)).getTime()
      : null;
    if (!closeCountsAsReturn(lockMs, window.endMs, rentedOutMs)) continue;

    const ok = await markReturned(supabase, booking, latest.event_timestamp);
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
