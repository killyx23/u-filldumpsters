import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from './cors.ts';
import { addDays, format, parseISO, isBefore, parse, set, addMinutes, isSameDay, startOfDay } from 'https://esm.sh/date-fns@2';
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
      const isWindow = intervalMinutes >= 120;
      const label = isWindow ? `${format(currentTime, 'h:mm a')} - ${format(slotEnd, 'h:mm a')}` : `${format(currentTime, 'h:mm a')}`;
      slots.push({
        value: format(currentTime, 'HH:mm:ss'),
        label
      });
    }
    currentTime = addMinutes(currentTime, intervalMinutes);
  }
  return slots;
};
// NEW: decide if a booking occupies inventory on a given date, based on occupancy_model
const bookingOccupiesDate = (occupancyModel, date, bookingDropOffDate, bookingPickupDate)=>{
  const d = startOfDay(date);
  const drop = startOfDay(parseISO(bookingDropOffDate));
  const pick = startOfDay(parseISO(bookingPickupDate));
  switch(occupancyModel){
    case 'dropoff_only':
      return isSameDay(d, drop);
    case 'dropoff_and_pickup_only':
      return isSameDay(d, drop) || isSameDay(d, pick);
    case 'same_day':
      // If data is inconsistent (drop != pickup), be conservative and treat it like a range.
      if (!isSameDay(drop, pick)) {
        return d >= drop && d <= pick;
      }
      return isSameDay(d, drop);
    case 'range':
    default:
      // Inclusive range (same behavior as you had before)
      return d >= drop && d <= pick;
  }
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
      throw new Error('An unexpected error occurred: Service ID, start date, and end date are required.');
    }
    const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
    const start = parseISO(startDate);
    const end = parseISO(endDate);
    const dateRange = [];
    for(let d = start; d <= end; d = addDays(d, 1)){
      dateRange.push(format(d, 'yyyy-MM-dd'));
    }
    const serviceIdForAvail = isDelivery && Number(serviceId) === 2 ? 4 : Number(serviceId);
    const [{ data: weeklyRules, error: weeklyError }, { data: dateSpecificRules, error: specificError }, { data: bookings, error: bookingsError }, { data: inventoryRules, error: inventoryRulesError }, // NEW: get occupancy_model per service id
    { data: services, error: servicesError }] = await Promise.all([
      supabaseAdmin.from('service_availability').select('*').eq('service_id', serviceIdForAvail),
      supabaseAdmin.from('date_specific_availability').select('*').eq('service_id', serviceIdForAvail).in('date', dateRange),
      supabaseAdmin.from('bookings').select('plan, drop_off_date, pickup_date, addons').lte('drop_off_date', endDate).gte('pickup_date', startDate).in('status', [
        'Confirmed',
        'Rescheduled',
        'Delivered',
        'waiting_to_be_returned',
        'pending_review'
      ]),
      supabaseAdmin.from('inventory_rules').select('service_id, inventory_item_id, quantity_required, inventory_items(id, total_quantity)'),
      supabaseAdmin.from('services').select('id, occupancy_model')
    ]);
    if (weeklyError) throw weeklyError;
    if (specificError) throw specificError;
    if (bookingsError) throw bookingsError;
    if (inventoryRulesError) throw inventoryRulesError;
    if (servicesError) throw servicesError;
    // --- LOGGING: inspect raw bookings data ---
    console.log(`[get_availability] Total bookings fetched: ${bookings?.length ?? 0}`);
    if (bookings && bookings.length > 0) {
      console.log('[get_availability] Sample booking (first):', JSON.stringify(bookings[0]));
      console.log('[get_availability] Sample booking plan:', JSON.stringify(bookings[0]?.plan));
      console.log('[get_availability] Sample booking addons:', JSON.stringify(bookings[0]?.addons));
      console.log('[get_availability] All booking plan values:', JSON.stringify(bookings.map((b)=>({
          plan: b.plan,
          addons: b.addons
        }))));
    } else {
      console.log('[get_availability] No bookings found in date range.');
    }
    // --- LOGGING: inspect inventory rules ---
    console.log(`[get_availability] Total inventory rules fetched: ${inventoryRules?.length ?? 0}`);
    console.log('[get_availability] Inventory rules:', JSON.stringify(inventoryRules));
    // --- LOGGING: inspect services and occupancy models ---
    console.log('[get_availability] Services with occupancy models:', JSON.stringify(services));
    const weeklyRulesMap = new Map(weeklyRules.map((r)=>[
        r.day_of_week,
        r
      ]));
    const specificRulesMap = new Map(dateSpecificRules.map((r)=>[
        r.date,
        r
      ]));
    // NEW: map of service id -> occupancy_model
    const occupancyByServiceId = new Map((services ?? []).map((s)=>[
        Number(s.id),
        String(s.occupancy_model ?? 'range')
      ]));
    const availability = {};
    const now = new Date();
    for (const dateStr of dateRange){
      const date = startOfDay(parseISO(dateStr));
      const dayOfWeek = date.getDay();
      const rule = specificRulesMap.get(dateStr) || weeklyRulesMap.get(dayOfWeek);
      let isAvailable = rule ? rule.is_available !== false : false;
      if (isAvailable) {
        const requiredItems = inventoryRules.filter((r)=>r.service_id === serviceIdForAvail);
        // --- LOGGING: required inventory items for this service ---
        console.log(`[get_availability] Date: ${dateStr} | serviceIdForAvail: ${serviceIdForAvail} | requiredItems:`, JSON.stringify(requiredItems));
        for (const requiredItem of requiredItems){
          const item = requiredItem.inventory_items;
          if (!item) continue;
          const bookingsUsingItem = bookings.filter((b)=>{
            const bookingServiceId = b.addons?.isDelivery && b.plan?.id === 2 ? 4 : b.plan?.id;
            // --- LOGGING: resolved service ID per booking ---
            console.log(`[get_availability] Booking plan raw: ${JSON.stringify(b.plan)} | addons raw: ${JSON.stringify(b.addons)} | resolved bookingServiceId: ${bookingServiceId}`);
            if (!bookingServiceId) return false;
            // Does that booking's service require THIS item?
            const bookingRequiresItem = inventoryRules.some((ir)=>ir.service_id === bookingServiceId && ir.inventory_item_id === item.id);
            // --- LOGGING: whether booking requires the item ---
            console.log(`[get_availability] bookingServiceId: ${bookingServiceId} | item.id: ${item.id} | bookingRequiresItem: ${bookingRequiresItem}`);
            if (!bookingRequiresItem) return false;
            // NEW: occupancy_model decides which days count as "occupied"
            const occupancyModel = occupancyByServiceId.get(Number(bookingServiceId)) ?? 'range';
            const occupies = bookingOccupiesDate(occupancyModel, date, b.drop_off_date, b.pickup_date);
            // --- LOGGING: occupancy check result ---
            console.log(`[get_availability] Date: ${dateStr} | occupancyModel: ${occupancyModel} | drop_off: ${b.drop_off_date} | pickup: ${b.pickup_date} | occupies: ${occupies}`);
            return occupies;
          });
          const quantityUsed = bookingsUsingItem.reduce((acc, curr)=>{
            const bookingServiceId = curr.addons?.isDelivery && curr.plan?.id === 2 ? 4 : curr.plan?.id;
            const ruleForItem = inventoryRules.find((ir)=>ir.service_id === bookingServiceId && ir.inventory_item_id === item.id);
            return acc + (ruleForItem ? ruleForItem.quantity_required : 0);
          }, 0);
          // --- LOGGING: final quantity check ---
          console.log(`[get_availability] Date: ${dateStr} | item.id: ${item.id} | total_quantity: ${item.total_quantity} | quantityUsed: ${quantityUsed} | required: ${requiredItem.quantity_required} | wouldExceed: ${quantityUsed + requiredItem.quantity_required > item.total_quantity}`);
          if (quantityUsed + requiredItem.quantity_required > item.total_quantity) {
            isAvailable = false;
            console.log(`[get_availability] Date: ${dateStr} marked UNAVAILABLE due to inventory item ${item.id}`);
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
