import { useEffect, useState } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import {
  fetchServiceById,
  getServiceIdFromBooking,
  resolveBookingService,
} from '@/utils/servicePlan';

/**
 * Loads live service row for a booking; merges with audit plan for display/logic.
 * @param {object|null} booking
 * @returns {{ loading: boolean, displayName: string, planForLogic: object, service: object|null, auditPlan: object, isCustomerPickup: boolean, isDelivery: boolean }}
 */
export function useResolvedBookingService(booking) {
  const [state, setState] = useState({
    loading: Boolean(booking),
    displayName: 'Service',
    planForLogic: booking?.plan || {},
    service: null,
    auditPlan: booking?.plan || {},
    isCustomerPickup: false,
    isDelivery: false,
    serviceId: null,
  });

  useEffect(() => {
    if (!booking) {
      setState((s) => ({ ...s, loading: false }));
      return;
    }

    let cancelled = false;

    const load = async () => {
      const serviceId = getServiceIdFromBooking(booking);
      let liveService = null;
      if (serviceId) {
        const { data } = await fetchServiceById(supabase, serviceId);
        liveService = data;
      }
      if (cancelled) return;
      const resolved = resolveBookingService(booking, liveService);
      setState({
        loading: false,
        displayName: resolved.displayName,
        planForLogic: resolved.planForLogic,
        service: resolved.service,
        auditPlan: resolved.auditPlan,
        isCustomerPickup: resolved.isCustomerPickup,
        isDelivery: resolved.isDelivery,
        serviceId: resolved.serviceId,
      });
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [booking?.id, booking?.plan, booking?.addons, booking?.service_id]);

  return state;
}
