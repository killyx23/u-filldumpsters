
import { supabase } from '@/lib/customSupabaseClient';
import { isValidEquipmentId, logEquipmentIdQuery } from './equipmentIdValidator';

/**
 * Equipment Debugging Helper
 * Provides comprehensive debugging tools for equipment pricing issues
 */

/**
 * Debug equipment pricing for a specific equipment ID
 * Validates format, checks existence, and retrieves pricing
 * 
 * @param {string} equipmentId - The equipment ID to debug
 * @param {string} context - Where this debug is being called from
 * @returns {Promise<object>} Debug results
 */
export async function debugEquipmentPricing(equipmentId, context) {
  console.group(`[Equipment Pricing Debug] ${context}`);
  
  const result = {
    equipmentId,
    context,
    isValidFormat: false,
    existsInEquipment: false,
    hasPricing: false,
    price: null,
    errors: []
  };

  // Step 1: Validate format
  result.isValidFormat = isValidEquipmentId(equipmentId);
  console.log('✓ Format validation:', result.isValidFormat ? 'VALID UUID' : '❌ INVALID');
  
  if (!result.isValidFormat) {
    console.error('Equipment ID is not a valid UUID format:', equipmentId);
    result.errors.push('Invalid UUID format');
    console.groupEnd();
    return result;
  }

  try {
    // Step 2: Check if exists in equipment table
    const { data: equipmentData, error: equipError } = await supabase
      .from('equipment')
      .select('id, name, price, type')
      .eq('id', equipmentId)
      .single();

    if (equipError && equipError.code !== 'PGRST116') {
      console.error('Error querying equipment table:', equipError);
      result.errors.push(`Equipment query error: ${equipError.message}`);
    }

    result.existsInEquipment = !!equipmentData;
    console.log('✓ Exists in equipment table:', result.existsInEquipment ? 'YES' : '❌ NO');
    
    if (equipmentData) {
      console.log('Equipment details:', {
        id: equipmentData.id,
        name: equipmentData.name,
        type: equipmentData.type,
        price: equipmentData.price
      });
    }

    // Step 3: Check if has pricing record
    const { data: pricingData, error: pricingError } = await supabase
      .from('equipment_pricing')
      .select('*')
      .eq('equipment_id', equipmentId)
      .single();

    if (pricingError && pricingError.code !== 'PGRST116') {
      console.error('Error querying equipment_pricing table:', pricingError);
      result.errors.push(`Pricing query error: ${pricingError.message}`);
    }

    result.hasPricing = !!pricingData;
    console.log('✓ Has pricing record:', result.hasPricing ? 'YES' : '❌ NO');
    
    if (pricingData) {
      result.price = Number(pricingData.base_price || 0);
      console.log('Pricing details:', {
        base_price: pricingData.base_price,
        item_type: pricingData.item_type,
        last_updated: pricingData.last_updated
      });
    } else if (equipmentData) {
      result.price = Number(equipmentData.price || 0);
      console.warn('⚠️ No pricing record - using fallback from equipment.price:', result.price);
    }

  } catch (error) {
    console.error('Unexpected error during debug:', error);
    result.errors.push(`Unexpected error: ${error.message}`);
  }

  console.log('📊 Debug Summary:', result);
  console.groupEnd();
  
  return result;
}

/**
 * Logs all equipment IDs in the system for reference
 * Helps identify valid IDs that should be used
 * 
 * @returns {Promise<Array>} List of all equipment records
 */
export async function logAllEquipmentIds() {
  console.group('[Equipment IDs] All Equipment in System');
  
  try {
    const { data: equipment, error } = await supabase
      .from('equipment')
      .select('id, name, type, price')
      .order('name');

    if (error) {
      console.error('Error fetching equipment:', error);
      console.groupEnd();
      return [];
    }

    if (!equipment || equipment.length === 0) {
      console.warn('No equipment found in database');
      console.groupEnd();
      return [];
    }

    console.log(`Found ${equipment.length} equipment records:`);
    console.table(equipment);

    // Validate each ID
    const invalidIds = equipment.filter(e => !isValidEquipmentId(e.id));
    if (invalidIds.length > 0) {
      console.warn(`⚠️ Found ${invalidIds.length} equipment with invalid UUID format:`);
      console.table(invalidIds);
    }

    console.groupEnd();
    return equipment;

  } catch (error) {
    console.error('Unexpected error fetching equipment:', error);
    console.groupEnd();
    return [];
  }
}

