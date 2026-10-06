import { supabase } from '@/lib/customSupabaseClient';

export function bridgeOnlineFromDevices(devices) {
  if (!devices?.length) return null;
  if (devices.some((d) => d.bridge_online === true)) return true;
  if (devices.every((d) => d.bridge_online === false)) return false;
  return null;
}

/** How long the admin bar waits for the padlock to auto-lock after a manual unlock. */
export const MANUAL_LOCK_WATCH_MS = 2 * 60 * 1000;

/**
 * Physical position for the admin manual lock bar.
 * `current_state` wins, including when a hardware close is a few seconds behind
 * the server clock and the open timestamp is still slightly newer.
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
 */
export function watchManualLockAfterCommand({
  action,
  lastOpenedAt,
  lastClosedAt,
  currentState,
  onDevices,
  intervalMs = 2000,
  timeoutMs = MANUAL_LOCK_WATCH_MS,
}) {
  let stopped = false;
  let timer = null;
  const started = Date.now();
  const waitingForAutolock = action === 'remote_unlock' && currentState !== 'locked';

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
    const landed = waitingForAutolock
      ? device?.current_state === 'locked' && timesClose(device?.last_opened_at, lastOpenedAt, 5000)
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

function latestEventMap(events, kind) {
  const map = {};
  for (const ev of events || []) {
    if (ev.event_kind !== kind || !ev.device_id || !ev.occurred_at) continue;
    if (!map[ev.device_id] || ev.occurred_at > map[ev.device_id]) {
      map[ev.device_id] = ev.occurred_at;
    }
  }
  return map;
}

async function enrichOpenCloseTimes(devices) {
  const ids = devices.map((d) => d.device_id).filter(Boolean);
  if (!ids.length) return devices;

  const { data: events, error } = await supabase
    .from('lock_device_events')
    .select('device_id, event_kind, occurred_at')
    .in('device_id', ids)
    .in('event_kind', ['lock', 'unlock']);

  if (error) {
    console.warn('[lockPresence] Could not load lock/unlock times:', error.message);
    return devices;
  }

  const opened = latestEventMap(events, 'unlock');
  const closed = latestEventMap(events, 'lock');
  return devices.map((d) => ({
    ...d,
    last_opened_at: d.last_opened_at ?? opened[d.device_id] ?? null,
    last_closed_at: d.last_closed_at ?? closed[d.device_id] ?? null,
  }));
}

export async function loadLockPresenceDevices() {
  const { data, error } = await supabase
    .from('lock_device_presence')
    .select('*')
    .order('device_id');

  if (error) {
    return { devices: [], error: error.message };
  }

  let devices = data || [];
  const missingTimes = devices.some(
    (d) => !('last_opened_at' in d) || !('last_closed_at' in d),
  );
  if (devices.length && missingTimes) {
    devices = await enrichOpenCloseTimes(devices);
  }

  return { devices, error: null };
}
