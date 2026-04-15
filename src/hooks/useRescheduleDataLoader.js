
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
                // 1. Fetch Booking
                const { data: booking, error: bookingErr } = await supabase
                    .from('bookings')
                    .select('*, customers(*)')
                    .eq('id', bookingId)
                    .single();
                if (bookingErr) throw bookingErr;

                // 2. Fetch Services
                const { data: services, error: servicesErr } = await supabase
                    .from('services')
                    .select('*');
                if (servicesErr) throw servicesErr;

                // 3. Fetch Booking Equipment (Original Add-ons)
                const { data: bookingEquip, error: equipErr } = await supabase
                    .from('booking_equipment')
                    .select('*, equipment(*)')
                    .eq('booking_id', bookingId);
                if (equipErr) throw equipErr;

                // Extract prices from booking.addons JSON as fallback since equipment table might lack price
                const addonJsonPrices = {};
                if (booking.addons && typeof booking.addons === 'object') {
                    Object.entries(booking.addons).forEach(([key, val]) => {
                        if (val && typeof val === 'object' && val.price) {
                            addonJsonPrices[key.toLowerCase()] = Number(val.price);
                        } else if (typeof val === 'number') {
                            addonJsonPrices[key.toLowerCase()] = val;
                        }
                    });
                }

                // Map original addons
                const originalAddonsList = (bookingEquip || []).map(be => {
                    const equipName = be.equipment?.name || 'Unknown Equipment';
                    // Check JSON for price, fallback to 15
                    const matchedPrice = addonJsonPrices[equipName.toLowerCase()] || 15;
                    return {
                        id: be.equipment_id,
                        name: equipName,
                        quantity: be.quantity || 1,
                        price: matchedPrice,
                        description: be.equipment?.type || 'Rental Equipment'
                    };
                });

                // Include insurance if present in JSON but not in equipment table
                if (booking.addons && typeof booking.addons === 'object') {
                    Object.entries(booking.addons).forEach(([key, val]) => {
                        if (key.toLowerCase().includes('insurance')) {
                            const price = typeof val === 'object' ? Number(val.price || 25) : Number(val || 25);
                            originalAddonsList.push({
                                id: 'insurance',
                                name: key,
                                quantity: 1,
                                price: price,
                                description: 'Protection Plan'
                            });
                        }
                    });
                }

                // 4. Identify Original Service
                const originalServiceId = booking.plan?.id || booking.service_id;
                const originalService = services.find(s => s.id === originalServiceId) || services[0];

                // 5. Calculate Original Costs strictly
                const distanceMiles = Number(booking.customers?.distance_miles || 0);
                const origDays = calculateDays(booking.drop_off_date, booking.pickup_date);
                const originalCosts = calculateBookingCosts(originalService, origDays, originalAddonsList, distanceMiles);

                // 6. Fetch Availability (Date Specific)
                const { data: availability, error: availErr } = await supabase
                    .from('date_specific_availability')
                    .select('*')
                    .eq('is_available', true);
                if (availErr) throw availErr;

                setData({
                    originalBooking: booking,
                    originalService,
                    availableServices: services,
                    originalAddonsList,
                    originalCosts,
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