/**
 * Validates all equipment have pricing records
 * 
 * @returns {Promise<object>} Validation report
 */
export async function validateAllEquipmentPricing() {
  console.group('[Equipment Pricing Validation] System-wide Check');
  
  const report = {
    totalEquipment: 0,
    withPricing: 0,
    withoutPricing: [],
    invalidIds: [],
    errors: []
  };

  try {
    // Fetch all equipment
    const { data: equipment, error: equipError } = await supabase
      .from('equipment')
      .select('id, name, type');

    if (equipError) {
      report.errors.push(`Equipment fetch error: ${equipError.message}`);
      console.error(equipError);
      console.groupEnd();
      return report;
    }

    report.totalEquipment = equipment?.length || 0;
    console.log(`Total equipment records: ${report.totalEquipment}`);

    // Fetch all pricing records
    const { data: pricing, error: pricingError } = await supabase
      .from('equipment_pricing')
      .select('equipment_id');

    if (pricingError) {
      report.errors.push(`Pricing fetch error: ${pricingError.message}`);
      console.error(pricingError);
    }

    const pricingMap = new Set(pricing?.map(p => p.equipment_id) || []);

    // Check each equipment
    for (const item of equipment || []) {
      // Validate ID format
      if (!isValidEquipmentId(item.id)) {
        report.invalidIds.push({ id: item.id, name: item.name });
        console.warn(`❌ Invalid UUID: ${item.name} (${item.id})`);
        continue;
      }

      // Check if has pricing
      if (pricingMap.has(item.id)) {
        report.withPricing++;
      } else {
        report.withoutPricing.push({ id: item.id, name: item.name, type: item.type });
        console.warn(`⚠️ Missing pricing: ${item.name} (${item.id})`);
      }
    }

    console.log('📊 Validation Summary:');
    console.log(`  Total Equipment: ${report.totalEquipment}`);
    console.log(`  ✓ With Pricing: ${report.withPricing}`);
    console.log(`  ⚠️ Without Pricing: ${report.withoutPricing.length}`);
    console.log(`  ❌ Invalid IDs: ${report.invalidIds.length}`);

    if (report.withoutPricing.length > 0) {
      console.table(report.withoutPricing);
    }

    if (report.invalidIds.length > 0) {
      console.error('Equipment with invalid UUID formats:');
      console.table(report.invalidIds);
    }

  } catch (error) {
    console.error('Unexpected validation error:', error);
    report.errors.push(`Unexpected error: ${error.message}`);
  }

  console.groupEnd();
  return report;
}

/**
 * Searches for equipment by name or partial ID
 * Helps find the correct equipment ID to use
 * 
 * @param {string} searchTerm - Name or partial ID to search for
 * @returns {Promise<Array>} Matching equipment records
 */
export async function searchEquipment(searchTerm) {
  console.group(`[Equipment Search] "${searchTerm}"`);
  
  try {
    const { data, error } = await supabase
      .from('equipment')
      .select('id, name, type, price')
      .or(`name.ilike.%${searchTerm}%,id.ilike.%${searchTerm}%`)
      .limit(10);

    if (error) {
      console.error('Search error:', error);
      console.groupEnd();
      return [];
    }

    if (!data || data.length === 0) {
      console.warn('No equipment found matching:', searchTerm);
      console.groupEnd();
      return [];
    }

    console.log(`Found ${data.length} matching equipment:`);
    console.table(data);
    console.groupEnd();
    
    return data;

  } catch (error) {
    console.error('Unexpected search error:', error);
    console.groupEnd();
    return [];
  }
}
