
import { supabase } from '@/lib/customSupabaseClient';
import { getOrCreateEquipmentPricing } from './equipmentPricingIntegration';
import { isValidEquipmentId } from './equipmentIdValidator';

/**
 * Validate equipment pricing record
 * @param {number} equipmentId - Equipment ID
 * @returns {Promise<object>} Validation result
 */
export async function validateEquipmentPricing(equipmentId) {
  const result = {
    isValid: true,
    issues: [],
    suggestions: [],
    equipmentExists: false,
    pricingExists: false,
    itemTypeValid: false,
    priceValid: false,
    equipment: null,
    pricing: null
  };

  // Validate ID format first
  if (!isValidEquipmentId(equipmentId)) {
    result.isValid = false;
    result.issues.push(`Invalid equipment ID format: ${equipmentId} (must be UUID)`);
    result.suggestions.push('Equipment IDs must be valid UUIDs from the equipment table');
    return result;
  }

  try {
    // Check if equipment exists
    const { data: equipment, error: equipError } = await supabase
      .from('equipment')
      .select('*')
      .eq('id', equipmentId)
      .single();

    if (equipError || !equipment) {
      result.isValid = false;
      result.issues.push(`Equipment record not found (ID: ${equipmentId})`);
      result.suggestions.push('Verify the equipment ID exists in the database');
      return result;
    }

    result.equipmentExists = true;
    result.equipment = equipment;

    // Check if equipment_pricing record exists
    const { data: pricing, error: pricingError } = await supabase
      .from('equipment_pricing')
      .select('*')
      .eq('equipment_id', equipmentId)
      .single();

    if (pricingError) {
      if (pricingError.code === 'PGRST116') {
        result.isValid = false;
        result.pricingExists = false;
        result.issues.push('Equipment pricing record does not exist');
        result.suggestions.push('Run migration to create missing pricing record');
        result.suggestions.push('Use getOrCreateEquipmentPricing() to auto-create the record');
      } else {
        result.isValid = false;
        result.issues.push(`Error fetching pricing: ${pricingError.message}`);
      }
      return result;
    }

    result.pricingExists = true;
    result.pricing = pricing;

    // Validate item_type
    const validItemTypes = ['rental_equipment', 'consumable_item', 'service_item'];
    if (!pricing.item_type) {
      result.isValid = false;
      result.itemTypeValid = false;
      result.issues.push('item_type is null or missing');
      result.suggestions.push('Set item_type based on equipment category');
      result.suggestions.push(`Valid types: ${validItemTypes.join(', ')}`);
    } else if (!validItemTypes.includes(pricing.item_type)) {
      result.isValid = false;
      result.itemTypeValid = false;
      result.issues.push(`Invalid item_type: "${pricing.item_type}"`);
      result.suggestions.push(`Change item_type to one of: ${validItemTypes.join(', ')}`);
    } else {
      result.itemTypeValid = true;
    }

    // Validate base_price
    if (pricing.base_price === null || pricing.base_price === undefined) {
      result.isValid = false;
      result.priceValid = false;
      result.issues.push('base_price is null or missing');
      result.suggestions.push('Set base_price to a valid number (can be 0)');
    } else if (isNaN(Number(pricing.base_price))) {
      result.isValid = false;
      result.priceValid = false;
      result.issues.push(`base_price is not a valid number: ${pricing.base_price}`);
      result.suggestions.push('Update base_price to a numeric value');
    } else if (Number(pricing.base_price) < 0) {
      result.isValid = false;
      result.priceValid = false;
      result.issues.push(`base_price is negative: ${pricing.base_price}`);
      result.suggestions.push('Update base_price to a non-negative value');
    } else {
      result.priceValid = true;
    }

    // Check for price mismatch between equipment and equipment_pricing
    const equipPrice = Number(equipment.price || 0);
    const pricingPrice = Number(pricing.base_price || 0);
    
    if (equipPrice !== pricingPrice) {
      result.issues.push(`Price mismatch: equipment.price ($${equipPrice}) != equipment_pricing.base_price ($${pricingPrice})`);
      result.suggestions.push('Sync prices between equipment and equipment_pricing tables');
    }

    return result;

  } catch (err) {
    result.isValid = false;
    result.issues.push(`Unexpected error: ${err.message}`);
    result.suggestions.push('Check database connection and permissions');
    return result;
  }
}

