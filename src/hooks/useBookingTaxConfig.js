import { useState, useEffect } from 'react';
import { fetchServiceTaxFlags, fetchEquipmentTaxFlags } from '@/utils/bookingTaxConfig';

/**
 * Loads service and equipment tax flags for booking total calculation.
 */
export function useBookingTaxConfig(planId) {
  const [serviceTaxFlags, setServiceTaxFlags] = useState({
    is_taxable: true,
    delivery_fee_is_taxable: true,
    mileage_is_taxable: true,
  });
  const [equipmentTaxFlags, setEquipmentTaxFlags] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      try {
        const [serviceFlags, equipFlags] = await Promise.all([
          fetchServiceTaxFlags(planId),
          fetchEquipmentTaxFlags(),
        ]);
        if (!cancelled) {
          setServiceTaxFlags(serviceFlags);
          setEquipmentTaxFlags(equipFlags);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [planId]);

  return { serviceTaxFlags, equipmentTaxFlags, loading };
}

/**
 * Build options object for calculateBookingTotal from tax hooks.
 */
export function buildTaxCalcOptions({
  serviceTaxFlags,
  equipmentTaxFlags,
  insuranceIsTaxable,
  drivewayPrice,
  drivewayIsTaxable,
}) {
  return {
    serviceTaxFlags: serviceTaxFlags || {},
    equipmentTaxFlags: equipmentTaxFlags || {},
    insuranceIsTaxable: insuranceIsTaxable ?? false,
    drivewayPrice: drivewayPrice ?? 0,
    drivewayIsTaxable: drivewayIsTaxable ?? true,
  };
}
