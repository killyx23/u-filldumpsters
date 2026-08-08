import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/customSupabaseClient';

const DEFAULT_FLAGS = {
  is_taxable: true,
  delivery_fee_is_taxable: true,
  mileage_is_taxable: true,
};

/**
 * Loads per-line tax flags for the selected rental service (plan.id → services.id).
 */
export function useServiceTaxFlags(planId) {
  const [serviceTaxFlags, setServiceTaxFlags] = useState(DEFAULT_FLAGS);
  const [loading, setLoading] = useState(Boolean(planId));
  const [error, setError] = useState(null);

  const fetchFlags = useCallback(async () => {
    if (!planId) {
      setServiceTaxFlags(DEFAULT_FLAGS);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { data, error: fetchError } = await supabase
        .from('services')
        .select('is_taxable, delivery_fee_is_taxable, mileage_is_taxable')
        .eq('id', planId)
        .maybeSingle();

      if (fetchError) throw fetchError;

      if (data) {
        setServiceTaxFlags({
          is_taxable: data.is_taxable !== false,
          delivery_fee_is_taxable: data.delivery_fee_is_taxable !== false,
          mileage_is_taxable: data.mileage_is_taxable !== false,
        });
      } else {
        setServiceTaxFlags(DEFAULT_FLAGS);
      }
    } catch (err) {
      console.warn('[useServiceTaxFlags] Error loading flags:', err?.message);
      setError(err?.message);
      setServiceTaxFlags(DEFAULT_FLAGS);
    } finally {
      setLoading(false);
    }
  }, [planId]);

  useEffect(() => {
    fetchFlags();
  }, [fetchFlags]);

  return { serviceTaxFlags, loading, error, refetch: fetchFlags };
}
