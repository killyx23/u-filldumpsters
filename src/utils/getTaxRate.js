import { useState, useEffect } from 'react';
import { supabase } from '@/lib/customSupabaseClient';

// Cache for tax rates to avoid repeated database calls
let taxRateCache = null;
let cacheTimestamp = null;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

/**
 * Fetches full tax configuration from business_settings (row id=1).
 * Includes separate pickup and delivery rates added in migration B.
 *
 * @returns {Promise<Object>} Tax configuration object
 */
export async function getTaxRates() {
  const now = Date.now();
  if (taxRateCache && cacheTimestamp && (now - cacheTimestamp) < CACHE_DURATION) {
    return taxRateCache;
  }

  try {
    const { data, error } = await supabase
      .from('business_settings')
      .select('tax_rate, tax_rate_pickup, tax_rate_delivery, tax_state, tax_county, tax_city, tax_effective_date')
      .eq('id', 1)
      .single();

    if (error) {
      console.error('[getTaxRates] Error fetching tax configuration:', error);
      return getDefaultRates();
    }

    taxRateCache = {
      tax_rate:          data.tax_rate          ?? 7.45,
      tax_rate_pickup:   data.tax_rate_pickup   ?? data.tax_rate ?? 7.45,
      tax_rate_delivery: data.tax_rate_delivery ?? data.tax_rate ?? 7.45,
      tax_state:         data.tax_state         ?? 4.85,
      tax_county:        data.tax_county        ?? 2.0,
      tax_city:          data.tax_city          ?? 0.6,
      tax_effective_date: data.tax_effective_date ?? '2026-04-23',
    };
    cacheTimestamp = now;

    return taxRateCache;
  } catch (error) {
    console.error('[getTaxRates] Exception fetching tax configuration:', error);
    return getDefaultRates();
  }
}

/**
 * Determines the correct tax rate for a transaction based on delivery type.
 *
 * Utah uses destination-based sourcing:
 *   - 'delivery' → rate at customer's delivery ZIP (or stored delivery fallback)
 *   - 'self_service_trailer' | 'self_pickup' → rate at business location (Saratoga Springs)
 *
 * When TAX_API_ENABLED env var is set and deliveryType is 'delivery', this function
 * will delegate to the lookup-tax-rate edge function (TaxJar integration) which
 * caches results by ZIP. Falls back to business_settings on any error.
 *
 * @param {'delivery'|'self_service_trailer'|'self_pickup'} deliveryType
 * @param {string|null} deliveryZip - Customer ZIP code for destination-based lookup
 * @returns {Promise<number>} Applicable tax rate as a percentage (e.g., 7.45)
 */
export async function getApplicableTaxRate(deliveryType, deliveryZip = null) {
  const isDelivery = deliveryType === 'delivery';

  // Attempt real-time ZIP-based lookup for delivery transactions when configured
  if (isDelivery && deliveryZip && import.meta.env.VITE_TAX_API_ENABLED === 'true') {
    try {
      const { data, error } = await supabase.functions.invoke('lookup-tax-rate', {
        body: { zip_code: deliveryZip, delivery_type: deliveryType },
      });
      if (!error && data?.rate != null) {
        return data.rate;
      }
      console.warn('[getApplicableTaxRate] Tax API lookup failed, falling back to DB rate', error);
    } catch (err) {
      console.warn('[getApplicableTaxRate] Tax API exception, falling back to DB rate', err);
    }
  }

  const rates = await getTaxRates();
  return isDelivery ? rates.tax_rate_delivery : rates.tax_rate_pickup;
}

/**
 * Invalidates the tax rate cache (call after updating tax configuration in admin).
 */
export function invalidateTaxRateCache() {
  taxRateCache = null;
  cacheTimestamp = null;
}

/**
 * Gets the effective combined tax rate as a percentage.
 * Kept for backward-compatibility. Prefer getApplicableTaxRate() for new code.
 * @returns {Promise<number>}
 */
export async function getTaxRate() {
  const rates = await getTaxRates();
  return rates;
}

/**
 * Gets the effective tax rate as a decimal percentage.
 * @deprecated Use getApplicableTaxRate(deliveryType) instead.
 * @returns {Promise<number>}
 */
export async function getEffectiveTaxRate() {
  const rates = await getTaxRates();
  return rates.tax_rate;
}

// ─── React hook ──────────────────────────────────────────────────────────────

/**
 * React hook that fetches and caches both pickup and delivery tax rates.
 *
 * @param {'delivery'|'self_service_trailer'|'self_pickup'} [deliveryType]
 *   When provided, `taxRate` will be the correct rate for that transaction type.
 *   When omitted, `taxRate` falls back to the combined `tax_rate` field (backward-compat).
 * @param {string|null} [deliveryZip] ZIP code used for TaxJar lookup on delivery transactions.
 * @returns {{ taxRate: number, taxRates: Object, loading: boolean, error: string|null }}
 */
export function useTaxRate(deliveryType = null, deliveryZip = null) {
  const [taxRates, setTaxRates] = useState({
    tax_rate: 7.45,
    tax_rate_pickup: 7.45,
    tax_rate_delivery: 7.45,
  });
  const [taxRate, setTaxRate] = useState(7.45);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let isMounted = true;

    const fetchRates = async () => {
      try {
        setLoading(true);
        const rates = await getTaxRates();

        if (!isMounted) return;
        setTaxRates(rates);

        // If caller provided a delivery type, resolve the correct rate for it.
        if (deliveryType) {
          const applicable = await getApplicableTaxRate(deliveryType, deliveryZip);
          if (isMounted) setTaxRate(applicable);
        } else {
          // Backward-compatible: return the combined rate
          if (isMounted) setTaxRate(rates.tax_rate);
        }

        setError(null);
      } catch (err) {
        console.error('[useTaxRate] Error loading tax rate:', err);
        if (isMounted) {
          setError(err.message);
          setTaxRate(7.45);
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    fetchRates();
    return () => { isMounted = false; };
  }, [deliveryType, deliveryZip]);

  return { taxRate, taxRates, loading, error };
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function getDefaultRates() {
  return {
    tax_rate:           7.45,
    tax_rate_pickup:    7.45,
    tax_rate_delivery:  7.45,
    tax_state:          4.85,
    tax_county:         2.0,
    tax_city:           0.6,
    tax_effective_date: '2026-04-23',
  };
}
