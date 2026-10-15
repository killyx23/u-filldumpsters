import { useEffect, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { Key } from 'lucide-react';
import { supabase } from '@/lib/customSupabaseClient';

function formatWhen(value) {
    if (!value) return '';
    try {
        return format(parseISO(value), 'MMM d, h:mm a');
    } catch {
        return '';
    }
}

/**
 * Turn access-code rows for one order into the status the admin should see.
 * Rows should be newest first. An expired unconfirmed custom PIN is kept so
 * an AlgoPIN fallback still shows that the lock never confirmed the custom PIN.
 */
export function summarizeLockPins(rows) {
    const list = Array.isArray(rows) ? rows : [];
    const active = list.filter((row) => row.status === 'active' || row.status == null);
    const customConfirmed = active.find((row) => row.pin_type === 'bridge_proxied' && row.lock_confirmed_at);
    const customPending = active.find((row) => row.pin_type === 'bridge_proxied' && !row.lock_confirmed_at);
    const algos = active.filter((row) => row.pin_type === 'algopin');
    const algo = algos[0] || null;
    const expiredUnconfirmedCustom = list.find(
        (row) => row.pin_type === 'bridge_proxied' && !row.lock_confirmed_at && row.status !== 'active',
    );

    if (customConfirmed) {
        return { kind: 'custom_confirmed', custom: customConfirmed, algo: algo || null, algos };
    }
    if (customPending && algo) {
        return { kind: 'custom_pending_with_algo', custom: customPending, algo, algos };
    }
    if (algo) {
        return { kind: 'algo', custom: expiredUnconfirmedCustom || null, algo, algos };
    }
    if (customPending) {
        return { kind: 'custom_pending', custom: customPending, algo: null, algos };
    }
    return { kind: 'none', custom: null, algo: null, algos };
}

function PinLine({ pin }) {
    return <span className="font-mono tracking-widest text-white">{pin || '—'}</span>;
}

function needsActivation(pin) {
    if (!pin?.start_time || !pin?.end_time) return false;
    const hours = (new Date(pin.end_time).getTime() - new Date(pin.start_time).getTime()) / (60 * 60 * 1000);
    return hours > 24;
}

function AlgoLines({ algos }) {
    if (!algos?.length) return null;
    return algos.map((algo) => (
        <div key={algo.id || `${algo.access_pin}-${algo.start_time}`}>
            <p className="text-white">
                <PinLine pin={algo.access_pin} />
                <span className="text-violet-200"> · AlgoPIN</span>
            </p>
            <p className="text-violet-200">
                {formatWhen(algo.start_time) || 'Start'} – {formatWhen(algo.end_time) || 'End'}
            </p>
            {needsActivation(algo) && (
                <p className="text-amber-200">Enter once to activate</p>
            )}
        </div>
    ));
}

function StatusBody({ summary }) {
    if (summary.kind === 'custom_confirmed') {
        const when = formatWhen(summary.custom.lock_confirmed_at);
        return (
            <>
                <p className="text-white">
                    <PinLine pin={summary.custom.access_pin} />
                    <span className="text-gray-300"> · Custom PIN</span>
                </p>
                <p className="text-emerald-300">
                    Confirmed on the lock{when ? ` · ${when}` : ''}
                    {summary.custom.programmed_end_time || summary.custom.end_time
                        ? ` · lock accepts this code until ${formatWhen(summary.custom.programmed_end_time || summary.custom.end_time)}`
                        : ''}
                </p>
                <AlgoLines algos={summary.algos} />
            </>
        );
    }

    if (summary.kind === 'custom_pending_with_algo') {
        const sent = Boolean(summary.algo.notified_at);
        return (
            <>
                <p className="text-white">
                    <PinLine pin={summary.custom.access_pin} />
                    <span className="text-gray-300"> · Custom PIN</span>
                </p>
                <p className="text-amber-300">Waiting for lock confirmation</p>
                <AlgoLines algos={summary.algos || [summary.algo]} />
                <p className="text-violet-200">
                    {sent ? 'Customer was given this AlgoPIN' : 'AlgoPIN issued; customer send not recorded'}
                </p>
            </>
        );
    }

    if (summary.kind === 'algo') {
        const sent = Boolean(summary.algo.notified_at);
        return (
            <>
                {summary.custom && (
                    <p className="text-amber-300">Custom PIN was not confirmed. Customer has the AlgoPIN below.</p>
                )}
                <AlgoLines algos={summary.algos || [summary.algo]} />
                <p className="text-violet-200">
                    {sent
                        ? 'Customer was given this AlgoPIN'
                        : 'AlgoPIN issued; customer send not recorded'}
                </p>
            </>
        );
    }

    if (summary.kind === 'custom_pending') {
        const sent = Boolean(summary.custom.notified_at);
        return (
            <>
                <p className="text-white">
                    <PinLine pin={summary.custom.access_pin} />
                    <span className="text-gray-300"> · Custom PIN</span>
                </p>
                <p className="text-amber-300">Waiting for lock confirmation</p>
                <p className="text-amber-200/90">
                    {sent ? 'Customer was sent this PIN' : 'Customer has not been sent a PIN yet'}
                </p>
            </>
        );
    }

    return <p className="text-gray-300">No PIN yet</p>;
}

export function LockPinStatus({ codes, loading = false }) {
    const summary = summarizeLockPins(codes);

    return (
        <div className="flex gap-2 rounded-lg bg-black/20 px-3 py-2">
            <span className="mt-0.5 text-yellow-400">
                <Key className="h-4 w-4" />
            </span>
            <div className="min-w-0 text-sm">
                <p className="text-[11px] uppercase tracking-wide text-gray-400">Lock status</p>
                {loading ? (
                    <p className="text-gray-300">Checking lock…</p>
                ) : (
                    <StatusBody summary={summary} />
                )}
            </div>
        </div>
    );
}

export function useLockPinsByOrder(orderIds) {
    const key = [...new Set((orderIds || []).filter((id) => id != null).map(String))].sort().join(',');
    const [byOrder, setByOrder] = useState({});
    const [loading, setLoading] = useState(() => Boolean(key));

    useEffect(() => {
        if (!key) {
            setByOrder({});
            setLoading(false);
            return undefined;
        }

        let cancelled = false;
        setLoading(true);
        const ids = key.split(',');

        supabase
            .from('rental_access_codes')
            .select('id, order_id, access_pin, pin_type, lock_confirmed_at, notified_at, created_at, status, start_time, end_time, programmed_end_time')
            .in('order_id', ids)
            .order('created_at', { ascending: false })
            .then(({ data, error }) => {
                if (cancelled) return;
                if (error) {
                    console.error('[LockPinStatus] access code query failed:', error);
                    setByOrder({});
                    setLoading(false);
                    return;
                }
                const map = {};
                for (const row of data || []) {
                    const id = String(row.order_id);
                    if (!map[id]) map[id] = [];
                    map[id].push(row);
                }
                setByOrder(map);
                setLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [key]);

    return { byOrder, loading };
}
