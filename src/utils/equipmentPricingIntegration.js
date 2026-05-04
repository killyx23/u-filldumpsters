
import { supabase } from '@/lib/customSupabaseClient';
import { isValidEquipmentId, logEquipmentIdQuery, getEquipmentName } from './equipmentIdValidator';

/**
 * Equipment Pricing Integration
 * Handles all equipment pricing operations with numeric IDs (1-6 ONLY)
 * 
 * CRITICAL: Equipment ID 7 is RESERVED for Premium Insurance service
 * and MUST NOT be processed through equipment pricing system.
 * Premium Insurance pricing is managed via services table (service_id=7).
 */

const INSURANCE_SERVICE_ID = 7;
const EXCLUDED_EQUIPMENT_IDS = [INSURANCE_SERVICE_ID]; // IDs to exclude from equipment pricing

/**
 * Check if equipment ID should be excluded from pricing system
 * @param {number} equipmentId - Equipment ID to check
 * @returns {boolean} True if ID should be excluded
 */
function isExcludedEquipmentId(equipmentId) {
  const numericId = Number(equipmentId);
  return EXCLUDED_EQUIPMENT_IDS.includes(numericId);
}

/**
 * Validate equipment ID for pricing operations
 * @param {number} equipmentId - Equipment ID to validate
 * @param {string} context - Context for logging
 * @returns {boolean} True if valid for pricing operations
 */
function validateEquipmentIdForPricing(equipmentId, context) {
  if (!equipmentId) {
    console.error(`[${context}] No equipment ID provided`);
    return false;
  }

  const numericId = Number(equipmentId);

  // Check if excluded (ID 7 = Premium Insurance)
  if (isExcludedEquipmentId(numericId)) {
    console.warn(`[${context}] Equipment ID ${numericId} is excluded from pricing system (reserved for Premium Insurance service)`);
    return false;
  }

  // Validate ID range (1-6 only, excluding 7)
  if (!isValidEquipmentId(numericId) || numericId === INSURANCE_SERVICE_ID) {
    console.error(`[${context}] Invalid equipment ID: ${numericId} (expected 1-6, excluding 7)`);
    return false;
  }

  return true;
}

/**
 * Determine item_type from equipment record
 * @param {object} equipment - Equipment record
 * @returns {string} Item type
 */
function determineItemType(equipment) {
  if (!equipment) return 'rental_equipment';
  
  // Check equipment.type field first
  if (equipment.type) {
    if (equipment.type === 'consumable') return 'consumable_item';
    if (equipment.type === 'service') return 'service_item';
    if (equipment.type === 'rental') return 'rental_equipment';
    if (equipment.type === 'insurance') {
      console.warn('[determineItemType] Insurance type detected - this should use services table, not equipment_pricing');
      return 'insurance';
    }
  }
  
  // Default to rental_equipment
  return 'rental_equipment';
}

/**
 * Get or create equipment_pricing record
 * @param {number} equipmentId - Equipment ID (numeric 1-6, excluding 7)
 * @param {string|null} itemType - Optional item type override
 * @returns {Promise<object|null>} Equipment pricing record or null
 */
export async function getOrCreateEquipmentPricing(equipmentId, itemType = null) {
  const context = 'getOrCreateEquipmentPricing';
  
  // Validate and check exclusions
  if (!validateEquipmentIdForPricing(equipmentId, context)) {
    return null;
  }

  try {
    const numericId = Number(equipmentId);
    console.log(`[${context}] Querying equipment_pricing for ID: ${numericId}`);
    
    // First, try to get existing record
    const { data: existingRecord, error: fetchError } = await supabase
      .from('equipment_pricing')
      .select('*')
      .eq('equipment_id', numericId)
      .not('equipment_id', 'in', `(${EXCLUDED_EQUIPMENT_IDS.join(',')})`) // Exclude ID 7
      .single();

    if (!fetchError && existingRecord) {
      console.log(`[${context}] ✓ Found existing pricing record`, {
        equipment_id: numericId,
        equipment_name: getEquipmentName(numericId),
        base_price: existingRecord.base_price,
        item_type: existingRecord.item_type
      });
      return existingRecord;
    }

    if (fetchError && fetchError.code !== 'PGRST116') {
      console.error(`[${context}] Error querying equipment_pricing:`, fetchError);
      return null;
    }

    // Record doesn't exist, create it
    console.log(`[${context}] No pricing record found, creating new one for ID: ${numericId}`);

    // Fetch equipment record to get price and type
    const { data: equipment, error: equipError } = await supabase
      .from('equipment')
      .select('id, name, price, type')
      .eq('id', numericId)
      .not('id', 'in', `(${EXCLUDED_EQUIPMENT_IDS.join(',')})`) // Exclude ID 7
      .single();

    if (equipError) {
      console.error(`[${context}] Equipment ${numericId} not found in equipment table:`, equipError);
      return null;
    }

    if (!equipment) {
      console.error(`[${context}] No equipment data returned for ID: ${numericId}`);
      return null;
    }

    console.log(`[${context}] Found equipment record:`, {
      id: equipment.id,
      name: equipment.name,
      price: equipment.price,
      type: equipment.type
    });

    // Determine item type
    const finalItemType = itemType || determineItemType(equipment);
    const basePrice = Number(equipment.price || 0);

    // Create new pricing record
    const newRecord = {
      equipment_id: numericId,
      item_type: finalItemType,
      base_price: basePrice,
      price_history: [{
        price: basePrice,
        changed_at: new Date().toISOString(),
        changed_by: null,
        change_reason: 'Auto-created from equipment.price during price lookup',
        action: 'initialization'
      }],
      created_at: new Date().toISOString(),
      last_updated: new Date().toISOString()
    };

    const { data: insertedRecord, error: insertError } = await supabase
      .from('equipment_pricing')
      .insert([newRecord])
      .select()
      .single();

    if (insertError) {
      console.error(`[${context}] Failed to create pricing record:`, insertError);
      return null;
    }

    console.log(`[${context}] ✓ Successfully created pricing record for ${equipment.name}`);
    return insertedRecord;

  } catch (err) {
    console.error(`[${context}] Unexpected error:`, err);
    return null;
  }
}

