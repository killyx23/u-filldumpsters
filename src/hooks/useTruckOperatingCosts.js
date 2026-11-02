import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import {
  DEFAULT_OPERATING_COST_RATES,
  EMPTY_OPERATING_COST_TOTALS,
  normalizeOperatingCostRates,
  sumOperatingCosts,
} from '@/utils/operatingCost';

const LOG_PAGE = 1000;

const LOG_SELECT = `
  id,
  booking_id,
  recorded_at,
  round_trip_miles,
  customer_gps_miles,
  truck_miles_override,
  driver_minutes_override,
  landfill_haul_override,
  service_id,
  service_name,
  trip_kind,
  customers:customer_id ( travel_time_minutes ),
  bookings:booking_id ( addons, plan, assigned_inventory_items )
`;

async function fetchAllMileageLogs() {
  const logs = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('booking_mileage_logs')
      .select(LOG_SELECT)
      .order('id', { ascending: true })
      .range(from, from + LOG_PAGE - 1);
    if (error) throw error;
    const page = data || [];
    logs.push(...page);
    if (page.length < LOG_PAGE) break;
    from += LOG_PAGE;
  }
  return logs;
}

export function useTruckOperatingCosts() {
  const [rates, setRates] = useState(DEFAULT_OPERATING_COST_RATES);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [{ data: rateRow, error: rateError }, mileageLogs] = await Promise.all([
        supabase.from('operating_cost_rates').select('*').eq('id', 1).maybeSingle(),
        fetchAllMileageLogs(),
      ]);
      if (rateError) throw rateError;
      setRates(rateRow ? normalizeOperatingCostRates(rateRow) : DEFAULT_OPERATING_COST_RATES);
      setLogs(mileageLogs);
    } catch (err) {
      console.error('[useTruckOperatingCosts]', err);
      setError(err.message || 'Could not load truck operating costs');
      setLogs([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  const totals = useMemo(
    () => (logs.length ? sumOperatingCosts(logs, rates) : { ...EMPTY_OPERATING_COST_TOTALS }),
    [logs, rates],
  );

  return { rates, logs, totals, loading, error, refetch };
}
