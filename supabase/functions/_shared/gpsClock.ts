/**
 * The padlock defers to a tracker that has reported a usable fix recently.
 * A query error leaves the padlock in charge so a missing GPS table cannot
 * freeze checkout and return.
 */

import { GPS_FRESH_MS } from "./gpsGeofence.ts";

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

type StateRow = { valid?: boolean | null; last_valid_at?: string | null };
type TrackerRow = { is_active?: boolean | null; gps_tracker_state?: StateRow | StateRow[] | null };

function freshState(row: TrackerRow, freshAfterMs: number): boolean {
  if (row.is_active === false) return false;
  const state = Array.isArray(row.gps_tracker_state) ? row.gps_tracker_state[0] : row.gps_tracker_state;
  if (!state?.last_valid_at) return false;
  const at = new Date(state.last_valid_at).getTime();
  return Number.isFinite(at) && at >= freshAfterMs;
}

export async function gpsOwnsLockClock(
  supabase: SupabaseClient,
  args: { bookingId?: number; deviceId?: string | null },
): Promise<boolean> {
  const freshAfterMs = Date.now() - GPS_FRESH_MS;
  try {
    if (args.deviceId) {
      const { data: lock, error: lockError } = await supabase
        .from("lock_devices")
        .select("inventory_unit_id")
        .eq("device_id", args.deviceId)
        .maybeSingle();
      if (lockError) {
        console.error("[gpsClock] lock lookup failed:", lockError.message);
      } else if (lock?.inventory_unit_id) {
        const { data, error } = await supabase
          .from("gps_trackers")
          .select("is_active, gps_tracker_state(valid, last_valid_at)")
          .eq("inventory_unit_id", lock.inventory_unit_id)
          .eq("is_active", true);
        if (error) {
          console.error("[gpsClock] unit tracker lookup failed:", error.message);
          return false;
        }
        if ((data ?? []).some((row: TrackerRow) => freshState(row, freshAfterMs))) return true;
      }

      const { data, error } = await supabase
        .from("gps_trackers")
        .select("is_active, gps_tracker_state(valid, last_valid_at)")
        .eq("lock_device_id", args.deviceId)
        .eq("is_active", true);
      if (error) {
        console.error("[gpsClock] tracker lookup failed:", error.message);
        return false;
      }
      return (data ?? []).some((row: TrackerRow) => freshState(row, freshAfterMs));
    }

    if (!args.bookingId) return false;
    const { data: lines, error: lineError } = await supabase
      .from("booking_unit_assignments")
      .select("inventory_unit_id")
      .eq("booking_id", args.bookingId)
      .is("released_at", null);
    if (lineError || !lines?.length) return false;
    const unitIds = lines
      .map((line: { inventory_unit_id?: number | null }) => line.inventory_unit_id)
      .filter((id: number | null | undefined) => id != null);
    if (!unitIds.length) return false;

    const { data, error } = await supabase
      .from("gps_trackers")
      .select("is_active, gps_tracker_state(valid, last_valid_at)")
      .in("inventory_unit_id", unitIds)
      .eq("is_active", true);
    if (error) {
      console.error("[gpsClock] unit tracker lookup failed:", error.message);
      return false;
    }
    return (data ?? []).some((row: TrackerRow) => freshState(row, freshAfterMs));
  } catch (err) {
    console.error("[gpsClock] lookup exception:", err);
    return false;
  }
}