/**
 * Log equipment pricing state for debugging
 * @param {number} equipmentId - Equipment ID
 * @returns {Promise<void>}
 */
export async function logEquipmentPricingState(equipmentId) {
  console.group(`[Debug] Equipment Pricing State - ID: ${equipmentId}`);

  // Validate ID format
  if (!isValidEquipmentId(equipmentId)) {
    console.error('❌ Invalid equipment ID format:', equipmentId);
    console.error('Expected: UUID format (e.g., 550e8400-e29b-41d4-a716-446655440000)');
    console.groupEnd();
    return;
  }

  try {
    // Fetch equipment
    const { data: equipment, error: equipError } = await supabase
      .from('equipment')
      .select('*')
      .eq('id', equipmentId)
      .single();

    if (equipError) {
      console.error('❌ Equipment fetch error:', equipError);
    } else if (!equipment) {
      console.error('❌ Equipment not found');
    } else {
      console.log('✓ Equipment Record:', {
        id: equipment.id,
        name: equipment.name,
        price: equipment.price,
        type: equipment.type,
        service_id_association: equipment.service_id_association
      });
    }

    // Fetch equipment_pricing
    const { data: pricing, error: pricingError } = await supabase
      .from('equipment_pricing')
      .select('*')
      .eq('equipment_id', equipmentId)
      .single();

    if (pricingError) {
      if (pricingError.code === 'PGRST116') {
        console.error('❌ Equipment pricing record does not exist');
      } else {
        console.error('❌ Pricing fetch error:', pricingError);
      }
    } else if (!pricing) {
      console.error('❌ Pricing record not found');
    } else {
      console.log('✓ Equipment Pricing Record:', {
        id: pricing.id,
        equipment_id: pricing.equipment_id,
        item_type: pricing.item_type,
        base_price: pricing.base_price,
        last_updated: pricing.last_updated,
        price_history_count: pricing.price_history?.length || 0
      });

      // Check for issues
      const issues = [];
      if (!pricing.item_type) issues.push('item_type is null');
      if (pricing.base_price === null) issues.push('base_price is null');
      if (equipment && Number(equipment.price) !== Number(pricing.base_price)) {
        issues.push(`Price mismatch: equipment.price=${equipment.price}, base_price=${pricing.base_price}`);
      }

      if (issues.length > 0) {
        console.warn('⚠ Issues found:', issues);
      } else {
        console.log('✓ No issues detected');
      }
    }

    // Run validation
    const validation = await validateEquipmentPricing(equipmentId);
    console.log('Validation Result:', validation);

  } catch (err) {
    console.error('Fatal error:', err);
  }

  console.groupEnd();
}

/**
 * Fix equipment pricing record
 * @param {number} equipmentId - Equipment ID
 * @param {string|null} itemType - Optional item type override
 * @returns {Promise<object>} { success: boolean, message: string, actions: [] }
 */
