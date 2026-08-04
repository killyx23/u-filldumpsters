import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';
import { Gauge, Loader2, RefreshCw } from 'lucide-react';
import { format, parseISO, subDays } from 'date-fns';

const SOURCE_LABELS = {
  booking_create: 'Booking create',
  reschedule_address: 'Address reschedule',
  backfill: 'Backfill',
  booking_complete: 'Booking complete',
};

export const MileageServiceTrackingModule = () => {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [serviceFilter, setServiceFilter] = useState('all');
  const [startDate, setStartDate] = useState(format(subDays(new Date(), 90), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState(format(new Date(), 'yyyy-MM-dd'));

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('booking_mileage_logs')
        .select(`
          id,
          booking_id,
          customer_id,
          service_id,
          service_name,
          service_type,
          one_way_miles,
          round_trip_miles,
          trip_kind,
          source,
          recorded_at,
          updated_at,
          customers:customer_id ( name, email ),
          bookings:booking_id ( id, status, drop_off_date )
        `)
        .order('recorded_at', { ascending: false })
        .limit(500);

      if (startDate) {
        query = query.gte('recorded_at', `${startDate}T00:00:00`);
      }
      if (endDate) {
        query = query.lte('recorded_at', `${endDate}T23:59:59`);
      }

      const { data, error } = await query;
      if (error) throw error;
      setLogs(data || []);
    } catch (err) {
      console.error('[MileageServiceTracking]', err);
      toast({
        title: 'Could not load mileage logs',
        description: err.message,
        variant: 'destructive',
      });
      setLogs([]);
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const serviceOptions = useMemo(() => {
    const names = new Set();
    logs.forEach((row) => {
      if (row.service_name) names.add(row.service_name);
    });
    return Array.from(names).sort();
  }, [logs]);

  const filtered = useMemo(() => {
    if (serviceFilter === 'all') return logs;
    return logs.filter((row) => row.service_name === serviceFilter);
  }, [logs, serviceFilter]);

  const totalsByService = useMemo(() => {
    const map = new Map();
    filtered.forEach((row) => {
      const key = row.service_name || 'Unknown Service';
      const prev = map.get(key) || { oneWay: 0, roundTrip: 0, count: 0 };
      prev.oneWay += Number(row.one_way_miles) || 0;
      prev.roundTrip += Number(row.round_trip_miles) || 0;
      prev.count += 1;
      map.set(key, prev);
    });
    return Array.from(map.entries())
      .map(([name, stats]) => ({ name, ...stats }))
      .sort((a, b) => b.roundTrip - a.roundTrip);
  }, [filtered]);

  const grandRoundTrip = totalsByService.reduce((sum, row) => sum + row.roundTrip, 0);
  const grandOneWay = totalsByService.reduce((sum, row) => sum + row.oneWay, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <Gauge className="h-6 w-6 text-blue-300" />
            Mileage &amp; Service Tracking
          </h2>
          <p className="text-gray-400 text-sm mt-1">
            One-way business↔customer miles from Google. Round-trip miles (×2) are logged for delivery/pickup trips by service type.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={fetchLogs}
          disabled={loading}
          className="border-gray-600 text-white"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
          Refresh
        </Button>
      </div>

      <Card className="bg-gray-800/50 border-gray-700">
        <CardContent className="pt-6 grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <Label className="text-gray-300">Start date</Label>
            <Input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="bg-gray-900 border-gray-700 text-white"
            />
          </div>
          <div>
            <Label className="text-gray-300">End date</Label>
            <Input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="bg-gray-900 border-gray-700 text-white"
            />
          </div>
          <div>
            <Label className="text-gray-300">Service type</Label>
            <Select value={serviceFilter} onValueChange={setServiceFilter}>
              <SelectTrigger className="bg-gray-900 border-gray-700 text-white">
                <SelectValue placeholder="All services" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All services</SelectItem>
                {serviceOptions.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col justify-end text-sm text-gray-300">
            <p>
              Trips: <span className="text-white font-semibold">{filtered.length}</span>
            </p>
            <p>
              Round-trip total:{' '}
              <span className="text-yellow-300 font-semibold">{grandRoundTrip.toFixed(1)} mi</span>
            </p>
            <p>
              One-way total:{' '}
              <span className="text-white font-semibold">{grandOneWay.toFixed(1)} mi</span>
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {totalsByService.map((row) => (
          <Card key={row.name} className="bg-gray-800/40 border-gray-700">
            <CardHeader className="pb-2">
              <CardTitle className="text-white text-base">{row.name}</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-gray-300 space-y-1">
              <p>{row.count} trip{row.count === 1 ? '' : 's'}</p>
              <p>
                Round-trip:{' '}
                <span className="text-yellow-300 font-semibold">{row.roundTrip.toFixed(1)} mi</span>
              </p>
              <p>
                One-way: <span className="text-white font-semibold">{row.oneWay.toFixed(1)} mi</span>
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="bg-gray-800/50 border-gray-700">
        <CardHeader>
          <CardTitle className="text-white">Trip log</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-blue-300" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-center text-gray-400 py-10">
              No mileage logs in this range. New delivery bookings and approved address reschedules will appear here.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs uppercase text-gray-400 border-b border-gray-700">
                  <tr>
                    <th className="py-3 pr-3">Date</th>
                    <th className="py-3 pr-3">Booking</th>
                    <th className="py-3 pr-3">Customer</th>
                    <th className="py-3 pr-3">Service</th>
                    <th className="py-3 pr-3 text-right">One-way</th>
                    <th className="py-3 pr-3 text-right">Round-trip</th>
                    <th className="py-3">Source</th>
                  </tr>
                </thead>
                <tbody className="text-gray-200">
                  {filtered.map((row) => (
                    <tr key={row.id} className="border-b border-gray-800/80">
                      <td className="py-3 pr-3 whitespace-nowrap">
                        {row.recorded_at ? format(parseISO(row.recorded_at), 'MMM d, yyyy') : '—'}
                      </td>
                      <td className="py-3 pr-3">#{row.booking_id}</td>
                      <td className="py-3 pr-3">
                        {row.customers?.name || '—'}
                        {row.customers?.email ? (
                          <span className="block text-xs text-gray-500">{row.customers.email}</span>
                        ) : null}
                      </td>
                      <td className="py-3 pr-3">
                        <span className="font-medium text-white">{row.service_name || '—'}</span>
                        {row.service_type ? (
                          <span className="block text-xs text-gray-500">{row.service_type}</span>
                        ) : null}
                      </td>
                      <td className="py-3 pr-3 text-right">{Number(row.one_way_miles || 0).toFixed(1)} mi</td>
                      <td className="py-3 pr-3 text-right text-yellow-300 font-semibold">
                        {Number(row.round_trip_miles || 0).toFixed(1)} mi
                      </td>
                      <td className="py-3">{SOURCE_LABELS[row.source] || row.source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
