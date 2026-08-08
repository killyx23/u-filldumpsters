/**
 * Customer pickup: customer travels to the yard (not company delivery).
 * Prefer services.customer_pickup from DB; audit plan fallback for legacy rows.
 */

/**
 * @param {object} plan - Live service row or audit plan snapshot
 * @param {object} addons - Booking addons JSON
 * @returns {boolean}
 */
export function isCustomerPickupService(plan, addons = {}) {
  if (!plan) return false;
  const isDelivery = addons?.deliveryService || addons?.isDelivery;
  if (isDelivery) return false;
  if (plan.customer_pickup === true) return true;
  const id = Number(plan.id);
  return id === 2 || id === 5 || id === 8;
}
