import { useState, useEffect, useCallback } from 'react';
import {
  fetchPlansForService,
  DEFAULT_INSURANCE_PRICE,
  DEFAULT_DRIVEWAY_PRICE,
} from '@/utils/protectionPlans';

export const useProtectionPlans = (serviceId) => {
  const [rentalInsurance, setRentalInsurance] = useState(null);
  const [drivewayProtection, setDrivewayProtection] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadPlans = useCallback(async () => {
    if (!serviceId) {
      setRentalInsurance(null);
      setDrivewayProtection(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const plans = await fetchPlansForService(serviceId);
      setRentalInsurance(plans.rentalInsurance);
      setDrivewayProtection(plans.drivewayProtection);
    } catch (err) {
      console.error('[useProtectionPlans] Error loading plans:', err);
      setError(err.message);
      setRentalInsurance(null);
      setDrivewayProtection(null);
    } finally {
      setLoading(false);
    }
  }, [serviceId]);

  useEffect(() => {
    loadPlans();
  }, [loadPlans]);

  return {
    rentalInsurance,
    drivewayProtection,
    insurancePrice: rentalInsurance?.price ?? DEFAULT_INSURANCE_PRICE,
    insuranceIsTaxable: rentalInsurance?.isTaxable ?? true,
    drivewayPrice: drivewayProtection?.price ?? DEFAULT_DRIVEWAY_PRICE,
    drivewayIsTaxable: drivewayProtection?.isTaxable ?? true,
    loading,
    error,
    reload: loadPlans,
  };
};
