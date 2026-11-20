import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, MapPin, RefreshCw, Trash2 } from 'lucide-react';
import { format } from 'date-fns';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';
import { linkDeviceToUnit, unlinkDeviceFromUnit } from '@/utils/linkUnitAccessory';

function when(value) {
  if (!value) return 'no fix yet';
  try {
    return format(new Date(value), 'MMM d, h:mm a');
  } catch {
    return String(value);
  }
}

function sideLabel(inside) {
  if (inside === true) return 'Inside yard';
  if (inside === false) return 'Outside yard';
  return 'Not confirmed';
}

const VENDOR_ALARM_LABELS = {
  1: 'SOS',
  3: 'Left fence',
  4: 'Entered fence',
  5: 'Device removal',
  6: 'Overspeed',
  8: 'Low power',
  16: 'Started',
  17: 'Collision',
  82: 'Shutdown',
  93: 'Started',
};

export default function GpsYardPanel() {
  const [yards, setYards] = useState([]);
  const [trackers, setTrackers] = useState([]);
  const [states, setStates] = useState({});
  const [alerts, setAlerts] = useState([]);
  const [vendorAlarms, setVendorAlarms] = useState([]);
  const [units, setUnits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [yardForm, setYardForm] = useState({ name: 'Yard', lat: '', lon: '', radius: '150' });
  const [attachIds, setAttachIds] = useState({});
  const [linkForm, setLinkForm] = useState({ macid: '', unitId: '' });
  const [savingLink, setSavingLink] = useState(false);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    const [yardRes, trackerRes, stateRes, alertRes, unitRes, vendorAlarmRes] = await Promise.all([
      supabase.from('yards').select('*').order('id'),
      supabase.from('gps_trackers').select('*').order('full_name'),
      supabase.from('gps_tracker_state').select('macid, inside_yard, last_valid_at, gpstime, open_booking_id'),
      supabase.from('gps_alerts').select('*').is('resolved_at', null).order('created_at', { ascending: false }),
      supabase.from('inventory_units').select('id, name, serial, status, inventory_item_id, inventory_items(name)').eq('is_active', true).order('name'),
      supabase.from('gps_vendor_alarms').select('id, macid, classify, ptime, lat, lon').order('ptime', { ascending: false }).limit(20),
    ]);
    if (yardRes.error || trackerRes.error) {
      toast({
        title: 'GPS settings unavailable',
        description: yardRes.error?.message || trackerRes.error?.message,
        variant: 'destructive',
      });
    }
    setYards(yardRes.data || []);
    setTrackers(trackerRes.data || []);
    const byMac = {};
    for (const row of stateRes.data || []) byMac[row.macid] = row;
    setStates(byMac);
    setAlerts(alertRes.data || []);
    setVendorAlarms(vendorAlarmRes.data || []);
    setUnits(unitRes.data || []);
    if (!silent) setLoading(false);
  }, []);

  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    loadRef.current();
    let timer;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => loadRef.current({ silent: true }), 400);
    };
    const channel = supabase.channel('gps-yard-admin')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'gps_tracker_state' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'gps_trackers' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'gps_alerts' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'gps_vendor_alarms' }, refresh)
      .subscribe();
    return () => {
      clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, []);

  const saveYard = async (event) => {
    event.preventDefault();
    const lat = Number(yardForm.lat);
    const lon = Number(yardForm.lon);
    const radius = Number(yardForm.radius);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !(radius > 0)) {
      toast({ title: 'Enter a latitude, longitude, and radius in meters.', variant: 'destructive' });
      return;
    }
    const { error } = await supabase.from('yards').insert({
      name: yardForm.name.trim() || 'Yard',
      lat,
      lon,
      radius_meters: Math.round(radius),
      is_active: true,
    });
    if (error) {
      toast({ title: 'Could not save yard', description: error.message, variant: 'destructive' });
      return;
    }
    setYardForm({ name: 'Yard', lat: '', lon: '', radius: '150' });
    load();
  };

  const toggleYard = async (yard) => {
    const { error } = await supabase.from('yards').update({
      is_active: !yard.is_active,
      updated_at: new Date().toISOString(),
    }).eq('id', yard.id);
    if (error) toast({ title: 'Could not update yard', description: error.message, variant: 'destructive' });
    else load();
  };

  const unitLabel = (unit) => (
    unit ? `${unit.name}${unit.inventory_items?.name ? ` · ${unit.inventory_items.name}` : ''}` : 'Unknown trailer'
  );

  const saveLink = async (event) => {
    event.preventDefault();
    const tracker = trackers.find((item) => item.macid === linkForm.macid);
    const unitId = Number(linkForm.unitId);
    if (!tracker || !Number.isFinite(unitId)) {
      toast({ title: 'Pick a GPS tracker and a serial unit.', variant: 'destructive' });
      return;
    }
    setSavingLink(true);
    const { error } = await linkDeviceToUnit(supabase, {
      kind: 'gps',
      deviceId: tracker.macid,
      deviceName: `${tracker.full_name || 'GPS'} (${tracker.macid})`,
      unitId,
      table: 'gps_trackers',
      idColumn: 'macid',
    });
    setSavingLink(false);
    if (error) {
      toast({ title: 'Could not link tracker', description: error.message, variant: 'destructive' });
      return;
    }
    setLinkForm({ macid: '', unitId: '' });
    load({ silent: true });
  };

  const unlink = async (tracker) => {
    const { error } = await unlinkDeviceFromUnit(supabase, {
      kind: 'gps',
      deviceId: tracker.macid,
      accessoryId: tracker.accessory_id,
      table: 'gps_trackers',
      idColumn: 'macid',
    });
    if (error) toast({ title: 'Could not remove link', description: error.message, variant: 'destructive' });
    else load();
  };

  const syncNow = async () => {
    setSyncing(true);
    const { data, error } = await supabase.functions.invoke('sync-gps-trackers', { body: {} });
    setSyncing(false);
    if (error || data?.ok === false) {
      let description = data?.error || error?.message || 'The tracker API did not respond.';
      if (error?.context?.json) {
        const body = await error.context.json().catch(() => null);
        if (body?.error) description = body.error;
      }
      toast({
        title: 'GPS sync failed',
        description,
        variant: 'destructive',
      });
      return;
    }
    toast({ title: 'GPS synced', description: `${data?.trackers ?? 0} tracker readings stored.` });
    load();
  };

  const attach = async (macid) => {
    const bookingId = Number(attachIds[macid]);
    if (!Number.isFinite(bookingId)) {
      toast({ title: 'Enter a booking number.', variant: 'destructive' });
      return;
    }
    const { data, error } = await supabase.functions.invoke('sync-gps-trackers', {
      body: { attach: { macid, bookingId } },
    });
    if (error || data?.ok === false) {
      let description = data?.error || error?.message;
      if (error?.context?.json) {
        const body = await error.context.json().catch(() => null);
        if (body?.error) description = body.error;
      }
      toast({
        title: 'Could not attach booking',
        description,
        variant: 'destructive',
      });
      return;
    }
    toast({ title: `Booking #${bookingId} checked out from GPS` });
    load();
  };

  const dismiss = async (alertId) => {
    const { error } = await supabase.from('gps_alerts').update({ resolved_at: new Date().toISOString() }).eq('id', alertId);
    if (error) toast({ title: 'Could not dismiss alert', description: error.message, variant: 'destructive' });
    else load();
  };

  return (
    <Card className="bg-gray-800 border-gray-700 text-white">
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="flex items-center gap-2">
            <MapPin className="h-5 w-5 text-yellow-400" />
            GPS yard clock
          </CardTitle>
          <CardDescription className="text-gray-400">
            Readings land here when the 5-minute yard sync writes them. Three fresh fixes outside the yard check the equipment out. Three fresh fixes back inside return it. The padlock fills in only when the tracker has no fix from the last 15 minutes. Sync now still pulls immediately.
          </CardDescription>
        </div>
        <Button type="button" variant="outline" onClick={syncNow} disabled={syncing}>
          {syncing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Sync now
        </Button>
      </CardHeader>
      <CardContent className="space-y-8">
        {loading ? (
          <div className="flex justify-center py-6"><Loader2 className="h-6 w-6 animate-spin text-yellow-400" /></div>
        ) : (
          <>
            <form onSubmit={saveYard} className="grid gap-3 md:grid-cols-5">
              <div>
                <Label className="text-gray-300">Yard name</Label>
                <Input value={yardForm.name} onChange={(e) => setYardForm({ ...yardForm, name: e.target.value })} className="mt-1" />
              </div>
              <div>
                <Label className="text-gray-300">Latitude</Label>
                <Input value={yardForm.lat} onChange={(e) => setYardForm({ ...yardForm, lat: e.target.value })} className="mt-1" inputMode="decimal" />
              </div>
              <div>
                <Label className="text-gray-300">Longitude</Label>
                <Input value={yardForm.lon} onChange={(e) => setYardForm({ ...yardForm, lon: e.target.value })} className="mt-1" inputMode="decimal" />
              </div>
              <div>
                <Label className="text-gray-300">Radius (meters)</Label>
                <Input value={yardForm.radius} onChange={(e) => setYardForm({ ...yardForm, radius: e.target.value })} className="mt-1" inputMode="numeric" />
              </div>
              <div className="flex items-end">
                <Button type="submit" className="w-full">Add yard</Button>
              </div>
            </form>

            <ul className="space-y-2">
              {yards.length === 0 && <li className="text-sm text-amber-300">No yard yet. Checkout and return stay paused until one is active.</li>}
              {yards.map((yard) => (
                <li key={yard.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-white/10 px-3 py-2 text-sm">
                  <span>
                    {yard.name}: {yard.lat}, {yard.lon} · {yard.radius_meters} m · {yard.is_active ? 'active' : 'paused'}
                  </span>
                  <Button type="button" size="sm" variant="outline" onClick={() => toggleYard(yard)}>
                    {yard.is_active ? 'Pause' : 'Activate'}
                  </Button>
                </li>
              ))}
            </ul>

            <div className="space-y-3">
              <h3 className="font-semibold">GPS accessories</h3>
              <p className="text-sm text-gray-400">
                Every GPS of this kind lives on this card. A linked row is read-only. If any tracker is still unassigned, the extra row mounts it on a serial unit.
              </p>
              {trackers.length === 0 && <p className="text-sm text-gray-400">None yet. Sync now after YZXGPS_KEY is set.</p>}
              {trackers.filter((tracker) => tracker.inventory_unit_id != null).map((tracker) => {
                const state = states[tracker.macid];
                const unit = units.find((item) => Number(item.id) === Number(tracker.inventory_unit_id));
                return (
                  <div key={tracker.macid} className="flex flex-wrap items-center justify-between gap-3 rounded border border-white/10 px-3 py-2 text-sm">
                    <div>
                      <p className="font-medium">{tracker.full_name || 'GPS'} · {unitLabel(unit)}</p>
                      <p className="text-xs text-gray-400 font-mono">{tracker.macid} · {sideLabel(state?.inside_yard)} · last fix {when(state?.gpstime || state?.last_valid_at)}</p>
                    </div>
                    <Button type="button" size="sm" variant="destructive" onClick={() => unlink(tracker)}>
                      <Trash2 className="mr-1 h-3.5 w-3.5" /> Delete
                    </Button>
                  </div>
                );
              })}
              {trackers.some((tracker) => tracker.inventory_unit_id == null) && (
                <form onSubmit={saveLink} className="grid gap-3 rounded border border-dashed border-white/20 p-3 md:grid-cols-[1fr_1fr_auto]">
                  <div className="space-y-1">
                    <Label className="text-xs text-gray-400">Unlinked GPS</Label>
                    <Select value={linkForm.macid || undefined} onValueChange={(value) => setLinkForm({ ...linkForm, macid: value })}>
                      <SelectTrigger><SelectValue placeholder="Select a GPS tracker" /></SelectTrigger>
                      <SelectContent>
                        {trackers.filter((tracker) => tracker.inventory_unit_id == null).map((tracker) => (
                          <SelectItem key={tracker.macid} value={tracker.macid}>
                            {tracker.full_name || 'GPS'} · {tracker.macid}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-gray-400">Serial unit</Label>
                    <Select value={linkForm.unitId || undefined} onValueChange={(value) => setLinkForm({ ...linkForm, unitId: value })}>
                      <SelectTrigger><SelectValue placeholder="Select a unit" /></SelectTrigger>
                      <SelectContent>
                        {units.map((unit) => (
                          <SelectItem key={unit.id} value={String(unit.id)}>{unitLabel(unit)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-end">
                    <Button type="submit" disabled={savingLink}>
                      {savingLink ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save link'}
                    </Button>
                  </div>
                </form>
              )}
            </div>

            <div className="space-y-3">
              <h3 className="font-semibold">Vendor fence events</h3>
              {vendorAlarms.length === 0 && (
                <p className="text-sm text-gray-400">None yet. Leave/enter (classify 3/4) show up here after the trailer crosses the 50 m circle.</p>
              )}
              {vendorAlarms.map((alarm) => (
                <div key={alarm.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-white/10 px-3 py-2 text-sm">
                  <span>{VENDOR_ALARM_LABELS[alarm.classify] || `Alarm ${alarm.classify}`}</span>
                  <span className="text-gray-400">{when(alarm.ptime)}</span>
                </div>
              ))}
            </div>

            <div className="space-y-3">
              <h3 className="font-semibold">Open alerts</h3>
              {alerts.length === 0 && <p className="text-sm text-gray-400">None.</p>}
              {alerts.map((alert) => {
                const canAttach = ['left_no_booking', 'ambiguous_booking', 'delivery_departure'].includes(alert.kind) && alert.macid;
                const candidates = Array.isArray(alert.payload?.candidateIds) ? alert.payload.candidateIds : [];
                return (
                  <div key={alert.id} className="rounded border border-amber-500/30 bg-amber-500/10 p-3 text-sm space-y-2">
                    <p>{alert.message}</p>
                    {candidates.length > 0 && <p className="text-xs text-gray-300">Candidate bookings: {candidates.join(', ')}</p>}
                    <div className="flex flex-wrap items-center gap-2">
                      {canAttach && (
                        <>
                          <Input
                            className="max-w-[140px]"
                            placeholder="Booking #"
                            value={attachIds[alert.macid] || ''}
                            onChange={(e) => setAttachIds({ ...attachIds, [alert.macid]: e.target.value })}
                          />
                          <Button type="button" size="sm" onClick={() => attach(alert.macid)}>Attach</Button>
                        </>
                      )}
                      <Button type="button" size="sm" variant="outline" onClick={() => dismiss(alert.id)}>Dismiss</Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
