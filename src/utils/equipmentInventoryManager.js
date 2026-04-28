import { supabase } from '@/lib/customSupabaseClient';

/**
 * Equipment Inventory Manager
 * Handles inventory tracking for different equipment types:
 * - rental: Track quantity, decrement on booking, increment on return
 * - consumable: Permanently decrease inventory on sale
 * - service: No inventory tracking (unlimited availability)
 */

export const EquipmentTypes = {
  RENTAL: 'rental',
  CONSUMABLE: 'consumable',
  SERVICE: 'service'
};

/**
 * Calculate inventory changes when equipment is added/removed from booking
 * @param {Array} originalEquipment - Original equipment list
 * @param {Array} newEquipment - Updated equipment list
 * @returns {Object} { toDecrement: [], toIncrement: [] }
 */
export const calculateInventoryChanges = (originalEquipment = [], newEquipment = []) => {
  const toDecrement = [];
  const toIncrement = [];

  // Create maps for easy lookup
  const originalMap = new Map();
  originalEquipment.forEach(eq => {
    const key = eq.id || eq.equipment_id;
    originalMap.set(key, eq.quantity || 1);
  });

  const newMap = new Map();
  newEquipment.forEach(eq => {
    const key = eq.id || eq.equipment_id;
    newMap.set(key, eq.quantity || 1);
  });

  // Find items to decrement (new items or increased quantities)
  newEquipment.forEach(eq => {
    const key = eq.id || eq.equipment_id;
    const newQty = eq.quantity || 1;
    const oldQty = originalMap.get(key) || 0;
    
    if (newQty > oldQty) {
      toDecrement.push({
        equipment_id: key,
        quantity: newQty - oldQty,
        type: eq.type
      });
    }
  });

  // Find items to increment (removed items or decreased quantities)
  originalEquipment.forEach(eq => {
    const key = eq.id || eq.equipment_id;
    const oldQty = eq.quantity || 1;
    const newQty = newMap.get(key) || 0;
    
    if (oldQty > newQty) {
      toIncrement.push({
        equipment_id: key,
        quantity: oldQty - newQty,
        type: eq.type
      });
    }
  });

  return { toDecrement, toIncrement };
};

/**
 * Update equipment inventory based on type
 * @param {number} equipmentId - Equipment ID
 * @param {number} quantityChange - Positive to decrease, negative to increase
 * @param {string} type - Equipment type (rental/consumable/service)
 */
export const updateInventory = async (equipmentId, quantityChange, type) => {
  // Services don't track inventory
  if (type === EquipmentTypes.SERVICE) {
    return { success: true };
  }

  const { data: equipment, error: fetchError } = await supabase
    .from('equipment')
    .select('total_quantity, name')
    .eq('id', equipmentId)
    .single();

  if (fetchError) {
    console.error('Error fetching equipment:', fetchError);
    return { success: false, error: fetchError.message };
  }

  const newQuantity = equipment.total_quantity - quantityChange;

  if (newQuantity < 0) {
    return { 
      success: false, 
      error: `Insufficient inventory for ${equipment.name}. Available: ${equipment.total_quantity}` 
    };
  }

  const { error: updateError } = await supabase
    .from('equipment')
    .update({ total_quantity: newQuantity })
    .eq('id', equipmentId);

  if (updateError) {
    console.error('Error updating inventory:', updateError);
    return { success: false, error: updateError.message };
  }

  return { success: true, newQuantity };
};

/**
 * Check if sufficient inventory is available
 * @param {number} equipmentId - Equipment ID
 * @param {number} requestedQuantity - Quantity requested
 */
export const checkInventoryAvailability = async (equipmentId, requestedQuantity) => {
  const { data: equipment, error } = await supabase
    .from('equipment')
    .select('total_quantity, name, type')
    .eq('id', equipmentId)
    .single();

  if (error) {
    console.error('Error checking inventory:', error);
    return { available: false, error: error.message };
  }

  // Services are always available
  if (equipment.type === EquipmentTypes.SERVICE) {
    return { available: true, quantity: 9999 };
  }

  const available = equipment.total_quantity >= requestedQuantity;
  
  return {
    available,
    quantity: equipment.total_quantity,
    name: equipment.name,
    shortage: available ? 0 : requestedQuantity - equipment.total_quantity
  };
};

/**
 * Sync booking equipment changes to database
 * @param {number} bookingId - Booking ID
 * @param {Array} newEquipment - New equipment list
 */
export const syncBookingEquipment = async (bookingId, newEquipment = []) => {
  try {
    // Fetch existing equipment for this booking
    const { data: existingEquipment, error: fetchError } = await supabase
      .from('booking_equipment')
      .select('*, equipment(*)')
      .eq('booking_id', bookingId);

    if (fetchError) throw fetchError;

    // Calculate what needs to change
    const { toDecrement, toIncrement } = calculateInventoryChanges(
      existingEquipment.map(e => ({
        id: e.equipment_id,
        quantity: e.quantity,
        type: e.equipment?.type
      })),
      newEquipment
    );

    // Update inventory for rentals and consumables
    for (const item of toDecrement) {
      if (item.type !== EquipmentTypes.SERVICE) {
        const result = await updateInventory(item.equipment_id, item.quantity, item.type);
        if (!result.success) {
          throw new Error(result.error);
        }
      }
    }

    for (const item of toIncrement) {
      if (item.type === EquipmentTypes.RENTAL) {
        await updateInventory(item.equipment_id, -item.quantity, item.type);
      }
      // Consumables cannot be returned to inventory
    }

    // Delete all existing booking_equipment records for this booking
    const { error: deleteError } = await supabase
      .from('booking_equipment')
      .delete()
      .eq('booking_id', bookingId);

    if (deleteError) throw deleteError;

    // Insert new equipment records
    if (newEquipment.length > 0) {
      const equipmentRecords = newEquipment
        .filter(eq => eq.type !== 'insurance') // Insurance is not stored in booking_equipment
        .map(eq => ({
          booking_id: bookingId,
          equipment_id: eq.id,
          quantity: eq.quantity || 1,
          created_at: new Date().toISOString()
        }));

      if (equipmentRecords.length > 0) {
        const { error: insertError } = await supabase
          .from('booking_equipment')
          .insert(equipmentRecords);

        if (insertError) throw insertError;
      }
    }

    return { success: true };
  } catch (error) {
    console.error('Error syncing booking equipment:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Mark rental equipment as returned
 * @param {number} bookingId - Booking ID
 * @param {number} equipmentId - Equipment ID
 */
export const markEquipmentReturned = async (bookingId, equipmentId) => {
  const { data, error } = await supabase
    .from('booking_equipment')
    .update({ returned_at: new Date().toISOString() })
    .eq('booking_id', bookingId)
    .eq('equipment_id', equipmentId)
    .select('*, equipment(*)')
    .single();

  if (error) {
    console.error('Error marking equipment returned:', error);
    return { success: false, error: error.message };
  }

  // Return rental equipment to inventory
  if (data.equipment?.type === EquipmentTypes.RENTAL) {
    await updateInventory(equipmentId, -data.quantity, EquipmentTypes.RENTAL);
  }

  return { success: true, data };
};