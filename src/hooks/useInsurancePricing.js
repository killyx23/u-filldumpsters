import { useProtectionPlans } from '@/hooks/useProtectionPlans';
import { DEFAULT_INSURANCE_PRICE } from '@/utils/protectionPlans';

/**
 * Backward-compatible wrapper around protection_plans rental insurance pricing.
 */
export const useInsurancePricing = (serviceId = null) => {
  const {
    rentalInsurance,
    insurancePrice,
    insuranceIsTaxable,
    loading,
    error,
    reload,
  } = useProtectionPlans(serviceId);

  const updateInsurancePrice = async () => {
    console.warn(
      '[Insurance Pricing] updateInsurancePrice is deprecated. Use PricingManager protection plans section.'
    );
    return false;
  };

  return {
    insurancePrice: insurancePrice ?? DEFAULT_INSURANCE_PRICE,
    insuranceIsTaxable,
    insuranceServiceId: rentalInsurance?.legacyServiceId ?? null,
    protectionPlanId: rentalInsurance?.id ?? null,
    rentalInsurance,
    loading,
    error,
    updateInsurancePrice,
    fetchPricing: reload,
  };
};
