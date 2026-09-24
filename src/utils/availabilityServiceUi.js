/**
 * Maps service ids to availability admin UI and booking time-slot behavior.
 */

export const AVAILABILITY_UI = {
  DELIVERY_WINDOW: 'delivery_window',
  HOURLY_PICKUP: 'hourly_pickup',
  DELIVERY_ONLY: 'delivery_only',
  NONE: 'none',
};

/** @param {number} serviceId */
export function getServiceAvailabilityUiKind(serviceId) {
  const id = Number(serviceId);
  if (id === 1 || id === 4) return AVAILABILITY_UI.DELIVERY_WINDOW;
  if (id === 2 || id === 5 || id === 8) return AVAILABILITY_UI.HOURLY_PICKUP;
  if (id === 3) return AVAILABILITY_UI.DELIVERY_ONLY;
  return AVAILABILITY_UI.NONE;
}

/**
 * Customer pickup at yard (trailer, excavator) — not delivery variant.
 * @param {object|null} plan
 * @param {boolean} [isDelivery]
 */
export function isHourlySelfPickupPlan(plan, isDelivery = false) {
  if (!plan || isDelivery) return false;
  const id = Number(plan.id);
  if (id === 2 || id === 5 || id === 8) return true;
  if (plan.customer_pickup && plan.service_type === 'hourly') return true;
  return false;
}

/**
 * Drop-off times come from get-availability deliverySlots (window / delivery-only services).
 * Includes plan id 4 when a past booking stored the delivery variant as the plan snapshot.
 * @param {object|null} plan
 * @param {boolean} [isDelivery]
 */
export function usesDeliveryWindowSlots(plan, isDelivery = false) {
  if (!plan) return false;
  if (isDelivery) return true;
  const kind = getServiceAvailabilityUiKind(plan.id);
  return kind === AVAILABILITY_UI.DELIVERY_WINDOW || kind === AVAILABILITY_UI.DELIVERY_ONLY;
}

/**
 * Pickup times come from get-availability pickupSlots (delivery-pickup window).
 * @param {object|null} plan
 * @param {boolean} [isDelivery]
 */
export function usesDeliveryPickupSlots(plan, isDelivery = false) {
  if (!plan) return false;
  if (isDelivery) return true;
  return getServiceAvailabilityUiKind(plan.id) === AVAILABILITY_UI.DELIVERY_WINDOW;
}
