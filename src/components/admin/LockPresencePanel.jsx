import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AlertTriangle, Loader2, Lock, RefreshCw, Unlock, WifiOff } from 'lucide-react';
import { format } from 'date-fns';
import RemoteBridgeControls from '@/components/admin/RemoteBridgeControls';
import LockOpenCloseTimes from '@/components/admin/LockOpenCloseTimes';
import { bridgeOnlineFromDevices, loadLockPresenceDevices, watchManualLockAfterCommand } from '@/utils/lockPresence';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';

const UNLINKED = '__unlinked__';

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
  const [equipmentOptions, setEquipmentOptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [linkingDeviceId, setLinkingDeviceId] = useState(null);
  const [optimisticTimes, setOptimisticTimes] = useState(null);
  const [watching, setWatching] = useState(false);
  const stopWatch = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ devices: next, error: queryError }, equipmentRes] = await Promise.all([
      loadLockPresenceDevices(),
      supabase
        .from('equipment')
        .select('id, name, type')
        .order('type', { ascending: true })
        .order('name', { ascending: true }),
    ]);

    if (queryError) {
      setError(queryError);
      setDevices([]);
    } else {
      setError(null);
      setDevices(next);
    }

    if (equipmentRes.error) {
      console.warn('[LockPresencePanel] Could not load equipment catalog:', equipmentRes.error.message);
      setEquipmentOptions([]);
    } else {
      setEquipmentOptions(equipmentRes.data || []);
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    return () => stopWatch.current?.();
  }, [load]);

  const linkEquipment = useCallback(
    async (deviceId, rawValue) => {
      if (!deviceId) return;
      const equipmentId = rawValue === UNLINKED || rawValue === '' || rawValue == null
        ? null
        : Number(rawValue);
      if (equipmentId != null && !Number.isFinite(equipmentId)) return;

      setLinkingDeviceId(deviceId);
      const { error: updateError } = await supabase
        .from('lock_devices')
        .update({ equipment_id: equipmentId })
        .eq('device_id', deviceId);

      if (updateError) {
        toast({
          title: 'Could not link lock',
          description: updateError.message,
          variant: 'destructive',
        });
      } else {
        const linkedName = equipmentOptions.find((e) => Number(e.id) === equipmentId)?.name;
        toast({
          title: equipmentId == null ? 'Lock unlinked' : 'Lock linked to equipment',
          description: equipmentId == null
            ? `${deviceId} is no longer mapped to catalog equipment.`
            : `${deviceId} → ${linkedName || `equipment #${equipmentId}`}`,
        });
        await load();
      }
      setLinkingDeviceId(null);
    },
    [equipmentOptions, load],
  );

  const primary = devices[0] || null;
  const lastOpenedAt = optimisticTimes?.lastOpenedAt ?? primary?.last_opened_at;
  const lastClosedAt = optimisticTimes?.lastClosedAt ?? primary?.last_closed_at;
  const currentState = optimisticTimes?.currentState ?? primary?.current_state ?? null;

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
        <RemoteBridgeControls
          bridgeOnline={bridgeOnlineFromDevices(devices)}
          lastOpenedAt={lastOpenedAt}
          lastClosedAt={lastClosedAt}
          currentState={currentState}
          watching={watching}
          onSuccess={(data) => {
            const nextState = data?.currentState
              || (data?.action === 'remote_unlock' ? 'unlocked' : data?.action === 'remote_lock' ? 'locked' : null);
            setOptimisticTimes({
              lastOpenedAt: data?.lastOpenedAt ?? primary?.last_opened_at ?? null,
              lastClosedAt: data?.lastClosedAt ?? primary?.last_closed_at ?? null,
              currentState: nextState,
            });
            stopWatch.current?.();
            if (data?.action === 'remote_unlock' && data?.currentState === 'locked') {
              setWatching(false);
              setOptimisticTimes(null);
              load();
              return;
            }
            setWatching(data?.action === 'remote_unlock');
            stopWatch.current = watchManualLockAfterCommand({
              action: data?.action,
              lastOpenedAt: data?.lastOpenedAt,
              lastClosedAt: data?.lastClosedAt,
              currentState: data?.currentState,
              onDevices: (next, { done }) => {
                setDevices(next || []);
                if (done) {
                  setOptimisticTimes(null);
                  setWatching(false);
                }
              },
            });
          }}
        />

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
          const selectValue = device.equipment_id != null
            ? String(device.equipment_id)
            : UNLINKED;
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

              <LockOpenCloseTimes
                lastOpenedAt={device.last_opened_at}
                lastClosedAt={device.last_closed_at}
                currentState={device.current_state}
              />

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 text-xs text-slate-400">
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
              </div>

              <div className="pt-1 space-y-1.5">
                <p className="text-xs text-slate-500">Linked equipment</p>
                <Select
                  value={selectValue}
                  onValueChange={(value) => linkEquipment(device.device_id, value)}
                  disabled={linkingDeviceId === device.device_id}
                >
                  <SelectTrigger className="h-9 max-w-md bg-black/30 border-white/15">
                    <SelectValue placeholder="Link to equipment…" />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-900 border-white/15 text-white">
                    <SelectItem value={UNLINKED}>Not linked</SelectItem>
                    {equipmentOptions.map((item) => (
                      <SelectItem key={item.id} value={String(item.id)}>
                        {item.name}
                        {item.type ? ` (${item.type})` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {!device.equipment_id && (
                  <p className="text-xs text-amber-300/80">
                    Pick a catalog item so this lock is mapped to equipment.
                  </p>
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
