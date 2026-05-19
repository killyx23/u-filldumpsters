import { getTaxRate } from '@/utils/getTaxRate';

/**
 * Derives delivery mode for tax jurisdiction selection.
 * @param {Object} plan - Selected service plan
 * @param {boolean} deliveryService - Whether delivery was selected (plan id 2)
 * @returns {'delivery'|'self_service_trailer'|'self_pickup'}
 */
export function deriveDeliveryType(plan, deliveryService = false) {
  if (!plan?.id) return 'delivery';
  if (plan.id === 1 || plan.id === 4) return 'delivery';
  if (plan.id === 2) return deliveryService ? 'delivery' : 'self_service_trailer';
  return 'self_pickup';
}

/**
 * Resolves the sales tax rate for a booking.
 * Phase 1: business HQ rate from business_settings.
 * Phase 2: ZIP-based lookup via lookup-tax-rate edge function for deliveries.
 *
 * @param {Object} options
 * @param {'delivery'|'self_service_trailer'|'self_pickup'} [options.deliveryType]
 * @param {string} [options.deliveryZip]
 * @param {string} [options.pickupZip]
 * @returns {Promise<{ taxRate: number, source: string, jurisdiction?: string }>}
 */
export async function resolveTaxRate({ deliveryType, deliveryZip, pickupZip } = {}) {
  const hqConfig = await getTaxRate();

  // Phase 2 stub — enable when TaxJar is wired:
  // if (deliveryType === 'delivery' && deliveryZip) {
  //   const { data } = await supabase.functions.invoke('lookup-tax-rate', {
  //     body: { zip_code: deliveryZip, delivery_type: deliveryType },
  //   });
  //   if (data?.rate) {
  //     return { taxRate: Number(data.rate), source: data.source || 'taxjar', jurisdiction: data.jurisdiction };
  //   }
  // }
  // if (deliveryType === 'self_pickup') {
  //   return { taxRate: hqConfig.tax_rate_pickup ?? hqConfig.tax_rate, source: 'business_settings_pickup' };
  // }

  void deliveryType;
  void deliveryZip;
  void pickupZip;

  return {
    taxRate: hqConfig.tax_rate,
    source: 'business_settings',
    jurisdiction: 'HQ',
  };
}
