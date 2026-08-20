import {
  DIY_HOMEPAGE_DISPLAY_NAME,
  DIY_HOMEPAGE_DESCRIPTION,
  DIY_HOMEPAGE_PICKUP_FEATURE,
} from '@/config/diyEquipmentMachines';
import { formatCustomerFacingPlanName } from '@/utils/displayPlanName';

/**
 * Single source of truth: public.services for live catalog.
 * bookings.plan JSONB = immutable audit snapshot at checkout (buildPlanSnapshot).
 */

/**
 * Delivery-variant row id for a base service (e.g. 2 → 4).
 * Falls back to 4 for legacy dump-trailer rows that never got the pointer.
 * @param {object|null|undefined} service
 * @returns {number|null}
 */
export function getDeliveryVariantServiceId(service) {
  if (!service) return null;
  const pointed = Number(service.delivery_variant_service_id);
  if (Number.isFinite(pointed) && pointed > 0) return pointed;
  if (Number(service.id) === 2) return 4;
  return null;
}

/**
 * True when the customer should see the "need delivery / no truck" toggle.
 * @param {object|null|undefined} service
 */
export function serviceOffersDeliveryOption(service) {
  return getDeliveryVariantServiceId(service) != null;
}

/**
 * Resolve effective service id (base vs delivery variant).
 * @param {object} service - Row from services
 * @param {boolean} isDelivery
 * @returns {number}
 */
export function resolveServiceIdForBooking(service, isDelivery = false) {
  if (!service) return null;
  if (isDelivery) {
    return getDeliveryVariantServiceId(service) ?? Number(service.id);
  }
  return Number(service.id);
}

const DELIVERY_FEE_FEATURE_RE = /delivery\s*fee/i;

/**
 * Homepage feature bullets: strip stale dollar amounts from JSON and inject live admin fields.
 * @param {object} service - Row from services
 */
export function resolvePlanCardFeatures(service) {
  if (!service) return { features: [], deliveryFee: null };
  let list = [];
  try {
    const raw = service.features;
    if (Array.isArray(raw)) list = [...raw];
    else if (typeof raw === 'string' && raw.trim()) list = JSON.parse(raw);
  } catch {
    list = [];
  }

  const features = list.filter((f) => {
    if (typeof f === 'object' && f !== null) {
      return !DELIVERY_FEE_FEATURE_RE.test(String(f.name || ''));
    }
    return true;
  });

  const fee = Number(service.delivery_fee ?? 0);
  const deliveryFee = fee > 0 ? fee : null;

  return { features, deliveryFee };
}

/**
 * Map DB service row to plan card / journey shape.
 * @param {object} service
 * @param {number} [displayOrderIndex] - for highlight animation delay
 */
