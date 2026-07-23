import { supabase } from '@/lib/customSupabaseClient';

export const PLAN_TYPES = {
  RENTAL_INSURANCE: 'rental_insurance',
  DRIVEWAY_PROTECTION: 'driveway_protection',
};

export const DEFAULT_INSURANCE_PRICE = 25.0;
export const DEFAULT_DRIVEWAY_PRICE = 15.0;

const planCache = new Map();
let allPlansCache = null;

export const clearProtectionPlansCache = () => {
  planCache.clear();
  allPlansCache = null;
};

const normalizePlan = (row) => ({
  id: row.id,
  planKey: row.plan_key,
  planType: row.plan_type,
  name: row.name,
  description: row.description || '',
  price: Number(row.price ?? 0),
  priceUnit: row.price_unit || '/rental',
  isTaxable: row.is_taxable === true,
  isPrimary: row.is_primary === true,
  isActive: row.is_active !== false,
  displayOrder: row.display_order ?? 0,
  infoText: row.info_text || '',
  serviceIds: (row.protection_plan_services || []).map((link) => link.service_id),
});

const pickPlanForType = (plans, planType) => {
  const matches = plans.filter((p) => p.planType === planType && p.isActive);
  if (!matches.length) return null;
  return (
    matches.find((p) => p.isPrimary) ||
    matches.sort((a, b) => a.displayOrder - b.displayOrder)[0]
  );
};

export const fetchAllProtectionPlans = async () => {
  if (allPlansCache) return allPlansCache;

  const { data, error } = await supabase
    .from('protection_plans')
    .select(`
      *,
      protection_plan_services ( service_id )
    `)
    .eq('is_active', true)
    .order('display_order', { ascending: true });

  if (error) {
    console.warn('[protectionPlans] fetchAllProtectionPlans error:', error.message);
    return [];
  }

  allPlansCache = (data || []).map(normalizePlan);
  return allPlansCache;
};

export const fetchPlansForService = async (serviceId) => {
  const numericServiceId = Number(serviceId);
  if (!Number.isFinite(numericServiceId) || numericServiceId <= 0) {
    return { rentalInsurance: null, drivewayProtection: null };
  }

  if (planCache.has(numericServiceId)) {
    return planCache.get(numericServiceId);
  }

  const { data, error } = await supabase
    .from('protection_plans')
    .select(`
      *,
      protection_plan_services!inner ( service_id )
    `)
    .eq('is_active', true)
    .eq('protection_plan_services.service_id', numericServiceId)
    .order('display_order', { ascending: true });

  if (error) {
    console.warn('[protectionPlans] fetchPlansForService error:', error.message);
    const fallback = {
      rentalInsurance: {
        id: null,
        planKey: 'premium_insurance',
        planType: PLAN_TYPES.RENTAL_INSURANCE,
        name: 'Premium Insurance',
        description: 'Complete protection coverage for your rental',
        price: DEFAULT_INSURANCE_PRICE,
        priceUnit: '/rental',
        isTaxable: false,
        isPrimary: true,
        infoText: '',
      },
      drivewayProtection: numericServiceId === 1 || numericServiceId === 4
        ? {
            id: null,
            planKey: 'driveway_protection',
            planType: PLAN_TYPES.DRIVEWAY_PROTECTION,
            name: 'Driveway Protection',
            description: 'Protects your driveway during delivery and pickup.',
            price: DEFAULT_DRIVEWAY_PRICE,
            priceUnit: '/delivery',
            isTaxable: true,
            isPrimary: true,
            infoText: '',
          }
        : null,
    };
    planCache.set(numericServiceId, fallback);
    return fallback;
  }

  const plans = (data || []).map(normalizePlan);
  const result = {
    rentalInsurance: pickPlanForType(plans, PLAN_TYPES.RENTAL_INSURANCE),
    drivewayProtection: pickPlanForType(plans, PLAN_TYPES.DRIVEWAY_PROTECTION),
  };

  planCache.set(numericServiceId, result);
  return result;
};

export const syncBookingProtectionPlans = async (bookingId) => {
  if (!bookingId) return;
  const { error } = await supabase.rpc('sync_booking_protection_plans', {
    p_booking_id: Number(bookingId),
  });
  if (error) {
    console.warn('[protectionPlans] syncBookingProtectionPlans error:', error.message);
  }
};

export const buildProtectionPlanIdsPayload = (rentalInsurance, drivewayProtection) => ({
  rentalInsurance: rentalInsurance?.id || null,
  drivewayProtection: drivewayProtection?.id || null,
});
