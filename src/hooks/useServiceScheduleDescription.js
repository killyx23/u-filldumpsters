import { useEffect, useMemo, useState } from 'react';
import { getFormattedServiceTimes } from '@/utils/serviceAvailabilityHelper';
import { AVAILABILITY_UI, getServiceAvailabilityUiKind } from '@/utils/availabilityServiceUi';
import { applyDynamicScheduleToDescription } from '@/utils/serviceDescriptionSchedule';
import { mapServiceToPlanCard, resolvePlanCardFeatures } from '@/utils/servicePlan';

/**
 * Shared schedule + marketing copy for service cards and info modals.
 * Matches booking flow: times from date_specific_availability / service_availability.
 */
export function useServiceScheduleDescription(service, referenceDate, isActive = true) {
  const [times, setTimes] = useState(null);
  const [loading, setLoading] = useState(false);

  const serviceId = service?.id;
  const isHourlyPickup =
    serviceId != null && getServiceAvailabilityUiKind(serviceId) === AVAILABILITY_UI.HOURLY_PICKUP;
  const hasReferenceDate = Boolean(referenceDate);

  useEffect(() => {
    if (!isActive || !service || !isHourlyPickup || !hasReferenceDate) {
      setTimes(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    getFormattedServiceTimes(serviceId, referenceDate)
      .then((result) => {
        if (!cancelled) setTimes(result);
      })
      .catch((error) => {
        console.error('[useServiceScheduleDescription] Failed to load schedule:', error);
        if (!cancelled) setTimes(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isActive, service, serviceId, isHourlyPickup, hasReferenceDate, referenceDate]);

  const planCard = useMemo(
    () => (service ? mapServiceToPlanCard(service) : null),
    [service]
  );

  const rawDescription = planCard?.displayDescription || service?.description || '';

  const description = useMemo(
    () =>
      applyDynamicScheduleToDescription(
        rawDescription,
        times,
        serviceId,
        hasReferenceDate
      ),
    [rawDescription, times, serviceId, hasReferenceDate]
  );

  const { features, deliveryFee } = useMemo(
    () => (service ? resolvePlanCardFeatures(service) : { features: [], deliveryFee: null }),
    [service]
  );

  return {
    description,
    loading: isHourlyPickup && hasReferenceDate && loading,
    times,
    planCard,
    features,
    deliveryFee,
    basePrice: Number(service?.base_price ?? 0),
    mileageRate: Number(service?.mileage_rate ?? 0),
  };
}
