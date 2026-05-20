import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/customSupabaseClient';

/**
 * Maps equipment_id → is_taxable from equipment_pricing (IDs 1–6; excludes insurance ID 7).
 */
export function useEquipmentTaxFlags() {
  const [equipmentTaxFlags, setEquipmentTaxFlags] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchFlags = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const { data, error: fetchError } = await supabase
        .from('equipment_pricing')
        .select('equipment_id, is_taxable')
        .in('equipment_id', [1, 2, 3, 4, 5, 6]);

      if (fetchError) throw fetchError;

      const map = {};
      (data || []).forEach((row) => {
        map[row.equipment_id] = row.is_taxable !== false;
      });
      setEquipmentTaxFlags(map);
    } catch (err) {
      console.warn('[useEquipmentTaxFlags] Error loading flags:', err?.message);
      setError(err?.message);
      setEquipmentTaxFlags({});
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFlags();
  }, [fetchFlags]);

  return { equipmentTaxFlags, loading, error, refetch: fetchFlags };
}
