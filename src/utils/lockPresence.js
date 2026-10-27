import { supabase } from '@/lib/customSupabaseClient';
import {
  eventTimeMs,
  isLockKind,
  isUnlockKind,
  lockDisplayFromCommand,
  withoutAutoLocks,
} from '@/utils/lockAutoLock';

export { lockDisplayFromCommand };

export function bridgeOnlineFromDevices(devices) {
  if (!devices?.length) return null;
  if (devices.some((d) => d.bridge_online === true)) return true;
  if (devices.every((d) => d.bridge_online === false)) return false;
  return null;
}

/** How long the admin bar waits for a manual unlock or lock to show up. */
export const MANUAL_LOCK_WATCH_MS = 2 * 60 * 1000;

/**
 * Physical position for the admin manual lock bar.
 * `current_state` is the display state after automatic relocks are removed.
 */
export function lockPosition(device) {
  if (!device) return 'unknown';
  if (device.current_state === 'locked') return 'closed';
  if (device.current_state === 'unlocked') return 'open';
  const opened = device.last_opened_at;
  const closed = device.last_closed_at;
  if (opened && (!closed || opened > closed)) return 'open';
  if (closed) return 'closed';
  return 'unknown';
}

function timesClose(a, b, slackMs) {
  if (!a || !b) return false;
  const left = new Date(a).getTime();
  const right = new Date(b).getTime();
  if (Number.isNaN(left) || Number.isNaN(right)) return false;
  return Math.abs(left - right) <= slackMs;
}

/**
 * Poll presence after a manual unlock or lock. Stops when this command's
 * position is visible, or after two minutes. Does not touch booking state.
 * An unlock is visible while it stays open. The automatic relock is not a close.
 */
export function watchManualLockAfterCommand({
  action,
  lastOpenedAt,
  lastClosedAt,
  onDevices,
  intervalMs = 2000,
  timeoutMs = MANUAL_LOCK_WATCH_MS,
}) {
  let stopped = false;
  let timer = null;
  const started = Date.now();
  const waitingForOpen = action === 'remote_unlock';

  const finish = (devices) => {
    stopped = true;
    if (timer) clearTimeout(timer);
    onDevices(devices, { done: true });
  };

  const tick = async () => {
    if (stopped) return;
    const { devices } = await loadLockPresenceDevices();
    if (stopped) return;
    const device = devices?.[0];
    const landed = waitingForOpen
      ? device?.current_state === 'unlocked' && timesClose(device?.last_opened_at, lastOpenedAt, 5000)
      : device?.current_state === 'locked' &&
        (!lastClosedAt || timesClose(device?.last_closed_at, lastClosedAt, 5000) ||
          new Date(device.last_closed_at).getTime() >= new Date(lastClosedAt).getTime() - 2000);
    if (landed || Date.now() - started >= timeoutMs) {
      finish(devices);
      return;
    }
    onDevices(devices, { done: false });
    timer = setTimeout(tick, intervalMs);
  };

  timer = setTimeout(tick, intervalMs);
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}

function presenceFor(currentState, bridgeOnline) {
  if (currentState === 'unlocked' && bridgeOnline === false) return 'alert_open_and_offline';
  if (currentState === 'unlocked') return 'off_premises';
  if (currentState === 'locked') return 'on_premises';
  return 'unknown';
}

function isoFromMs(ms) {
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** Status and last-closed time ignore automatic relocks. */
export function displayDeviceFromEvents(device, events) {
  const real = withoutAutoLocks(events);
  let lastOpenMs = NaN;
  let lastCloseMs = NaN;
  for (const event of real) {
    const ms = eventTimeMs(event);
    if (!Number.isFinite(ms)) continue;
    if (isUnlockKind(event)) lastOpenMs = ms;
    if (isLockKind(event)) lastCloseMs = ms;
  }
  const latest = [...real].reverse().find((event) => isUnlockKind(event) || isLockKind(event));
  let currentState = device.current_state;
  if (latest && isUnlockKind(latest)) currentState = 'unlocked';
  else if (latest && isLockKind(latest)) currentState = 'locked';
  return {
    ...device,
    current_state: currentState,
    presence: presenceFor(currentState, device.bridge_online),
    last_opened_at: isoFromMs(lastOpenMs) ?? device.last_opened_at ?? null,
    last_closed_at: isoFromMs(lastCloseMs),
  };
}

async function applyAutoLockDisplay(devices) {
  const ids = devices.map((d) => d.device_id).filter(Boolean);
  if (!ids.length) return devices;

  const { data: events, error } = await supabase
    .from('lock_device_events')
    .select('device_id, event_kind, occurred_at, log_type')
    .in('device_id', ids)
    .in('event_kind', ['lock', 'unlock']);

  if (error) {
    console.warn('[lockPresence] Could not load lock/unlock times:', error.message);
    return devices;
  }

  const byDevice = new Map();
  for (const event of events || []) {
    if (!event.device_id) continue;
    const list = byDevice.get(event.device_id) || [];
    list.push(event);
    byDevice.set(event.device_id, list);
  }

  return devices.map((device) => {
    const mine = byDevice.get(device.device_id);
    if (!mine?.length) return device;
    return displayDeviceFromEvents(device, mine);
  });
}

export async function loadLockPresenceDevices() {
  const { data, error } = await supabase
    .from('lock_device_presence')
    .select('*')
    .order('device_id');

  if (error) {
    return { devices: [], error: error.message };
  }

  const devices = data || [];
  if (!devices.length) return { devices, error: null };
  return { devices: await applyAutoLockDisplay(devices), error: null };
}
