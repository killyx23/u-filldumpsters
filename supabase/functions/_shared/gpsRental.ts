/**
 * Turn a confirmed yard crossing into rented_out_at / returned_at.
 * A crossing with zero or several self-pickup bookings is an alert, not a guess.
 */

import { isDeliveryBooking } from "./deliveryBooking.ts";
import { CHECKOUT_LEAD_MS, GPS_FRESH_MS, GPS_SILENT_MS, GPS_STREAK, isoFromMs } from "./gpsGeofence.ts";
import { closeCountsAsReturn } from "./lockEventState.ts";
import { BOOKING_WINDOW_COLUMNS, getBookingWindow } from "./pinTiming.ts";
import { ensureUnitAssignment, releaseUnitAssignment } from "./unitAssignment.ts";

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

const TERMINAL = '("Cancelled","Completed","flagged","pending_checklist")';

export type TrackerState = {
  macid: string;
  inside_yard: boolean | null;
  consecutive_outside: number;
  consecutive_inside: number;
  streak_outside_at: string | null;
  streak_inside_at: string | null;
  last_valid_at: string | null;
  last_reading_at: string | null;
  valid: boolean;
  open_booking_id: number | null;
  checkout_mileage: number | null;
  checkout_fuel: string | null;
};

export type TrackerRecord = {
  macid: string;
  inventory_unit_id: number | null;
  is_active: boolean;
};

type BookingRow = Record<string, unknown>;

function isCustomerPickupBooking(booking: BookingRow): boolean {
  if (isDeliveryBooking(booking)) return false;
  const plan = (booking.plan || {}) as Record<string, unknown>;
  if (plan.customer_pickup === true) return true;
  const id = Number(plan.id);
  return id === 2 || id === 5;
}

function inCheckoutWindow(booking: BookingRow, nowMs: number): boolean {
  const window = getBookingWindow(booking as never);
  if (!Number.isFinite(window.startMs) || !Number.isFinite(window.endMs)) return false;
  return nowMs >= window.startMs - CHECKOUT_LEAD_MS && nowMs <= window.endMs;
}

async function invokeNotify(
  supabase: SupabaseClient,
  functionName: string,
  body: Record<string, unknown>,
): Promise<void> {
  const base = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!base || !key) return;
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
      console.error(`[gpsRental] ${functionName} failed:`, res.status);
    }
  } catch (err) {
    console.error(`[gpsRental] ${functionName} exception:`, err);
  }
}

export async function raiseAlert(
  supabase: SupabaseClient,
  alert: {
    macid: string | null;
    bookingId?: number | null;
    kind: string;
    message: string;
    payload?: Record<string, unknown>;
  },
): Promise<void> {
  let query = supabase
    .from("gps_alerts")
    .select("id")
    .eq("kind", alert.kind)
    .is("resolved_at", null);
  query = alert.macid ? query.eq("macid", alert.macid) : query.is("macid", null);
  const { data: existing } = await query.maybeSingle();
  const row = {
    macid: alert.macid,
    booking_id: alert.bookingId ?? null,
    kind: alert.kind,
    message: alert.message,
    payload: alert.payload ?? {},
  };
  if (existing?.id) {
    await supabase.from("gps_alerts").update(row).eq("id", existing.id);
    return;
  }
  const { error } = await supabase.from("gps_alerts").insert(row);
  if (error) console.error("[gpsRental] alert insert failed:", error.message);
}

export async function resolveAlert(
  supabase: SupabaseClient,
  macid: string | null,
  kind: string,
): Promise<void> {
  let query = supabase
    .from("gps_alerts")
    .update({ resolved_at: new Date().toISOString() })
    .eq("kind", kind)
    .is("resolved_at", null);
  query = macid ? query.eq("macid", macid) : query.is("macid", null);
  await query;
}