export async function fixEquipmentPricingRecord(equipmentId, itemType = null) {
  const result = {
    success: false,
    message: '',
    actions: [],
    errors: []
  };

  // Validate ID format
  if (!isValidEquipmentId(equipmentId)) {
    result.errors.push(`Invalid equipment ID format: ${equipmentId}`);
    result.message = 'Cannot fix: invalid equipment ID format (must be UUID)';
    return result;
  }

  try {
    console.log(`[Fix] Attempting to fix equipment pricing for ID: ${equipmentId}`);

    // Step 1: Validate current state
    const validation = await validateEquipmentPricing(equipmentId);

    if (!validation.equipmentExists) {
      result.errors.push('Equipment record does not exist');
      result.message = 'Cannot fix: equipment not found';
      return result;
    }

    // Step 2: Get or create pricing record
    if (!validation.pricingExists) {
      console.log('[Fix] Creating missing pricing record...');
      
      const created = await getOrCreateEquipmentPricing(equipmentId, itemType);
      
      if (created) {
        result.actions.push('Created missing equipment_pricing record');
        result.success = true;
      } else {
        result.errors.push('Failed to create pricing record');
        result.message = 'Could not create pricing record';
        return result;
      }
    }

    // Step 3: Fix null item_type
    if (validation.pricingExists && !validation.itemTypeValid) {
      console.log('[Fix] Fixing null or invalid item_type...');
      
      const equipment = validation.equipment;
      const determinedType = itemType || (() => {
        if (equipment.type === 'consumable') return 'consumable_item';
        if (equipment.type === 'service') return 'service_item';
        return 'rental_equipment';
      })();

      const { error: updateError } = await supabase
        .from('equipment_pricing')
        .update({ 
          item_type: determinedType,
          last_updated: new Date().toISOString()
        })
        .eq('equipment_id', equipmentId);

      if (updateError) {
        result.errors.push(`Failed to update item_type: ${updateError.message}`);
      } else {
        result.actions.push(`Set item_type to: ${determinedType}`);
      }
    }

    // Step 4: Fix null base_price
    if (validation.pricingExists && !validation.priceValid) {
      console.log('[Fix] Fixing null or invalid base_price...');
      
      const equipment = validation.equipment;
      const price = Number(equipment.price || 0);

      const { error: updateError } = await supabase
        .from('equipment_pricing')
        .update({ 
          base_price: price,
          last_updated: new Date().toISOString()
        })
        .eq('equipment_id', equipmentId);

      if (updateError) {
        result.errors.push(`Failed to update base_price: ${updateError.message}`);
      } else {
        result.actions.push(`Set base_price to: $${price}`);
      }
    }

    // Step 5: Sync price mismatch
    if (validation.equipment && validation.pricing) {
      const equipPrice = Number(validation.equipment.price || 0);
      const pricingPrice = Number(validation.pricing.base_price || 0);

      if (equipPrice !== pricingPrice) {
        console.log('[Fix] Syncing price mismatch...');
        
        const { error: syncError } = await supabase
          .from('equipment_pricing')
          .update({ 
            base_price: equipPrice,
            last_updated: new Date().toISOString()
          })
          .eq('equipment_id', equipmentId);

        if (syncError) {
          result.errors.push(`Failed to sync price: ${syncError.message}`);
        } else {
          result.actions.push(`Synced price: $${pricingPrice} → $${equipPrice}`);
        }
      }
    }

    // Final validation
    const finalValidation = await validateEquipmentPricing(equipmentId);
    
    if (finalValidation.isValid) {
      result.success = true;
      result.message = 'Equipment pricing record fixed successfully';
    } else {
      result.message = 'Partial fix completed, some issues remain';
      result.errors.push(...finalValidation.issues);
    }

    console.log('[Fix] Result:', result);
    return result;

  } catch (err) {
    console.error('[Fix] Fatal error:', err);
    result.errors.push(`Unexpected error: ${err.message}`);
    result.message = 'Fix failed due to unexpected error';
    return result;
  }
}

/**
 * Check equipment pricing health across all records
 * @returns {Promise<object>} Health check results
 */
export async function checkEquipmentPricingHealth() {
  const health = {
    total_equipment: 0,
    total_pricing_records: 0,
    missing_pricing: [],
    null_item_types: [],
    invalid_prices: [],
    price_mismatches: [],
    invalid_ids: [],
    healthy_records: 0,
    issues_found: 0
  };

  try {
    // Fetch all equipment
    const { data: allEquipment, error: equipError } = await supabase
      .from('equipment')
      .select('id, name, price, type');

    if (equipError) {
      console.error('[Health Check] Failed to fetch equipment:', equipError);
      return health;
    }

    health.total_equipment = allEquipment?.length || 0;

    // Validate all equipment IDs
    allEquipment?.forEach(equip => {
      if (!isValidEquipmentId(equip.id)) {
        health.invalid_ids.push({
          id: equip.id,
          name: equip.name,
          reason: 'Invalid UUID format'
        });
        health.issues_found++;
      }
    });

    // Fetch all pricing records
    const { data: allPricing, error: pricingError } = await supabase
      .from('equipment_pricing')
      .select('equipment_id, item_type, base_price');

    if (pricingError) {
      console.error('[Health Check] Failed to fetch pricing:', pricingError);
      return health;
    }

    health.total_pricing_records = allPricing?.length || 0;

    // Create pricing map
    const pricingMap = new Map();
    allPricing?.forEach(p => pricingMap.set(p.equipment_id, p));

    // Check each equipment record
    for (const equipment of allEquipment || []) {
      // Skip invalid IDs
      if (!isValidEquipmentId(equipment.id)) {
        continue;
      }

      const pricing = pricingMap.get(equipment.id);

      if (!pricing) {
        health.missing_pricing.push({
          id: equipment.id,
          name: equipment.name
        });
        health.issues_found++;
        continue;
      }

      let hasIssue = false;

      // Check item_type
      if (!pricing.item_type) {
        health.null_item_types.push({
          id: equipment.id,
          name: equipment.name
        });
        hasIssue = true;
      }

      // Check price validity
      if (pricing.base_price === null || pricing.base_price === undefined || isNaN(Number(pricing.base_price))) {
        health.invalid_prices.push({
          id: equipment.id,
          name: equipment.name,
          base_price: pricing.base_price
        });
        hasIssue = true;
      }

      // Check price mismatch
      const equipPrice = Number(equipment.price || 0);
      const pricingPrice = Number(pricing.base_price || 0);
      
      if (equipPrice !== pricingPrice) {
        health.price_mismatches.push({
          id: equipment.id,
          name: equipment.name,
          equipment_price: equipPrice,
          pricing_price: pricingPrice
        });
        hasIssue = true;
      }

      if (hasIssue) {
        health.issues_found++;
      } else {
        health.healthy_records++;
      }
    }

    console.log('[Health Check] Summary:', {
      total: health.total_equipment,
      healthy: health.healthy_records,
      issues: health.issues_found,
      invalid_ids: health.invalid_ids.length
    });

    return health;

  } catch (err) {
    console.error('[Health Check] Fatal error:', err);
    return health;
  }
}

