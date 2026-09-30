import { format, isValid, parseISO } from 'date-fns';
import { supabase } from '@/lib/customSupabaseClient';

/** Calendar date (yyyy-MM-dd) for inventory overlap checks. */
export function toInventoryDate(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return isValid(value) ? format(value, 'yyyy-MM-dd') : null;
  }
  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    const parsed = parseISO(value);
    return isValid(parsed) ? format(parsed, 'yyyy-MM-dd') : null;
  }
  return null;
}

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
 * Bookable qty for UI/checkout until holds are date-aware end-to-end.
 * Rentals: min(date-aware, on-hand). Other types: date-aware (or on-hand).
 */
export function holdableQuantity({
  type,
  dateAwareQuantity,
  onHandQuantity,
} = {}) {
  const onHand = Number(onHandQuantity);
  const dateAware = Number(dateAwareQuantity);
  const safeOnHand = Number.isFinite(onHand) ? Math.max(0, onHand) : 0;
  const safeDateAware = Number.isFinite(dateAware) ? Math.max(0, dateAware) : safeOnHand;
  const isRental = String(type || '').toLowerCase() === EquipmentTypes.RENTAL;
  if (isRental) return Math.min(safeDateAware, safeOnHand);
  return safeDateAware;
}

/** Resolve bookable qty from a get-equipment-inventory row. */
export function bookableFromInventoryRow(row) {
  if (!row) return 0;
  return holdableQuantity({
    type: row.type,
    dateAwareQuantity: row.available_quantity ?? row.total_quantity,
    onHandQuantity: row.on_hand_quantity ?? row.total_quantity,
  });
}

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
 * On-hand stock, plus rental units that are checked out on a different set of days.
 * Returns null when the date-aware database function is not available yet.
 */
export async function fetchEquipmentAvailability({ startDate, endDate, excludeBookingId } = {}) {
  const start = toInventoryDate(startDate);
  const end = toInventoryDate(endDate) || start;
  if (!start || !end) return null;

  const { data, error } = await supabase.rpc('equipment_inventory_snapshot', {
    p_start: start,
    p_end: end,
    p_exclude_booking_id: excludeBookingId ?? null,
  });

  if (error) {
    console.warn('[equipment availability] date-aware stock unavailable:', error.message);
    return null;
  }
  return data || [];
}

export function stockForEquipment(inventoryItem) {
  if (!inventoryItem) return 0;
  const dated = inventoryItem.available_quantity;
  if (dated != null && dated !== '') return Number(dated);
  return Number(inventoryItem.total_quantity || 0);
}

export const checkInventoryAvailability = async (equipmentId, requestedQuantity, options = {}) => {
  const start = toInventoryDate(options.startDate);
  const end = toInventoryDate(options.endDate) || start;

  const { data: equipment, error: equipmentError } = await supabase
    .from('equipment')
    .select('total_quantity, name, type')
    .eq('id', equipmentId)
    .single();

  if (equipmentError) {
    console.error('Error checking inventory:', equipmentError);
    return { available: false, error: equipmentError.message };
  }

  // Services are always available
  if (equipment.type === EquipmentTypes.SERVICE) {
    return { available: true, quantity: 9999 };
  }

  const onHand = Number(equipment.total_quantity ?? 0);
  let dateAware = onHand;

  if (start && end) {
    const { data, error } = await supabase.rpc('equipment_quantity_available', {
      p_equipment_id: equipmentId,
      p_start: start,
      p_end: end,
      p_exclude_booking_id: options.excludeBookingId ?? null,
    });
    if (!error && data != null) {
      dateAware = Number(data);
    }
  }

  const quantity = holdableQuantity({
    type: equipment.type,
    dateAwareQuantity: dateAware,
    onHandQuantity: onHand,
  });
  const available = quantity >= requestedQuantity;

  return {
    available,
    quantity,
    onHand,
    dateAware,
    name: equipment.name,
    type: equipment.type,
    shortage: available ? 0 : requestedQuantity - quantity,
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
      if (item.type === EquipmentTypes.RENTAL || item.type === EquipmentTypes.CONSUMABLE) {
        await updateInventory(item.equipment_id, -item.quantity, item.type);
      }
      // Services have no inventory to restore
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