import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { format, formatDistanceStrict, parseISO } from 'date-fns';
import { Loader2, Lock, RefreshCw, Unlock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/customSupabaseClient';

function formatEventTime(value) {
  if (!value) return '—';
  try {
    return format(parseISO(value), 'MMM d, yyyy · h:mm:ss a');
  } catch {
    try {
      return format(new Date(value), 'MMM d, yyyy · h:mm:ss a');
    } catch {
      return String(value);
    }
  }
}

function formatDuration(startIso, endIso) {
  if (!startIso || !endIso) return null;
  try {
    const start = new Date(startIso);
    const end = new Date(endIso);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
      return null;
    }
    return formatDistanceStrict(end, start);
  } catch {
    return null;
  }
}

/**
 * Pair unlock → next lock into open sessions with duration.
 * Chronological ascending input; returns sessions newest-first for display.
 */
function buildOpenSessions(eventsAsc) {
  const sessions = [];
  let openUnlock = null;

  for (const event of eventsAsc) {
    if (event.event_type === 'unlock') {
      openUnlock = event;
      continue;
    }
    if (event.event_type === 'lock' && openUnlock) {
      sessions.push({
        id: `${openUnlock.id}-${event.id}`,
        openedAt: openUnlock.event_timestamp,
        closedAt: event.event_timestamp,
        duration: formatDuration(openUnlock.event_timestamp, event.event_timestamp),
        stillOpen: false,
      });
      openUnlock = null;
    }
  }

  if (openUnlock) {
    const nowIso = new Date().toISOString();
    sessions.push({
      id: `${openUnlock.id}-open`,
      openedAt: openUnlock.event_timestamp,
      closedAt: null,
      duration: formatDuration(openUnlock.event_timestamp, nowIso),
      stillOpen: true,
    });
  }

  return sessions.reverse();
}

