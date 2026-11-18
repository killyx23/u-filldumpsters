import React, { useCallback, useEffect, useState } from 'react';
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
import { Loader2, MapPin, RefreshCw } from 'lucide-react';
import { format } from 'date-fns';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';

const UNLINKED = '__unlinked__';

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
  const [equipmentOptions, setEquipmentOptions] = useState([]);
  const [locks, setLocks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [yardForm, setYardForm] = useState({ name: 'Yard', lat: '', lon: '', radius: '150' });
  const [attachIds, setAttachIds] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    const [yardRes, trackerRes, stateRes, alertRes, equipmentRes, lockRes, vendorAlarmRes] = await Promise.all([
      supabase.from('yards').select('*').order('id'),
      supabase.from('gps_trackers').select('*').order('full_name'),
      supabase.from('gps_tracker_state').select('macid, inside_yard, last_valid_at, gpstime, open_booking_id'),
      supabase.from('gps_alerts').select('*').is('resolved_at', null).order('created_at', { ascending: false }),
      supabase.from('equipment').select('id, name, type').order('name'),
      supabase.from('lock_devices').select('device_id, label').order('label'),
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
    setEquipmentOptions(equipmentRes.data || []);
    setLocks(lockRes.data || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

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

  const updateTracker = async (macid, patch) => {
    const { error } = await supabase.from('gps_trackers').update({
      ...patch,
      updated_at: new Date().toISOString(),
    }).eq('macid', macid);
    if (error) toast({ title: 'Could not update tracker', description: error.message, variant: 'destructive' });
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
            Three fresh GPS fixes outside the yard check the equipment out. Three fresh fixes back inside return it. The padlock fills in only when the tracker has no fix from the last 15 minutes.
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
              <h3 className="font-semibold">Trackers</h3>
              {trackers.length === 0 && <p className="text-sm text-gray-400">None yet. Sync now after YZXGPS_KEY is set.</p>}
              {trackers.map((tracker) => {
                const state = states[tracker.macid];
                return (
                  <div key={tracker.macid} className="rounded border border-white/10 p-3 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-medium">{tracker.full_name || tracker.macid}</p>
                        <p className="text-xs text-gray-400">{tracker.macid} · {sideLabel(state?.inside_yard)} · last fix {when(state?.gpstime || state?.last_valid_at)}</p>
                      </div>
                      {!tracker.equipment_id && <span className="text-xs text-amber-300">Unmapped</span>}
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <Select
                        value={tracker.equipment_id != null ? String(tracker.equipment_id) : UNLINKED}
                        onValueChange={(value) => updateTracker(tracker.macid, {
                          equipment_id: value === UNLINKED ? null : Number(value),
                        })}
                      >
                        <SelectTrigger><SelectValue placeholder="Equipment" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value={UNLINKED}>Not linked</SelectItem>
                          {equipmentOptions.map((item) => (
                            <SelectItem key={item.id} value={String(item.id)}>{item.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Select
                        value={tracker.lock_device_id || UNLINKED}
                        onValueChange={(value) => updateTracker(tracker.macid, {
                          lock_device_id: value === UNLINKED ? null : value,
                        })}
                      >
                        <SelectTrigger><SelectValue placeholder="Padlock" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value={UNLINKED}>No padlock</SelectItem>
                          {locks.map((lock) => (
                            <SelectItem key={lock.device_id} value={lock.device_id}>{lock.label || lock.device_id}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                );
              })}
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