/**
 * Initialize equipment pricing debug on app startup
 * Provides visibility into equipment pricing data structure
 * 
 * @returns {Promise<object>} Debug report
 */
export async function initializeEquipmentPricingDebug() {
  console.group('[Equipment Pricing Debug] System Initialization');
  
  const report = {
    timestamp: new Date().toISOString(),
    equipment: {
      total: 0,
      valid_ids: 0,
      invalid_ids: [],
      list: []
    },
    pricing: {
      total: 0,
      records: []
    },
    issues: {
      missing_pricing: [],
      invalid_ids: [],
      null_item_types: [],
      other: []
    }
  };

  try {
    // Fetch all equipment
    const { data: allEquipment, error: equipError } = await supabase
      .from('equipment')
      .select('id, name, type, price')
      .order('name');

    if (equipError) {
      console.error('Failed to fetch equipment:', equipError);
      report.issues.other.push(`Equipment fetch error: ${equipError.message}`);
    } else {
      report.equipment.total = allEquipment?.length || 0;
      report.equipment.list = allEquipment || [];
      
      console.log(`Found ${report.equipment.total} equipment records`);
      
      // Validate equipment IDs
      allEquipment?.forEach(equip => {
        if (isValidEquipmentId(equip.id)) {
          report.equipment.valid_ids++;
        } else {
          report.equipment.invalid_ids.push({
            id: equip.id,
            name: equip.name,
            type: equip.type
          });
          console.warn(`❌ Invalid equipment ID: ${equip.name} (${equip.id})`);
        }
      });
      
      console.log(`Valid UUIDs: ${report.equipment.valid_ids}`);
      console.log(`Invalid IDs: ${report.equipment.invalid_ids.length}`);
    }

    // Fetch all pricing records
    const { data: allPricing, error: pricingError } = await supabase
      .from('equipment_pricing')
      .select('equipment_id, item_type, base_price, created_at')
      .order('created_at');

    if (pricingError) {
      console.error('Failed to fetch pricing:', pricingError);
      report.issues.other.push(`Pricing fetch error: ${pricingError.message}`);
    } else {
      report.pricing.total = allPricing?.length || 0;
      report.pricing.records = allPricing || [];
      
      console.log(`Found ${report.pricing.total} pricing records`);
      
      // Check for issues
      const pricingMap = new Map(allPricing?.map(p => [p.equipment_id, p]) || []);
      
      allEquipment?.forEach(equip => {
        if (!isValidEquipmentId(equip.id)) {
          report.issues.invalid_ids.push(equip);
          return;
        }
        
        const pricing = pricingMap.get(equip.id);
        
        if (!pricing) {
          report.issues.missing_pricing.push({
            id: equip.id,
            name: equip.name,
            type: equip.type
          });
        } else if (!pricing.item_type) {
          report.issues.null_item_types.push({
            id: equip.id,
            name: equip.name
          });
        }
      });
    }

    // Summary
    console.log('\n📊 Equipment Pricing System Status:');
    console.log(`  Total Equipment: ${report.equipment.total}`);
    console.log(`  Valid Equipment IDs: ${report.equipment.valid_ids}`);
    console.log(`  Invalid Equipment IDs: ${report.equipment.invalid_ids.length}`);
    console.log(`  Total Pricing Records: ${report.pricing.total}`);
    console.log(`  Missing Pricing: ${report.issues.missing_pricing.length}`);
    console.log(`  Null Item Types: ${report.issues.null_item_types.length}`);

    if (report.equipment.invalid_ids.length > 0) {
      console.error('\n❌ CRITICAL: Invalid equipment IDs detected:');
      console.table(report.equipment.invalid_ids);
    }

    if (report.issues.missing_pricing.length > 0) {
      console.warn('\n⚠️ Equipment missing pricing records:');
      console.table(report.issues.missing_pricing);
    }

    if (report.issues.null_item_types.length > 0) {
      console.warn('\n⚠️ Pricing records with null item_type:');
      console.table(report.issues.null_item_types);
    }

  } catch (error) {
    console.error('Fatal error during initialization:', error);
    report.issues.other.push(`Fatal error: ${error.message}`);
  }

  console.groupEnd();
  return report;
}

