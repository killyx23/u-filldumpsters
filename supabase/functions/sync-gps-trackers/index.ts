/**
 * sync-gps-trackers
 *
 * Logs into yzxgps.com with YZXGPS_KEY as userName and YZXGPS_PASSWORD, then
 * polls LocationByUser, CircularFenceGetList, and alarmOperation. Credentials
 * and URLs are never logged.
 * never logged.
 *
 * Cron body is {}. An admin may POST { "attach": { "macid", "bookingId" } }
 * or { "simulate": { "leave"|"enter": { "macid" } } } when the trailer cannot
 * physically leave the yard.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getCorsHeaders } from "./cors.ts";
import {
  GPS_STREAK,
  insideAnyYard,
  isoFromMs,
  parseTrackerRow,
  type ParsedFix,
  type YardCircle,
} from "../_shared/gpsGeofence.ts";
import {
  ALARM_ENTER,
  ALARM_LEAVE,
  ALARM_LOOKBACK_MS,
  alarmOperation,
  circularFenceGetList,
  isSessionFailure,
  locationByUser,
  locationRows,
  parseCircularFences,
  parseVendorAlarms,
  uniqueFenceCircles,
  userLogin,
  type CircularFence,
  type YzxSession,
} from "../_shared/yzxgpsClient.ts";
import {
  attachOpenTrip,
  nextStreak,
  onConfirmedInside,
  onConfirmedOutside,
  raiseAlert,
  resolveAlert,
  watchOpenTrip,
  type TrackerState,
} from "../_shared/gpsRental.ts";
import { requireAdminCaller } from "../_shared/phoneOrderAuth.ts";

const READING_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const ALARM_APPLY_MAX_AGE_MS = 2 * 60 * 60 * 1000;

function json(cors: Record<string, string>, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function emptyState(macid: string): TrackerState {
  return {
    macid,
    inside_yard: null,
    consecutive_outside: 0,
    consecutive_inside: 0,
    streak_outside_at: null,
    streak_inside_at: null,
    last_valid_at: null,
    last_reading_at: null,
    valid: false,
    open_booking_id: null,
    checkout_mileage: null,
    checkout_fuel: null,
  };
}

function stateFromRow(row: Record<string, unknown> | null, macid: string): TrackerState {
  if (!row) return emptyState(macid);
  return {
    macid,
    inside_yard: row.inside_yard == null ? null : Boolean(row.inside_yard),
    consecutive_outside: Number(row.consecutive_outside ?? 0),
    consecutive_inside: Number(row.consecutive_inside ?? 0),
    streak_outside_at: (row.streak_outside_at as string | null) ?? null,
    streak_inside_at: (row.streak_inside_at as string | null) ?? null,
    last_valid_at: (row.last_valid_at as string | null) ?? null,
    last_reading_at: (row.last_reading_at as string | null) ?? null,
    valid: Boolean(row.valid),
    open_booking_id: row.open_booking_id == null ? null : Number(row.open_booking_id),
    checkout_mileage: row.checkout_mileage == null ? null : Number(row.checkout_mileage),
    checkout_fuel: (row.checkout_fuel as string | null) ?? null,
  };
}

async function withSession<T>(
  userName: string,
  password: string,
  run: (session: YzxSession) => Promise<{ result: { success: boolean; errorDescribe: string }; value: T }>,
  empty: T,
): Promise<{ session: YzxSession | null; value: T; authFailed: boolean; detail: string }> {
  const login = await userLogin(userName, password);
  if (!login.ok) {
    return { session: null, value: empty, authFailed: login.authFailed, detail: login.detail };
  }
  let session = login.session;
  let ran = await run(session);
  if (isSessionFailure(ran.result)) {
    const again = await userLogin(userName, password);
    if (!again.ok) {
      return { session: null, value: empty, authFailed: again.authFailed, detail: again.detail };
    }
    session = again.session;
    ran = await run(session);
    if (isSessionFailure(ran.result)) {
      return {
        session,
        value: empty,
        authFailed: true,
        detail: ran.result.errorDescribe || "Session token was rejected after one re-login.",
      };
    }
  }
  return { session, value: ran.value, authFailed: false, detail: "" };
}

async function loadTrackerRows(
  userName: string,
  password: string,
): Promise<{
  session: YzxSession | null;
  rows: Record<string, unknown>[];
  authFailed: boolean;
  detail: string;
}> {
  const loaded = await withSession(userName, password, async (session) => {
    const located = await locationByUser(session);
    return { result: located, value: locationRows(located) };
  }, [] as Record<string, unknown>[]);
  if (loaded.authFailed) {
    return { session: null, rows: [], authFailed: true, detail: loaded.detail };
  }
  if (loaded.detail) {
    return { session: loaded.session, rows: [], authFailed: false, detail: loaded.detail };
  }
  if (!loaded.value.length) {
    return {
      session: loaded.session,
      rows: [],
      authFailed: false,
      detail: "",
    };
  }
  return { session: loaded.session, rows: loaded.value, authFailed: false, detail: "" };
}

async function ingestVendorAlarms(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  session: YzxSession,
  devices: Array<{ macid: string; objectid: string }>,
  nowMs: number,
): Promise<{ stored: number; leaves: number; enters: number; checkouts: number; returns: number }> {
  const tallies = { stored: 0, leaves: 0, enters: 0, checkouts: 0, returns: 0 };
  const begin = nowMs - ALARM_LOOKBACK_MS;
  for (const device of devices) {
    const listed = await alarmOperation(session, device.objectid, begin, nowMs);
    if (!listed.success && isSessionFailure(listed)) break;
    const alarms = parseVendorAlarms(listed.body, device.macid);
    for (const alarm of alarms) {
      const { data: existing } = await supabase
        .from("gps_vendor_alarms")
        .select("id, processed_at")
        .eq("id", alarm.id)
        .maybeSingle();
      if (!existing) {
        const { error } = await supabase.from("gps_vendor_alarms").insert({
          id: alarm.id,
          macid: alarm.macid,
          objectid: alarm.objectid,
          classify: alarm.classify,
          ptime: isoFromMs(alarm.ptimeMs),
          lat: alarm.lat,
          lon: alarm.lon,
          speed: alarm.speed,
          notea: alarm.notea,
          status: alarm.status,
        });
        if (error) {
          console.error("[sync-gps-trackers] vendor alarm insert failed:", error.message);
          continue;
        }
        tallies.stored += 1;
      } else if (existing.processed_at) {
        continue;
      }

      const fresh = alarm.ptimeMs != null && nowMs - alarm.ptimeMs <= ALARM_APPLY_MAX_AGE_MS;
      const atIso = isoFromMs(alarm.ptimeMs);
      if (fresh && atIso && (alarm.classify === ALARM_LEAVE || alarm.classify === ALARM_ENTER)) {
        const { data: trackerRow } = await supabase
          .from("gps_trackers")
          .select("macid, inventory_unit_id, is_active")
          .eq("macid", alarm.macid)
          .maybeSingle();
        const { data: stateRow } = await supabase
          .from("gps_tracker_state")
          .select("*")
          .eq("macid", alarm.macid)
          .maybeSingle();
        const tracker = {
          macid: alarm.macid,
          inventory_unit_id: trackerRow?.inventory_unit_id == null ? null : Number(trackerRow.inventory_unit_id),
          is_active: trackerRow?.is_active !== false,
        };
        if (alarm.classify === ALARM_LEAVE) {
          tallies.leaves += 1;
          if (tracker.is_active) {
            const trip = await onConfirmedOutside(supabase, tracker, atIso, {
              mileage: null,
              fuel: null,
              lat: alarm.lat,
              lon: alarm.lon,
            }, nowMs);
            if (trip.openBookingId) tallies.checkouts += 1;
            await supabase.from("gps_tracker_state").update({
              inside_yard: false,
              open_booking_id: trip.openBookingId,
              checkout_mileage: trip.checkoutMileage,
              checkout_fuel: trip.checkoutFuel,
              updated_at: new Date().toISOString(),
            }).eq("macid", alarm.macid);
          }
        } else {
          tallies.enters += 1;
          if (tracker.is_active) {
            const trip = await onConfirmedInside(supabase, stateFromRow(stateRow, alarm.macid), atIso, null);
            if (trip.applied) tallies.returns += 1;
            await supabase.from("gps_tracker_state").update({
              inside_yard: true,
              open_booking_id: trip.openBookingId,
              updated_at: new Date().toISOString(),
            }).eq("macid", alarm.macid);
          }
        }
      }

      await supabase.from("gps_vendor_alarms").update({
        processed_at: new Date().toISOString(),
      }).eq("id", alarm.id);
    }
  }
  return tallies;
}

async function loadFencesForMacids(
  session: YzxSession,
  macids: string[],
): Promise<CircularFence[]> {
  const all: CircularFence[] = [];
  for (const macid of macids) {
    const listed = await circularFenceGetList(session, macid);
    if (!listed.success && isSessionFailure(listed)) break;
    all.push(...parseCircularFences(listed.body, macid));
  }
  return uniqueFenceCircles(all);
}

function sameCircle(a: { lat: number; lon: number; radius_meters: number }, fence: CircularFence): boolean {
  return Math.abs(a.lat - fence.lat) < 0.000001 &&
    Math.abs(a.lon - fence.lon) < 0.000001 &&
    a.radius_meters === fence.radiusMeters;
}

async function ensureYardsFromFences(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  fences: CircularFence[],
): Promise<YardCircle[]> {
  const { data: yardRows } = await supabase
    .from("yards")
    .select("id, lat, lon, radius_meters, is_active");
  const existing = (yardRows ?? []) as Array<{
    lat: number;
    lon: number;
    radius_meters: number;
    is_active: boolean;
  }>;
  for (const fence of fences) {
    const already = existing.some((yard) => sameCircle(yard, fence));
    if (already) continue;
    const name = fence.address || fence.name || "Yard";
    const { data, error } = await supabase.from("yards").insert({
      name,
      lat: fence.lat,
      lon: fence.lon,
      radius_meters: fence.radiusMeters,
      is_active: true,
    }).select("lat, lon, radius_meters, is_active").maybeSingle();
    if (!error && data) existing.push(data);
  }
  return existing
    .filter((yard) => yard.is_active && Number.isFinite(yard.lat) && Number.isFinite(yard.lon) && yard.radius_meters > 0)
    .map((yard) => ({ lat: yard.lat, lon: yard.lon, radius_meters: yard.radius_meters }));
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(cors, { error: "POST required" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceKey) {
    return json(cors, { error: "Supabase service credentials are missing." }, 500);
  }

  const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const isService = bearer !== "" && bearer === serviceKey;
  if (!isService) {
    const admin = await requireAdminCaller(req, cors);
    if (admin.error) return admin.error;
  }

  let body: {
    attach?: { macid?: string; bookingId?: number };
    simulate?: { leave?: { macid?: string }; enter?: { macid?: string } };
  } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  if (body.simulate?.leave || body.simulate?.enter) {
    const direction = body.simulate.leave ? "leave" : "enter";
    const macid = String(
      (direction === "leave" ? body.simulate.leave?.macid : body.simulate.enter?.macid) || "",
    ).trim();
    if (!macid) return json(cors, { error: "macid is required." }, 400);

    const { data: trackerRow } = await supabase
      .from("gps_trackers")
      .select("macid, inventory_unit_id, is_active")
      .eq("macid", macid)
      .maybeSingle();
    if (!trackerRow) return json(cors, { error: "Tracker not found." }, 404);

    const { data: stateRow } = await supabase.from("gps_tracker_state").select("*").eq("macid", macid).maybeSingle();
    let state = stateFromRow(stateRow, macid);
    const nowMs = Date.now();
    const atIso = new Date(nowMs).toISOString();
    const tracker = {
      macid,
      inventory_unit_id: trackerRow.inventory_unit_id == null ? null : Number(trackerRow.inventory_unit_id),
      is_active: trackerRow.is_active !== false,
    };

    if (direction === "leave") {
      const trip = await onConfirmedOutside(supabase, tracker, atIso, {
        mileage: state.checkout_mileage,
        fuel: state.checkout_fuel,
        lat: stateRow?.lat ?? null,
        lon: stateRow?.lon ?? null,
      }, nowMs);
      state.inside_yard = false;
      state.consecutive_outside = GPS_STREAK;
      state.consecutive_inside = 0;
      state.streak_outside_at = atIso;
      state.streak_inside_at = null;
      state.open_booking_id = trip.openBookingId;
      state.checkout_mileage = trip.checkoutMileage;
      state.checkout_fuel = trip.checkoutFuel;
      state.last_valid_at = atIso;
      await supabase.from("gps_tracker_state").upsert({
        macid,
        inside_yard: state.inside_yard,
        consecutive_outside: state.consecutive_outside,
        consecutive_inside: state.consecutive_inside,
        streak_outside_at: state.streak_outside_at,
        streak_inside_at: state.streak_inside_at,
        open_booking_id: state.open_booking_id,
        checkout_mileage: state.checkout_mileage,
        checkout_fuel: state.checkout_fuel,
        last_valid_at: state.last_valid_at,
        last_reading_at: atIso,
        updated_at: atIso,
      });
      return json(cors, {
        ok: true,
        simulated: "leave",
        openBookingId: trip.openBookingId,
      });
    }

    const trip = await onConfirmedInside(supabase, state, atIso, null, nowMs);
    state.inside_yard = true;
    state.consecutive_inside = GPS_STREAK;
    state.consecutive_outside = 0;
    state.streak_inside_at = atIso;
    state.streak_outside_at = null;
    state.open_booking_id = trip.openBookingId;
    state.last_valid_at = atIso;
    await supabase.from("gps_tracker_state").upsert({
      macid,
      inside_yard: state.inside_yard,
      consecutive_inside: state.consecutive_inside,
      consecutive_outside: state.consecutive_outside,
      streak_inside_at: state.streak_inside_at,
      streak_outside_at: state.streak_outside_at,
      open_booking_id: state.open_booking_id,
      last_valid_at: state.last_valid_at,
      last_reading_at: atIso,
      updated_at: atIso,
    });
    return json(cors, {
      ok: true,
      simulated: "enter",
      applied: trip.applied,
      openBookingId: trip.openBookingId,
    });
  }

  if (body.attach) {
    const macid = String(body.attach.macid || "").trim();
    const bookingId = Number(body.attach.bookingId);
    if (!macid || !Number.isFinite(bookingId)) {
      return json(cors, { error: "macid and bookingId are required." }, 400);
    }
    const result = await attachOpenTrip(supabase, macid, bookingId);
    if (!result.ok) return json(cors, { error: result.error }, 400);
    return json(cors, { ok: true, attached: bookingId });
  }

  const userName = Deno.env.get("YZXGPS_KEY")?.trim() ?? "";
  const password = Deno.env.get("YZXGPS_PASSWORD")?.trim() ?? "";
  if (!userName || !password) {
    return json(cors, { error: "YZXGPS_KEY and YZXGPS_PASSWORD must both be set." }, 500);
  }

  const loaded = await loadTrackerRows(userName, password);
  if (loaded.session) {
    await supabase.from("gps_api_session").upsert({
      id: true,
      account_id: loaded.session.id,
      updated_at: new Date().toISOString(),
    });
  }
  if (loaded.authFailed) {
    await raiseAlert(supabase, {
      macid: null,
      kind: "auth_failed",
      message: loaded.detail || "Tracker login was rejected.",
    });
    console.error("[sync-gps-trackers] auth failed");
    return json(cors, { ok: false, error: loaded.detail }, 502);
  }
  if (loaded.detail && !loaded.rows.length) {
    await raiseAlert(supabase, {
      macid: null,
      kind: "auth_failed",
      message: loaded.detail,
    });
    console.error("[sync-gps-trackers] location failed");
    return json(cors, { ok: false, error: loaded.detail }, 502);
  }
  await resolveAlert(supabase, null, "auth_failed");

  const nowMs = Date.now();
  const macids = [...new Set(
    loaded.rows
      .map((row) => String(row.macid ?? row.macId ?? "").trim())
      .filter(Boolean),
  )];
  const vendorFences = loaded.session ? await loadFencesForMacids(loaded.session, macids) : [];
  const yards = await ensureYardsFromFences(supabase, vendorFences);
  if (!yards.length) {
    await raiseAlert(supabase, {
      macid: null,
      kind: "no_yard",
      message: "No active yard circle is configured, so GPS checkout and return are paused.",
    });
  } else {
    await resolveAlert(supabase, null, "no_yard");
  }

  const fixes: ParsedFix[] = [];
  for (const row of loaded.rows) {
    const fix = parseTrackerRow(row, nowMs);
    if (fix) fixes.push(fix);
  }

  let checkouts = 0;
  let returns = 0;

  for (const fix of fixes) {
    const { data: existing } = await supabase
      .from("gps_trackers")
      .select("macid, full_name, inventory_unit_id, is_active")
      .eq("macid", fix.macid)
      .maybeSingle();
    if (!existing) {
      await supabase.from("gps_trackers").insert({ macid: fix.macid, full_name: fix.fullName });
    } else if (fix.fullName && existing.full_name !== fix.fullName) {
      await supabase.from("gps_trackers").update({
        full_name: fix.fullName,
        updated_at: new Date().toISOString(),
      }).eq("macid", fix.macid);
    }

    await supabase.from("gps_readings").insert({
      macid: fix.macid,
      gpstime: isoFromMs(fix.gpstimeMs),
      lat: fix.lat,
      lon: fix.lon,
      speed: fix.speed,
      hearttime: isoFromMs(fix.hearttimeMs),
      server_time: isoFromMs(fix.serverTimeMs),
      device_status: fix.deviceStatus,
      mileage: fix.mileage,
      fuel: fix.fuel,
      positioning_mode: fix.positioningMode,
      acc: fix.acc,
      main_power: fix.mainPower,
      operating_status: fix.operatingStatus,
      stale: fix.stale,
      valid: fix.valid,
    });

    const { data: stateRow } = await supabase
      .from("gps_tracker_state")
      .select("*")
      .eq("macid", fix.macid)
      .maybeSingle();
    let state = stateFromRow(stateRow, fix.macid);
    state.last_reading_at = new Date().toISOString();

    const tracker = {
      macid: fix.macid,
      inventory_unit_id: existing?.inventory_unit_id == null ? null : Number(existing.inventory_unit_id),
      is_active: existing?.is_active !== false,
    };

    if (!tracker.inventory_unit_id) {
      await raiseAlert(supabase, {
        macid: fix.macid,
        kind: "unmapped_tracker",
        message: `Tracker ${fix.fullName || fix.macid} is not linked to a unit.`,
      });
    } else {
      await resolveAlert(supabase, fix.macid, "unmapped_tracker");
    }

    if (fix.valid && fix.lat != null && fix.lon != null && fix.gpstimeMs != null && yards.length) {
      const inside = insideAnyYard(fix.lat, fix.lon, yards);
      const stepped = nextStreak(state, inside, fix.gpstimeMs);
      state = stepped.state;
      if (stepped.checkoutAt && tracker.is_active) {
        const trip = await onConfirmedOutside(supabase, tracker, stepped.checkoutAt, {
          mileage: fix.mileage,
          fuel: fix.fuel,
          lat: fix.lat,
          lon: fix.lon,
        }, nowMs);
        state.open_booking_id = trip.openBookingId;
        state.checkout_mileage = trip.checkoutMileage;
        state.checkout_fuel = trip.checkoutFuel;
        if (trip.openBookingId) checkouts += 1;
      }
      if (stepped.returnAt && tracker.is_active) {
        const trip = await onConfirmedInside(supabase, state, stepped.returnAt, fix.mileage);
        state.open_booking_id = trip.openBookingId;
        if (trip.applied) returns += 1;
      }
    }

    if (tracker.is_active) {
      await watchOpenTrip(supabase, state, {
        hearttimeMs: fix.hearttimeMs,
        serverTimeMs: fix.serverTimeMs,
        mainPower: fix.mainPower,
      }, nowMs);
    }

    const saved = {
      macid: fix.macid,
      lat: fix.valid ? fix.lat : stateRow?.lat ?? null,
      lon: fix.valid ? fix.lon : stateRow?.lon ?? null,
      gpstime: fix.valid ? isoFromMs(fix.gpstimeMs) : stateRow?.gpstime ?? null,
      hearttime: isoFromMs(fix.hearttimeMs) ?? stateRow?.hearttime ?? null,
      speed: fix.valid ? fix.speed : stateRow?.speed ?? null,
      inside_yard: state.inside_yard,
      consecutive_outside: state.consecutive_outside,
      consecutive_inside: state.consecutive_inside,
      streak_outside_at: state.streak_outside_at,
      streak_inside_at: state.streak_inside_at,
      last_valid_at: state.last_valid_at,
      last_reading_at: state.last_reading_at,
      valid: fix.valid,
      positioning_mode: fix.positioningMode,
      main_power: fix.mainPower,
      mileage: fix.mileage,
      fuel: fix.fuel,
      operating_status: fix.operatingStatus,
      open_booking_id: state.open_booking_id,
      checkout_mileage: state.checkout_mileage,
      checkout_fuel: state.checkout_fuel,
      updated_at: new Date().toISOString(),
    };
    await supabase.from("gps_tracker_state").upsert(saved);
  }

  const alarmDevices = loaded.rows
    .map((row) => ({
      macid: String(row.macid ?? row.macId ?? "").trim(),
      objectid: String(row.objectid ?? "").trim(),
    }))
    .filter((row) => row.macid && row.objectid);
  const vendorAlarms = loaded.session
    ? await ingestVendorAlarms(supabase, loaded.session, alarmDevices, nowMs)
    : { stored: 0, leaves: 0, enters: 0, checkouts: 0, returns: 0 };
  checkouts += vendorAlarms.checkouts;
  returns += vendorAlarms.returns;

  await supabase
    .from("gps_readings")
    .delete()
    .lt("received_at", new Date(nowMs - READING_RETENTION_MS).toISOString());

  return json(cors, {
    ok: true,
    trackers: fixes.length,
    checkouts,
    returns,
    yards: yards.length,
    vendorFences: vendorFences.length,
    vendorAlarms: vendorAlarms.stored,
    fenceLeaves: vendorAlarms.leaves,
    fenceEnters: vendorAlarms.enters,
  });
});
