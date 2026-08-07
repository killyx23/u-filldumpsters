import React, { useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Loader2,
  Key,
  Unlock,
  Lock,
  RefreshCw,
  Undo2,
  Radar,
  ArrowLeft,
  AlertTriangle,
  CheckCircle2,
  Trash2,
} from 'lucide-react';
import { format } from 'date-fns';

async function formatInvokeError(error, data) {
  if (data?.success === false && data?.error) {
    return String(data.error);
  }

  let status = null;
  let bodyText = '';
  let bodyJson = null;

  try {
    const ctx = error?.context;
    if (ctx) {
      status = ctx.status ?? ctx.statusCode ?? null;
      if (typeof ctx.json === 'function') {
        bodyJson = await ctx.json().catch(() => null);
      } else if (typeof ctx.text === 'function') {
        bodyText = await ctx.text().catch(() => '');
      }
    }
  } catch {
    // ignore parse failures
  }

  const nestedError =
    bodyJson?.error ||
    bodyJson?.message ||
    bodyJson?.msg ||
    (typeof bodyJson === 'string' ? bodyJson : null) ||
    bodyText ||
    null;

  if (status === 404) {
    return (
      'Function not found (HTTP 404). Local: restart `npx supabase functions serve`. ' +
      'Hosted: `npx supabase functions deploy test-lock-lifecycle --project-ref REDACTED_PROJECT_REF`'
    );
  }

  if (nestedError) {
    return status ? `HTTP ${status}: ${nestedError}` : String(nestedError);
  }

  const base = error?.message || 'Edge function error';
  if (base.includes('non-2xx') && status) {
    return `HTTP ${status}: ${base}`;
  }
  return base;
}

async function invokeTest(action, bookingId, extra = {}) {
  const { data, error } = await supabase.functions.invoke('test-lock-lifecycle', {
    body: { action, bookingId: Number(bookingId), ...extra },
  });
  if (error) {
    const message = await formatInvokeError(error, data);
    const err = new Error(message);
    err.payload = data || null;
    throw err;
  }
  if (data?.success === false) {
    const err = new Error(data.error || 'Request failed');
    err.payload = data;
    throw err;
  }
  return data;
}

