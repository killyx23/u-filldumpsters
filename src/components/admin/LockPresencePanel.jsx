import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertTriangle, Loader2, Lock, RefreshCw, Unlock, WifiOff } from 'lucide-react';
import { format } from 'date-fns';

const PRESENCE = {
  on_premises: {
    label: 'On premises',
    detail: 'Locked',
    className: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
    Icon: Lock,
  },
  off_premises: {
    label: 'Off premises',
    detail: 'Unlocked — rental in progress or return underway',
    className: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
    Icon: Unlock,
  },
  alert_open_and_offline: {
    label: 'Open and offline',
    detail: 'Unlocked when the bridge lost connectivity',
    className: 'bg-red-500/15 text-red-300 border-red-500/40',
    Icon: AlertTriangle,
  },
  unknown: {
    label: 'Unknown',
    detail: 'No lock or unlock event recorded yet',
    className: 'bg-slate-500/15 text-slate-300 border-slate-500/40',
    Icon: WifiOff,
  },
};

function when(value) {
  if (!value) return 'never';
  try {
    return format(new Date(value), 'MMM d, h:mm a');
  } catch {
    return String(value);
  }
}

export default function LockPresencePanel() {
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error: queryError } = await supabase
      .from('lock_device_presence')
      .select('*')
      .order('device_id');
    if (queryError) {
      setError(queryError.message);
      setDevices([]);
    } else {
      setError(null);
      setDevices(data || []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <Card className="bg-white/5 border-white/10">
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle>Lock &amp; equipment status</CardTitle>
          <CardDescription className="text-slate-400">
            Live state from igloohome webhook events. Locks register themselves the first time
            they report activity.
          </CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          <span className="ml-2">Refresh</span>
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && (
          <p className="text-sm text-red-300">
            Could not load lock status: {error}
          </p>
        )}

        {!error && !loading && devices.length === 0 && (
          <p className="text-sm text-slate-400">
            No locks registered yet. A lock appears here automatically after its first webhook
            delivery, then you can map it to a piece of equipment.
          </p>
        )}

        {devices.map((device) => {
          const state = PRESENCE[device.presence] || PRESENCE.unknown;
          const { Icon } = state;
          return (
            <div
              key={device.device_id}
              className="rounded-lg border border-white/10 bg-black/20 p-4 space-y-2"
            >
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <p className="font-semibold">
                    {device.equipment_name || device.label || device.device_id}
                  </p>
                  <p className="text-xs text-slate-500 font-mono">{device.device_id}</p>
                </div>
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${state.className}`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {state.label}
                </span>
              </div>

              <p className="text-sm text-slate-400">{state.detail}</p>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 text-xs text-slate-400">
                <span>
                  Changed: <span className="text-slate-200">{when(device.state_changed_at)}</span>
                </span>
                <span>
                  Last event: <span className="text-slate-200">{when(device.last_event_at)}</span>
                </span>
                <span>
                  Bridge:{' '}
                  <span
                    className={
                      device.bridge_online === false
                        ? 'text-red-300'
                        : device.bridge_online
                        ? 'text-emerald-300'
                        : 'text-slate-200'
                    }
                  >
                    {device.bridge_online === null || device.bridge_online === undefined
                      ? 'unreported'
                      : device.bridge_online
                      ? 'online'
                      : 'offline'}
                  </span>
                </span>
                {device.last_order_id && (
                  <span>
                    Booking: <span className="text-slate-200">#{device.last_order_id}</span>
                  </span>
                )}
                {!device.equipment_id && (
                  <span className="text-amber-300/80 col-span-2">
                    Not linked to equipment yet
                  </span>
                )}
              </div>

              {device.last_breakin_at && (
                <p className="flex items-center gap-2 rounded border border-red-500/40 bg-red-950/40 px-3 py-2 text-xs text-red-200">
                  <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
                  Break-in attempt reported {when(device.last_breakin_at)}
                </p>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
