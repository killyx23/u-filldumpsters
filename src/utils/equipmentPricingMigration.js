
import { supabase } from '@/lib/customSupabaseClient';
import { getOrCreateEquipmentPricing } from './equipmentPricingIntegration';

/**
 * Determine item_type from equipment record
 */
function determineItemType(equipment) {
  if (!equipment) return 'rental_equipment';
  
  if (equipment.type) {
    if (equipment.type === 'consumable') return 'consumable_item';
    if (equipment.type === 'service') return 'service_item';
    if (equipment.type === 'rental') return 'rental_equipment';
  }
  
  return 'rental_equipment';
}

/**
 * Run equipment pricing migration - populates missing equipment_pricing records
 * @returns {Promise<object>} Migration summary
 */
export async function runEquipmentPricingMigration() {
  console.log('[Migration] Starting equipment pricing migration...');
  
  const summary = {
    timestamp: new Date().toISOString(),
    total_equipment: 0,
    existing_records: 0,
    created_records: 0,
    updated_records: 0,
    errors: 0,
    error_details: [],
    success: false
  };

  try {
    // Step 1: Fetch all equipment
    const { data: allEquipment, error: equipError } = await supabase
      .from('equipment')
      .select('id, name, price, type, service_id_association')
      .order('id');

    if (equipError) {
      console.error('[Migration] Failed to fetch equipment:', equipError);
      summary.error_details.push({ step: 'fetch_equipment', error: equipError.message });
      return summary;
    }

    if (!allEquipment || allEquipment.length === 0) {
      console.log('[Migration] No equipment found');
      summary.success = true;
      return summary;
    }

    summary.total_equipment = allEquipment.length;
    console.log(`[Migration] Found ${summary.total_equipment} equipment records`);

    // Step 2: Fetch all existing equipment_pricing records
    const { data: existingPricing, error: pricingError } = await supabase
      .from('equipment_pricing')
      .select('equipment_id, item_type');

    if (pricingError) {
      console.error('[Migration] Failed to fetch existing pricing:', pricingError);
      summary.error_details.push({ step: 'fetch_pricing', error: pricingError.message });
    }

    const existingMap = new Map();
    if (existingPricing) {
      existingPricing.forEach(record => {
        existingMap.set(record.equipment_id, record);
      });
      summary.existing_records = existingPricing.length;
    }

    console.log(`[Migration] Found ${summary.existing_records} existing pricing records`);

    // Step 3: Process each equipment record
    const recordsToCreate = [];
    const recordsToUpdate = [];

    for (const equipment of allEquipment) {
      const existing = existingMap.get(equipment.id);

      if (!existing) {
        // Create new record
        const itemType = determineItemType(equipment);
        const basePrice = Number(equipment.price || 0);

        recordsToCreate.push({
          equipment_id: equipment.id,
          item_type: itemType,
          base_price: basePrice,
          price_history: [{
            price: basePrice,
            changed_at: new Date().toISOString(),
            changed_by: null,
            change_reason: 'Auto-created during equipment pricing migration',
            action: 'migration'
          }],
          created_at: new Date().toISOString(),
          last_updated: new Date().toISOString()
        });

        console.log(`[Migration] Will create pricing for: ${equipment.name} (ID: ${equipment.id}, Type: ${itemType}, Price: $${basePrice})`);
      } else if (!existing.item_type) {
        // Update record with missing item_type
        const itemType = determineItemType(equipment);
        
        recordsToUpdate.push({
          equipment_id: equipment.id,
          item_type: itemType
        });

        console.log(`[Migration] Will update item_type for: ${equipment.name} (ID: ${equipment.id}, Type: ${itemType})`);
      }
    }

    // Step 4: Insert new records in batches
    if (recordsToCreate.length > 0) {
      console.log(`[Migration] Creating ${recordsToCreate.length} new pricing records...`);
      
      const BATCH_SIZE = 50;
      for (let i = 0; i < recordsToCreate.length; i += BATCH_SIZE) {
        const batch = recordsToCreate.slice(i, i + BATCH_SIZE);
        
        const { error: insertError } = await supabase
          .from('equipment_pricing')
          .insert(batch);

        if (insertError) {
          console.error(`[Migration] Failed to insert batch ${i / BATCH_SIZE + 1}:`, insertError);
          summary.errors += batch.length;
          summary.error_details.push({
            step: 'insert_batch',
            batch: i / BATCH_SIZE + 1,
            error: insertError.message
          });
        } else {
          summary.created_records += batch.length;
          console.log(`[Migration] Created batch ${i / BATCH_SIZE + 1} (${batch.length} records)`);
        }
      }
    }

    // Step 5: Update records with null item_type
    if (recordsToUpdate.length > 0) {
      console.log(`[Migration] Updating ${recordsToUpdate.length} records with missing item_type...`);
      
      for (const record of recordsToUpdate) {
        const { error: updateError } = await supabase
          .from('equipment_pricing')
          .update({ 
            item_type: record.item_type,
            last_updated: new Date().toISOString()
          })
          .eq('equipment_id', record.equipment_id);

        if (updateError) {
          console.error(`[Migration] Failed to update equipment ${record.equipment_id}:`, updateError);
          summary.errors++;
          summary.error_details.push({
            step: 'update_item_type',
            equipment_id: record.equipment_id,
            error: updateError.message
          });
        } else {
          summary.updated_records++;
        }
      }
    }

    // Step 6: Final verification
    const { data: finalPricing, error: verifyError } = await supabase
      .from('equipment_pricing')
      .select('equipment_id', { count: 'exact' });

    if (!verifyError && finalPricing) {
      const finalCount = finalPricing.length;
      const expected = summary.total_equipment;
      
      if (finalCount >= expected) {
        summary.success = true;
        console.log(`[Migration] ✓ Migration successful! All ${expected} equipment have pricing records.`);
      } else {
        console.warn(`[Migration] ⚠ Migration incomplete. Expected ${expected}, found ${finalCount} pricing records.`);
        summary.success = false;
      }
    }

    console.log('[Migration] Summary:', summary);
    return summary;

  } catch (err) {
    console.error('[Migration] Fatal error:', err);
    summary.error_details.push({
      step: 'fatal',
      error: err.message
    });
    return summary;
  }
}

