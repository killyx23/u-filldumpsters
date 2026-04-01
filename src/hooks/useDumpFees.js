import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';

export const useDumpFees = () => {
  const [dumpFees, setDumpFees] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchDumpFees = useCallback(async () => {
    setLoading(true);
    try {
      // Dump fees specifically track weight and landfill costs now, 
      // delivery_fee has been moved to the services table.
      const { data, error } = await supabase
        .from('dump_fees')
        .select('*, services(name)');
      
      if (error) throw error;
      setDumpFees(data || []);
    } catch (error) {
      console.error('Error fetching dump fees:', error);
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
      return true;
    } catch (error) {
      console.error('Error updating dump fee:', error);
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

  return {
    dumpFees,
    loading,
    fetchDumpFees,
    updateDumpFee,
    getFeeForService
  };
};