/**
 * Fetch current or historical price for equipment from equipment_pricing table
 * @param {number} equipmentId - Equipment ID (numeric 1-6, excluding 7)
 * @param {Date|string|null} date - Optional date for historical pricing
 * @returns {Promise<number>} Price amount (never returns null, returns 0 on error)
 */
export async function getPriceForEquipment(equipmentId, date = null) {
  const context = 'getPriceForEquipment';
  
  // Validate and check exclusions
  if (!validateEquipmentIdForPricing(equipmentId, context)) {
    console.warn(`[${context}] Skipping pricing fetch for excluded ID: ${equipmentId}`);
    return 0;
  }

  try {
    const numericId = Number(equipmentId);
    console.log(`[${context}] Fetching price for equipment ID: ${numericId} (${getEquipmentName(numericId)})`);
    
    // Get or create the pricing record
    const pricingRecord = await getOrCreateEquipmentPricing(numericId);

    if (!pricingRecord) {
      console.warn(`[${context}] ⚠️ Could not get/create pricing record for: ${numericId}`);
      
      // Fallback: try to get price directly from equipment table (excluding ID 7)
      try {
        console.log(`[${context}] Attempting fallback to equipment.price`);
        
        const { data: equipment, error: equipError } = await supabase
          .from('equipment')
          .select('price, name')
          .eq('id', numericId)
          .not('id', 'in', `(${EXCLUDED_EQUIPMENT_IDS.join(',')})`) // Exclude ID 7
          .single();

        if (equipError || !equipment) {
          console.warn(`[${context}] Fallback failed - equipment not found: ${numericId}`);
          return 0;
        }

        const fallbackPrice = Number(equipment.price || 0);
        console.log(`[${context}] ✓ Using fallback price from equipment table:`, {
          equipment_id: numericId,
          name: equipment.name,
          price: fallbackPrice
        });
        
        return fallbackPrice;
        
      } catch (fallbackErr) {
        console.error(`[${context}] Fallback error:`, fallbackErr);
        return 0;
      }
    }

    // If date is specified, check price history
    if (date) {
      const dateStr = typeof date === 'string' ? date : date.toISOString().split('T')[0];
      const history = pricingRecord.price_history || [];
      
      // Find the most recent price at or before the specified date
      const historicalEntry = history
        .filter(entry => entry.changed_at && new Date(entry.changed_at) <= new Date(dateStr))
        .sort((a, b) => new Date(b.changed_at) - new Date(a.changed_at))[0];

      if (historicalEntry) {
        const historicalPrice = Number(historicalEntry.price || 0);
        console.log(`[${context}] ✓ Found historical price for ${dateStr}:`, historicalPrice);
        return historicalPrice;
      }
    }

    // Return current base price
    const currentPrice = Number(pricingRecord.base_price || 0);
    console.log(`[${context}] ✓ Returning current base price:`, {
      equipment_id: numericId,
      equipment_name: getEquipmentName(numericId),
      price: currentPrice,
      item_type: pricingRecord.item_type
    });
    
    return currentPrice;

  } catch (err) {
    console.error(`[${context}] Error fetching price for equipment ${equipmentId}:`, err);
    
    // Final fallback attempt (excluding ID 7)
    try {
      const numericId = Number(equipmentId);
      console.log(`[${context}] Final fallback attempt to equipment.price`);
      
      const { data: equipment } = await supabase
        .from('equipment')
        .select('price')
        .eq('id', numericId)
        .not('id', 'in', `(${EXCLUDED_EQUIPMENT_IDS.join(',')})`) // Exclude ID 7
        .single();

      const finalPrice = Number(equipment?.price || 0);
      console.log(`[${context}] ✓ Final fallback price: ${finalPrice}`);
      return finalPrice;
      
    } catch {
      console.error(`[${context}] All fallback attempts failed, returning 0`);
      return 0;
    }
  }
}