export function mapServiceToPlanCard(service, displayOrderIndex = 0) {
  if (!service) return null;
  const fallbackHighlights = {
    5: 'Save Your Back & Time',
  };
  const highlightText =
    service.homepage_highlight?.trim() || fallbackHighlights[Number(service.id)] || '';
  const isDumpsterHomepage = Number(service.id) === 1;
  const isDiyHomepage = Number(service.id) === 5;
  const { features: rawFeatures, deliveryFee } = resolvePlanCardFeatures(service);
  const displayFeatures = isDiyHomepage
    ? rawFeatures.map((feature) => {
        if (typeof feature !== 'string') return feature;
        if (/^you pick up/i.test(feature)) return DIY_HOMEPAGE_PICKUP_FEATURE;
        return feature;
      })
    : rawFeatures;
  return {
    ...service,
    highlight: highlightText
      ? { text: highlightText, delay: 0.1 + displayOrderIndex * 0.1 }
      : undefined,
    displayPrice: service.homepage_price ?? service.base_price ?? 0,
    displayPriceUnit: isDumpsterHomepage
      ? 'Daily Rate'
      : service.homepage_price_unit ?? service.price_unit ?? '',
    displayDescription: isDiyHomepage
      ? DIY_HOMEPAGE_DESCRIPTION
      : service.homepage_description || service.description || '',
    displayFeatures,
    displayDeliveryFee: deliveryFee,
    // Service 5 books as Mini Excavator, but the homepage category card stays Compact Equipment Rental.
    displayName: isDiyHomepage
      ? DIY_HOMEPAGE_DISPLAY_NAME
      : service.name?.trim() || highlightText || 'Service Plan',
    displayDeliveryFeeLabel: isDumpsterHomepage ? 'Delivery & Pickup Fee' : undefined,
    showWeeklyRatesAvailable: isDumpsterHomepage,
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

  const displayName = formatCustomerFacingPlanName(
    service?.name || auditPlan.name || 'Service'
  );
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
  const pickupIds = [2, 5, 8];
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
export const HOMEPAGE_SERVICE_IDS = [2, 1, 5, 3];

/** Non-rentable legacy rows (e.g. Premium Insurance service id 7). */
export const NON_RENTABLE_SERVICE_IDS = [7];

/**
 * Exclude protection-plan legacy service rows from rentable service pickers.
 * @param {object[]} services
 */
export function filterRentableServices(services = []) {
  return (services || []).filter((service) => {
    const id = Number(service?.id);
    if (NON_RENTABLE_SERVICE_IDS.includes(id)) return false;
    if (service?.is_rentable === false) return false;
    return true;
  });
}

/**
 * Drop rows that are another service's delivery_variant_service_id (e.g. hide 4 next to 2).
 * Customer catalogs should show the base SKU only; the variant is the checkbox.
 * @param {object[]} services
 */
export function excludeDeliveryVariantServices(services = []) {
  const list = services || [];
  const variantIds = new Set(
    list
      .map((service) => Number(service?.delivery_variant_service_id))
      .filter((id) => Number.isFinite(id) && id > 0)
  );
  // Legacy dump-trailer delivery row even if the pointer is missing on this result set.
  variantIds.add(4);
  return list.filter((service) => !variantIds.has(Number(service?.id)));
}

/**
 * Rentable services that customers pick (homepage, reschedule), excluding delivery twins.
 * @param {object[]} services
 */
export function filterCustomerCatalogServices(services = []) {
  return excludeDeliveryVariantServices(filterRentableServices(services));
}

const HERO_STATIC_FALLBACK = [
  { id: 2, name: 'Dump Trailer Rental Service' },
  { id: 1, name: 'Dumpster Rental' },
  { id: 5, name: 'Compact Equipment Rental' },
  { id: 3, name: 'Rock, Decorative Rock, Mulch, & Gravel Delivery Service' },
];

export function getHeroStaticFallback() {
  return HERO_STATIC_FALLBACK;
}

/**
 * Legacy homepage fetch by known service ids (pre-migration or empty flags).
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
export async function fetchHomepageServicesLegacy(supabase) {
  const result = await supabase
    .from('services')
    .select('*')
    .in('id', HOMEPAGE_SERVICE_IDS)
    .order('id');
  if (result.data) {
    return { ...result, data: filterCustomerCatalogServices(result.data) };
  }
  return result;
}

/**
 * Fetch all homepage services; falls back to legacy ids on error or empty result.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
export async function fetchHomepageServices(supabase) {
  // services_resolved (Phase 3) is a view over services left-joined to service_groups, so this
  // carries group_slug/group_name/group_display_order plus resolved_* fallback columns for free.
  const filtered = await supabase
    .from('services_resolved')
    .select('*')
    .eq('show_on_homepage', true)
    .order('group_display_order', { ascending: true, nullsFirst: false })
    .order('display_order', { ascending: true });

  if (!filtered.error && filtered.data?.length > 0) {
    return { ...filtered, data: filterCustomerCatalogServices(filtered.data) };
  }

  if (filtered.error) {
    console.warn('[servicePlan] Homepage flag query failed, using legacy ids:', filtered.error.message);
  } else {
    console.warn('[servicePlan] No show_on_homepage services; using legacy ids');
  }

  return fetchHomepageServicesLegacy(supabase);
}

/**
 * Bucket resolved services into their presentation groups, sorted by group display order.
 * Ungrouped services (group_slug null) land in a trailing, header-less bucket rather than
 * being dropped, so a service always renders even if nobody has assigned it a group yet.
 * @param {object[]} services - rows from services_resolved (or plain services; group_slug just won't be set)
 * @returns {{ slug: string, name: string|null, description: string|null, displayOrder: number, services: object[] }[]}
 */
export function groupServicesForDisplay(services = []) {
  const groupsBySlug = new Map();
  const ungrouped = [];

  for (const service of services) {
    if (service?.group_slug) {
      if (!groupsBySlug.has(service.group_slug)) {
        groupsBySlug.set(service.group_slug, {
          slug: service.group_slug,
          name: service.group_name ?? null,
          description: service.group_description ?? null,
          displayOrder: service.group_display_order ?? 0,
          services: [],
        });
      }
      groupsBySlug.get(service.group_slug).services.push(service);
    } else {
      ungrouped.push(service);
    }
  }

  const groups = [...groupsBySlug.values()].sort((a, b) => a.displayOrder - b.displayOrder);
  if (ungrouped.length > 0) {
    groups.push({ slug: '__ungrouped__', name: null, description: null, displayOrder: Infinity, services: ungrouped });
  }
  return groups;
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
