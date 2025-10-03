import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from './cors.ts';
import { addDays, format, parseISO, isBefore, parse, set, addMinutes, isSameDay } from 'https://esm.sh/date-fns@2';

const generateSlotsFromRange = (startTime, endTime, intervalMinutes, currentDate, now) => {
  if (!startTime || !endTime) return [];
  let start = parse(startTime, 'HH:mm:ss', currentDate);
  const end = parse(endTime, 'HH:mm:ss', currentDate);
  if (isSameDay(currentDate, now) && isBefore(start, now)) {
    start = now;
    const twoHoursFromNow = addMinutes(start, 120);
    if (isBefore(start, twoHoursFromNow)) {
      start = twoHoursFromNow;
    }
  }
  const minutes = start.getMinutes();
  const roundedMinutes = Math.ceil(minutes / intervalMinutes) * intervalMinutes;
  let currentTime = set(start, {
    minutes: roundedMinutes,
    seconds: 0,
    milliseconds: 0
  });
  const slots = [];
  while(isBefore(currentTime, end)){
    const slotEnd = addMinutes(currentTime, intervalMinutes);
    if (isBefore(slotEnd, addMinutes(end, 1))) {
      slots.push({
        value: format(currentTime, 'HH:mm:ss'),
        label: `${format(currentTime, 'h:mm a')}`
      });
    }
    currentTime = addMinutes(currentTime, intervalMinutes);
  }
  return slots;
};

const filterBookedSlots = (slots, existingBookings, dateStr, slotType) => {
  if (!slots || slots.length === 0) return slots;
  
  const bookedSlots = existingBookings
    .filter(booking => {
      // Check if booking is for the same date
      const bookingDate = booking.drop_off_date === dateStr ? booking.drop_off_date : booking.pickup_date;
      if (bookingDate !== dateStr) return false;
      
      // Check if booking is confirmed/active
      const activeStatuses = ['Confirmed', 'Delivered', 'flagged', 'waiting_to_be_returned', 'Rescheduled'];
      if (!activeStatuses.includes(booking.status)) return false;
      
      // Check slot type
      if (slotType === 'delivery' && booking.drop_off_date === dateStr) return true;
      if (slotType === 'pickup' && booking.pickup_date === dateStr) return true;
      if (slotType === 'return' && booking.pickup_date === dateStr) return true;
      if (slotType === 'hourly' && booking.drop_off_date === dateStr) return true;
      
      return false;
    })
    .map(booking => {
      if (slotType === 'delivery') return booking.drop_off_time_slot;
      if (slotType === 'pickup') return booking.pickup_time_slot;
      if (slotType === 'return') return booking.pickup_time_slot;
      if (slotType === 'hourly') return booking.drop_off_time_slot;
      return null;
    })
    .filter(slot => slot !== null);
  
  return slots.filter(slot => !bookedSlots.includes(slot.value));
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
  }
  
  try {
    const { serviceId, startDate, endDate, isDelivery } = await req.json();
    if (!serviceId || !startDate || !endDate) {
      throw new Error("An unexpected error occurred: Service ID, start date, and end date are required.");
    }
    
    const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
    const start = parseISO(startDate);
    const end = parseISO(endDate);
    const dateRange = [];
    for(let d = start; d <= end; d = addDays(d, 1)){
      dateRange.push(format(d, 'yyyy-MM-dd'));
    }
    
    const serviceIdForAvail = isDelivery && serviceId === 2 ? 4 : serviceId;
    
    // Get weekly availability rules
    const { data: weeklyRules, error: weeklyError } = await supabaseAdmin
      .from('service_availability')
      .select('*')
      .eq('service_id', serviceIdForAvail);
    if (weeklyError) throw weeklyError;
    
    const weeklyRulesMap = new Map(weeklyRules.map((r) => [
      r.day_of_week,
      r
    ]));
    
    // Get date-specific availability rules (these override weekly rules)
    const { data: dateSpecificRules, error: specificError } = await supabaseAdmin
      .from('date_specific_availability')
      .select('*')
      .eq('service_id', serviceIdForAvail)
      .in('date', dateRange);
    if (specificError) throw specificError;
    
    const specificRulesMap = new Map(dateSpecificRules.map((r) => [
      r.date,
      r
    ]));
    
    // Get existing bookings for the date range to filter out booked slots
    const { data: existingBookings, error: bookingsError } = await supabaseAdmin
      .from('bookings')
      .select('drop_off_date, pickup_date, drop_off_time_slot, pickup_time_slot, status, plan')
      .or(`drop_off_date.in.(${dateRange.join(',')}),pickup_date.in.(${dateRange.join(',')})`)
      .in('status', ['Confirmed', 'Delivered', 'flagged', 'waiting_to_be_returned', 'Rescheduled']);
    if (bookingsError) throw bookingsError;
    
    const availability = {};
    const now = new Date();
    
    for (const dateStr of dateRange) {
      const date = parseISO(dateStr);
      const dayOfWeek = date.getDay();
      
      // Priority: date_specific_availability overrides service_availability
      let rule = null;
      if (specificRulesMap.has(dateStr)) {
        rule = specificRulesMap.get(dateStr);
      } else if (weeklyRulesMap.has(dayOfWeek)) {
        rule = weeklyRulesMap.get(dayOfWeek);
      }
      
      // Determine availability - if no rule exists, default to false
      let isAvailable = rule ? rule.is_available !== false : false;
      if (rule && rule.is_available === false) {
        isAvailable = false;
      }
      
      const intervalMap = {
        1: 120,
        2: 60,
        3: 60,
        4: 120
      };
      const interval = intervalMap[serviceIdForAvail] || 120;
      
      // Generate slots only if available
      let deliverySlots = [];
      let pickupSlots = [];
      let returnSlots = [];
      let hourlySlots = [];
      
      if (isAvailable && rule) {
        deliverySlots = generateSlotsFromRange(rule.delivery_start_time, rule.delivery_end_time, interval, date, now);
        pickupSlots = generateSlotsFromRange(rule.pickup_start_time, rule.pickup_end_time, interval, date, now);
        returnSlots = generateSlotsFromRange(rule.return_start_time, rule.return_end_time, 60, date, now);
        hourlySlots = generateSlotsFromRange(rule.hourly_start_time, rule.hourly_end_time, 60, date, now);
        
        // Filter out booked slots
        deliverySlots = filterBookedSlots(deliverySlots, existingBookings, dateStr, 'delivery');
        pickupSlots = filterBookedSlots(pickupSlots, existingBookings, dateStr, 'pickup');
        returnSlots = filterBookedSlots(returnSlots, existingBookings, dateStr, 'return');
        hourlySlots = filterBookedSlots(hourlySlots, existingBookings, dateStr, 'hourly');
      }
      
      availability[dateStr] = {
        available: isAvailable,
        deliverySlots,
        pickupSlots,
        returnSlots,
        hourlySlots
      };
    }
    
    return new Response(JSON.stringify({
      availability
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 200
    });
  } catch (error) {
    console.error(error);
    return new Response(JSON.stringify({
      error: error.message
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 500
    });
  }
});