async function loadCandidates(
  supabase: SupabaseClient,
  unitId: number,
): Promise<BookingRow[]> {
  const { data: lines, error } = await supabase
    .from("booking_unit_assignments")
    .select("booking_id")
    .eq("inventory_unit_id", unitId)
    .is("released_at", null);
  if (error || !lines?.length) return [];
  const ids = [...new Set(lines.map((line: { booking_id: number }) => line.booking_id))];
  const { data, error: bookingError } = await supabase
    .from("bookings")
    .select(
      `id, status, plan, addons, delivery_type, ${BOOKING_WINDOW_COLUMNS}, rented_out_at, returned_at, checkout_clock_source, return_clock_source, rental_started_notified_at, return_notified_at`,
    )
    .in("id", ids)
    .is("returned_at", null)
    .not("status", "in", TERMINAL);
  if (bookingError) {
    console.error("[gpsRental] candidate query failed:", bookingError.message);
    return [];
  }
  return data ?? [];
}

const PICKUP_SELECT =
  `id, status, plan, addons, delivery_type, ${BOOKING_WINDOW_COLUMNS}, rented_out_at, returned_at, checkout_clock_source, return_clock_source, rental_started_notified_at, return_notified_at`;

async function loadPickupCandidates(
  supabase: SupabaseClient,
  unitId: number,
  nowMs: number,
): Promise<BookingRow[]> {
  const assigned = await loadCandidates(supabase, unitId);
  if (assigned.length) return assigned;

  const from = new Date(nowMs - 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const to = new Date(nowMs + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from("bookings")
    .select(PICKUP_SELECT)
    .is("returned_at", null)
    .in("status", ["Confirmed", "Delivered"])
    .gte("drop_off_date", from)
    .lte("drop_off_date", to);
  if (error || !data?.length) {
    if (error) console.error("[gpsRental] pickup candidate query failed:", error.message);
    return [];
  }

  const { data: openLines } = await supabase
    .from("booking_unit_assignments")
    .select("booking_id, inventory_unit_id")
    .is("released_at", null);
  const blocked = new Set(
    (openLines ?? [])
      .filter((line: { inventory_unit_id: number }) => Number(line.inventory_unit_id) !== unitId)
      .map((line: { booking_id: number }) => Number(line.booking_id)),
  );
  return (data as BookingRow[]).filter((booking) => !blocked.has(Number(booking.id)));
}

function chooseCheckout(candidates: BookingRow[], nowMs: number): { booking: BookingRow | null; reason: "none" | "one" | "many" | "delivery" } {
  const pickup = candidates.filter((booking) => isCustomerPickupBooking(booking) && inCheckoutWindow(booking, nowMs));
  const delivery = candidates.filter((booking) => isDeliveryBooking(booking) && inCheckoutWindow(booking, nowMs));
  if (pickup.length === 1) return { booking: pickup[0], reason: "one" };
  if (pickup.length > 1) {
    const locked = pickup.filter((booking) => booking.checkout_clock_source === "lock");
    if (locked.length === 1) return { booking: locked[0], reason: "one" };
    return { booking: null, reason: "many" };
  }
  if (delivery.length > 0) return { booking: null, reason: "delivery" };
  return { booking: null, reason: "none" };
}

export async function applyGpsCheckout(
  supabase: SupabaseClient,
  booking: BookingRow,
  atIso: string,
): Promise<"applied" | "kept" | "skipped"> {
  const status = String(booking.status || "");
  if (status !== "Confirmed" && status !== "Delivered") return "skipped";
  const replace = !booking.rented_out_at || booking.checkout_clock_source === "lock";
  if (!replace) return "kept";

  const patch: Record<string, unknown> = {
    rented_out_at: atIso,
    checkout_clock_source: "gps",
  };
  if (status === "Confirmed") patch.status = "Delivered";
  const { error } = await supabase.from("bookings").update(patch).eq("id", booking.id);
  if (error) {
    console.error(`[gpsRental] checkout update failed for #${booking.id}:`, error.message);
    return "skipped";
  }
  if (!booking.rental_started_notified_at) {
    await invokeNotify(supabase, "send-rental-started", {
      order_id: booking.id,
      unlock_timestamp: atIso,
    });
  }
  return "applied";
}

export async function applyGpsReturn(
  supabase: SupabaseClient,
  booking: BookingRow,
  atIso: string,
  mileage: { checkout: number | null; returned: number | null },
): Promise<"applied" | "alert" | "skipped"> {
  const status = String(booking.status || "");
  if (status === "Completed") return "alert";
  if (booking.return_clock_source === "manual") return "alert";
  if (booking.returned_at && booking.return_clock_source !== "lock" && booking.return_clock_source !== null) {
    return "skipped";
  }

  const patch: Record<string, unknown> = {
    returned_at: atIso,
    return_lock_at: atIso,
    return_clock_source: "gps",
  };
  if (status === "Delivered" || status === "Confirmed") patch.status = "pending_checklist";
  const { error } = await supabase.from("bookings").update(patch).eq("id", booking.id);
  if (error) {
    console.error(`[gpsRental] return update failed for #${booking.id}:`, error.message);
    return "skipped";
  }
  if (!booking.return_notified_at) {
    await invokeNotify(supabase, "send-return-confirmation", {
      order_id: booking.id,
      lock_event_timestamp: atIso,
    });
  }
  await writeMileageDelta(supabase, booking, mileage);
  return "applied";
}

async function writeMileageDelta(
  supabase: SupabaseClient,
  booking: BookingRow,
  mileage: { checkout: number | null; returned: number | null },
): Promise<void> {
  const addons = (booking.addons || {}) as Record<string, unknown>;
  if (addons.extraGpsMilesLocked === true) return;
  if (mileage.checkout == null || mileage.returned == null) return;
  const delta = Math.round((mileage.returned - mileage.checkout) * 100) / 100;
  if (!Number.isFinite(delta) || delta < 0) return;
  const { data: log } = await supabase
    .from("booking_mileage_logs")
    .select("id")
    .eq("booking_id", booking.id)
    .maybeSingle();
  if (!log?.id) return;
  await supabase
    .from("booking_mileage_logs")
    .update({ customer_gps_miles: delta, updated_at: new Date().toISOString() })
    .eq("id", log.id);
}

export async function onConfirmedOutside(
  supabase: SupabaseClient,
  tracker: TrackerRecord,
  atIso: string,
  extras: { mileage: number | null; fuel: string | null; lat: number | null; lon: number | null },
  nowMs: number,
): Promise<{ openBookingId: number | null; checkoutMileage: number | null; checkoutFuel: string | null }> {
  const keep = {
    openBookingId: null as number | null,
    checkoutMileage: extras.mileage,
    checkoutFuel: extras.fuel,
  };
  if (!tracker.inventory_unit_id) {
    await raiseAlert(supabase, {
      macid: tracker.macid,
      kind: "unmapped_tracker",
      message: `Tracker ${tracker.macid} left the yard and is not linked to a unit.`,
      payload: { streakAt: atIso, ...extras },
    });
    return keep;
  }
  await resolveAlert(supabase, tracker.macid, "unmapped_tracker");

  const candidates = await loadPickupCandidates(supabase, tracker.inventory_unit_id, nowMs);
  const choice = chooseCheckout(candidates, nowMs);
  const payload = {
    streakAt: atIso,
    ...extras,
    candidateIds: candidates.map((booking) => booking.id),
  };

  if (choice.reason === "many") {
    await raiseAlert(supabase, {
      macid: tracker.macid,
      kind: "ambiguous_booking",
      message: `Tracker ${tracker.macid} left the yard and more than one self-pickup booking matches.`,
      payload,
    });
    return keep;
  }
  if (choice.reason === "delivery") {
    await raiseAlert(supabase, {
      macid: tracker.macid,
      kind: "delivery_departure",
      message: `Tracker ${tracker.macid} left the yard on a company delivery, not a customer checkout.`,
      payload,
    });
    return keep;
  }
  if (!choice.booking) {
    await raiseAlert(supabase, {
      macid: tracker.macid,
      kind: "left_no_booking",
      message: `Tracker ${tracker.macid} left the yard with no self-pickup booking in the window.`,
      payload,
    });
    return keep;
  }

  const assigned = await ensureUnitAssignment(supabase, Number(choice.booking.id), tracker.inventory_unit_id);
  if (!assigned) {
    await raiseAlert(supabase, {
      macid: tracker.macid,
      bookingId: Number(choice.booking.id),
      kind: "ambiguous_booking",
      message: `Tracker ${tracker.macid} left the yard but booking #${choice.booking.id} could not be assigned to its unit.`,
      payload,
    });
    return keep;
  }

  const applied = await applyGpsCheckout(supabase, choice.booking, atIso);
  if (applied === "skipped") {
    await raiseAlert(supabase, {
      macid: tracker.macid,
      bookingId: Number(choice.booking.id),
      kind: "left_no_booking",
      message: `Tracker ${tracker.macid} left the yard but booking #${choice.booking.id} was not updated.`,
      payload,
    });
    return keep;
  }

  await resolveAlert(supabase, tracker.macid, "left_no_booking");
  await resolveAlert(supabase, tracker.macid, "ambiguous_booking");
  await resolveAlert(supabase, tracker.macid, "delivery_departure");
  return {
    openBookingId: Number(choice.booking.id),
    checkoutMileage: extras.mileage,
    checkoutFuel: extras.fuel,
  };
}

async function bookingForYardReturn(
  supabase: SupabaseClient,
  state: TrackerState,
): Promise<BookingRow | null> {
  if (state.open_booking_id) {
    const { data, error } = await supabase
      .from("bookings")
      .select(PICKUP_SELECT)
      .eq("id", state.open_booking_id)
      .maybeSingle();
    if (error) console.error("[gpsRental] return booking query failed:", error.message);
    if (data) return data;
  }

  const { data: tracker } = await supabase
    .from("gps_trackers")
    .select("inventory_unit_id")
    .eq("macid", state.macid)
    .maybeSingle();
  if (!tracker?.inventory_unit_id) return null;
  const assigned = await loadCandidates(supabase, Number(tracker.inventory_unit_id));
  const rented = assigned.filter((booking) => booking.rented_out_at);
  return rented.length === 1 ? rented[0] : null;
}

export async function onConfirmedInside(
  supabase: SupabaseClient,
  state: TrackerState,
  atIso: string,
  mileage: number | null,
  nowMs?: number,
): Promise<{ openBookingId: number | null; applied: boolean }> {
  const booking = await bookingForYardReturn(supabase, state);
  if (!booking) {
    await raiseAlert(supabase, {
      macid: state.macid,
      kind: "return_no_trip",
      message: `Tracker ${state.macid} entered the yard with no open GPS trip.`,
      payload: { streakAt: atIso, direction: "return" },
    });
    return { openBookingId: null, applied: false };
  }

  const bookingId = Number(booking.id);
  const atMs = new Date(atIso).getTime();
  const observedMs = nowMs ?? atMs;
  const window = getBookingWindow(booking as never);
  const rentedOutMs = booking.rented_out_at ? new Date(String(booking.rented_out_at)).getTime() : null;
  const arrivedInWindow = closeCountsAsReturn(atMs, window.endMs, rentedOutMs);
  const stillHereInWindow = closeCountsAsReturn(observedMs, window.endMs, rentedOutMs);
  if (!arrivedInWindow && !stillHereInWindow) {
    return { openBookingId: bookingId, applied: false };
  }
  const returnStamp = arrivedInWindow ? atIso : new Date(observedMs).toISOString();

  const result = await applyGpsReturn(supabase, booking, returnStamp, {
    checkout: state.checkout_mileage,
    returned: mileage,
  });
  if (result === "skipped" && booking.returned_at) {
    await releaseUnitAssignment(supabase, bookingId);
    return { openBookingId: null, applied: false };
  }
  if (result === "alert") {
    const kind = String(booking.status) === "Completed" ? "completed_disagreement" : "manual_return_disagreement";
    await raiseAlert(supabase, {
      macid: state.macid,
      bookingId,
      kind,
      message: `Tracker ${state.macid} is in the yard. Booking #${bookingId} was left unchanged.`,
      payload: { streakAt: atIso },
    });
    return { openBookingId: null, applied: false };
  }
  if (result === "applied") {
    await releaseUnitAssignment(supabase, bookingId);
    await resolveAlert(supabase, state.macid, "past_return_still_outside");
    await resolveAlert(supabase, state.macid, "returned_but_outside");
    await resolveAlert(supabase, state.macid, "left_no_booking");
    await resolveAlert(supabase, state.macid, "return_no_trip");
    return { openBookingId: null, applied: true };
  }
  return { openBookingId: bookingId, applied: false };
}

export async function watchOpenTrip(
  supabase: SupabaseClient,
  state: TrackerState,
  reading: { hearttimeMs: number | null; serverTimeMs: number | null; mainPower: boolean | null },
  nowMs: number,
): Promise<void> {
  if (state.inside_yard === true && state.open_booking_id && state.last_valid_at) {
    const atMs = new Date(state.last_valid_at).getTime();
    if (Number.isFinite(atMs) && nowMs - atMs <= GPS_FRESH_MS) {
      const stamp = state.streak_inside_at || state.last_valid_at;
      const trip = await onConfirmedInside(supabase, state, stamp, null, nowMs);
      state.open_booking_id = trip.openBookingId;
    }
  }

  if (!state.open_booking_id || state.inside_yard !== false) {
    await resolveAlert(supabase, state.macid, "past_return_still_outside");
    await resolveAlert(supabase, state.macid, "main_power_off");
    await resolveAlert(supabase, state.macid, "tracker_silent");
    await resolveAlert(supabase, state.macid, "returned_but_outside");
    return;
  }

  const { data: booking } = await supabase
    .from("bookings")
    .select(`id, status, returned_at, return_clock_source, ${BOOKING_WINDOW_COLUMNS}`)
    .eq("id", state.open_booking_id)
    .maybeSingle();
  if (!booking) return;

  if (booking.returned_at) {
    await raiseAlert(supabase, {
      macid: state.macid,
      bookingId: Number(booking.id),
      kind: "returned_but_outside",
      message: `Booking #${booking.id} is marked returned and tracker ${state.macid} is still outside the yard.`,
    });
  } else {
    await resolveAlert(supabase, state.macid, "returned_but_outside");
    const window = getBookingWindow(booking as never);
    if (Number.isFinite(window.endMs) && nowMs > window.endMs) {
      await raiseAlert(supabase, {
        macid: state.macid,
        bookingId: Number(booking.id),
        kind: "past_return_still_outside",
        message: `Booking #${booking.id} is past its scheduled return and tracker ${state.macid} is still outside.`,
      });
    } else {
      await resolveAlert(supabase, state.macid, "past_return_still_outside");
    }
  }

  if (reading.mainPower === false) {
    await raiseAlert(supabase, {
      macid: state.macid,
      bookingId: Number(booking.id),
      kind: "main_power_off",
      message: `Tracker ${state.macid} lost main power while booking #${booking.id} is out.`,
    });
  } else {
    await resolveAlert(supabase, state.macid, "main_power_off");
  }

  const heart = reading.hearttimeMs;
  const server = reading.serverTimeMs ?? nowMs;
  if (heart != null && server - heart > GPS_SILENT_MS) {
    await raiseAlert(supabase, {
      macid: state.macid,
      bookingId: Number(booking.id),
      kind: "tracker_silent",
      message: `Tracker ${state.macid} has gone silent while booking #${booking.id} is out.`,
    });
  } else if (heart != null) {
    await resolveAlert(supabase, state.macid, "tracker_silent");
  }
}

export function nextStreak(
  state: TrackerState,
  inside: boolean,
  gpstimeMs: number,
): { state: TrackerState; checkoutAt: string | null; returnAt: string | null } {
  const at = isoFromMs(gpstimeMs);
  const next: TrackerState = { ...state, valid: true, last_valid_at: at };
  let checkoutAt: string | null = null;
  let returnAt: string | null = null;

  if (inside) {
    next.consecutive_inside = (state.consecutive_inside ?? 0) + 1;
    next.consecutive_outside = 0;
    next.streak_outside_at = null;
    if (next.consecutive_inside === 1) next.streak_inside_at = at;
    if (state.inside_yard === false && next.consecutive_inside >= GPS_STREAK) {
      returnAt = next.streak_inside_at;
      next.inside_yard = true;
    } else if (state.inside_yard == null && next.consecutive_inside >= GPS_STREAK) {
      next.inside_yard = true;
    }
  } else {
    next.consecutive_outside = (state.consecutive_outside ?? 0) + 1;
    next.consecutive_inside = 0;
    next.streak_inside_at = null;
    if (next.consecutive_outside === 1) next.streak_outside_at = at;
    if (state.inside_yard === true && next.consecutive_outside >= GPS_STREAK) {
      checkoutAt = next.streak_outside_at;
      next.inside_yard = false;
    } else if (state.inside_yard == null && next.consecutive_outside >= GPS_STREAK) {
      next.inside_yard = false;
    }
  }

  return { state: next, checkoutAt, returnAt };
}

export async function attachOpenTrip(
  supabase: SupabaseClient,
  macid: string,
  bookingId: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: alert } = await supabase
    .from("gps_alerts")
    .select("id, payload, kind")
    .eq("macid", macid)
    .in("kind", ["left_no_booking", "ambiguous_booking", "delivery_departure"])
    .is("resolved_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const streakAt = alert?.payload?.streakAt;
  if (typeof streakAt !== "string") {
    return { ok: false, error: "This alert has no GPS time to apply." };
  }

  const { data: tracker } = await supabase
    .from("gps_trackers")
    .select("macid, inventory_unit_id")
    .eq("macid", macid)
    .maybeSingle();
  if (!tracker?.inventory_unit_id) {
    return { ok: false, error: "Link this tracker to a unit before attaching a booking." };
  }

  const { data: openForBooking } = await supabase
    .from("booking_unit_assignments")
    .select("id, inventory_unit_id")
    .eq("booking_id", bookingId)
    .is("released_at", null)
    .maybeSingle();
  if (openForBooking && Number(openForBooking.inventory_unit_id) !== Number(tracker.inventory_unit_id)) {
    return { ok: false, error: "That booking is already assigned to another unit." };
  }
  if (!openForBooking) {
    const { error: assignError } = await supabase.from("booking_unit_assignments").insert({
      booking_id: bookingId,
      inventory_unit_id: tracker.inventory_unit_id,
    });
    if (assignError) {
      const taken = assignError.code === "23505";
      return {
        ok: false,
        error: taken
          ? "That unit already has an open booking."
          : assignError.message,
      };
    }
  }

  const { data: booking, error } = await supabase
    .from("bookings")
    .select(
      "id, status, plan, addons, delivery_type, rented_out_at, returned_at, checkout_clock_source, rental_started_notified_at",
    )
    .eq("id", bookingId)
    .maybeSingle();
  if (error || !booking) return { ok: false, error: "Booking not found." };
  if (!isCustomerPickupBooking(booking)) {
    return { ok: false, error: "GPS checkout is only applied to self-pickup bookings." };
  }
  if (booking.returned_at) return { ok: false, error: "That booking is already returned." };

  const applied = await applyGpsCheckout(supabase, booking, streakAt);
  if (applied === "skipped") {
    return { ok: false, error: "The booking clock was not changed." };
  }

  const { data: state } = await supabase
    .from("gps_tracker_state")
    .select("checkout_mileage, checkout_fuel")
    .eq("macid", macid)
    .maybeSingle();
  await supabase.from("gps_tracker_state").update({
    open_booking_id: bookingId,
    inside_yard: false,
    updated_at: new Date().toISOString(),
    checkout_mileage: state?.checkout_mileage ?? null,
    checkout_fuel: state?.checkout_fuel ?? null,
  }).eq("macid", macid);
  await supabase.from("inventory_units").update({
    status: "out",
    updated_at: new Date().toISOString(),
  }).eq("id", tracker.inventory_unit_id);

  await resolveAlert(supabase, macid, "left_no_booking");
  await resolveAlert(supabase, macid, "ambiguous_booking");
  await resolveAlert(supabase, macid, "delivery_departure");
  return { ok: true };
}
