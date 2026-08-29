import React, { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';
import { Loader2, RefreshCw, MailWarning, ChevronDown, ChevronUp, Tag } from 'lucide-react';
import { formatCustomerFacingPlanName } from '@/utils/displayPlanName';

const STATUS_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'reminded', label: 'Reminded' },
  { value: 'expired', label: 'Expired' },
  { value: 'left_early', label: 'Left early' },
  { value: 'open', label: 'Open' },
  { value: 'converted', label: 'Converted' },
  { value: 'unsubscribed', label: 'Unsubscribed' },
];

const statusBadgeClass = (status) => {
  switch (status) {
    case 'reminded':
      return 'bg-blue-500/20 text-blue-300';
    case 'expired':
      return 'bg-orange-500/20 text-orange-300';
    case 'left_early':
      return 'bg-purple-500/20 text-purple-300';
    case 'converted':
      return 'bg-green-500/20 text-green-300';
    case 'unsubscribed':
      return 'bg-gray-500/20 text-gray-300';
    default:
      return 'bg-yellow-500/20 text-yellow-300';
  }
};

const money = (amount) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(amount || 0));

export const AbandonedCheckoutsManager = () => {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [expandedId, setExpandedId] = useState(null);
  const [savingId, setSavingId] = useState(null);
  const [draftNotes, setDraftNotes] = useState({});
  const [draftTags, setDraftTags] = useState({});

  const fetchRows = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('abandoned_checkouts')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500);
      if (error) throw error;
      setRows(data || []);
    } catch (err) {
      console.error('[AbandonedCheckoutsManager] fetch error:', err);
      toast({
        title: 'Could not load incomplete orders',
        description: err.message || 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRows();
  }, []);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (statusFilter !== 'all' && row.status !== statusFilter) return false;
      if (!needle) return true;
      const haystack = [
        row.full_name,
        row.email,
        row.phone,
        row.service_name,
        row.status,
        String(row.status || '').replace(/_/g, ' '),
        row.source,
        String(row.source || '').replace(/_/g, ' '),
        row.booking_id != null ? String(row.booking_id) : '',
        ...(Array.isArray(row.tags) ? row.tags : []),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [rows, query, statusFilter]);

  const openExpanded = (row) => {
    const next = expandedId === row.id ? null : row.id;
    setExpandedId(next);
    if (next) {
      setDraftNotes((prev) => ({ ...prev, [row.id]: row.notes || '' }));
      setDraftTags((prev) => ({
        ...prev,
        [row.id]: Array.isArray(row.tags) ? row.tags.join(', ') : '',
      }));
    }
  };

  const saveLead = async (row, patch = {}) => {
    setSavingId(row.id);
    try {
      const tagsRaw = draftTags[row.id];
      const tags =
        tagsRaw === undefined
          ? row.tags
          : String(tagsRaw)
              .split(',')
              .map((t) => t.trim())
              .filter(Boolean);

      const payload = {
        notes: draftNotes[row.id] !== undefined ? draftNotes[row.id] : row.notes,
        tags,
        ...patch,
      };

      const { error } = await supabase
        .from('abandoned_checkouts')
        .update(payload)
        .eq('id', row.id);
      if (error) throw error;

      setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, ...payload } : r)));
      toast({ title: 'Lead updated', description: `${row.email} saved.` });
    } catch (err) {
      toast({
        title: 'Update failed',
        description: err.message || 'Could not save lead.',
        variant: 'destructive',
      });
    } finally {
      setSavingId(null);
    }
  };

  const equipmentSummary = (row) => {
    const equipment = row.addons?.equipment;
    if (!Array.isArray(equipment) || equipment.length === 0) return 'None';
    return equipment
      .map((item) => `${item.name || item.label || item.id || 'Item'}×${item.quantity || 1}`)
      .join(', ');
  };

  return (
    <div className="space-y-6">
      <Card className="bg-gray-800/50 border-gray-700">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <MailWarning className="h-5 w-5 text-orange-400" />
            Did Not Finalize
          </CardTitle>
          <CardDescription className="text-gray-400">
            Customers who reached payment but did not complete checkout across all services.
            Statuses: <strong className="text-purple-300">Left early</strong> (clicked Leave
            booking), <strong className="text-blue-300">Reminded</strong> (~1h unpaid),{' '}
            <strong className="text-orange-300">Expired</strong> (~2h timeout). Filter by status
            or search service tags like dump-trailer / dumpster.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col lg:flex-row gap-2">
            <Input
              placeholder="Search name, email, phone, service, booking #..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="text-white"
            />
            <div className="flex flex-wrap gap-2">
              {STATUS_FILTERS.map((f) => (
                <Button
                  key={f.value}
                  size="sm"
                  variant={statusFilter === f.value ? 'default' : 'outline'}
                  className={statusFilter === f.value ? 'bg-yellow-500 text-black hover:bg-yellow-400' : ''}
                  onClick={() => setStatusFilter(f.value)}
                >
                  {f.label}
                </Button>
              ))}
              <Button variant="outline" onClick={fetchRows} disabled={loading} className="shrink-0">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              </Button>
            </div>
          </div>

          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-10 w-10 animate-spin text-yellow-400" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-center text-gray-400 py-10">No incomplete-order leads yet.</p>
          ) : (
            <div className="space-y-3 max-h-[640px] overflow-y-auto pr-1">
              {filtered.map((row) => {
                const expanded = expandedId === row.id;
                const serviceLabel = formatCustomerFacingPlanName(row.service_name || row.plan?.name || 'Service');
                return (
                  <div key={row.id} className="bg-gray-900/50 border border-gray-700 rounded-lg p-4">
                    <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
                      <div className="space-y-1 min-w-0">
                        <p className="text-white font-semibold truncate">
                          {row.full_name || 'Unknown name'}{' '}
                          <span className="text-gray-400 font-normal">· {row.email}</span>
                        </p>
                        <p className="text-sm text-blue-200">{serviceLabel}</p>
                        <p className="text-xs text-gray-400">
                          {row.drop_off_date || '—'} → {row.pickup_date || '—'}
                          {row.booking_id != null ? ` · Booking #${row.booking_id}` : ''}
                          {row.phone ? ` · ${row.phone}` : ''}
                        </p>
                        <p className="text-sm text-white font-medium">{money(row.total_price)}</p>
                        <div className="flex flex-wrap gap-1.5 pt-0.5">
                          {Array.isArray(row.tags) &&
                            row.tags.map((tag) => (
                              <span
                                key={tag}
                                className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-slate-700/80 text-slate-200"
                              >
                                {tag}
                              </span>
                            ))}
                        </div>
                        <p className="text-xs text-gray-500">
                          Created {row.created_at ? new Date(row.created_at).toLocaleString() : '—'}
                          {row.reminder_sent_at
                            ? ` · Reminded ${new Date(row.reminder_sent_at).toLocaleString()}`
                            : ''}
                          {row.expired_at
                            ? ` · Expired ${new Date(row.expired_at).toLocaleString()}`
                            : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={`text-xs font-bold px-2 py-1 rounded-full capitalize ${statusBadgeClass(row.status)}`}>
                          {String(row.status || 'open').replace(/_/g, ' ')}
                        </span>
                        <span className="text-[10px] uppercase tracking-wide text-gray-500 border border-gray-600 px-1.5 py-0.5 rounded">
                          {String(row.source || 'pending_payment').replace(/_/g, ' ')}
                        </span>
                        <Button size="sm" variant="outline" onClick={() => openExpanded(row)}>
                          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </Button>
                      </div>
                    </div>

                    {expanded && (
                      <div className="mt-4 border-t border-white/10 pt-4 space-y-4">
                        <div className="grid md:grid-cols-2 gap-3 text-sm text-gray-200">
                          <div className="bg-black/20 rounded-md p-3">
                            <p className="text-yellow-300 font-semibold mb-1">Cart snapshot</p>
                            <p><span className="text-gray-400">Service:</span> {serviceLabel}</p>
                            <p><span className="text-gray-400">Equipment:</span> {equipmentSummary(row)}</p>
                            <p>
                              <span className="text-gray-400">Insurance:</span>{' '}
                              {row.addons?.insurance === 'accept' ? 'Accepted' : 'Declined / n/a'}
                            </p>
                            <p>
                              <span className="text-gray-400">Driveway:</span>{' '}
                              {row.addons?.drivewayProtection === 'accept' ? 'Accepted' : 'Declined / n/a'}
                            </p>
                            <p className="text-xs text-gray-500 mt-2">
                              Source: {row.source} · Marketing eligible:{' '}
                              {row.marketing_eligible ? 'Yes' : 'No'}
                            </p>
                          </div>
                          <div className="bg-black/20 rounded-md p-3 space-y-2">
                            <label className="text-yellow-300 font-semibold block">Admin notes</label>
                            <Textarea
                              value={draftNotes[row.id] ?? row.notes ?? ''}
                              onChange={(e) =>
                                setDraftNotes((prev) => ({ ...prev, [row.id]: e.target.value }))
                              }
                              className="min-h-[88px]"
                              placeholder="Call notes, coupon ideas, follow-up reminders..."
                            />
                            <label className="text-yellow-300 font-semibold flex items-center gap-1">
                              <Tag className="h-3.5 w-3.5" /> Tags (comma-separated)
                            </label>
                            <Input
                              value={draftTags[row.id] ?? (Array.isArray(row.tags) ? row.tags.join(', ') : '')}
                              onChange={(e) =>
                                setDraftTags((prev) => ({ ...prev, [row.id]: e.target.value }))
                              }
                              placeholder="dump-trailer, high-intent, coupon-candidate"
                              className="text-white"
                            />
                            <div className="flex flex-wrap gap-2 pt-1">
                              <Button
                                size="sm"
                                disabled={savingId === row.id}
                                onClick={() => saveLead(row)}
                              >
                                {savingId === row.id ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  'Save notes'
                                )}
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={savingId === row.id || row.status === 'converted'}
                                onClick={() => saveLead(row, { status: 'converted' })}
                              >
                                Mark converted
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={savingId === row.id || row.status === 'unsubscribed'}
                                onClick={() =>
                                  saveLead(row, { status: 'unsubscribed', marketing_eligible: false })
                                }
                              >
                                Unsubscribe
                              </Button>
                            </div>
                          </div>
                        </div>

                        <div className="rounded-md border border-dashed border-yellow-500/30 bg-yellow-500/5 p-3">
                          <p className="text-yellow-300 font-semibold text-sm">Future campaigns</p>
                          <p className="text-xs text-yellow-100/80 mt-1 leading-relaxed">
                            This lead store is ready for upcoming coupon and win-back email tools.
                            Cart snapshots (service, dates, add-ons, total) are preserved so offers
                            can be personalized by what they almost booked.
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
