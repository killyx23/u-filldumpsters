import { useMemo } from 'react';
import { useInsurancePricing } from '@/hooks/useInsurancePricing';
import { useDrivewayProtectionPrice } from '@/hooks/useDrivewayProtectionPrice';
import { useServiceTaxFlags } from '@/hooks/useServiceTaxFlags';
import { useEquipmentTaxFlags } from '@/hooks/useEquipmentTaxFlags';

/**
 * Bundles insurance/driveway pricing and per-line tax flags for booking totals.
 */
export function useBookingTaxOptions(planId) {
  const { insurancePrice, insuranceIsTaxable, loading: insuranceLoading } = useInsurancePricing();
  const { drivewayPrice, drivewayIsTaxable, loading: drivewayLoading } = useDrivewayProtectionPrice();
  const { serviceTaxFlags, loading: serviceLoading } = useServiceTaxFlags(planId);
  const { equipmentTaxFlags, loading: equipmentLoading } = useEquipmentTaxFlags();

  const taxOptions = useMemo(
    () => ({
      insuranceIsTaxable,
      drivewayPrice,
      drivewayIsTaxable,
      serviceTaxFlags,
      equipmentTaxFlags,
    }),
    [insuranceIsTaxable, drivewayPrice, drivewayIsTaxable, serviceTaxFlags, equipmentTaxFlags]
  );

  const loading =
    insuranceLoading || drivewayLoading || serviceLoading || equipmentLoading;

  return {
    insurancePrice,
    taxOptions,
    drivewayPrice,
    loading,
  };
}
