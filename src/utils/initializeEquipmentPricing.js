
import { supabase } from '@/lib/customSupabaseClient';

/**
 * Initialize equipment_pricing table with data from equipment table
 * Creates pricing records for all equipment items that don't have one
 * @returns {Promise<Object>} Result object with initialization status
 */
export async function initializeEquipmentPricing() {
  try {
    console.log('[EquipmentPricing] Starting initialization...');

    // Fetch all equipment items
    const { data: equipment, error: equipmentError } = await supabase
      .from('equipment')
      .select('id, name, price, type');

    if (equipmentError) {
      throw equipmentError;
    }

    if (!equipment || equipment.length === 0) {
      console.log('[EquipmentPricing] No equipment items found');
      return {
        initialized: true,
        count: 0,
        message: 'No equipment items to initialize'
      };
    }

    console.log(`[EquipmentPricing] Found ${equipment.length} equipment items`);

    // Fetch existing pricing records
    const { data: existingPricing, error: pricingError } = await supabase
      .from('equipment_pricing')
      .select('equipment_id');

    if (pricingError) {
      throw pricingError;
    }

    const existingIds = new Set(existingPricing?.map(p => p.equipment_id) || []);
    console.log(`[EquipmentPricing] Found ${existingIds.size} existing pricing records`);

    // Create pricing records for items that don't have one
    const pricingRecords = [];
    let createdCount = 0;

    for (const item of equipment) {
      if (existingIds.has(item.id)) {
        console.log(`[EquipmentPricing] Skipping ${item.name} (pricing exists)`);
        continue;
      }

      const basePrice = Number(item.price || 0);
      
      // Determine item_type from equipment.type
      let itemType = 'rental_equipment';
      if (item.type === 'consumable') {
        itemType = 'consumable_item';
      } else if (item.type === 'service') {
        itemType = 'service_item';
      }

      pricingRecords.push({
        equipment_id: item.id,
        item_type: itemType,
        base_price: basePrice,
        price_history: [{
          price: basePrice,
          changed_at: new Date().toISOString(),
          changed_by: null
        }],
        created_at: new Date().toISOString()
      });

      createdCount++;
      console.log(`[EquipmentPricing] Creating pricing record for ${item.name} ($${basePrice})`);
    }

    if (pricingRecords.length === 0) {
      console.log('[EquipmentPricing] All equipment items already have pricing records');
      return {
        initialized: true,
        count: 0,
        message: 'All items already initialized'
      };
    }

    // Insert pricing records in batches to avoid hitting limits
    const batchSize = 100;
    for (let i = 0; i < pricingRecords.length; i += batchSize) {
      const batch = pricingRecords.slice(i, i + batchSize);
      const { error: insertError } = await supabase
        .from('equipment_pricing')
        .insert(batch);

      if (insertError) {
        throw insertError;
      }
    }

    console.log(`[EquipmentPricing] Successfully initialized ${createdCount} pricing records`);

    return {
      initialized: true,
      count: createdCount,
      message: `Created ${createdCount} pricing records`
    };
  } catch (err) {
    console.error('[EquipmentPricing] Initialization failed:', err);
    return {
      initialized: false,
      error: err.message || 'Initialization failed',
      count: 0
    };
  }
}
