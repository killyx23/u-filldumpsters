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

const tracksOnHand = (type) => {
  const normalized = String(type || '').toLowerCase();
  return normalized === EquipmentTypes.RENTAL || normalized === EquipmentTypes.CONSUMABLE;
};

const loadBookingEquipment = async (bookingId) => {
  const { data, error } = await supabase
    .from('booking_equipment')
    .select('equipment_id, quantity, equipment(type, name)')
    .eq('booking_id', bookingId);
  if (error) throw error;
  return (data || []).map((row) => ({
    id: row.equipment_id,
    equipment_id: row.equipment_id,
    quantity: Number(row.quantity || 1),
    type: row.equipment?.type || null,
    name: row.equipment?.name || null,
  }));
};

/**
 * Extra units beyond what this booking already holds must be free on the new dates.
 * Same quantity does not need more on-hand stock; the booking date change moves the hold.
 */
export const assertRescheduleStock = async ({
  bookingId,
  newEquipment = [],
  startDate,
  endDate,
} = {}) => {
  try {
    const existing = await loadBookingEquipment(bookingId);
    const { toDecrement } = calculateInventoryChanges(existing, newEquipment);
    for (const item of toDecrement) {
      if (!tracksOnHand(item.type)) continue;
      const check = await checkInventoryAvailability(item.equipment_id, item.quantity, {
        startDate,
        endDate,
        excludeBookingId: bookingId,
      });
      if (!check.available) {
        const name = check.name || 'Equipment';
        const free = Number(check.quantity) || 0;
        return {
          ok: false,
          message: `${name} does not have enough free stock for these dates. Additional available: ${free}.`,
        };
      }
    }
    return { ok: true, previous: existing };
  } catch (error) {
    return { ok: false, message: error.message || 'Could not check equipment inventory.' };
  }
};

const rpcQuantityItems = (items) => items
  .filter((item) => tracksOnHand(item.type) && Number(item.quantity) > 0)
  .map((item) => ({
    equipment_id: item.equipment_id,
    quantity: Number(item.quantity),
  }));

/**
 * Sync booking equipment changes to database.
 * Returns stock with increment_equipment_quantities and takes stock with
 * decrement_equipment_quantities so on-hand cannot go below zero.
 */
export const syncBookingEquipment = async (bookingId, newEquipment = []) => {
  let appliedIncrements = [];
  let appliedDecrements = [];
  let replacedRows = false;
  let previous = [];
  const reverseApplied = async () => {
    if (appliedDecrements.length > 0) {
      await supabase.rpc('increment_equipment_quantities', {
        items_to_increment: appliedDecrements,
      });
    }
    if (appliedIncrements.length > 0) {
      await supabase.rpc('decrement_equipment_quantities', {
        items_to_decrement: appliedIncrements,
      });
    }
  };
  try {
    const existingEquipment = await loadBookingEquipment(bookingId);
    previous = existingEquipment.map((item) => ({
      id: item.id,
      quantity: item.quantity,
      type: item.type,
    }));

    const { toDecrement, toIncrement } = calculateInventoryChanges(
      existingEquipment,
      newEquipment
    );
    const increments = rpcQuantityItems(toIncrement);
    const decrements = rpcQuantityItems(toDecrement);

    if (increments.length > 0) {
      const { error } = await supabase.rpc('increment_equipment_quantities', {
        items_to_increment: increments,
      });
      if (error) throw error;
      appliedIncrements = increments;
    }

    if (decrements.length > 0) {
      const { error } = await supabase.rpc('decrement_equipment_quantities', {
        items_to_decrement: decrements,
      });
      if (error) throw error;
      appliedDecrements = decrements;
    }

    // Delete all existing booking_equipment records for this booking
    const { error: deleteError } = await supabase
      .from('booking_equipment')
      .delete()
      .eq('booking_id', bookingId);

    if (deleteError) throw deleteError;
    replacedRows = true;

    // Insert new equipment records
    if (newEquipment.length > 0) {
      const equipmentRecords = newEquipment
        .filter((eq) => eq.type !== 'insurance' && eq.type !== 'driveway')
        .map((eq) => ({
          booking_id: bookingId,
          equipment_id: Number(eq.id ?? eq.equipment_id),
          quantity: eq.quantity || 1,
          created_at: new Date().toISOString(),
        }))
        .filter((eq) => Number.isFinite(eq.equipment_id) && eq.equipment_id > 0);

      if (equipmentRecords.length > 0) {
        const { error: insertError } = await supabase
          .from('booking_equipment')
          .insert(equipmentRecords);

        if (insertError) throw insertError;
      }
    }

    return { success: true, previous };
  } catch (error) {
    console.error('Error syncing booking equipment:', error);
    try {
      await reverseApplied();
      if (replacedRows && previous.length > 0) {
        await supabase.from('booking_equipment').insert(previous.map((item) => ({
          booking_id: bookingId,
          equipment_id: item.id,
          quantity: item.quantity || 1,
          created_at: new Date().toISOString(),
        })));
      }
    } catch (restoreError) {
      console.error('Error restoring equipment after a failed sync:', restoreError);
    }
    return { success: false, error: error.message, previous };
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