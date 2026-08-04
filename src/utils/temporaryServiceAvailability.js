import { formatISO, startOfDay, addDays } from 'date-fns';
import { supabase } from '@/lib/customSupabaseClient';

/**
 * Build a map of serviceId -> available (true) / temporarily unavailable (false),
 * matching homepage Plans.jsx rules: closed today, or no open day in a 30-day window.
 *
 * @param {Array<{ id: number|string, delivery_variant_service_id?: number|string|null }>} services
 * @returns {Promise<Record<string|number, boolean>>}
 */
export async function fetchTemporaryServiceAvailabilityMap(services = []) {
  const list = Array.isArray(services) ? services.filter((s) => s?.id != null) : [];
  if (list.length === 0) return {};

  const todayStr = formatISO(startOfDay(new Date()), { representation: 'date' });

  const { data: dateSpecificAvailData, error: dateSpecificError } = await supabase
    .from('date_specific_availability')
    .select('service_id, is_available')
    .eq('date', todayStr);

  if (dateSpecificError) {
    console.warn(
      '[temporaryServiceAvailability] Date-specific availability fetch failed:',
      dateSpecificError
    );
  }

  const todayAvailabilityMap = {};
  if (dateSpecificAvailData) {
    dateSpecificAvailData.forEach((item) => {
      todayAvailabilityMap[item.service_id] = item.is_available;
    });
  }

  const startDate = todayStr;
  const endDate = formatISO(addDays(startOfDay(new Date()), 30), { representation: 'date' });

  const availabilityPromises = list.map((plan) =>
    supabase.functions.invoke('get-availability', {
      body: {
        serviceId: plan.id,
        startDate,
        endDate,
        isDelivery: plan.delivery_variant_service_id ? false : undefined,
      },
    })
  );

  const trailerPlan = list.find((p) => p.delivery_variant_service_id);
  const deliveryForTrailerPromise = trailerPlan
    ? supabase.functions.invoke('get-availability', {
        body: {
          serviceId: trailerPlan.id,
          startDate,
          endDate,
          isDelivery: true,
        },
      })
    : Promise.resolve({ data: null });

  try {
    const results = await Promise.all([...availabilityPromises, deliveryForTrailerPromise]);
    const newAvailability = {};
    const deliveryResultIndex = results.length - 1;

    list.forEach((plan, index) => {
      if (todayAvailabilityMap[plan.id] === false) {
        newAvailability[plan.id] = false;
        return;
      }

      const result = results[index];
      const availByDate = result.data?.availability;
      let isAnyDayAvailable = todayAvailabilityMap[plan.id] !== false;

      if (availByDate && Object.keys(availByDate).length > 0) {
        isAnyDayAvailable = Object.values(availByDate).some((day) => day.available);
      }

      if (plan.delivery_variant_service_id) {
        const deliveryResult = results[deliveryResultIndex];
        if (deliveryResult?.data?.availability) {
          const isDeliveryAvailable = Object.values(deliveryResult.data.availability).some(
            (day) => day.available
          );
          isAnyDayAvailable = isAnyDayAvailable || isDeliveryAvailable;
        }
      }

      newAvailability[plan.id] = isAnyDayAvailable;
    });

    return newAvailability;
  } catch (availError) {
    console.error('[temporaryServiceAvailability] Availability fetch failed:', availError);
    const fallbackAvail = {};
    list.forEach((p) => {
      fallbackAvail[p.id] = todayAvailabilityMap[p.id] !== false;
    });
    return fallbackAvail;
  }
}