/**
 * Verify equipment_pricing table structure
 */
async function verifyEquipmentPricingTable() {
  try {
    const { data, error } = await supabase
      .from('equipment_pricing')
      .select('id, equipment_id, base_price, item_type, created_at')
      .limit(1);

    if (error) {
      console.error('[Migration] equipment_pricing table verification failed:', error);
      return false;
    }

    console.log('[Migration] equipment_pricing table verified');
    return true;
  } catch (err) {
    console.error('[Migration] equipment_pricing table check error:', err);
    return false;
  }
}

/**
 * Verify bookings table has price_snapshot field
 */
async function verifyBookingsPriceSnapshot() {
  try {
    const { data, error } = await supabase
      .from('bookings')
      .select('id, addons')
      .limit(1);

    if (error) {
      console.error('[Migration] Bookings table verification failed:', error);
      return false;
    }

    console.log('[Migration] Bookings table verified (price snapshots stored in addons field)');
    return true;
  } catch (err) {
    console.error('[Migration] Bookings table check error:', err);
    return false;
  }
}

/**
 * Run complete migration and verification
 */
export async function runMigration() {
  console.log('[Migration] Starting equipment pricing migration...');
  
  const results = {
    timestamp: new Date().toISOString(),
    equipmentPricingVerified: false,
    equipmentPricingInitialized: false,
    bookingsVerified: false,
    migrationSummary: null,
    errors: []
  };

  try {
    // Step 1: Verify equipment_pricing table
    results.equipmentPricingVerified = await verifyEquipmentPricingTable();
    
    if (!results.equipmentPricingVerified) {
      results.errors.push('equipment_pricing table verification failed');
      console.error('[Migration] ❌ Migration failed: equipment_pricing table not accessible');
      return results;
    }

    // Step 2: Run migration
    const migrationResult = await runEquipmentPricingMigration();
    results.migrationSummary = migrationResult;
    results.equipmentPricingInitialized = migrationResult.success;
    
    if (!migrationResult.success) {
      results.errors.push(...migrationResult.error_details.map(e => e.error));
    }

    // Step 3: Verify bookings table
    results.bookingsVerified = await verifyBookingsPriceSnapshot();

    if (!results.bookingsVerified) {
      results.errors.push('Bookings table verification failed');
    }

    // Summary
    const success = results.equipmentPricingVerified && 
                    results.equipmentPricingInitialized && 
                    results.bookingsVerified;

    if (success) {
      console.log('[Migration] ✓ Migration completed successfully', results);
    } else {
      console.error('[Migration] ⚠ Migration completed with errors', results);
    }

    return results;
  } catch (err) {
    console.error('[Migration] Fatal migration error:', err);
    results.errors.push(err.message);
    return results;
  }
}

/**
 * Get migration status
 */
export async function getMigrationStatus() {
  const status = {
    equipmentPricingExists: false,
    equipmentPricingCount: 0,
    totalEquipment: 0,
    missingRecords: 0,
    nullItemTypes: 0,
    bookingsWithSnapshots: 0,
    errors: []
  };

  try {
    // Check equipment_pricing
    const { data: pricingData, error: pricingError } = await supabase
      .from('equipment_pricing')
      .select('equipment_id, item_type', { count: 'exact' });

    if (!pricingError) {
      status.equipmentPricingExists = true;
      status.equipmentPricingCount = pricingData?.length || 0;
      status.nullItemTypes = pricingData?.filter(p => !p.item_type).length || 0;
    } else {
      status.errors.push('equipment_pricing table not accessible');
    }

    // Check total equipment
    const { data: equipmentData, error: equipError } = await supabase
      .from('equipment')
      .select('id', { count: 'exact' });

    if (!equipError) {
      status.totalEquipment = equipmentData?.length || 0;
      status.missingRecords = Math.max(0, status.totalEquipment - status.equipmentPricingCount);
    }

    // Check bookings with snapshots
    const { data: bookingsData, error: bookingsError } = await supabase
      .from('bookings')
      .select('id, addons')
      .not('addons->priceSnapshot', 'is', null);

    if (!bookingsError) {
      status.bookingsWithSnapshots = bookingsData?.length || 0;
    }

    return status;
  } catch (err) {
    console.error('[Migration] Status check error:', err);
    status.errors.push(err.message);
    return status;
  }
}
