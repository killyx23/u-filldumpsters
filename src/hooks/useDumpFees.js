
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

export const useDumpFees = () => {
  const [dumpFees, setDumpFees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [servicesPricing, setServicesPricing] = useState({});

  const fetchDumpFees = useCallback(async () => {
    setLoading(true);
    try {
      console.log('[Dump Fees] Fetching dump fees and service pricing');
      
      // SELECT only from dump_fees and services tables
      const { data, error } = await supabase
        .from('dump_fees')
        .select('*, services(id, name, delivery_fee, mileage_rate)');
      
      if (error) throw error;
      setDumpFees(data || []);

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
      console.log('[Dump Fees] ✓ Loaded dump fees for', Object.keys(pricingMap).length, 'services');
    } catch (error) {
      console.error('[Dump Fees] Error fetching dump fees:', error);
      toast({
        title: 'Error loading dump fees',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDumpFees();
  }, [fetchDumpFees]);

  const updateDumpFee = async (serviceId, feePerTon, maxTons) => {
    try {
      console.log('[Dump Fees] Updating dump fee for service:', serviceId);
      
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

      if (error) throw error;
      
      toast({
        title: 'Dump fee updated',
        description: 'The dump fee has been successfully updated.',
      });
      await fetchDumpFees();
      console.log('[Dump Fees] ✓ Dump fee updated successfully');
      return true;
    } catch (error) {
      console.error('[Dump Fees] Error updating dump fee:', error);
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
    fetchDumpFees,
    updateDumpFee,
    getFeeForService,
    getPricingForService
  };
};