/**
 * Update equipment price
 * @param {number} equipmentId - Equipment ID (numeric 1-6, excluding 7)
 * @param {number} newPrice - New price
 * @param {string} itemType - Item type
 * @param {string|null} updatedBy - User ID who updated the price
 * @param {string} changeReason - Reason for price change
 * @returns {Promise<object>} Result object
 */
export async function updateEquipmentPrice(equipmentId, newPrice, itemType, updatedBy = null, changeReason = 'Manual price update') {
  const context = 'updateEquipmentPrice';
  
  // Validate and check exclusions
  if (!validateEquipmentIdForPricing(equipmentId, context)) {
    return { 
      success: false, 
      error: 'Equipment ID 7 is reserved for Premium Insurance (use services table)', 
      code: 'EXCLUDED_EQUIPMENT_ID' 
    };
  }

  if (newPrice === undefined || newPrice === null || isNaN(Number(newPrice))) {
    return { success: false, error: 'Valid price is required', code: 'INVALID_PRICE' };
  }

  if (!itemType) {
    return { success: false, error: 'Item type is required', code: 'MISSING_ITEM_TYPE' };
  }

  const sanitizedPrice = Number(newPrice);
  if (sanitizedPrice < 0) {
    return { success: false, error: 'Price cannot be negative', code: 'NEGATIVE_PRICE' };
  }

  try {
    const numericId = Number(equipmentId);
    console.log(`[${context}] Updating price for equipment ${numericId} (${getEquipmentName(numericId)}) to ${sanitizedPrice}`);

    // Get or create the pricing record
    const pricingRecord = await getOrCreateEquipmentPricing(numericId, itemType);

    if (!pricingRecord) {
      return { 
        success: false, 
        error: 'Could not find or create equipment pricing record', 
        code: 'RECORD_NOT_FOUND' 
      };
    }

    const oldPrice = Number(pricingRecord.base_price || 0);

    // Prepare updated price history
    const currentHistory = pricingRecord.price_history || [];
    const newHistoryEntry = {
      price: oldPrice,
      new_price: sanitizedPrice,
      changed_at: new Date().toISOString(),
      changed_by: updatedBy,
      change_reason: changeReason,
      action: 'price_update'
    };

    const updatedHistory = [...currentHistory, newHistoryEntry];

    // Update the record
    const { data: updatedRecord, error: updateError } = await supabase
      .from('equipment_pricing')
      .update({
        base_price: sanitizedPrice,
        item_type: itemType,
        price_history: updatedHistory,
        last_updated: new Date().toISOString(),
        updated_by: updatedBy
      })
      .eq('equipment_id', numericId)
      .not('equipment_id', 'in', `(${EXCLUDED_EQUIPMENT_IDS.join(',')})`) // Exclude ID 7
      .select()
      .single();

    if (updateError) {
      console.error(`[${context}] Update failed:`, updateError);
      return { 
        success: false, 
        error: `Database update failed: ${updateError.message}`, 
        code: 'UPDATE_FAILED' 
      };
    }

    // Also update equipment table for backward compatibility
    try {
      await supabase
        .from('equipment')
        .update({ price: sanitizedPrice })
        .eq('id', numericId)
        .not('id', 'in', `(${EXCLUDED_EQUIPMENT_IDS.join(',')})`); // Exclude ID 7
    } catch (equipUpdateErr) {
      console.warn(`[${context}] Failed to sync price to equipment table:`, equipUpdateErr);
    }

    console.log(`[${context}] ✓ Successfully updated price from ${oldPrice} to ${sanitizedPrice}`);

    return {
      success: true,
      message: 'Price updated successfully',
      oldPrice,
      newPrice: sanitizedPrice,
      record: updatedRecord
    };

  } catch (err) {
    console.error(`[${context}] Error updating price:`, err);
    return { 
      success: false, 
      error: `Unexpected error: ${err.message}`, 
      code: 'UNEXPECTED_ERROR' 
    };
  }
}

/**
 * Get price change history for equipment
 * @param {number} equipmentId - Equipment ID (numeric 1-6, excluding 7)
 * @returns {Promise<Array>} Array of price history entries
 */
