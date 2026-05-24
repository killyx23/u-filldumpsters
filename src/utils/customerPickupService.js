/**
 * Customer pickup services: customer travels to the business yard (not company delivery).
 * Add plan IDs here when new self-pickup rentals ship.
 */
export const CUSTOMER_PICKUP_PLAN_IDS = [2]; // Dump Loader Trailer; add 5 (excavator) when ready

/**
 * @param {object} plan - Booking plan JSON
 * @param {object} addons - Booking addons JSON
 * @returns {boolean}
 */
export function isCustomerPickupService(plan, addons = {}) {
  if (!plan) return false;
  const isDelivery = addons?.deliveryService || addons?.isDelivery;
  if (isDelivery) return false;
  return CUSTOMER_PICKUP_PLAN_IDS.includes(Number(plan.id));
}