/**
 * Validate equipment_pricing table integrity
 * Checks that all pricing records reference valid equipment
 * 
 * @returns {Promise<object>} Integrity report
 */
export async function validateEquipmentPricingIntegrity() {
  console.group('[Equipment Pricing Integrity] Validation');
  
  const report = {
    timestamp: new Date().toISOString(),
    total_pricing_records: 0,
    valid_references: 0,
    orphaned_records: [],
    invalid_equipment_ids: [],
    errors: []
  };

  try {
    // Fetch all pricing records
    const { data: allPricing, error: pricingError } = await supabase
      .from('equipment_pricing')
      .select('id, equipment_id, item_type, base_price');

    if (pricingError) {
      report.errors.push(`Pricing fetch error: ${pricingError.message}`);
      console.error('Failed to fetch pricing records:', pricingError);
      console.groupEnd();
      return report;
    }

    report.total_pricing_records = allPricing?.length || 0;
    console.log(`Checking ${report.total_pricing_records} pricing records...`);

    // Fetch all equipment IDs
    const { data: allEquipment, error: equipError } = await supabase
      .from('equipment')
      .select('id');

    if (equipError) {
      report.errors.push(`Equipment fetch error: ${equipError.message}`);
      console.error('Failed to fetch equipment:', equipError);
      console.groupEnd();
      return report;
    }

    const validEquipmentIds = new Set(allEquipment?.map(e => e.id) || []);
    console.log(`Found ${validEquipmentIds.size} equipment records`);

    // Check each pricing record
    for (const pricing of allPricing || []) {
      // Check if equipment_id is valid UUID
      if (!isValidEquipmentId(pricing.equipment_id)) {
        report.invalid_equipment_ids.push({
          pricing_id: pricing.id,
          equipment_id: pricing.equipment_id,
          reason: 'Invalid UUID format'
        });
        continue;
      }

      // Check if equipment exists
      if (!validEquipmentIds.has(pricing.equipment_id)) {
        report.orphaned_records.push({
          pricing_id: pricing.id,
          equipment_id: pricing.equipment_id,
          item_type: pricing.item_type,
          base_price: pricing.base_price
        });
      } else {
        report.valid_references++;
      }
    }

    console.log('\n📊 Integrity Check Results:');
    console.log(`  Total Pricing Records: ${report.total_pricing_records}`);
    console.log(`  ✓ Valid References: ${report.valid_references}`);
    console.log(`  ❌ Invalid Equipment IDs: ${report.invalid_equipment_ids.length}`);
    console.log(`  ⚠️ Orphaned Records: ${report.orphaned_records.length}`);

    if (report.invalid_equipment_ids.length > 0) {
      console.error('\n❌ Pricing records with invalid equipment_id format:');
      console.table(report.invalid_equipment_ids);
    }

    if (report.orphaned_records.length > 0) {
      console.warn('\n⚠️ Pricing records referencing non-existent equipment:');
      console.table(report.orphaned_records);
    }

  } catch (error) {
    console.error('Fatal error during integrity check:', error);
    report.errors.push(`Fatal error: ${error.message}`);
  }

  console.groupEnd();
  return report;
}
