import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { createFeeLookup, DEFAULT_FEES, mapFeeRowsToConfig } from '@/utils/chargesAndFeesConfig';

export const useChargesAndFees = () => {
  const [fees, setFees] = useState(DEFAULT_FEES);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let isMounted = true;

    const loadFees = async () => {
      try {
        const { data, error: feesError } = await supabase
          .from('charges_and_fees')
          .select('fee_key, fee_value');

        if (feesError) throw feesError;
        if (!isMounted || !data) return;

        const mapped = mapFeeRowsToConfig(data);
        setFees((prev) => ({ ...prev, ...mapped }));
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

  return { fees, loading, error, fee };
};
