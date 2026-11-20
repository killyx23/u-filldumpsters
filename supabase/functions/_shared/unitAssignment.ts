/**
 * Which physical unit left on a booking, and when it is back.
 * GPS checkout and a lock checkout (only when the tracker is silent) both write
 * the same open row. A yard return releases it.
 */

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

export async function ensureUnitAssignment(
  supabase: SupabaseClient,
  bookingId: number,
  unitId: number,
): Promise<boolean> {
  const { data: openForBooking, error: readError } = await supabase
    .from("booking_unit_assignments")
    .select("id, inventory_unit_id")
    .eq("booking_id", bookingId)
    .is("released_at", null)
    .maybeSingle();
  if (readError) {
    console.error("[unitAssignment] read failed:", readError.message);
    return false;
  }
  if (openForBooking && Number(openForBooking.inventory_unit_id) !== unitId) {
    console.error(`[unitAssignment] booking #${bookingId} is already on another unit.`);
    return false;
  }
  if (!openForBooking) {
    const { error } = await supabase.from("booking_unit_assignments").insert({
      booking_id: bookingId,
      inventory_unit_id: unitId,
    });
    if (error) {
      console.error(`[unitAssignment] insert failed for #${bookingId}:`, error.message);
      return false;
    }
  }

  const now = new Date().toISOString();
  await supabase.from("inventory_units").update({
    status: "out",
    updated_at: now,
  }).eq("id", unitId);

  const { data: trackers } = await supabase
    .from("gps_trackers")
    .select("macid")
    .eq("inventory_unit_id", unitId)
    .eq("is_active", true);
  const macids = (trackers ?? [])
    .map((row: { macid?: string }) => row.macid)
    .filter((macid: string | undefined): macid is string => Boolean(macid));
  if (macids.length) {
    await supabase
      .from("gps_tracker_state")
      .update({ open_booking_id: bookingId, updated_at: now })
      .in("macid", macids)
      .is("open_booking_id", null);
  }
  return true;
}

export async function releaseUnitAssignment(
  supabase: SupabaseClient,
  bookingId: number,
): Promise<void> {
  const { data: lines, error } = await supabase
    .from("booking_unit_assignments")
    .select("inventory_unit_id")
    .eq("booking_id", bookingId)
    .is("released_at", null);
  if (error) {
    console.error("[unitAssignment] release read failed:", error.message);
    return;
  }
  if (!lines?.length) return;

  const now = new Date().toISOString();
  await supabase
    .from("booking_unit_assignments")
    .update({ released_at: now })
    .eq("booking_id", bookingId)
    .is("released_at", null);

  const unitIds = [...new Set(lines.map((line: { inventory_unit_id: number }) => line.inventory_unit_id))];
  await supabase.from("inventory_units").update({
    status: "available",
    updated_at: now,
  }).in("id", unitIds);

  const { data: trackers } = await supabase
    .from("gps_trackers")
    .select("macid")
    .in("inventory_unit_id", unitIds);
  const macids = (trackers ?? [])
    .map((row: { macid?: string }) => row.macid)
    .filter((macid: string | undefined): macid is string => Boolean(macid));
  if (macids.length) {
    await supabase
      .from("gps_tracker_state")
      .update({ open_booking_id: null, updated_at: now })
      .in("macid", macids)
      .eq("open_booking_id", bookingId);
  }
}

export async function unitIdForLock(
  supabase: SupabaseClient,
  deviceId: string | null | undefined,
): Promise<number | null> {
  if (!deviceId) return null;
  const { data, error } = await supabase
    .from("lock_devices")
    .select("inventory_unit_id")
    .eq("device_id", deviceId)
    .maybeSingle();
  if (error || data?.inventory_unit_id == null) return null;
  return Number(data.inventory_unit_id);
}
