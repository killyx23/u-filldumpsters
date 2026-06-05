import React from 'react';
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';

/**
 * Dump Fees Hook
 * Loads dump fees and delivery pricing from dump_fees and services tables
 *
 * IMPORTANT: This hook performs SELECT and UPDATE queries only.
 * INSERT operations (upsert) are allowed for dump_fees table.
 * No INSERT attempts are made to business_settings table.
 */

function isNetworkFetchError(message) {
  if (!message) return false;
  const lower = message.toLowerCase();
  return (
    lower.includes('failed to fetch') ||
    lower.includes('networkerror') ||
    lower.includes('network request failed')
  );
}

function formatDumpFeesError(error) {
  const raw = error?.message || String(error);
  if (isNetworkFetchError(raw)) {
    return (
      'Local Supabase is not reachable. Run `npx supabase start`, then `npm run supabase:sync-local-env`, and restart `npm run dev`.'
    );
  }
  if (raw.startsWith('Connection test failed:')) {
    const inner = raw.replace(/^Connection test failed:\s*/i, '');
    if (isNetworkFetchError(inner)) {
      return (
        'Local Supabase is not reachable. Run `npx supabase start`, then `npm run supabase:sync-local-env`, and restart `npm run dev`.'
      );
    }
  }
  return raw;
}

export const useDumpFees = ({ showErrorToast = false } = {}) => {
  const [dumpFees, setDumpFees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [servicesPricing, setServicesPricing] = useState({});

  const fetchDumpFees = useCallback(async () => {
    setLoading(true);
    setError(null);
    
    try {
      console.log('[Dump Fees] 🔄 Initiating fetch from Supabase');
      console.log('[Dump Fees] Supabase client status:', supabase ? '✓ Initialized' : '✗ Not initialized');
      
      // Test basic connection first
      const { data: testData, error: testError } = await supabase
        .from('dump_fees')
        .select('id')
        .limit(1);
      
      if (testError) {
        console.error('[Dump Fees] ✗ Connection test failed:', testError);
        throw new Error(`Connection test failed: ${testError.message}`);
      }
      
      console.log('[Dump Fees] ✓ Connection test successful');
      
      // Fetch dump fees with service details
      const { data, error: fetchError } = await supabase
        .from('dump_fees')
        .select('*, services(id, name, delivery_fee, mileage_rate)');
      
      if (fetchError) {
        console.error('[Dump Fees] ✗ Fetch error:', {
          message: fetchError.message,
          details: fetchError.details,
          hint: fetchError.hint,
          code: fetchError.code
        });
        throw fetchError;
      }
      
      console.log('[Dump Fees] ✓ Fetched data:', data);
      setDumpFees(data || []);

      // Build pricing map from services data
      const pricingMap = {};
      if (data) {
        data.forEach(item => {
          if (item.services) {
            pricingMap[item.services.id] = {
              delivery_fee_flat: item.services.delivery_fee !== null ? Number(item.services.delivery_fee) : 10.00,
              mileage_rate: item.services.mileage_rate !== null ? Number(item.services.mileage_rate) : 0.85
            };
          }
        });
      }
      
      setServicesPricing(pricingMap);
      console.log('[Dump Fees] ✓ Successfully loaded dump fees for', Object.keys(pricingMap).length, 'services');
      
    } catch (err) {
      const message = formatDumpFeesError(err);
      console.error('[Dump Fees] ✗ Fatal error:', message, err);
      setError(message);

      if (showErrorToast) {
        toast({
          title: 'Error loading dump fees',
          description: message,
          variant: 'destructive',
        });
      }
    } finally {
      setLoading(false);
    }
  }, [showErrorToast]);

  useEffect(() => {
    fetchDumpFees();
  }, [fetchDumpFees]);

  const updateDumpFee = async (serviceId, feePerTon, maxTons) => {
    try {
      console.log('[Dump Fees] 🔄 Updating dump fee for service:', serviceId);
      
      // UPSERT is allowed for dump_fees table (has proper RLS policies)
      const { error } = await supabase
        .from('dump_fees')
        .upsert(
          { 
            service_id: serviceId, 
            fee_per_ton: feePerTon, 
            max_tons: maxTons, 
            updated_at: new Date().toISOString() 
          },
          { onConflict: 'service_id' }
        );

      if (error) {
        console.error('[Dump Fees] ✗ Update error:', error);
        throw error;
      }
      
      toast({
        title: 'Dump fee updated',
        description: 'The dump fee has been successfully updated.',
      });
      
      await fetchDumpFees();
      console.log('[Dump Fees] ✓ Dump fee updated successfully');
      return true;
    } catch (error) {
      console.error('[Dump Fees] ✗ Error updating dump fee:', error);
      toast({
        title: 'Error updating dump fee',
        description: error.message,
        variant: 'destructive',
      });
      return false;
    }
  };

  const getFeeForService = useCallback((serviceId) => {
    return dumpFees.find(fee => fee.service_id === serviceId) || null;
  }, [dumpFees]);

  const getPricingForService = useCallback((serviceId, miles = 0) => {
    const pricing = servicesPricing[serviceId] || { delivery_fee_flat: 10.00, mileage_rate: 0.85 };
    const delivery_fee_flat = pricing.delivery_fee_flat;
    const mileage_rate = pricing.mileage_rate;
    
    const safe_delivery_fee_flat = delivery_fee_flat !== undefined && delivery_fee_flat !== null ? delivery_fee_flat : 10.00;
    const safe_mileage_rate = mileage_rate !== undefined && mileage_rate !== null ? mileage_rate : 0;
    const trip_mileage_cost = miles > 0 && safe_mileage_rate > 0 ? (miles * safe_mileage_rate) : 0;

    return {
      delivery_fee_flat: safe_delivery_fee_flat,
      mileage_rate: safe_mileage_rate,
      trip_mileage_cost: trip_mileage_cost
    };
  }, [servicesPricing]);

  return {
    dumpFees,
    loading,
    error,
    fetchDumpFees,
    updateDumpFee,
    getFeeForService,
    getPricingForService
  };
};