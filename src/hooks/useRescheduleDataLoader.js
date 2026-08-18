import { useState, useEffect } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import {
    calculateBookingCosts,
    calculateDays,
    buildOriginalAddonsList,
} from '@/utils/rescheduleCalculations';
import { filterRentableServices, excludeDeliveryVariantServices } from '@/utils/servicePlan';
import { fetchPlansForService, DEFAULT_INSURANCE_PRICE } from '@/utils/protectionPlans';

export const useRescheduleDataLoader = (bookingId) => {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        const fetchAllData = async () => {
            if (!bookingId) return;
            setLoading(true);
            try {
                const { data: booking, error: bookingErr } = await supabase
                    .from('bookings')
                    .select('*, customers(*)')
                    .eq('id', bookingId)
                    .single();
                if (bookingErr) throw bookingErr;

                const { data: servicesRaw, error: servicesErr } = await supabase
                    .from('services')
                    .select('*');
                if (servicesErr) throw servicesErr;
                const services = filterRentableServices(servicesRaw || []);
                const catalogServices = excludeDeliveryVariantServices(services);

                const { data: allEquipment, error: allEquipErr } = await supabase
                    .from('equipment')
                    .select('*');
                if (allEquipErr) throw allEquipErr;

                const { data: bookingEquip, error: equipErr } = await supabase
                    .from('booking_equipment')
                    .select('*, equipment(*)')
                    .eq('booking_id', bookingId);
                if (equipErr) throw equipErr;

                const bookingServiceId = Number(booking?.plan?.id);
                const protectionPlans = await fetchPlansForService(bookingServiceId);
                const insuranceFallbackPrice =
                    protectionPlans?.rentalInsurance?.price ?? DEFAULT_INSURANCE_PRICE;

                const originalAddonsList = buildOriginalAddonsList(
                    booking,
                    bookingEquip,
                    allEquipment,
                    insuranceFallbackPrice
                );

                const originalServiceId = booking.plan?.id || booking.service_id;
                const originalService =
                    services.find((s) => Number(s.id) === Number(originalServiceId)) || services[0];

                const distanceMiles = Number(booking.customers?.distance_miles || 0);
                const origDays = calculateDays(booking.drop_off_date, booking.pickup_date);

                const originalCosts = await calculateBookingCosts(
                    originalService,
                    origDays,
                    originalAddonsList,
                    distanceMiles
                );

                setData({
                    originalBooking: booking,
                    originalService,
                    availableServices: catalogServices,
                    allEquipment: allEquipment || [],
                    originalAddonsList,
                    originalCosts: {
                        serviceCost: originalCosts.serviceCost,
                        addonsCost: originalCosts.addonsCost,
                        mileageCharge: originalCosts.mileageCharge,
                        subtotal: originalCosts.subtotal,
                        tax: originalCosts.tax,
                        total: originalCosts.total,
                    },
                    distanceMiles,
                });
            } catch (err) {
                console.error('Failed to load comprehensive reschedule data:', err);
                setError(err.message);
            } finally {
                setLoading(false);
            }
        };

        fetchAllData();
    }, [bookingId]);

    return { data, loading, error };
};
