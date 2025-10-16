import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from './cors.ts';
import { addDays, format, parseISO, isBefore, parse, set, addMinutes, isSameDay, startOfDay, endOfDay } from 'https://esm.sh/date-fns@2';
const generateSlotsFromRange = (startTime, endTime, intervalMinutes, currentDate, now)=>{
  if (!startTime || !endTime) return [];
  let start = parse(startTime, 'HH:mm:ss', currentDate);
  const end = parse(endTime, 'HH:mm:ss', currentDate);
  if (isSameDay(currentDate, now)) {
    const twoHoursFromNow = addMinutes(now, 120);
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
    const serviceIdForAvail = isDelivery && serviceId === 2 ? 4 : serviceId;
    const [{ data: weeklyRules, error: weeklyError }, { data: dateSpecificRules, error: specificError }, { data: bookings, error: bookingsError }, { data: inventoryRules, error: inventoryRulesError }] = await Promise.all([
      supabaseAdmin.from('service_availability').select('*').eq('service_id', serviceIdForAvail),
      supabaseAdmin.from('date_specific_availability').select('*').eq('service_id', serviceIdForAvail).in('date', dateRange),
      supabaseAdmin.from('bookings').select('plan, drop_off_date, pickup_date, addons').lte('drop_off_date', endDate).gte('pickup_date', startDate).in('status', [
        'Confirmed',
        'Rescheduled',
        'Delivered',
        'waiting_to_be_returned',
        'pending_review'
      ]),
      supabaseAdmin.from('inventory_rules').select('service_id, inventory_item_id, quantity_required, inventory_items(id, total_quantity)')
    ]);
    if (weeklyError) throw weeklyError;
    if (specificError) throw specificError;
    if (bookingsError) throw bookingsError;
    if (inventoryRulesError) throw inventoryRulesError;
    const weeklyRulesMap = new Map(weeklyRules.map((r)=>[
        r.day_of_week,
        r
      ]));
    const specificRulesMap = new Map(dateSpecificRules.map((r)=>[
        r.date,
        r
      ]));
    const availability = {};
    const now = new Date();
    for (const dateStr of dateRange){
      const date = startOfDay(parseISO(dateStr));
      const dayOfWeek = date.getDay();
      let rule = specificRulesMap.get(dateStr) || weeklyRulesMap.get(dayOfWeek);
      let isAvailable = rule ? rule.is_available !== false : false;
      if (isAvailable) {
        const requiredItems = inventoryRules.filter((r)=>r.service_id === serviceIdForAvail);
        for (const requiredItem of requiredItems){
          const item = requiredItem.inventory_items;
          if (!item) continue;
          const bookingsUsingItem = bookings.filter((b)=>{
            const bookingStart = startOfDay(parseISO(b.drop_off_date));
            const bookingEnd = endOfDay(parseISO(b.pickup_date));
            const bookingServiceId = b.addons?.isDelivery && b.plan.id === 2 ? 4 : b.plan.id;
            const bookingRequiresItem = inventoryRules.some((ir)=>ir.service_id === bookingServiceId && ir.inventory_item_id === item.id);
            return bookingRequiresItem && date >= bookingStart && date <= bookingEnd;
          });
          const quantityUsed = bookingsUsingItem.reduce((acc, curr)=>{
            const bookingServiceId = curr.addons?.isDelivery && curr.plan.id === 2 ? 4 : curr.plan.id;
            const ruleForItem = inventoryRules.find((ir)=>ir.service_id === bookingServiceId && ir.inventory_item_id === item.id);
            return acc + (ruleForItem ? ruleForItem.quantity_required : 0);
          }, 0);
          if (quantityUsed + requiredItem.quantity_required > item.total_quantity) {
            isAvailable = false;
            break;
          }
        }
      }
      const intervalMap = {
        1: 120,
        2: 60,
        3: 60,
        4: 120
      };
      const interval = intervalMap[serviceIdForAvail] || 120;
      const deliverySlots = rule ? generateSlotsFromRange(rule.delivery_start_time, rule.delivery_end_time, interval, date, now) : [];
      const pickupSlots = rule ? generateSlotsFromRange(rule.pickup_start_time, rule.pickup_end_time, interval, date, now) : [];
      const returnSlots = rule ? generateSlotsFromRange(rule.return_start_time, rule.return_end_time, 60, date, now) : [];
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
    console.error('Get Availability Error:', error.message, error.stack);
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
