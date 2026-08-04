import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { createFeeLookup, DEFAULT_FEES, mapFeeRowsToConfig } from '@/utils/chargesAndFeesConfig';

const DEFAULT_FEE_META = {
  late_reschedule_percentage: {
    fee_name: 'Late Reschedule Fee (%)',
    fee_description:
      'Percentage of the original booking total charged when a reschedule is requested within 24 hours of the original appointment. Scheduling may waive this fee when more than 24 hours remain.',
  },
};

export const useChargesAndFees = () => {
  const [fees, setFees] = useState(DEFAULT_FEES);
  const [feeRows, setFeeRows] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let isMounted = true;

    const loadFees = async () => {
      try {
        const { data, error: feesError } = await supabase
          .from('charges_and_fees')
          .select('fee_key, fee_value, fee_name, fee_description');

        if (feesError) throw feesError;
        if (!isMounted || !data) return;

        const mapped = mapFeeRowsToConfig(data);
        setFees((prev) => ({ ...prev, ...mapped }));

        const meta = {};
        for (const row of data) {
          if (!row?.fee_key) continue;
          meta[row.fee_key] = {
            fee_name: row.fee_name || DEFAULT_FEE_META[row.fee_key]?.fee_name || row.fee_key,
            fee_description:
              row.fee_description || DEFAULT_FEE_META[row.fee_key]?.fee_description || '',
            fee_value: Number(row.fee_value),
          };
        }
        setFeeRows(meta);
      } catch (err) {
        if (isMounted) setError(err);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    loadFees();
    return () => {
      isMounted = false;
    };
  }, []);

  const fee = useMemo(() => createFeeLookup(fees), [fees]);

  const getFeeMeta = useMemo(
    () => (key) => {
      const row = feeRows[key];
      const fallback = DEFAULT_FEE_META[key];
      return {
        fee_key: key,
        fee_name: row?.fee_name || fallback?.fee_name || key,
        fee_description: row?.fee_description || fallback?.fee_description || '',
        fee_value: row?.fee_value ?? fees[key] ?? DEFAULT_FEES[key] ?? 0,
      };
    },
    [feeRows, fees],
  );

  return { fees, loading, error, fee, getFeeMeta };
};
