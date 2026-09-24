import { supabase } from '@/lib/customSupabaseClient';

export function bridgeOnlineFromDevices(devices) {
  if (!devices?.length) return null;
  if (devices.some((d) => d.bridge_online === true)) return true;
  if (devices.every((d) => d.bridge_online === false)) return false;
  return null;
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