export const BookingLockStatusSection = ({ bookingId }) => {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [events, setEvents] = useState([]);
  const [error, setError] = useState(null);
  const [nowTick, setNowTick] = useState(() => Date.now());

  const fetchEvents = useCallback(async ({ silent = false } = {}) => {
    if (!bookingId) return;

    try {
      if (silent) setRefreshing(true);
      else setLoading(true);

      const { data, error: queryError } = await supabase
        .from('rental_tracking_logs')
        .select('id, event_type, event_timestamp, notes, created_at')
        .eq('order_id', bookingId)
        .in('event_type', ['unlock', 'lock'])
        .order('event_timestamp', { ascending: true });

      if (queryError) {
        console.error('[BookingLockStatusSection] query error:', queryError);
        setError(queryError.message || 'Unable to load lock activity');
        setEvents([]);
        return;
      }

      setError(null);
      setEvents(data || []);
    } catch (err) {
      console.error('[BookingLockStatusSection] unexpected error:', err);
      setError(err?.message || 'Unable to load lock activity');
      setEvents([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [bookingId]);

  useEffect(() => {
    fetchEvents({ silent: false });
  }, [fetchEvents]);

  useEffect(() => {
    if (!bookingId) return undefined;

    const channel = supabase
      .channel(`booking-lock-activity-${bookingId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'rental_tracking_logs',
          filter: `order_id=eq.${bookingId}`,
        },
        () => {
          fetchEvents({ silent: true });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [bookingId, fetchEvents]);

  // Keep "currently open" duration fresh while unlocked.
  useEffect(() => {
    const last = events.length ? events[events.length - 1] : null;
    if (last?.event_type !== 'unlock') return undefined;
    const id = setInterval(() => setNowTick(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [events]);

  const accessEvents = useMemo(
    () => events.filter((e) => e.event_type === 'unlock' || e.event_type === 'lock'),
    [events],
  );

  const unlockCount = useMemo(
    () => accessEvents.filter((e) => e.event_type === 'unlock').length,
    [accessEvents],
  );
  const lockCount = useMemo(
    () => accessEvents.filter((e) => e.event_type === 'lock').length,
    [accessEvents],
  );

  const sessions = useMemo(() => {
    void nowTick;
    return buildOpenSessions(accessEvents);
  }, [accessEvents, nowTick]);

  const latest = accessEvents.length ? accessEvents[accessEvents.length - 1] : null;
  const isOpen = latest?.event_type === 'unlock';
  const isClosed = latest?.event_type === 'lock';
  const currentOpenDuration =
    isOpen && latest
      ? formatDuration(latest.event_timestamp, new Date(nowTick).toISOString())
      : null;

  const statusLabel = !latest ? 'Unknown' : isOpen ? 'Open' : 'Closed';
  const statusDetail = !latest
    ? 'No unlock or lock events recorded for this rental yet.'
    : isOpen
      ? `Lock has been open since ${formatEventTime(latest.event_timestamp)}${
          currentOpenDuration ? ` (${currentOpenDuration})` : ''
        }.`
      : `Lock was closed at ${formatEventTime(latest.event_timestamp)}.`;

  if (!bookingId) return null;

  return (
    <div className="bg-black/30 p-4 rounded-lg border border-yellow-400/40 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {isOpen ? (
            <Unlock className="h-4 w-4 text-amber-300" />
          ) : (
            <Lock className="h-4 w-4 text-emerald-300" />
          )}
          <p className="text-xs uppercase tracking-widest text-yellow-400 font-semibold">
            Lock Status
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => fetchEvents({ silent: true })}
          disabled={loading || refreshing}
          className="h-8 px-2 text-gray-300 hover:text-white hover:bg-white/10"
        >
          {refreshing || loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          <span className="ml-1.5 text-xs">Refresh</span>
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-gray-300">
          <Loader2 className="h-4 w-4 animate-spin text-yellow-400" />
          Loading lock activity…
        </div>
      ) : error ? (
        <p className="text-sm text-red-300">{error}</p>
      ) : (
        <>
          <div
            className={`rounded-lg border px-3 py-3 ${
              isOpen
                ? 'border-amber-400/40 bg-amber-500/10'
                : isClosed
                  ? 'border-emerald-400/40 bg-emerald-500/10'
                  : 'border-white/10 bg-slate-950/60'
            }`}
          >
            <p className="text-lg font-semibold text-white">
              Currently:{' '}
              <span className={isOpen ? 'text-amber-300' : isClosed ? 'text-emerald-300' : 'text-gray-300'}>
                {statusLabel}
              </span>
            </p>
            <p className="text-sm text-gray-300 mt-1 leading-relaxed">{statusDetail}</p>
          </div>

          <div className="grid grid-cols-2 gap-2 text-center">
            <div className="rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2">
              <p className="text-xs uppercase tracking-wide text-gray-400">Opened</p>
              <p className="text-2xl font-bold text-white tabular-nums">{unlockCount}</p>
            </div>
            <div className="rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2">
              <p className="text-xs uppercase tracking-wide text-gray-400">Closed</p>
              <p className="text-2xl font-bold text-white tabular-nums">{lockCount}</p>
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-xs uppercase tracking-widest text-yellow-400/90 font-semibold">
              Activity timeline
            </p>
            {accessEvents.length === 0 ? (
              <p className="text-sm text-gray-400">
                Unlock and lock times will appear here as soon as the padlock reports activity.
              </p>
            ) : (
              <ul className="space-y-2 max-h-64 overflow-y-auto pr-1">
                {[...accessEvents].reverse().map((event) => {
                  const opened = event.event_type === 'unlock';
                  return (
                    <li
                      key={event.id}
                      className="flex items-start gap-3 rounded-md border border-white/10 bg-slate-950/50 px-3 py-2"
                    >
                      <span
                        className={`mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
                          opened
                            ? 'bg-amber-500/20 text-amber-300'
                            : 'bg-emerald-500/20 text-emerald-300'
                        }`}
                      >
                        {opened ? <Unlock className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-white">
                          {opened ? 'Opened (unlocked)' : 'Closed (locked)'}
                        </p>
                        <p className="text-xs text-yellow-400/90 mt-0.5">
                          {formatEventTime(event.event_timestamp)}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {sessions.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-widest text-yellow-400/90 font-semibold">
                Open durations
              </p>
              <ul className="space-y-2">
                {sessions.map((session) => (
                  <li
                    key={session.id}
                    className="rounded-md border border-white/10 bg-slate-950/50 px-3 py-2 text-sm text-gray-300"
                  >
                    <p>
                      <span className="text-white font-medium">
                        {session.stillOpen ? 'Currently open' : 'Was open'}
                      </span>
                      {session.duration ? (
                        <>
                          {' '}
                          for <span className="text-yellow-400 font-medium">{session.duration}</span>
                        </>
                      ) : null}
                    </p>
                    <p className="text-xs text-gray-400 mt-1">
                      {formatEventTime(session.openedAt)}
                      {' → '}
                      {session.stillOpen ? 'now' : formatEventTime(session.closedAt)}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default BookingLockStatusSection;
