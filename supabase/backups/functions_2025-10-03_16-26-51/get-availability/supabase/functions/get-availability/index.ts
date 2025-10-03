import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from './cors.ts';
import { addDays, format, parseISO, isBefore, parse, set, addMinutes, isSameDay } from 'https://esm.sh/date-fns@2';
const generateSlotsFromRange = (startTime, endTime, intervalMinutes, currentDate, now)=>{
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
Deno.serve(async (req)=>{
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
    const serviceIdForAvail = serviceId === 2 && isDelivery ? 4 : serviceId;
    // Weekly rules
    const { data: weeklyRules, error: weeklyError } = await supabaseAdmin.from('service_availability').select('*').eq('service_id', serviceIdForAvail);
    if (weeklyError) throw weeklyError;
    const weeklyRulesMap = new Map(weeklyRules.map((r)=>[
        r.day_of_week,
        r
      ]));
    // Date-specific rules
    const { data: dateSpecificRules, error: specificError } = await supabaseAdmin.from('date_specific_availability').select('*').eq('service_id', serviceIdForAvail).in('date', dateRange);
    if (specificError) throw specificError;
    const specificRulesMap = new Map(dateSpecificRules.map((r)=>[
        r.date,
        r
      ]));
    // Unavailable dates
    const { data: unavailableDatesData, error: unavailableError } = await supabaseAdmin.from('unavailable_dates').select('date').eq('service_id', serviceIdForAvail).in('date', dateRange);
    if (unavailableError) throw unavailableError;
    const unavailableDates = new Set(unavailableDatesData.map((d)=>d.date));
    // Bookings
    const { data: bookingsData, error: bookingsError } = await supabaseAdmin.from('bookings').select('drop_off_date, pickup_date, plan').lte('drop_off_date', endDate).gte('pickup_date', startDate);
    if (bookingsError) throw bookingsError;
    // Filter by plan.id === serviceIdForAvail
    const filteredBookings = (bookingsData ?? []).filter((b)=>{
      try {
        return b.plan && b.plan.id === serviceIdForAvail;
      } catch  {
        return false;
      }
    });
    // Build bookedDates depending on service
    const bookedDates = new Set();
    for (const b of filteredBookings){
      if (!b.drop_off_date || !b.pickup_date) continue;
      if (serviceIdForAvail === 1 || serviceIdForAvail === 3) {
        // Only endpoints
        bookedDates.add(b.drop_off_date);
        bookedDates.add(b.pickup_date);
      } else if (serviceIdForAvail === 2 || serviceIdForAvail === 4) {
        // Full range inclusive
        let d = parseISO(b.drop_off_date);
        const end = parseISO(b.pickup_date);
        while(d <= end){
          bookedDates.add(format(d, 'yyyy-MM-dd'));
          d = addDays(d, 1);
        }
      }
    }
    // Build availability map
    const availability = {};
    const now = new Date();
    for (const dateStr of dateRange){
      const date = parseISO(dateStr);
      const dayOfWeek = date.getDay();
      let rule = null;
      if (specificRulesMap.has(dateStr)) {
        rule = specificRulesMap.get(dateStr);
      } else if (weeklyRulesMap.has(dayOfWeek)) {
        rule = weeklyRulesMap.get(dayOfWeek);
      }
      let isAvailable = rule ? rule.is_available !== false : weeklyRules.length === 0;
      if (rule && rule.is_available === false) {
        isAvailable = false;
      }
      // Override with unavailable dates or booked dates
      if (unavailableDates.has(dateStr) || bookedDates.has(dateStr)) {
        isAvailable = false;
      }
      const deliverySlots = rule ? generateSlotsFromRange(rule.delivery_start_time, rule.delivery_end_time, 30, date, now) : [];
      const pickupSlots = rule ? generateSlotsFromRange(rule.pickup_start_time, rule.pickup_end_time, 30, date, now) : [];
      const returnSlots = rule ? generateSlotsFromRange(rule.return_start_time, rule.return_end_time, 30, date, now) : [];
      const hourlySlots = rule ? generateSlotsFromRange(rule.hourly_start_time, rule.hourly_end_time, 60, date, now) : [];
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
