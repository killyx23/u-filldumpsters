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
import { AlertTriangle, Loader2, Lock, RefreshCw, Trash2, Unlock, WifiOff } from 'lucide-react';
import { format } from 'date-fns';
import RemoteBridgeControls from '@/components/admin/RemoteBridgeControls';
import LockOpenCloseTimes from '@/components/admin/LockOpenCloseTimes';
import { bridgeOnlineFromDevices, loadLockPresenceDevices, lockDisplayFromCommand, watchManualLockAfterCommand } from '@/utils/lockPresence';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';
import { linkDeviceToUnit, unlinkDeviceFromUnit } from '@/utils/linkUnitAccessory';

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
  const [unitOptions, setUnitOptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [linkForm, setLinkForm] = useState({ deviceId: '', unitId: '' });
  const [savingLink, setSavingLink] = useState(false);
  const [error, setError] = useState(null);
  const [linkingDeviceId, setLinkingDeviceId] = useState(null);
  const [optimisticTimes, setOptimisticTimes] = useState(null);
  const stopWatch = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ devices: next, error: queryError }, unitRes] = await Promise.all([
      loadLockPresenceDevices(),
      supabase
        .from('inventory_units')
        .select('id, name, inventory_items(name)')
        .eq('is_active', true)
        .order('name'),
    ]);

    if (queryError) {
      setError(queryError);
      setDevices([]);
    } else {
      setError(null);
      setDevices(next);
    }

    if (unitRes.error) {
      console.warn('[LockPresencePanel] Could not load units:', unitRes.error.message);
      setUnitOptions([]);
    } else {
      setUnitOptions(unitRes.data || []);
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    return () => stopWatch.current?.();
  }, [load]);

  const unitLabel = (unit) => (
    unit ? `${unit.name}${unit.inventory_items?.name ? ` · ${unit.inventory_items.name}` : ''}` : 'Unknown trailer'
  );

  const saveLink = async (event) => {
    event.preventDefault();
    const device = devices.find((item) => item.device_id === linkForm.deviceId);
    const unitId = Number(linkForm.unitId);
    if (!device || !Number.isFinite(unitId)) {
      toast({ title: 'Pick a lock and a serial unit.', variant: 'destructive' });
      return;
    }
    setSavingLink(true);
    const { error } = await linkDeviceToUnit(supabase, {
      kind: 'lock',
      deviceId: device.device_id,
      deviceName: device.label || device.device_id,
      unitId,
      table: 'lock_devices',
      idColumn: 'device_id',
    });
    setSavingLink(false);
    if (error) {
      toast({ title: 'Could not link lock', description: error.message, variant: 'destructive' });
      return;
    }
    setLinkForm({ deviceId: '', unitId: '' });
    await load();
  };

  const unlink = async (device) => {
    setLinkingDeviceId(device.device_id);
    const { error } = await unlinkDeviceFromUnit(supabase, {
      kind: 'lock',
      deviceId: device.device_id,
      accessoryId: device.accessory_id,
      table: 'lock_devices',
      idColumn: 'device_id',
    });
    setLinkingDeviceId(null);
    if (error) toast({ title: 'Could not remove link', description: error.message, variant: 'destructive' });
    else await load();
  };

  const primary = devices[0] || null;
  const lastOpenedAt = optimisticTimes?.lastOpenedAt ?? primary?.last_opened_at;
  const lastClosedAt = optimisticTimes?.lastClosedAt ?? primary?.last_closed_at;
  const currentState = optimisticTimes?.currentState ?? primary?.current_state ?? null;
  const linked = devices.filter((device) => device.inventory_unit_id != null);
  const unlinked = devices.filter((device) => device.inventory_unit_id == null);

  return (
    <Card className="bg-white/5 border-white/10">
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle>Lock accessories</CardTitle>
          <CardDescription className="text-slate-400">
            Every padlock of this kind lives on this card. Linked rows are read-only. If any lock is still unassigned, the extra row mounts it on a serial unit.
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
          onSuccess={(data) => {
            const display = lockDisplayFromCommand(data, {
              lastOpenedAt,
              lastClosedAt,
              currentState,
            });
            if (display) setOptimisticTimes(display);
            stopWatch.current?.();
            if (data?.action !== 'remote_unlock' && data?.action !== 'remote_lock') return;
            stopWatch.current = watchManualLockAfterCommand({
              action: data.action,
              lastOpenedAt: display?.lastOpenedAt ?? data?.lastOpenedAt,
              lastClosedAt: display?.lastClosedAt ?? data?.lastClosedAt,
              onDevices: (next, { done }) => {
                setDevices(next || []);
                if (done) setOptimisticTimes(null);
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
            delivery, then you can map it to a serial unit.
          </p>
        )}

        {linked.map((device) => {
          const state = PRESENCE[device.presence] || PRESENCE.unknown;
          const { Icon } = state;
          const unit = unitOptions.find((item) => Number(item.id) === Number(device.inventory_unit_id));
          return (
            <div
              key={device.device_id}
              className="rounded-lg border border-white/10 bg-black/20 p-4 space-y-2"
            >
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <p className="font-semibold">
                    {device.label || device.device_id} · {unitLabel(unit)}
                  </p>
                  <p className="text-xs text-slate-500 font-mono">{device.device_id}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${state.className}`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {state.label}
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    onClick={() => unlink(device)}
                    disabled={linkingDeviceId === device.device_id}
                  >
                    <Trash2 className="mr-1 h-3.5 w-3.5" /> Delete
                  </Button>
                </div>
              </div>
              <p className="text-sm text-slate-400">{state.detail}</p>
              <LockOpenCloseTimes
                lastOpenedAt={device.last_opened_at}
                lastClosedAt={device.last_closed_at}
                currentState={device.current_state}
              />
              {device.last_breakin_at && (
                <p className="flex items-center gap-2 rounded border border-red-500/40 bg-red-950/40 px-3 py-2 text-xs text-red-200">
                  <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
                  Break-in attempt reported {when(device.last_breakin_at)}
                </p>
              )}
            </div>
          );
        })}

        {unlinked.length > 0 && (
          <form onSubmit={saveLink} className="grid gap-3 rounded border border-dashed border-white/20 p-3 md:grid-cols-[1fr_1fr_auto]">
            <Select value={linkForm.deviceId || undefined} onValueChange={(value) => setLinkForm({ ...linkForm, deviceId: value })}>
              <SelectTrigger className="bg-black/30 border-white/15"><SelectValue placeholder="Unlinked lock" /></SelectTrigger>
              <SelectContent className="bg-slate-900 border-white/15 text-white">
                {unlinked.map((device) => (
                  <SelectItem key={device.device_id} value={device.device_id}>
                    {device.label || device.device_id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={linkForm.unitId || undefined} onValueChange={(value) => setLinkForm({ ...linkForm, unitId: value })}>
              <SelectTrigger className="bg-black/30 border-white/15"><SelectValue placeholder="Serial unit" /></SelectTrigger>
              <SelectContent className="bg-slate-900 border-white/15 text-white">
                {unitOptions.map((unit) => (
                  <SelectItem key={unit.id} value={String(unit.id)}>{unitLabel(unit)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="submit" disabled={savingLink}>
              {savingLink ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save link'}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