export default function LockLifecycleTestPage() {
  const [bookingId, setBookingId] = useState('');
  const [durationMinutes, setDurationMinutes] = useState(30);
  const [busy, setBusy] = useState(null);
  const [result, setResult] = useState(null);
  const confirmPollRef = React.useRef(0);

  const run = useCallback(async (action, extra = {}) => {
    if (!bookingId) {
      toast({ title: 'Enter a booking ID', variant: 'destructive' });
      return;
    }
    setBusy(action);
    try {
      const data = await invokeTest(action, bookingId, extra);
      setResult(data);
      const pinText = typeof data.pin === 'string' ? data.pin : data.pin?.access_pin || null;
      let description = data.result || data.action || 'Done';
      let toastTitle = data.needsConfirm ? 'Waiting on Bridge' : `${action} OK`;
      let toastVariant = 'default';

      if (action === 'sync' || action === 'probe') {
        const parsed = Number(data.eventsParsed ?? data.parsedEvents?.length ?? 0);
        const actionsList = Array.isArray(data.actions) ? data.actions : [];
        const stateChanging = Number(
          data.stateChanging ??
            actionsList.filter(
              (a) =>
                String(a).includes('marked_rented') || String(a).includes('marked_returned'),
            ).length,
        );
        if (action === 'probe') {
          description = `Parsed ${parsed} event(s) from Igloohome activity. Inspect raw result below.`;
        } else if (stateChanging > 0) {
          toastTitle = 'Sync updated rental';
          description = `Marked rented/returned from ${stateChanging} event(s) (${parsed} parsed). Check admin timestamps.`;
        } else if (actionsList.length > 0) {
          toastTitle = 'Sync OK — no rental change';
          description =
            data.bridgeHint ||
            `Logged ${actionsList.length} in-window event(s) but rented/returned did not change (already set or outside rules).`;
        } else {
          toastTitle = 'Sync found nothing to apply';
          toastVariant = 'destructive';
          description =
            data.bridgeHint ||
            (parsed === 0
              ? 'Bridge responded OK, but no unlock/lock events were found. Unlock and lock with this booking’s PIN near the Bridge, wait ~30–60s, then Sync again.'
              : `Parsed ${parsed} historical event(s), but none match this booking’s PIN / time window — rented/returned were not updated.`);
        }
      } else if (data.needsConfirm) {
        description = pinText
          ? `PIN ${pinText} queued — waiting for Bridge delivery`
          : 'Waiting for Bridge to confirm PIN delivery';
      } else if (pinText) {
        if (action === 'algopin') description = `AlgoPIN ${pinText} ready — works without the bridge`;
        else if (action === 'setup' || action === 'confirm_pin') {
          description = `PIN ${pinText} confirmed on the lock for ~${data.durationMinutes || durationMinutes} min`;
        } else if (action === 'clear_lock_pins') {
          description = `Cleared ${data.cleared?.confirmed ?? 0} PIN(s) from the lock`;
        } else description = `Active PIN ${pinText}`;
      } else if (action === 'clear_lock_pins') {
        description = `Cleared ${data.cleared?.confirmed ?? 0} PIN(s); stale remaining: ${data.stalePinCount ?? 0}`;
      }
      toast({
        title: toastTitle,
        description,
        variant: toastVariant,
      });
      return data;
    } catch (err) {
      console.error('[LockLifecycleTest]', action, err);
      if (err?.payload) setResult(err.payload);
      const hint = err?.payload?.hint;
      toast({
        title: `${action} failed`,
        description: hint || err.message,
        variant: 'destructive',
      });
      return null;
    } finally {
      setBusy(null);
    }
  }, [bookingId, durationMinutes]);

  // Auto-poll confirm_pin while a bridge job is still pending (up to ~2 minutes).
  React.useEffect(() => {
    if (!result?.needsConfirm || !bookingId) return undefined;
    if (busy) return undefined;
    if (confirmPollRef.current >= 24) return undefined;

    const timer = setTimeout(async () => {
      confirmPollRef.current += 1;
      const data = await run('confirm_pin');
      if (data?.lockJobState === 'completed') {
        confirmPollRef.current = 0;
      }
    }, 5000);

    return () => clearTimeout(timer);
  }, [result?.needsConfirm, result?.lockJobState, bookingId, busy, run]);

  // Reset poll counter when a fresh setup starts a new pending job
  React.useEffect(() => {
    if (result?.action === 'setup' && result?.needsConfirm) {
      confirmPollRef.current = 0;
    }
  }, [result?.action, result?.needsConfirm, result?.lockJobDiagnostics?.jobId]);

  const runDiagnose = useCallback(async () => {
    setBusy('oauth_diagnose');
    try {
      const { data, error } = await supabase.functions.invoke('test-lock-lifecycle', {
        body: { action: 'oauth_diagnose' },
      });
      if (error) throw new Error(await formatInvokeError(error, data));
      if (data?.success === false) throw new Error(data.error || 'Request failed');
      setResult(data);
      const working = (data.results || []).filter((r) => r.ok).map((r) => r.scopes);
      toast({
        title: 'oauth_diagnose OK',
        description: working.length
          ? `Accepted: ${working.join(', ')}`
          : 'Igloohome rejected every scope combination — see details below.',
        variant: working.length ? 'default' : 'destructive',
      });
    } catch (err) {
      console.error('[LockLifecycleTest] oauth_diagnose', err);
      toast({ title: 'oauth_diagnose failed', description: err.message, variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  }, []);

  const booking = result?.booking;
  const displayPin =
    (typeof result?.pin === 'string' && result.pin) ||
    (result?.pin && typeof result.pin === 'object' ? result.pin.access_pin : null) ||
    null;
  const pinRow = typeof result?.pin === 'object' && result?.pin?.access_pin ? result.pin : null;

  return (
    <div className="min-h-screen bg-slate-950 text-white p-4 md:p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <Link
              to="/admin/dashboard?tab=settings"
              className="inline-flex items-center text-sm text-blue-300 hover:text-blue-200 mb-2"
            >
              <ArrowLeft className="h-4 w-4 mr-1" /> Back to Admin
            </Link>
            <h1 className="text-3xl font-bold">Lock Lifecycle Test</h1>
            <p className="text-slate-400 mt-1">
              Compress a Dump Loader booking into a short live PIN window so you can
              unlock/lock the padlock and verify Rented → Returned + email/SMS in minutes.
            </p>
            <p className="text-xs text-slate-500 mt-2 font-mono">
              Backend: {typeof window !== 'undefined' ? window.location.origin : '…'}
              /functions/v1 (Vite → local Supabase)
            </p>
          </div>
        </div>

        <Card className="bg-amber-950/40 border-amber-500/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-amber-200 flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4" /> Use a test / throwaway booking
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-amber-100/90 space-y-1">
            <p>
              <strong>Setup</strong> temporarily overwrites that booking&apos;s pickup/return
              schedule, clears rented/returned timestamps, and creates a real Igloohome PIN.
              Always click <strong>Restore Dates</strong> when you&apos;re done.
            </p>
            <p>
              Keep the padlock within Wi-Fi bridge range while unlocking and locking so activity
              logs can sync. Or use Simulate Unlock / Simulate Lock to skip the hardware.
            </p>
            <p>
              <strong>Clear PINs From Lock</strong> before re-testing if a previous PIN is still
              on the padlock. Setup now verifies the old PIN is gone before creating a new one.
              Only try a PIN when state is <strong>completed</strong>.
            </p>
          </CardContent>
        </Card>

        <Card className="bg-white/5 border-white/10">
          <CardHeader>
            <CardTitle>1. Choose booking</CardTitle>
            <CardDescription className="text-slate-400">
              Self-pickup Dump Loader order (plan id 2). Use a Confirmed booking that exists in
              the database you are pointed at — local seed data and production have different ids.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="sm:col-span-1">
                <Label htmlFor="bookingId">Booking / Order ID</Label>
                <Input
                  id="bookingId"
                  value={bookingId}
                  onChange={(e) => setBookingId(e.target.value.trim())}
                  placeholder="1296"
                  className="bg-black/30 border-white/20 mt-1"
                />
              </div>
              <div>
                <Label htmlFor="duration">PIN duration (minutes)</Label>
                <Input
                  id="duration"
                  type="number"
                  min={5}
                  max={180}
                  value={durationMinutes}
                  onChange={(e) => setDurationMinutes(Number(e.target.value) || 30)}
                  className="bg-black/30 border-white/20 mt-1"
                />
              </div>
              <div className="flex items-end">
                <Button
                  className="w-full"
                  variant="outline"
                  disabled={!!busy}
                  onClick={() => run('status')}
                >
                  {busy === 'status' ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                  Refresh Status
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white/5 border-white/10">
          <CardHeader>
            <CardTitle>2. Run the test</CardTitle>
            <CardDescription className="text-slate-400">
              Bridge Setup needs the Igloo Bridge online to Igloohome&apos;s cloud. An empty PIN
              list in the Igloo app does <strong>not</strong> mean the Bridge is reachable — if
              you see HTTP 406 / bridge offline, use <strong>AlgoPIN</strong> (works offline) or
              power-cycle the Bridge Wi‑Fi and retry.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Button
              className="bg-red-800 hover:bg-red-700 sm:col-span-2"
              disabled={!!busy}
              onClick={() => run('clear_lock_pins')}
            >
              {busy === 'clear_lock_pins' ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Trash2 className="h-4 w-4 mr-2" />}
              Clear PINs From Lock
            </Button>
            <Button
              className="bg-green-600 hover:bg-green-700 sm:col-span-2"
              disabled={!!busy}
              onClick={() => run('algopin', { durationMinutes })}
            >
              {busy === 'algopin' ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Key className="h-4 w-4 mr-2" />}
              Setup + AlgoPIN (no bridge needed) — recommended
            </Button>
            <Button
              className="bg-purple-600 hover:bg-purple-700"
              disabled={!!busy}
              onClick={() => run('setup', { durationMinutes })}
            >
              {busy === 'setup' ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Key className="h-4 w-4 mr-2" />}
              {busy === 'setup' ? 'Clearing old PIN + creating…' : 'Setup + bridge PIN (needs bridge)'}
            </Button>
            <Button
              className="bg-amber-600 hover:bg-amber-700"
              disabled={!!busy || !(result?.needsConfirm || result?.lockJobState === 'pending')}
              onClick={() => run('confirm_pin')}
            >
              {busy === 'confirm_pin' ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
              {busy === 'confirm_pin' ? 'Checking Bridge…' : 'Check Bridge Delivery'}
            </Button>
            <Button
              className="bg-blue-600 hover:bg-blue-700"
              disabled={!!busy}
              onClick={() => run('sync')}
            >
              {busy === 'sync' ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Radar className="h-4 w-4 mr-2" />}
              Sync Lock Activity (real)
            </Button>
            <p className="sm:col-span-2 text-xs text-slate-500 -mt-1">
              Sync asks the Bridge to upload padlock logs, then reads Igloohome cloud activity.
              Unlock must happen with the <strong className="text-slate-300">Confirmed PIN</strong> while
              the lock is within a few feet of the Bridge (LED alone is not enough). If Sync still
              finds 0 unlocks, open the Igloo app → Logs → Sync on your phone against the lock, then
              Sync here — or use Simulate Unlock to advance admin without waiting on Igloohome.
            </p>
            <Button
              className="bg-orange-600 hover:bg-orange-700"
              disabled={!!busy}
              onClick={() => run('simulate_unlock')}
            >
              {busy === 'simulate_unlock' ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Unlock className="h-4 w-4 mr-2" />}
              Simulate Unlock → Rented
            </Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700"
              disabled={!!busy}
              onClick={() => run('simulate_lock')}
            >
              {busy === 'simulate_lock' ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Lock className="h-4 w-4 mr-2" />}
              Simulate Lock → Returned
            </Button>
            <Button
              variant="outline"
              disabled={!!busy}
              onClick={() => run('probe')}
            >
              {busy === 'probe' ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Radar className="h-4 w-4 mr-2" />}
              Probe Activity Log Shape
            </Button>
            <Button
              variant="destructive"
              disabled={!!busy}
              onClick={() => run('restore')}
            >
              {busy === 'restore' ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Undo2 className="h-4 w-4 mr-2" />}
              Restore Dates
            </Button>
            <Button
              variant="outline"
              className="sm:col-span-2"
              disabled={!!busy}
              onClick={runDiagnose}
            >
              {busy === 'oauth_diagnose' ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <AlertTriangle className="h-4 w-4 mr-2" />}
              Diagnose Igloohome OAuth (no booking needed)
            </Button>
          </CardContent>
        </Card>

        {(booking || displayPin) && (
          <Card className="bg-white/5 border-white/10">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-400" />
                Current state
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {displayPin && (
                <div className="bg-purple-900/30 border border-purple-500/40 rounded-xl p-6 text-center">
                  <p className="text-sm text-purple-200 mb-2">
                    {result?.lockJobState === 'completed'
                      ? 'Confirmed PIN — enter on the padlock'
                      : 'Pending PIN — do not use until confirmed'}
                  </p>
                  <p className="text-5xl font-mono font-black tracking-widest text-white">{displayPin}</p>
                  {result?.lockJobState && result.lockJobState !== 'completed' && (
                    <p className="text-sm text-red-300 mt-3 flex items-center justify-center gap-2">
                      <AlertTriangle className="h-4 w-4" />
                      Bridge has not confirmed this PIN reached the padlock — wake the lock and wait
                    </p>
                  )}
                  {result?.lockJobDiagnostics && (
                    <div className="mt-4 text-left bg-black/40 rounded-lg p-3 text-xs font-mono text-slate-300 space-y-1">
                      <p className="text-yellow-300 font-semibold">Lock job status</p>
                      <p>state: {String(result.lockJobState)}</p>
                      <p>jobId: {String(result.lockJobDiagnostics.jobId || 'none')}</p>
                      <p>deleteAttempts: {String(result.lockJobDiagnostics.deleteAttempts)}</p>
                      <p>deleteConfirmed: {String(result.lockJobDiagnostics.deleteConfirmed ?? 'n/a')}</p>
                      <p>stalePinCount: {String(result.stalePinCount ?? 'n/a')}</p>
                      <p>pollCount: {String(result.lockJobDiagnostics.polls?.length || 0)}</p>
                      <p>
                        devices:{' '}
                        {JSON.stringify(result.devices || result.lockJobDiagnostics.devices || null)}
                      </p>
                      <p>
                        lastPoll:{' '}
                        {JSON.stringify(
                          result.lockJobDiagnostics.polls?.[
                            (result.lockJobDiagnostics.polls?.length || 1) - 1
                          ] || null,
                        )}
                      </p>
                    </div>
                  )}
                  {pinRow?.start_time && pinRow?.end_time && (
                    <p className="text-sm text-purple-200 mt-3">
                      Valid {format(new Date(pinRow.start_time), 'PPp')} → {format(new Date(pinRow.end_time), 'PPp')}
                    </p>
                  )}
                </div>
              )}

              {booking && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                  <div className="bg-black/30 rounded-lg p-3">
                    <p className="text-slate-400">Status</p>
                    <p className="font-semibold">{booking.status}</p>
                  </div>
                  <div className="bg-black/30 rounded-lg p-3">
                    <p className="text-slate-400">Schedule (MST slots)</p>
                    <p className="font-semibold">
                      {booking.drop_off_date} {booking.drop_off_time_slot}
                      <br />→ {booking.pickup_date} {booking.pickup_time_slot}
                    </p>
                  </div>
                  <div className="bg-black/30 rounded-lg p-3">
                    <p className="text-slate-400">Rented out</p>
                    <p className="font-semibold">
                      {booking.rented_out_at
                        ? format(new Date(booking.rented_out_at), 'PPp')
                        : '—'}
                    </p>
                    {booking.rental_started_notified_at && (
                      <p className="text-xs text-green-300 mt-1">Started email/SMS sent</p>
                    )}
                  </div>
                  <div className="bg-black/30 rounded-lg p-3">
                    <p className="text-slate-400">Returned</p>
                    <p className="font-semibold">
                      {booking.returned_at
                        ? format(new Date(booking.returned_at), 'PPp')
                        : '—'}
                    </p>
                    {booking.return_notified_at && (
                      <p className="text-xs text-green-300 mt-1">Return email/SMS sent</p>
                    )}
                  </div>
                </div>
              )}

              {(result?.action === 'sync' || result?.action === 'probe') && (
                <div
                  className={`rounded-lg p-4 text-sm space-y-2 border ${
                    (Array.isArray(result.actions) ? result.actions.length : 0) === 0 &&
                    result.action === 'sync'
                      ? 'bg-amber-950/40 border-amber-500/40 text-amber-100'
                      : 'bg-black/30 border-white/10 text-slate-200'
                  }`}
                >
                  <p className="font-semibold flex items-center gap-2">
                    {Number(result.stateChanging || 0) > 0 ? (
                      <CheckCircle2 className="h-4 w-4 text-green-400" />
                    ) : (
                      <AlertTriangle className="h-4 w-4 text-amber-400" />
                    )}
                    Sync / activity log result
                  </p>
                  <p className="font-mono text-xs">
                    jobId: {String(result.jobId || 'none')}
                  </p>
                  <p className="font-mono text-xs">
                    eventsParsed:{' '}
                    {String(
                      result.eventsParsed ??
                        (Array.isArray(result.parsedEvents) ? result.parsedEvents.length : 0),
                    )}
                  </p>
                  <p className="font-mono text-xs">
                    eventsRelevant / stateChanging:{' '}
                    {String(result.eventsRelevant ?? (Array.isArray(result.actions) ? result.actions.length : 0))}
                    {' / '}
                    {String(result.stateChanging ?? 0)}
                  </p>
                  {result.skipped ? (
                    <p className="font-mono text-xs text-muted-foreground">
                      skipped: outsideWindow={String(result.skipped.outsideWindow ?? 0)}, pinMismatch=
                      {String(result.skipped.pinMismatch ?? 0)}, noPin={String(result.skipped.noPin ?? 0)}
                    </p>
                  ) : null}
                  {result.diagnostics ? (
                    <p className="font-mono text-xs text-muted-foreground">
                      activePin…{String(result.diagnostics.activePinSuffix || '??')}, unlocksForActivePin=
                      {String(result.diagnostics.unlocksForActivePin ?? 0)}, bridgeContactAt=
                      {String(result.diagnostics.bridgeContactAt || 'none')}
                    </p>
                  ) : null}
                  {Array.isArray(result.failedUnlockAttemptsInWindow) &&
                  result.failedUnlockAttemptsInWindow.length > 0 ? (
                    <p className="text-xs font-mono text-amber-200/90">
                      failed PIN attempts in window:{' '}
                      {result.failedUnlockAttemptsInWindow
                        .map(
                          (f) =>
                            `${f.eventTimestamp} (*${f.pinSuffix || '??'})`,
                        )
                        .join('; ')}
                    </p>
                  ) : null}
                  {typeof result.activityRowsFetched === "number" ? (
                    <p className="text-xs font-mono text-muted-foreground">
                      activityRowsFetched: {result.activityRowsFetched}
                    </p>
                  ) : null}
                  {result.emptyBridgePayload ? (
                    <p className="text-xs font-mono text-amber-200/90">
                      emptyBridgePayload: true (jobType 15 body had no log rows — expected; history comes from /activity)
                    </p>
                  ) : null}
                  {result.bridgeHint ? (
                    <p className="text-xs text-amber-100/90">{result.bridgeHint}</p>
                  ) : null}
                  {Array.isArray(result.actions) && result.actions.length > 0 ? (
                    <ul className="list-disc pl-5 text-xs font-mono space-y-1">
                      {result.actions.map((a, i) => (
                        <li key={i}>{typeof a === 'string' ? a : JSON.stringify(a)}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              )}

              {Array.isArray(result?.instructions) && (
                <ol className="list-decimal list-inside text-sm text-slate-300 space-y-1 bg-black/20 rounded-lg p-4">
                  {result.instructions.map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ol>
              )}

              {Array.isArray(result?.logs) && result.logs.length > 0 && (
                <div>
                  <p className="text-sm font-semibold mb-2">Recent tracking logs</p>
                  <div className="max-h-48 overflow-auto text-xs font-mono bg-black/40 rounded-lg p-3 space-y-1">
                    {result.logs.map((log) => (
                      <div key={log.id} className="border-b border-white/5 pb-1">
                        <span className="text-yellow-300">{log.event_type}</span>{' '}
                        {format(new Date(log.event_timestamp), 'PPp')}
                        {log.notes ? <span className="text-slate-500"> — {log.notes}</span> : null}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {Array.isArray(result?.results) && result.action === 'oauth_diagnose' && (
          <Card className="bg-white/5 border-white/10">
            <CardHeader>
              <CardTitle>Igloohome OAuth diagnosis</CardTitle>
              <CardDescription className="text-slate-400">
                Client id {result.credentials?.clientIdLength} chars, secret{' '}
                {result.credentials?.clientSecretLength} chars.
                Green = that exact scope list is accepted. Red on a multi-scope row usually means
                one unauthorized scope — Cognito rejects the whole request. Activity sync needs
                <code className="mx-1">get-activity-logs-bridge-proxied-job</code>
                (legacy <code className="mx-1">create-bridge-proxied-job</code> is often unused).
                Bridge Setup failing with HTTP 406 is hardware offline, not OAuth.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {Array.isArray(result.interpretation) && (
                <ul className="text-xs text-slate-400 list-disc pl-5 space-y-1 mb-3">
                  {result.interpretation.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              )}
              {result.results.map((r) => (
                <div
                  key={r.scopes}
                  className="flex items-start gap-3 bg-black/30 rounded-lg p-3"
                >
                  {r.ok
                    ? <CheckCircle2 className="h-4 w-4 text-green-400 shrink-0 mt-0.5" />
                    : <AlertTriangle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />}
                  <div className="min-w-0">
                    <p className="font-mono text-xs break-all">{r.scopes}</p>
                    {r.reason && <p className="text-xs text-red-300 mt-1">{r.reason}</p>}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {result && (
          <details className="bg-black/40 rounded-lg p-4 text-xs">
            <summary className="cursor-pointer text-slate-300">Raw response JSON</summary>
            <pre className="mt-2 overflow-auto max-h-96 text-slate-400">
              {JSON.stringify(result, null, 2)}
            </pre>
          </details>
        )}
      </div>
    </div>
  );
}
