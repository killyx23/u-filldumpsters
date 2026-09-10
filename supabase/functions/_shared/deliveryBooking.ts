/**
 * Delivery vs yard self-pickup. PIN create / PIN email / lock confirm must skip delivery.
 *
 * Primary flag: addons.isDelivery (and deliveryService). Also honor delivery_type and
 * always-delivered catalog services (dumpster #1, dump trailer with delivery #4) when
 * the JSON flag is missing.
 */

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // ignore
    }
  }
  return {};
}

/** Catalog services that are always company delivery (not a yard padlock pickup). */
export const ALWAYS_DELIVERY_PLAN_IDS = [1, 4];

export function isDeliveryBooking(
  booking: Record<string, unknown> | null | undefined,
): boolean {
  if (!booking) return false;
  const addons = asRecord(booking.addons);
  const plan = asRecord(booking.plan);
  if (addons.isDelivery === true || addons.deliveryService === true) return true;
  if (booking.delivery_service === true) return true;
  if (String(booking.delivery_type || "").toLowerCase() === "delivery") return true;
  const planId = Number(plan.id);
  return ALWAYS_DELIVERY_PLAN_IDS.includes(planId);
}

/**
 * True when this booking should get a yard padlock PIN (create, confirm, email/SMS).
 * Delivery is always excluded, even if the plan name contains "trailer".
 */
export function bookingNeedsYardLockPin(
  booking: Record<string, unknown> | null | undefined,
): boolean {
  if (!booking || isDeliveryBooking(booking)) return false;
  const plan = asRecord(booking.plan);
  const name = String(plan.name ?? booking.service_name ?? "").toLowerCase();
  const serviceType = String(plan.service_type ?? booking.service_type ?? "");
  return (
    serviceType === "trailer_rental" ||
    Number(plan.id) === 2 ||
    Number(plan.id) === 5 ||
    name.includes("dump loader") ||
    name.includes("dump trailer") ||
    name.includes("trailer") ||
    plan.customer_pickup === true
  );
}
