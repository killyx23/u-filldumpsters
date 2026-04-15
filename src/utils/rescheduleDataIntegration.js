
import { supabase } from '@/lib/customSupabaseClient';
import { eachDayOfInterval, format, isValid, parseISO } from 'date-fns';
import { rescheduleDebugLogger } from './rescheduleDebugLogger';

export const fetchAllServices = async () => {
    console.log("[Data Integration] Fetching all services...");
    const { data, error } = await supabase
        .from('services')
        .select('*')
        .order('base_price', { ascending: true });
        
    if (error) {
        console.error("[Data Integration] Error fetching services:", error);
        throw error;
    }
    return data || [];
};

export const fetchBlockedDatesForService = async (serviceId, currentBookingId = null) => {
    console.log(`[Data Integration] Fetching blocked dates for service ${serviceId}, excluding booking ${currentBookingId}...`);
    
    // 1. Get explicitly blocked dates by admin
    const { data: adminBlocked, error: adminError } = await supabase
        .from('date_specific_availability')
        .select('date')
        .eq('service_id', serviceId)
        .eq('is_available', false);

    if (adminError) console.error("[Data Integration] Admin blocked dates error:", adminError);

    // 2. Get active bookings, excluding the current customer's booking
    let query = supabase
        .from('bookings')
        .select('id, drop_off_date, pickup_date')
        .not('status', 'in', '("Cancelled", "Returned", "Refunded")')
        .filter('plan->>id', 'eq', serviceId.toString());
        
    if (currentBookingId) {
        query = query.neq('id', currentBookingId);
    }

    const { data: existingBookings, error: bookingsError } = await query;
    rescheduleDebugLogger.logAvailabilityQuery(serviceId, existingBookings, bookingsError);
    if (bookingsError) console.error("[Data Integration] Existing bookings error:", bookingsError);

    const blockedDatesSet = new Set();

    if (adminBlocked) {
        adminBlocked.forEach(item => {
            if (item.date) blockedDatesSet.add(item.date);
        });
    }

    if (existingBookings) {
        existingBookings.forEach(booking => {
            if (booking.drop_off_date && booking.pickup_date) {
                try {
                    const start = parseISO(booking.drop_off_date);
                    const end = parseISO(booking.pickup_date);
                    if (isValid(start) && isValid(end)) {
                        const days = eachDayOfInterval({ start, end });
                        days.forEach(day => {
                            blockedDatesSet.add(format(day, 'yyyy-MM-dd'));
                        });
                    }
                } catch (e) {
                    console.warn("Invalid date range in booking:", booking);
                }
            }
        });
    }

    const result = Array.from(blockedDatesSet);
    console.log(`[Data Integration] Found ${result.length} blocked dates.`);
    return result;
};
