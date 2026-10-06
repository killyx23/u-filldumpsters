/**
 * Device-level lock tracking, independent of any booking.
 *
 * `rental_tracking_logs` answers "what happened on booking #123". These tables
 * answer "where is this piece of equipment right now", which still needs to be
 * correct when a PIN cannot be matched to a booking (key/thumbturn use, an
 * expired code, a break-in attempt).
 *
 * Shared by igloohome-webhook and the sync-lock-activity poller so both paths
 * converge on the same state, deduplicated by a unique index.
 */

import { type LockActivityEvent, redactPins } from "./iglooActivity.ts";
import {
  AUTOLOCK_DWELL_MS,
  resolveOrderIdByPin,
  resolvePrecedingUnlockOrderId,
} from "./lockEventState.ts";

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

export type RecordedEvent = {
  event: LockActivityEvent;
  deviceId: string;
  orderId: number | null;
};

export type RecordResult = {
  recorded: RecordedEvent[];
  stored: number;
  skippedDuplicates: number;
};

/** Igloo activity log type for a padlock auto-lock / shackle relock. */
export const PADLOCK_AUTOLOCK_LOG_TYPE = 13;
const MANUAL_UNLOCK_KEY = "remote-unlock";
/** Hardware clock may sit slightly behind the server timestamp we stored for the unlock. */
const MANUAL_AUTOLOCK_SKEW_MS = 30 * 1000;

function eventMs(value: string | null | undefined): number {
  const ms = value ? new Date(value).getTime() : NaN;
  return Number.isNaN(ms) ? NaN : ms;
}

export function isManualAutolockWindow(unlockAt: string, lockAt: string): boolean {
  const unlockMs = eventMs(unlockAt);
  const lockMs = eventMs(lockAt);
  if (!Number.isFinite(unlockMs) || !Number.isFinite(lockMs)) return false;
  return lockMs >= unlockMs - MANUAL_AUTOLOCK_SKEW_MS && lockMs - unlockMs <= AUTOLOCK_DWELL_MS;
}

/**
 * True when this close is the padlock auto-locking after an admin remote unlock.
 * Those closes update device presence only — they must not mark a rental returned
 * or send rental email.
 */
