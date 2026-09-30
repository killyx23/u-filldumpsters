/**
 * Recognising the database's "resource is fully booked" rejection.
 *
 * Availability shown in the calendar is advisory: it is read before checkout, so two customers
 * can both be told a day is free and both proceed. The check_booking_inventory_capacity trigger
 * is what actually prevents the oversell, and it rejects the losing write.
 *
 * That rejection arrives as P0001, which is also the default code for roughly fifty unrelated
 * RAISE statements elsewhere in the schema. Matching the code alone would report unrelated
 * failures as "fully booked", so the trigger tags itself in DETAIL and names the exhausted
 * resource in HINT.
 */

const CAPACITY_MARKER = 'booking_capacity_exceeded';

export function isBookingCapacityError(error) {
  if (!error) return false;
  const fields = [error.details, error.detail, error.message, error.hint];
  return fields.some((field) => typeof field === 'string' && field.includes(CAPACITY_MARKER));
}

/**
 * Customer-facing copy for a capacity rejection. The raw database message quotes internal
 * stock levels ("1 of 1 units already in use"), which we keep out of the UI.
 *
 * @param {{hint?: string}|null} error
 * @returns {{title: string, description: string}}
 */
export function describeBookingCapacityError(error) {
  const hint = typeof error?.hint === 'string' ? error.hint.trim() : '';
  const resource = hint && !hint.includes(CAPACITY_MARKER) ? hint : '';
  const what = resource ? `the last available ${resource}` : 'the last available equipment';

  return {
    title: 'Those Dates Just Filled Up',
    description:
      `Another customer reserved ${what} for your dates while you were checking out. ` +
      'You have not been charged. Please go back and pick different dates, and the calendar ' +
      'will show what is still open.',
  };
}

const EQUIPMENT_STOCK_MARKER = 'equipment_insufficient_stock';

export function isEquipmentStockError(error) {
  if (!error) return false;
  const fields = [error.details, error.detail, error.message, error.hint, error.code];
  return fields.some(
    (field) => typeof field === 'string' && field.includes(EQUIPMENT_STOCK_MARKER)
  );
}

/**
 * Customer-facing copy when rental add-ons (dump cart / hand truck) cannot be held.
 * @param {{hint?: string, message?: string}|null} error
 * @returns {{title: string, description: string}}
 */
export function describeEquipmentStockError(error) {
  const hint = typeof error?.hint === 'string' ? error.hint.trim() : '';
  const named =
    hint && !hint.includes(EQUIPMENT_STOCK_MARKER) ? hint : '';
  const what = named || 'a rental add-on';

  return {
    title: 'Rental Gear Just Sold Out',
    description:
      `Another customer reserved ${what} while you were checking out. ` +
      'You have not been charged. Please go back and update your add-ons, then try again.',
  };
}

/** Build a thrown Error that isEquipmentStockError recognizes. */
export function equipmentStockErrorFromRpc(rpcError) {
  const { title, description } = describeEquipmentStockError(rpcError);
  const err = new Error(description);
  err.title = title;
  err.details = EQUIPMENT_STOCK_MARKER;
  err.detail = EQUIPMENT_STOCK_MARKER;
  err.hint = typeof rpcError?.hint === 'string' ? rpcError.hint : undefined;
  return err;
}
