import { supabase } from '@/lib/customSupabaseClient';

/**
 * Get the current price for a specific equipment item
 * @param {number} equipmentId - The equipment ID
 * @returns {Promise<number>} The base price, or 0 if not found
 */
export async function getPriceForEquipment(equipmentId) {
  try {
    const { data, error } = await supabase
      .from('equipment_pricing')
      .select('base_price')
      .eq('equipment_id', equipmentId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        // No pricing record exists, return 0 as fallback
        console.warn(`No pricing record found for equipment ${equipmentId}, returning 0`);
        return 0;
      }
      throw error;
    }

    return Number(data?.base_price || 0);
  } catch (err) {
    console.error('Error fetching equipment price:', err);
    return 0;
  }
}

/**
 * Get the price history for a specific equipment item
 * @param {number} equipmentId - The equipment ID
 * @returns {Promise<Array>} Array of price history entries
 */
export async function getPriceHistory(equipmentId) {
  try {
    const { data, error } = await supabase
      .from('equipment_pricing')
      .select('price_history')
      .eq('equipment_id', equipmentId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return [];
      }
      throw error;
    }

    return data?.price_history || [];
  } catch (err) {
    console.error('Error fetching price history:', err);
    return [];
  }
}

/**
 * Update the price for a specific equipment item
 * @param {number} equipmentId - The equipment ID
 * @param {number} newPrice - The new price
 * @param {string} adminUserId - The admin user ID making the change
 * @returns {Promise<Object>} Result object with success status
 */
export async function updateEquipmentPrice(equipmentId, newPrice, adminUserId) {
  try {
    // Validate newPrice
    const priceNum = Number(newPrice);
    if (isNaN(priceNum) || priceNum < 0) {
      return {
        success: false,
        error: 'Price must be a positive number'
      };
    }

    // Fetch current pricing record
    const { data: currentPricing, error: fetchError } = await supabase
      .from('equipment_pricing')
      .select('base_price, price_history')
      .eq('equipment_id', equipmentId)
      .single();

    if (fetchError && fetchError.code !== 'PGRST116') {
      throw fetchError;
    }

    const oldPrice = currentPricing?.base_price ? Number(currentPricing.base_price) : 0;
    const existingHistory = currentPricing?.price_history || [];

    // Create new history entry
    const newHistoryEntry = {
      price: oldPrice,
      changed_at: new Date().toISOString(),
      changed_by: adminUserId
    };

    const updatedHistory = [...existingHistory, newHistoryEntry];

    // Upsert the pricing record
    const { error: upsertError } = await supabase
      .from('equipment_pricing')
      .upsert({
        equipment_id: equipmentId,
        base_price: priceNum,
        price_history: updatedHistory,
        last_updated: new Date().toISOString(),
        updated_by: adminUserId
      }, {
        onConflict: 'equipment_id'
      });

    if (upsertError) {
      throw upsertError;
    }

    return {
      success: true,
      oldPrice,
      newPrice: priceNum,
      timestamp: new Date().toISOString()
    };
  } catch (err) {
    console.error('Error updating equipment price:', err);
    return {
      success: false,
      error: err.message || 'Failed to update price'
    };
  }
}