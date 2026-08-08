import { useProtectionPlans } from '@/hooks/useProtectionPlans';
import { DEFAULT_DRIVEWAY_PRICE } from '@/utils/protectionPlans';

/**
 * Backward-compatible wrapper around protection_plans driveway protection pricing.
 */
export const useDrivewayProtectionPrice = (serviceId = null) => {
  const {
    drivewayProtection,
    drivewayPrice,
    drivewayIsTaxable,
    loading,
    error,
    reload,
  } = useProtectionPlans(serviceId);

  const updateDrivewayPrice = async () => {
    console.warn(
      '[Driveway Protection Pricing] updateDrivewayPrice is deprecated. Use PricingManager protection plans section.'
    );
    return false;
  };

  return {
    drivewayPrice: drivewayPrice ?? DEFAULT_DRIVEWAY_PRICE,
    drivewayIsTaxable,
    protectionPlanId: drivewayProtection?.id ?? null,
    drivewayProtection,
    loading,
    error,
    updateDrivewayPrice,
    fetchPricing: reload,
  };
};
