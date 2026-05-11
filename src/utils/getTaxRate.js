import { useState, useEffect } from 'react';
import { supabase } from '@/lib/customSupabaseClient';

// Cache for tax rate to avoid repeated database calls
let taxRateCache = null;
let cacheTimestamp = null;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes in milliseconds

/**
 * Fetches tax configuration from the database
 * @returns {Promise<Object>} Tax configuration object
 */
export async function getTaxRate() {
  // Return cached data if still valid
  const now = Date.now();
  if (taxRateCache && cacheTimestamp && (now - cacheTimestamp) < CACHE_DURATION) {
    return taxRateCache;
  }

  try {
    const { data, error } = await supabase
      .from('business_settings')
      .select('tax_rate, tax_state, tax_county, tax_city, tax_effective_date')
      .eq('id', 1)
      .single();

    if (error) {
      console.error('[getTaxRate] Error fetching tax configuration:', error);
      // Return default Saratoga Springs, Utah rates as fallback
      return {
        tax_rate: 7.45,
        tax_state: 4.85,
        tax_county: 2.0,
        tax_city: 0.6,
        tax_effective_date: '2026-04-23'
      };
    }

    // Cache the result
    taxRateCache = {
      tax_rate: data.tax_rate || 7.45,
      tax_state: data.tax_state || 4.85,
      tax_county: data.tax_county || 2.0,
      tax_city: data.tax_city || 0.6,
      tax_effective_date: data.tax_effective_date || '2026-04-23'
    };
    cacheTimestamp = now;

    return taxRateCache;
  } catch (error) {
    console.error('[getTaxRate] Exception fetching tax configuration:', error);
    // Return default rates as fallback
    return {
      tax_rate: 7.45,
      tax_state: 4.85,
      tax_county: 2.0,
      tax_city: 0.6,
      tax_effective_date: '2026-04-23'
    };
  }
}

/**
 * Invalidates the tax rate cache (call after updating tax configuration)
 */
export function invalidateTaxRateCache() {
  taxRateCache = null;
  cacheTimestamp = null;
}

/**
 * Gets the effective tax rate as a decimal (e.g., 7.45 for 7.45%)
 * @returns {Promise<number>} Tax rate as percentage
 */
export async function getEffectiveTaxRate() {
  const config = await getTaxRate();
  return config.tax_rate;
}

/**
 * React hook to fetch and cache tax rate
 * @returns {Object} { taxRate, loading, error }
 */
export function useTaxRate() {
  const [taxRate, setTaxRate] = useState(7.45); // Default fallback
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let isMounted = true;

    const fetchTaxRate = async () => {
      try {
        setLoading(true);
        const config = await getTaxRate();
        
        if (isMounted) {
          setTaxRate(config.tax_rate);
          setError(null);
        }
      } catch (err) {
        console.error('[useTaxRate] Error loading tax rate:', err);
        if (isMounted) {
          setError(err.message);
          setTaxRate(7.45); // Fallback to default
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    fetchTaxRate();

    return () => {
      isMounted = false;
    };
  }, []);

  return { taxRate, loading, error };
}