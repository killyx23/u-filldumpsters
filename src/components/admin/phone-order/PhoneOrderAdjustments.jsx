import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { Input } from '@/components/ui/input';
import { money } from '@/utils/phoneOrderQuote';

export function PhoneOrderAdjustments({ compact = false }) {
  const [rows, setRows] = useState([]);
  const [agent, setAgent] = useState('');
  const [bookingId, setBookingId] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      let query = supabase.from('phone_order_adjustments').select('*').order('created_at', { ascending: false }).limit(200);
      if (agent.trim()) query = query.ilike('agent_email', `%${agent.trim()}%`);
      if (bookingId.trim()) query = query.eq('booking_id', Number(bookingId));
      if (fromDate) query = query.gte('created_at', `${fromDate}T00:00:00`);
      const { data, error: queryError } = await query;
      if (cancelled) return;
      if (queryError) setError(queryError.message);
      else setRows(data || []);
    };
    load();
    return () => { cancelled = true; };
  }, [agent, bookingId, fromDate]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-white">Phone order adjustments</h2>
        <p className="text-sm text-gray-400">
          These rows are written automatically when a signed-in admin unlocks a phone order and changes a field. The filters only search records that were already saved. They do not create agents or booking ids.
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <Input placeholder="Filter by agent email" value={agent} onChange={(e) => setAgent(e.target.value)} className="bg-white/10 border-white/30" />
        <Input placeholder="Filter by booking id" value={bookingId} onChange={(e) => setBookingId(e.target.value)} className="bg-white/10 border-white/30" />
        <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="bg-white/10 border-white/30" />
      </div>
      {error && <p className="text-sm text-red-300">{error}</p>}
      <div className="space-y-3">
        {rows.length === 0 && <p className="text-sm text-gray-400">No manual unlocks recorded yet.</p>}
        {rows.map((row) => (
          <article key={row.id} className="rounded-lg border border-white/10 bg-black/20 p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="font-medium text-white">{row.line_label}</h3>
              {String(row.line_key || '').startsWith('field.') ? null : (
                <p className="text-yellow-300">{money(row.amount_before)} → {money(row.amount_after)}</p>
              )}
            </div>
            <p className="mt-2 text-sm text-gray-300">{row.reason}</p>
            <p className="mt-2 text-xs text-gray-500">
              Approved by {row.agent_email || 'admin'} · initials {row.initials}
              {row.booking_id ? ` · booking ${row.booking_id}` : ''} · {new Date(row.created_at).toLocaleString()}
            </p>
            {!compact && row.signature_data && (
              <img src={row.signature_data} alt={`Signature of ${row.initials}`} className="mt-3 h-16 rounded bg-slate-950" />
            )}
          </article>
        ))}
      </div>
    </div>
  );
}