export async function isManualAutolockClose(
  supabase: SupabaseClient,
  deviceId: string,
  event: { eventType?: string; logType?: number | null; eventTimestamp?: string },
): Promise<boolean> {
  if (event.eventType !== "lock" || event.logType !== PADLOCK_AUTOLOCK_LOG_TYPE) return false;
  if (!event.eventTimestamp) return false;
  const lockMs = eventMs(event.eventTimestamp);
  if (!Number.isFinite(lockMs)) return false;

  const { data: unlock, error } = await supabase
    .from("lock_device_events")
    .select("occurred_at, key_id")
    .eq("device_id", deviceId)
    .eq("event_kind", "unlock")
    .lte("occurred_at", new Date(lockMs + MANUAL_AUTOLOCK_SKEW_MS).toISOString())
    .order("occurred_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !unlock?.occurred_at) return false;
  if (unlock.key_id !== MANUAL_UNLOCK_KEY) return false;
  return isManualAutolockWindow(unlock.occurred_at, event.eventTimestamp);
}

/**
 * A manual unlock writes its open time immediately. The padlock then auto-locks,
 * sometimes with a device clock a few seconds behind that open time. Roll the
 * device back to locked and keep the hardware close time.
 * An older auto-lock already stored before this unlock is ignored.
 */
export async function forceClosedAfterManualAutolock(
  supabase: SupabaseClient,
  deviceId: string,
  batch: LockActivityEvent[] = [],
): Promise<boolean> {
  const batchUnlock = [...batch].reverse().find(
    (event) => event.eventType === "unlock" && event.keyId === MANUAL_UNLOCK_KEY,
  );
  const batchLock = batchUnlock
    ? batch.find((event) =>
      event.eventType === "lock" &&
      isManualAutolockWindow(batchUnlock.eventTimestamp, event.eventTimestamp)
    )
    : undefined;

  let closedAt: string | null = batchLock?.eventTimestamp ?? null;

  if (!closedAt) {
    const { data: unlock } = await supabase
      .from("lock_device_events")
      .select("occurred_at, received_at")
      .eq("device_id", deviceId)
      .eq("event_kind", "unlock")
      .eq("key_id", MANUAL_UNLOCK_KEY)
      .order("received_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!unlock?.occurred_at || !unlock.received_at) return false;

    const { data: locks } = await supabase
      .from("lock_device_events")
      .select("occurred_at")
      .eq("device_id", deviceId)
      .eq("event_kind", "lock")
      .gte("received_at", unlock.received_at)
      .order("received_at", { ascending: false })
      .limit(5);
    const match = (locks || []).find((row: { occurred_at?: string }) =>
      row.occurred_at && isManualAutolockWindow(unlock.occurred_at, row.occurred_at)
    );
    closedAt = match?.occurred_at ?? null;
  }

  if (!closedAt) return false;

  const { error } = await supabase
    .from("lock_devices")
    .update({
      current_state: "locked",
      state_changed_at: closedAt,
      last_event_at: closedAt,
    })
    .eq("device_id", deviceId);
  if (error) {
    console.error("[lockDeviceState] manual autolock state update failed:", error.message);
    return false;
  }
  return true;
}

export function defaultDeviceId(): string | null {
  return Deno.env.get("IGLOOHOME_LOCK_ID") || Deno.env.get("IGLOOHOME_DEVICE_ID") || null;
}

export function defaultBridgeId(): string | null {
  return Deno.env.get("IGLOOHOME_BRIDGE_ID") || null;
}

export async function ensureBridge(
  supabase: SupabaseClient,
  bridgeId: string | null,
): Promise<void> {
  if (!bridgeId) return;
  const now = new Date().toISOString();

  // Lock/unlock activity traveling through the bridge proves it is reachable.
  // Event type 10 (Bridge Connection) remains the path that can mark offline.
  const { data: previous } = await supabase
    .from("lock_bridges")
    .select("bridge_id, is_online")
    .eq("bridge_id", bridgeId)
    .maybeSingle();

  const changed = previous?.is_online !== true;
  const { error } = await supabase.from("lock_bridges").upsert(
    {
      bridge_id: bridgeId,
      last_event_at: now,
      is_online: true,
      ...(changed ? { last_changed_at: now } : {}),
    },
    { onConflict: "bridge_id" },
  );
  if (error) console.error("[lockDeviceState] ensureBridge failed:", error.message);
}

/**
 * Register hardware the first time we hear from it, so adding a second lock is
 * plug-and-play — map it to a piece of equipment afterwards in the admin UI.
 */
export async function ensureDevice(
  supabase: SupabaseClient,
  deviceId: string,
  bridgeId: string | null,
): Promise<Record<string, unknown> | null> {
  await ensureBridge(supabase, bridgeId);

  const columns = "device_id, label, bridge_id, current_state, state_changed_at, equipment_id";
  const { data: existing } = await supabase
    .from("lock_devices")
    .select(columns)
    .eq("device_id", deviceId)
    .maybeSingle();

  if (existing) {
    if (bridgeId && existing.bridge_id !== bridgeId) {
      await supabase.from("lock_devices").update({ bridge_id: bridgeId }).eq(
        "device_id",
        deviceId,
      );
    }
    return existing;
  }

  const { data: inserted, error } = await supabase
    .from("lock_devices")
    .insert({ device_id: deviceId, bridge_id: bridgeId, current_state: "unknown" })
    .select(columns)
    .maybeSingle();
  if (error) console.error("[lockDeviceState] ensureDevice insert failed:", error.message);
  return inserted ?? null;
}

/**
 * Persist activity events against their device and roll the device's current
 * state forward. Returns only the events that were new, so callers do not
 * re-notify on a redelivery.
 */
export async function recordDeviceEvents(
  supabase: SupabaseClient,
  events: LockActivityEvent[],
  opts: { deviceId?: string | null; bridgeId?: string | null } = {},
): Promise<RecordResult> {
  const fallbackDeviceId = opts.deviceId || defaultDeviceId();
  const bridgeId = opts.bridgeId || defaultBridgeId();

  const ordered = [...events].sort(
    (a, b) => new Date(a.eventTimestamp).getTime() - new Date(b.eventTimestamp).getTime(),
  );

  const recorded: RecordedEvent[] = [];
  const latestPerDevice = new Map<string, LockActivityEvent>();
  const deviceCache = new Map<string, Record<string, unknown> | null>();
  let stored = 0;
  let skippedDuplicates = 0;

  for (const event of ordered) {
    const deviceId = event.deviceId || fallbackDeviceId;
    if (!deviceId) {
      console.warn("[lockDeviceState] Event with no resolvable device id; skipping");
      continue;
    }
    if (!deviceCache.has(deviceId)) {
      deviceCache.set(deviceId, await ensureDevice(supabase, deviceId, bridgeId));
    }
    const device = deviceCache.get(deviceId) ?? null;

    // The PIN is used in memory to match a booking, then stripped before the
    // payload is stored. It is never written to the table or to the logs.
    // A close with no PIN belongs to the unlock this device just matched.
    let orderId = await resolveOrderIdByPin(supabase, event.pinCode, event.eventTimestamp);
    if (!orderId && event.eventType === "lock" && !event.pinCode) {
      orderId = await resolvePrecedingUnlockOrderId(supabase, deviceId, event.eventTimestamp);
    }

    const { error } = await supabase.from("lock_device_events").insert({
      device_id: deviceId,
      bridge_id: bridgeId,
      event_kind: event.eventType,
      log_type: event.logType,
      occurred_at: event.eventTimestamp,
      order_id: orderId,
      pin_matched: Boolean(event.pinCode && orderId),
      key_id: event.keyId,
      operation_id: event.operationId,
      raw: redactPins(event.raw),
    });

    if (error) {
      // 23505 means an earlier delivery or poll already ingested this entry.
      if (error.code === "23505") skippedDuplicates += 1;
      else console.error("[lockDeviceState] event insert failed:", error.message);
      continue;
    }

    stored += 1;
    recorded.push({ event: { ...event, raw: {} }, deviceId, orderId });

    if (event.eventType === "breakin") {
      await supabase
        .from("lock_devices")
        .update({ last_breakin_at: event.eventTimestamp })
        .eq("device_id", deviceId);
      continue;
    }

    // Entries can arrive batched and out of order; never let a stale entry
    // overwrite a more recent known state.
    const known = latestPerDevice.get(deviceId);
    const previousMs = known
      ? new Date(known.eventTimestamp).getTime()
      : device?.state_changed_at
      ? new Date(String(device.state_changed_at)).getTime()
      : -Infinity;
    if (new Date(event.eventTimestamp).getTime() >= previousMs) {
      latestPerDevice.set(deviceId, event);
    }
  }

  for (const [deviceId, latest] of latestPerDevice) {
    const { error } = await supabase
      .from("lock_devices")
      .update({
        current_state: latest.eventType === "lock" ? "locked" : "unlocked",
        state_changed_at: latest.eventTimestamp,
        last_event_at: latest.eventTimestamp,
      })
      .eq("device_id", deviceId);
    if (error) console.error("[lockDeviceState] state update failed:", error.message);
  }

  const touched = new Set<string>([
    ...latestPerDevice.keys(),
    ...recorded.map((row) => row.deviceId),
  ]);
  for (const deviceId of touched) {
    await forceClosedAfterManualAutolock(supabase, deviceId, ordered);
  }

  return { recorded, stored, skippedDuplicates };
}
