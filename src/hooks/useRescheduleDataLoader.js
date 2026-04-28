import { useState, useEffect } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { calculateBookingCosts, calculateDays } from '@/utils/rescheduleCalculations';

export const useRescheduleDataLoader = (bookingId) => {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        const fetchAllData = async () => {
            if (!bookingId) return;
            setLoading(true);
            try {
                // 1. Fetch Booking with customer data
                const { data: booking, error: bookingErr } = await supabase
                    .from('bookings')
                    .select('*, customers(*)')
                    .eq('id', bookingId)
                    .single();
                if (bookingErr) throw bookingErr;

                // 2. Fetch ALL Services
                const { data: services, error: servicesErr } = await supabase
                    .from('services')
                    .select('*');
                if (servicesErr) throw servicesErr;

                // 3. Fetch ALL Equipment from equipment table (for available options)
                const { data: allEquipment, error: allEquipErr } = await supabase
                    .from('equipment')
                    .select('*');
                if (allEquipErr) throw allEquipErr;

                // 4. Fetch Original Booking Equipment (what customer selected originally)
                const { data: bookingEquip, error: equipErr } = await supabase
                    .from('booking_equipment')
                    .select('*, equipment(*)')
                    .eq('booking_id', bookingId);
                if (equipErr) throw equipErr;

                // Map original booking equipment to addons format
                const originalAddonsList = (bookingEquip || []).map(be => {
                    const equipName = be.equipment?.name || 'Unknown Equipment';
                    const equipPrice = Number(be.equipment?.price || 0);
                    return {
                        id: be.equipment_id,
                        name: equipName,
                        quantity: be.quantity || 1,
                        price: equipPrice,
                        description: be.equipment?.description || be.equipment?.type || 'Equipment',
                        type: be.equipment?.type || 'equipment'
                    };
                });

                // Check if insurance was in original booking (from addons JSON field)
                let hasOriginalInsurance = false;
                let originalInsurancePrice = 25;
                if (booking.addons && typeof booking.addons === 'object') {
                    Object.entries(booking.addons).forEach(([key, val]) => {
                        if (key.toLowerCase().includes('insurance')) {
                            hasOriginalInsurance = true;
                            originalInsurancePrice = typeof val === 'object' ? Number(val.price || 25) : Number(val || 25);
                        }
                    });
                }

                if (hasOriginalInsurance) {
                    originalAddonsList.push({
                        id: 'insurance',
                        name: 'Premium Insurance',
                        quantity: 1,
                        price: originalInsurancePrice,
                        description: 'Complete protection coverage for your rental',
                        type: 'insurance'
                    });
                }

                // 5. Identify Original Service
                const originalServiceId = booking.plan?.id || booking.service_id;
                const originalService = services.find(s => s.id === originalServiceId) || services[0];

                // 6. Calculate Original Costs with correct mileage
                const distanceMiles = Number(booking.customers?.distance_miles || 0);
                const origDays = calculateDays(booking.drop_off_date, booking.pickup_date);
                
                const originalCosts = calculateBookingCosts(originalService, origDays, originalAddonsList, distanceMiles);

                // 7. Fetch Availability
                const { data: availability, error: availErr } = await supabase
                    .from('date_specific_availability')
                    .select('*')
                    .eq('is_available', true);
                if (availErr) throw availErr;

                setData({
                    originalBooking: booking,
                    originalService,
                    availableServices: services,
                    allEquipment: allEquipment || [], // All equipment available for selection
                    originalAddonsList, // What customer selected in original booking
                    originalCosts: {
                        serviceCost: originalCosts.serviceCost,
                        addonsCost: originalCosts.addonsCost,
                        mileageCharge: originalCosts.mileageCharge,
                        subtotal: originalCosts.subtotal,
                        tax: originalCosts.tax,
                        total: originalCosts.total
                    },
                    availableDates: availability || [],
                    distanceMiles
                });

            } catch (err) {
                console.error("Failed to load comprehensive reschedule data:", err);
                setError(err.message);
            } finally {
                setLoading(false);
            }
        };

        fetchAllData();
    }, [bookingId]);

    return { data, loading, error };
};