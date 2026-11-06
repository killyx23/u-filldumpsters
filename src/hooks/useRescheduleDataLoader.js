import { useState, useEffect } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import {
    buildOriginalAddonsList,
} from '@/utils/rescheduleCalculations';
import { filterRentableServices } from '@/utils/servicePlan';
import { fetchPlansForService, DEFAULT_INSURANCE_PRICE } from '@/utils/protectionPlans';
import { resolvePurchaseReceiptTotals } from '@/utils/purchaseReceiptTotals';

const round2 = (amount) => Math.round((Number(amount) || 0) * 100) / 100;

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
                    .select('*, pricing_promo_labels(label)');
                if (servicesErr) throw servicesErr;
                const services = filterRentableServices(servicesRaw || []);

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
                const originalService = services.find((s) => s.id === originalServiceId) || services[0];

                const distanceMiles = Number(booking.customers?.distance_miles || 0);
                const receipt = resolvePurchaseReceiptTotals(booking);

                setData({
                    originalBooking: booking,
                    originalService,
                    availableServices: services,
                    allEquipment: allEquipment || [],
                    originalAddonsList,
                    // Frozen at purchase — do not reprice the original booking from live catalog.
                    originalCosts: {
                        serviceCost: round2(
                            Math.max(0, receipt.subtotal - receipt.deliveryFee - receipt.mileageCharge),
                        ),
                        addonsCost: 0,
                        deliveryFee: receipt.deliveryFee,
                        mileageCharge: receipt.mileageCharge,
                        subtotal: receipt.subtotal,
                        tax: receipt.tax,
                        total: receipt.total,
                        taxRate: receipt.taxRate,
                        source: receipt.source,
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
