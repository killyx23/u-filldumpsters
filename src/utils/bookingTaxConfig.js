import { supabase } from '@/lib/customSupabaseClient';

const EQUIPMENT_IDS = [1, 2, 3, 4, 5, 6];

/**
 * Load per-plan service tax flags from services table.
 */
export async function fetchServiceTaxFlags(serviceId) {
  if (!serviceId) {
    return {
      is_taxable: true,
      delivery_fee_is_taxable: true,
      mileage_is_taxable: true,
    };
  }

  const { data, error } = await supabase
    .from('services')
    .select('is_taxable, delivery_fee_is_taxable, mileage_is_taxable')
    .eq('id', serviceId)
    .maybeSingle();

  if (error || !data) {
    return {
      is_taxable: true,
      delivery_fee_is_taxable: true,
      mileage_is_taxable: true,
    };
  }

  return {
    is_taxable: data.is_taxable !== false,
    delivery_fee_is_taxable: data.delivery_fee_is_taxable !== false,
    mileage_is_taxable: data.mileage_is_taxable !== false,
  };
}

/**
 * Load is_taxable flags for equipment_pricing rows (IDs 1-6).
 */
export async function fetchEquipmentTaxFlags() {
  const flags = {};
  const { data, error } = await supabase
    .from('equipment_pricing')
    .select('equipment_id, is_taxable')
    .in('equipment_id', EQUIPMENT_IDS);

  if (error) {
    EQUIPMENT_IDS.forEach((id) => {
      flags[id] = true;
    });
    return flags;
  }

  EQUIPMENT_IDS.forEach((id) => {
    flags[id] = true;
  });
  (data || []).forEach((row) => {
    flags[row.equipment_id] = row.is_taxable !== false;
  });
  return flags;
}

/**
 * Insurance service (id 7) tax flag.
 */
export async function fetchInsuranceTaxFlag() {
  const { data, error } = await supabase
    .from('services')
    .select('is_taxable')
    .eq('id', 7)
    .maybeSingle();

  if (error || !data) return false;
  return data.is_taxable === true;
}