export async function getPriceHistory(equipmentId) {
  const context = 'getPriceHistory';
  
  // Validate and check exclusions
  if (!validateEquipmentIdForPricing(equipmentId, context)) {
    return [];
  }

  try {
    const numericId = Number(equipmentId);
    const pricingRecord = await getOrCreateEquipmentPricing(numericId);

    if (!pricingRecord) {
      console.warn(`[${context}] No pricing record found for: ${numericId}`);
      return [];
    }

    const history = pricingRecord.price_history || [];
    
    // Sort by date, most recent first
    return history.sort((a, b) => {
      const dateA = new Date(a.changed_at || 0);
      const dateB = new Date(b.changed_at || 0);
      return dateB - dateA;
    });

  } catch (err) {
    console.error(`[${context}] Error fetching price history:`, err);
    return [];
  }
}

/**
 * Get current prices for multiple equipment items
 * @param {Array<number|object>} equipmentIds - Array of equipment IDs or objects
 * @returns {Promise<Object>} Object with equipment_id as key and price as value
 */
export async function getEquipmentPriceSnapshot(equipmentIds) {
  const context = 'getEquipmentPriceSnapshot';
  
  if (!Array.isArray(equipmentIds) || equipmentIds.length === 0) {
    console.warn(`[${context}] No equipment IDs provided or empty array`);
    return {};
  }

  try {
    const snapshot = {};
    
    for (const item of equipmentIds) {
      const id = typeof item === 'number' ? item : (item.id || item.equipment_id || item.dbId);
      
      if (id) {
        const numericId = Number(id);
        
        // Skip excluded IDs (ID 7 = Premium Insurance)
        if (isExcludedEquipmentId(numericId)) {
          console.log(`[${context}] Skipping excluded equipment ID: ${numericId} (Premium Insurance uses services table)`);
          continue;
        }
        
        // Validate ID (1-6 only)
        if (!isValidEquipmentId(numericId)) {
          console.warn(`[${context}] Skipping invalid equipment ID: ${id} (expected 1-6)`);
          continue;
        }
        
        const price = await getPriceForEquipment(numericId);
        snapshot[numericId] = price;
        console.log(`[${context}] Added to snapshot: ${numericId} (${getEquipmentName(numericId)}) = $${price}`);
      }
    }

    console.log(`[${context}] Created snapshot with ${Object.keys(snapshot).length} equipment prices`);
    return snapshot;
    
  } catch (err) {
    console.error(`[${context}] Error creating price snapshot:`, err);
    return {};
  }
}

/**
 * Calculate total cost for equipment with quantity
 * @param {number} equipmentId - Equipment ID (numeric 1-6, excluding 7)
 * @param {number} quantity - Quantity
 * @param {Date|string|null} date - Optional date for historical pricing
 * @returns {Promise<number>} Total cost
 */
export async function calculateEquipmentCost(equipmentId, quantity, date = null) {
  const context = 'calculateEquipmentCost';
  
  // Validate and check exclusions
  if (!validateEquipmentIdForPricing(equipmentId, context)) {
    return 0;
  }
  
  const numericId = Number(equipmentId);
  const price = await getPriceForEquipment(numericId, date);
  const total = price * (quantity || 1);
  
  console.log(`[${context}] Calculated cost: ${numericId} (${getEquipmentName(numericId)}) x ${quantity} = $${total}`);
  return total;
}

/**
 * Format price for display
 * @param {number} price - Price amount
 * @returns {string} Formatted price string
 */
export function formatPriceDisplay(price) {
  const numPrice = sanitizePrice(price);
  return `$${numPrice.toFixed(2)}`;
}

/**
 * Validate and sanitize price value
 * @param {any} price - Price value to validate
 * @returns {number} Sanitized price (0 if invalid)
 */
export function sanitizePrice(price) {
  if (price === null || price === undefined) {
    return 0;
  }
  
  const numPrice = Number(price);
  
  if (isNaN(numPrice) || numPrice < 0) {
    return 0;
  }
  
  return Math.round(numPrice * 100) / 100;
}

/**
 * Get price from snapshot or fetch current price
 * @param {number} equipmentId - Equipment ID (numeric 1-6, excluding 7)
 * @param {Object} snapshot - Price snapshot object
 * @returns {Promise<number>} Price amount
 */
export async function getPriceFromSnapshotOrCurrent(equipmentId, snapshot = null) {
  const numericId = Number(equipmentId);
  
  // Check exclusions
  if (isExcludedEquipmentId(numericId)) {
    console.warn('[getPriceFromSnapshotOrCurrent] Skipping excluded equipment ID:', numericId);
    return 0;
  }
  
  if (snapshot && snapshot[numericId] !== undefined) {
    return Number(snapshot[numericId]);
  }
  
  return await getPriceForEquipment(numericId);
}
