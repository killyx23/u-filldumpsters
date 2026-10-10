import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import {
  createHppFeeLookup,
  DEFAULT_FEES,
  mapFeeRowsToConfig,
} from '@/utils/chargesAndFeesConfig';

export function useHppTermsFee() {
  const [fees, setFees] = useState(DEFAULT_FEES);
  const [planPrice, setPlanPrice] = useState(null);

  useEffect(() => {
    let isMounted = true;

    const load = async () => {
      const [feesResult, planResult] = await Promise.all([
        supabase.from('charges_and_fees').select('fee_key, fee_value'),
        supabase
          .from('protection_plans')
          .select('price')
          .eq('plan_type', 'rental_insurance')
          .eq('is_primary', true)
          .eq('is_active', true)
          .order('display_order', { ascending: true })
          .limit(1)
          .maybeSingle(),
      ]);

      if (!isMounted) return;
      if (!feesResult.error && feesResult.data) {
        setFees((prev) => ({ ...prev, ...mapFeeRowsToConfig(feesResult.data) }));
      }
      if (!planResult.error && planResult.data?.price != null) {
        setPlanPrice(Number(planResult.data.price));
      }
    };

    load();
    return () => {
      isMounted = false;
    };
  }, []);

  const fee = useMemo(() => createHppFeeLookup(fees, planPrice), [fees, planPrice]);
  return { fee, fees, planPrice };
}
