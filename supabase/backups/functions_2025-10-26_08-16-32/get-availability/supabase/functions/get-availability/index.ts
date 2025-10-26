import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from './cors.ts';
import { startOfDay, endOfDay, add, set, parseISO, isWithinInterval, eachDayOfInterval, format } from 'https://esm.sh/date-fns@2.30.0';
const generateTimeSlots = (start, end, interval, bookedSlots)=>{
  const slots = [];
  let current = start;
  while(current < end){
    const slotEnd = add(current, {
      minutes: interval
    });
    const isBooked = bookedSlots.some((bookedSlot)=>isWithinInterval(current, {
        start: bookedSlot.start,
        end: add(bookedSlot.end, {
          minutes: -1
        })
      }) || isWithinInterval(add(slotEnd, {
        minutes: -1
      }), {
        start: bookedSlot.start,
        end: add(bookedSlot.end, {
          minutes: -1
        })
      }));
    if (!isBooked) {
      slots.push({
        value: `${String(current.getHours()).padStart(2, '0')}:${String(current.getMinutes()).padStart(2, '0')}`,
        label: `${String(current.getHours() % 12 || 12).padStart(2, '0')}:${String(current.getMinutes()).padStart(2, '0')} ${current.getHours() >= 12 ? 'PM' : 'AM'}`
      });
    }
    current = add(current, {
      minutes: interval
    });
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
    const supabase = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
    const actualServiceId = serviceId === 2 && isDelivery ? 4 : serviceId;
    const { data: generalSettings, error: settingsError } = await supabase.from('service_availability').select('*');
    if (settingsError) throw new Error(`Availability settings error: ${settingsError.message}`);
    const { data: dateSpecificSettings, error: dateSettingsError } = await supabase.from('date_specific_availability').select('*').gte('date', startDate).lte('date', endDate);
    if (dateSettingsError) throw new Error(`Date-specific settings error: ${dateSettingsError.message}`);
    const { data: unavailableDates, error: unavailableDatesError } = await supabase.from('unavailable_dates').select('date, service_id').gte('date', startDate).lte('date', endDate);
    if (unavailableDatesError) throw new Error(`Unavailable dates error: ${unavailableDatesError.message}`);
    const { data: bookings, error: bookingsError } = await supabase.from('bookings').select('drop_off_date, pickup_date, plan, status, drop_off_time_slot, pickup_time_slot').in('status', [
      'confirmed',
      'rented_out',
      'rescheduled'
    ]).lte('drop_off_date', endDate).gte('pickup_date', startDate);
    if (bookingsError) throw new Error(`Bookings fetch error: ${bookingsError.message}`);
    const { data: equipment, error: equipmentError } = await supabase.from('equipment').select('id, total_quantity, blocks_all_services_when_rented, service_id_association');
    if (equipmentError) throw new Error(`Equipment fetch error: ${equipmentError.message}`);
    const serviceInventory = equipment.find((e)=>e.service_id_association === actualServiceId);
    const maxInventory = serviceInventory ? serviceInventory.total_quantity : 1;
    const availability = {};
    const dateRange = eachDayOfInterval({
      start: parseISO(startDate),
      end: parseISO(endDate)
    });
    for (const day of dateRange){
      const dateStr = format(day, 'yyyy-MM-dd');
      const dayOfWeek = day.getDay();
      const specificUnavailable = unavailableDates.find((d)=>d.date === dateStr && (d.service_id === actualServiceId || d.service_id === null));
      if (specificUnavailable) {
        availability[dateStr] = {
          available: false,
          deliverySlots: [],
          pickupSlots: [],
          returnSlots: []
        };
        continue;
      }
      const dateSpecific = dateSpecificSettings.find((d)=>d.date === dateStr && d.service_id === actualServiceId);
      const general = generalSettings.find((g)=>g.day_of_week === dayOfWeek && g.service_id === actualServiceId);
      const settings = dateSpecific || general;
      if (!settings || !settings.is_available) {
        availability[dateStr] = {
          available: false,
          deliverySlots: [],
          pickupSlots: [],
          returnSlots: []
        };
        continue;
      }
      const inventoryCount = bookings.filter((b)=>{
        const bookingStart = startOfDay(parseISO(b.drop_off_date));
        const bookingEnd = endOfDay(parseISO(b.pickup_date));
        let bookingServiceId = b.plan?.id;
        if (b.plan?.name?.toLowerCase().includes('delivery')) {
          bookingServiceId = 4;
        }
        let isServiceMatch = bookingServiceId === actualServiceId;
        const isBlockingEquipmentRented = equipment.some((e)=>e.blocks_all_services_when_rented && bookingServiceId === e.service_id_association);
        return isWithinInterval(day, {
          start: bookingStart,
          end: bookingEnd
        }) && (isServiceMatch || isBlockingEquipmentRented);
      }).length;
      if (inventoryCount >= maxInventory) {
        availability[dateStr] = {
          available: false,
          deliverySlots: [],
          pickupSlots: [],
          returnSlots: []
        };
        continue;
      }
      const dayStart = startOfDay(day);
      const parseTime = (timeStr)=>timeStr ? set(dayStart, {
          hours: parseInt(timeStr.split(':')[0]),
          minutes: parseInt(timeStr.split(':')[1])
        }) : null;
      const deliveryStart = parseTime(settings.delivery_start_time);
      const deliveryEnd = parseTime(settings.delivery_end_time);
      const pickupStart = parseTime(settings.pickup_start_time);
      const pickupEnd = parseTime(settings.pickup_end_time);
      const returnStart = parseTime(settings.return_start_time);
      const returnEnd = parseTime(settings.return_end_time);
      const dailyBookedSlots = {
        delivery: [],
        pickup: [],
        return: []
      };
      const dayBookings = bookings.filter((b)=>b.drop_off_date === dateStr || b.pickup_date === dateStr);
      dayBookings.forEach((b)=>{
        let bookingServiceId = b.plan?.id;
        if (b.plan?.name?.toLowerCase().includes('delivery')) {
          bookingServiceId = 4;
        }
        let isRelevant = bookingServiceId === actualServiceId;
        if (!isRelevant) return;
        const [dropOffH, dropOffM] = (b.drop_off_time_slot || '00:00').split(':').map(Number);
        const [pickupH, pickupM] = (b.pickup_time_slot || '00:00').split(':').map(Number);
        const buffer = 120; // 2-hour window (60 mins before, 60 mins after)
        if (b.drop_off_date === dateStr) {
          const dropOffTime = set(dayStart, {
            hours: dropOffH,
            minutes: dropOffM
          });
          const slot = {
            start: add(dropOffTime, {
              minutes: -buffer / 2
            }),
            end: add(dropOffTime, {
              minutes: buffer / 2
            })
          };
          if (bookingServiceId === 2) dailyBookedSlots.pickup.push(slot); // Self-service pickup
          else dailyBookedSlots.delivery.push(slot); // Delivery
        }
        if (b.pickup_date === dateStr) {
          const pickupTime = set(dayStart, {
            hours: pickupH,
            minutes: pickupM
          });
          const slot = {
            start: add(pickupTime, {
              minutes: -buffer / 2
            }),
            end: add(pickupTime, {
              minutes: buffer / 2
            })
          };
          if (bookingServiceId === 2) dailyBookedSlots.return.push(slot); // Self-service return
          else dailyBookedSlots.pickup.push(slot); // Regular pickup
        }
      });
      const interval = 60;
      availability[dateStr] = {
        available: true,
        deliverySlots: deliveryStart && deliveryEnd ? generateTimeSlots(deliveryStart, deliveryEnd, interval, dailyBookedSlots.delivery) : [],
        pickupSlots: pickupStart && pickupEnd ? generateTimeSlots(pickupStart, pickupEnd, interval, dailyBookedSlots.pickup) : [],
        returnSlots: returnStart && returnEnd ? generateTimeSlots(returnStart, returnEnd, interval, dailyBookedSlots.return) : []
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
