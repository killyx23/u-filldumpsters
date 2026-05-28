/**
 * Single source of truth: public.services for live catalog.
 * bookings.plan JSONB = immutable audit snapshot at checkout (buildPlanSnapshot).
 */

/**
 * Resolve effective service id (base vs delivery variant).
 * @param {object} service - Row from services
 * @param {boolean} isDelivery
 * @returns {number}
 */
export function resolveServiceIdForBooking(service, isDelivery = false) {
  if (!service) return null;
  if (isDelivery && service.delivery_variant_service_id) {
    return Number(service.delivery_variant_service_id);
  }
  return Number(service.id);
}

/**
 * Map DB service row to plan card / journey shape.
 * @param {object} service
 * @param {number} [displayOrderIndex] - for highlight animation delay
 */
export function mapServiceToPlanCard(service, displayOrderIndex = 0) {
  if (!service) return null;
  const highlightText = service.homepage_highlight?.trim();
  return {
    ...service,
    highlight: highlightText
      ? { text: highlightText, delay: 0.1 + displayOrderIndex * 0.1 }
      : undefined,
    displayPrice: service.homepage_price ?? service.base_price ?? 0,
    displayPriceUnit: service.homepage_price_unit ?? service.price_unit ?? '',
    displayDescription: service.homepage_description || service.description || '',
  };
}

/**
 * Immutable snapshot for bookings.plan at payment time only.
 * @param {object} service - Full service row at checkout
 * @param {object} [overrides]
 * @param {number} [overrides.price] - Quoted base rental
 * @param {number} [overrides.mileage_rate]
 * @param {number} [overrides.delivery_fee]
 */
export function buildPlanSnapshot(service, overrides = {}) {
  if (!service) return null;
  const bookedAt = new Date().toISOString();
  const price =
    overrides.price !== undefined && overrides.price !== null
      ? Number(overrides.price)
      : Number(service.base_price ?? 0);

  return {
    id: Number(service.id),
    service_id: Number(service.id),
    name: service.name,
    description: service.description ?? null,
    base_price: Number(service.base_price ?? 0),
    price,
    price_unit: service.price_unit ?? null,
    sale_price: service.sale_price ?? null,
    weekly_rate: service.weekly_rate ?? null,
    daily_rate: service.daily_rate ?? null,
    service_type: service.service_type ?? null,
    features: service.features ?? null,
    occupancy_model: service.occupancy_model ?? null,
    mileage_rate:
      overrides.mileage_rate !== undefined
        ? Number(overrides.mileage_rate)
        : Number(service.mileage_rate ?? 0),
    delivery_fee:
      overrides.delivery_fee !== undefined
        ? Number(overrides.delivery_fee)
        : Number(service.delivery_fee ?? 0),
    booked_at: bookedAt,
  };
}

/**
 * Service id from booking audit plan or pending row.
 * @param {object} bookingOrPending
 */
export function getServiceIdFromBooking(bookingOrPending) {
  if (!bookingOrPending) return null;
  if (bookingOrPending.service_id != null) {
    return Number(bookingOrPending.service_id);
  }
  const plan = bookingOrPending.plan || bookingOrPending.plan_data;
  if (!plan) return null;
  if (plan.service_id != null) return Number(plan.service_id);
  if (plan.id != null) return Number(plan.id);
  return null;
}

/**
 * For live UI: prefer services table; audit plan fills gaps and historical pricing.
 * @param {object} booking - bookings row
 * @param {object|null} liveService - from services table
 * @returns {{ serviceId: number|null, service: object|null, auditPlan: object, displayName: string, isCustomerPickup: boolean }}
 */
export function resolveBookingService(booking, liveService = null) {
  const auditPlan = booking?.plan || {};
  const addons = booking?.addons || {};
  const serviceId = getServiceIdFromBooking(booking);
  const service = liveService || null;

  const isDelivery = Boolean(
    addons.isDelivery || addons.deliveryService || booking?.delivery_service
  );

  const displayName = service?.name || auditPlan.name || 'Service';
  const isCustomerPickup = service
    ? Boolean(service.customer_pickup) && !isDelivery
    : isCustomerPickupFromAudit(auditPlan, addons);

  return {
    serviceId,
    service,
    auditPlan,
    displayName,
    isCustomerPickup,
    isDelivery,
    serviceType: service?.service_type ?? auditPlan.service_type,
    /** Operational plan shape: live service merged with audit pricing fields */
    planForLogic: service
      ? {
          ...service,
          id: serviceId ?? service.id,
          price: auditPlan.price ?? auditPlan.base_price ?? service.base_price,
          base_price: auditPlan.base_price ?? service.base_price,
          mileage_rate: auditPlan.mileage_rate ?? service.mileage_rate,
          delivery_fee: auditPlan.delivery_fee ?? service.delivery_fee,
        }
      : auditPlan,
  };
}

function isCustomerPickupFromAudit(auditPlan, addons) {
  if (!auditPlan?.id) return false;
  if (addons?.isDelivery || addons?.deliveryService) return false;
  const pickupIds = [2, 5];
  return pickupIds.includes(Number(auditPlan.id));
}

/**
 * Fetch a service by id from Supabase.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {number} serviceId
 */
export async function fetchServiceById(supabase, serviceId) {
  if (!serviceId) return { data: null, error: null };
  return supabase.from('services').select('*').eq('id', serviceId).maybeSingle();
}

/** Default homepage catalog when flags are missing or unset. */
export const HOMEPAGE_SERVICE_IDS = [1, 2, 3, 5];

const HERO_STATIC_FALLBACK = [
  { id: 1, name: '16 Yard Dumpster' },
  { id: 2, name: 'Dump Loader Trailer Rental Service' },
  { id: 3, name: 'Rock, Decorative Rock, Mulch, & Gravel Delivery Service' },
  { id: 5, name: 'Mini Excavator Rental Service' },
];

export function getHeroStaticFallback() {
  return HERO_STATIC_FALLBACK;
}

/**
 * Legacy homepage fetch by known service ids (pre-migration or empty flags).
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
export async function fetchHomepageServicesLegacy(supabase) {
  return supabase
    .from('services')
    .select('*')
    .in('id', HOMEPAGE_SERVICE_IDS)
    .order('id');
}

/**
 * Fetch all homepage services; falls back to legacy ids on error or empty result.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
export async function fetchHomepageServices(supabase) {
  const filtered = await supabase
    .from('services')
    .select('*')
    .eq('show_on_homepage', true)
    .order('display_order', { ascending: true });

  if (!filtered.error && filtered.data?.length > 0) {
    return filtered;
  }

  if (filtered.error) {
    console.warn('[servicePlan] Homepage flag query failed, using legacy ids:', filtered.error.message);
  } else {
    console.warn('[servicePlan] No show_on_homepage services; using legacy ids');
  }

  return fetchHomepageServicesLegacy(supabase);
}

/**
 * Batch-fetch services by ids.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {number[]} ids
 */
export async function fetchServicesByIds(supabase, ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return { data: [], error: null };
  return supabase.from('services').select('*').in('id', unique);
}
