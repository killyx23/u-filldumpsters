import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getCorsHeaders } from "./cors.ts";
import { addDays, format, parseISO, isBefore, parse, set, addMinutes, isSameDay, startOfDay } from 'npm:date-fns@2.30.0';

const generateSlotsFromRange = (startTime, endTime, intervalMinutes, currentDate, now) => {
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
  while (isBefore(currentTime, end)) {
    const slotEnd = addMinutes(currentTime, intervalMinutes);
    if (isBefore(slotEnd, addMinutes(end, 1))) {
      const isWindow = intervalMinutes >= 120;
      const label = isWindow ? `${format(currentTime, 'h:mm a')} - ${format(slotEnd, 'h:mm a')}` : `${format(currentTime, 'h:mm a')}`;
      slots.push({
        value: format(currentTime, 'HH:mm:ss'),
        end: format(slotEnd, 'HH:mm:ss'),
        label
      });
    }
    currentTime = addMinutes(currentTime, intervalMinutes);
  }
  return slots;
};

/**
 * Resolves which service's inventory_rules/reservations a request is actually asking about.
 *
 * Phase 2d: replaces the hardcoded `serviceId === 2 && isDelivery -> 4` with a lookup of
 * services.delivery_variant_service_id, so any future delivery variant is covered without an
 * edge function edit — the same fix Phase 1 applied to the write-time trigger.
 */
function resolveServiceIdForAvailability(serviceId, isDelivery, servicesById) {
  const base = Number(serviceId);
  if (!isDelivery) return base;
  const variant = servicesById.get(base)?.delivery_variant_service_id;
  return variant ? Number(variant) : base;
}

/** Phase 2d: services.slot_interval_minutes replaces the hardcoded intervalMap. */
function slotIntervalFor(serviceIdForAvail, servicesById) {
  return servicesById.get(serviceIdForAvail)?.slot_interval_minutes || 120;
}

/**
 * Sum of reservation rows for one resource/date, split into the part that blocks any request
 * ("day" rows, plus any slot row — see resource_quantity_used) and the individual slot rows a
 * candidate window needs to be overlap-tested against.
 *
 * Mirrors public.resource_quantity_used exactly, but as a single bulk in-memory reduction over
 * one query instead of one RPC call per (date, slot, resource) — at this business's data volume
 * that is a handful of rows per resource per month, so the O(n) scan costs nothing, and it keeps
 * get-availability's one Supabase round trip per request. scripts/verify-resource-reservations.mjs
 * exercises public.resource_quantity_used directly so the two can't silently drift apart.
 */
function buildReservationIndex(reservations) {
  const index = new Map(); // `${resource_id}|${date}` -> { dayQty, slotRows: [{start,end,qty}] }
  for (const r of reservations ?? []) {
    const key = `${r.resource_id}|${r.reserved_date}`;
    const entry = index.get(key) ?? { dayQty: 0, slotRows: [] };
    if (r.granularity === 'day') {
      entry.dayQty += r.quantity;
    } else {
      entry.slotRows.push({ start: r.slot_start, end: r.slot_end, qty: r.quantity });
    }
    index.set(key, entry);
  }
  return index;
}

function dayUsage(index, resourceId, dateStr) {
  const entry = index.get(`${resourceId}|${dateStr}`);
  if (!entry) return 0;
  return entry.dayQty + entry.slotRows.reduce((sum, row) => sum + row.qty, 0);
}

function slotUsage(index, resourceId, dateStr, slotStart, slotEnd) {
  const entry = index.get(`${resourceId}|${dateStr}`);
  if (!entry) return 0;
  const overlapping = entry.slotRows
    .filter((row) => row.start < slotEnd && row.end > slotStart)
    .reduce((sum, row) => sum + row.qty, 0);
  return entry.dayQty + overlapping;
}

/**
 * Phase 2f.3: annotates a generated slot list with per-slot capacity for slot-granular
 * requirements. No-op (every slot stays available) when the service has none, which is every
 * service today — Phase 2f is infrastructure ahead of any service actually being configured for
 * slot granularity (see the design doc's Phase 1 data-audit deferral).
 */
function annotateSlots(slots, dateStr, slotGranularItems, reservationIndex) {
  if (slotGranularItems.length === 0) {
    return slots.map((s) => ({ ...s, available: true }));
  }
  return slots.map((slot) => {
    let remaining = Infinity;
    for (const item of slotGranularItems) {
      const used = slotUsage(reservationIndex, item.inventory_item_id, dateStr, slot.value, slot.end ?? slot.value);
      const itemRemaining = item.inventory_items.total_quantity - used;
      remaining = Math.min(remaining, itemRemaining);
    }
    return { ...slot, available: remaining >= 1, remaining: Math.max(0, remaining) };
  });
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  try {
    const { serviceId, startDate, endDate, isDelivery } = await req.json();
    if (!serviceId || !startDate || !endDate) {
      throw new Error('Service ID, start date, and end date are required.');
    }
    const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
    const start = parseISO(startDate);
    const end = parseISO(endDate);
    const dateRange = [];
    for (let d = start; d <= end; d = addDays(d, 1)) {
      dateRange.push(format(d, 'yyyy-MM-dd'));
    }

    // Fetched up front (small table) so delivery-variant resolution and slot intervals are data
    // lookups rather than hardcoded ids — see resolveServiceIdForAvailability / slotIntervalFor.
    const { data: services, error: servicesError } = await supabaseAdmin
      .from('services')
      .select('id, occupancy_model, delivery_variant_service_id, slot_interval_minutes, service_type');
    if (servicesError) throw servicesError;
    const servicesById = new Map((services ?? []).map((s) => [Number(s.id), s]));

    const serviceIdForAvail = resolveServiceIdForAvailability(serviceId, isDelivery, servicesById);
    const interval = slotIntervalFor(serviceIdForAvail, servicesById);
    const isWindowService = servicesById.get(serviceIdForAvail)?.service_type === 'window';

    console.log(`\n${'='.repeat(80)}`);
    console.log(`[get-availability] serviceId=${serviceId}, isDelivery=${isDelivery}, serviceIdForAvail=${serviceIdForAvail}, interval=${interval}min`);
    console.log(`[get-availability] dateRange: ${startDate} → ${endDate} (${dateRange.length} days)`);

    const [
      { data: weeklyRules, error: weeklyError },
      { data: dateSpecificRules, error: specificError },
      { data: inventoryRules, error: inventoryRulesError },
    ] = await Promise.all([
      supabaseAdmin.from('service_availability').select('*').eq('service_id', serviceIdForAvail),
      supabaseAdmin.from('date_specific_availability').select('*').eq('service_id', serviceIdForAvail).in('date', dateRange),
      supabaseAdmin.from('inventory_rules').select('service_id, inventory_item_id, quantity_required, occupancy_model, scheduling_granularity, inventory_items(id, total_quantity, name)'),
    ]);
    if (weeklyError) throw weeklyError;
    if (specificError) throw specificError;
    if (inventoryRulesError) throw inventoryRulesError;

    const requiredItems = (inventoryRules ?? []).filter((r) => r.service_id === serviceIdForAvail);
    const dayGranularItems = requiredItems.filter((r) => (r.scheduling_granularity ?? 'day') !== 'slot');
    const slotGranularItems = requiredItems.filter((r) => r.scheduling_granularity === 'slot');
    const resourceIds = [...new Set(requiredItems.map((r) => r.inventory_item_id))];

    if (requiredItems.length === 0) {
      console.log(`  ⚠️  NO INVENTORY RULES for service ${serviceIdForAvail} — capacity is UNCHECKED`);
    }

    // Reservations are pre-expanded one row per occupied day (see booking_reservation_rows), so
    // this single indexed range query replaces the old nested loop over every booking's raw
    // plan/addons JSONB (bookingOccupiesDate + the O(bookings × rules) scan it drove).
    let reservationIndex = new Map();
    if (resourceIds.length > 0) {
      const { data: reservations, error: reservationsError } = await supabaseAdmin
        .from('booking_resource_reservations')
        .select('resource_id, reserved_date, quantity, slot_start, slot_end, granularity')
        .in('resource_id', resourceIds)
        .gte('reserved_date', startDate)
        .lte('reserved_date', endDate);
      if (reservationsError) throw reservationsError;
      reservationIndex = buildReservationIndex(reservations);
      console.log(`  Reservations in range for resources [${resourceIds.join(',')}]: ${reservations?.length ?? 0}`);
    }

    const weeklyRulesMap = new Map(weeklyRules.map((r) => [r.day_of_week, r]));
    const specificRulesMap = new Map(dateSpecificRules.map((r) => [r.date, r]));

    const availability = {};
    const now = new Date();
    for (const dateStr of dateRange) {
      const date = startOfDay(parseISO(dateStr));
      const dayOfWeek = date.getDay();
      const rule = specificRulesMap.get(dateStr) || weeklyRulesMap.get(dayOfWeek);
      let isAvailable = rule ? rule.is_available !== false : false;

      if (isAvailable) {
        for (const requiredItem of dayGranularItems) {
          const item = requiredItem.inventory_items;
          if (!item) continue;
          const used = dayUsage(reservationIndex, item.id, dateStr);
          const wouldExceed = used + requiredItem.quantity_required > item.total_quantity;
          if (wouldExceed) {
            console.log(`  [${dateStr}] "${item.name}" full: ${used} + ${requiredItem.quantity_required} > ${item.total_quantity}`);
            isAvailable = false;
            break;
          }
        }
      }

      // Delivery-window services (16-yard dumpster, delivered trailer) have a distinct
      // "delivery pickup window" for the return trip, separate from the self-pickup
      // pickup/return-by config used by hourly services. Phase 2f.4 relies on this being
      // correct: BookingForm now sources plan 1/4's pickup window from here instead of
      // querying date_specific_availability directly.
      const deliverySlots = rule ? generateSlotsFromRange(rule.delivery_start_time ?? rule.delivery_window_start_time, rule.delivery_end_time ?? rule.delivery_window_end_time, interval, date, now) : [];
      const pickupSlots = rule
        ? isWindowService
          ? generateSlotsFromRange(rule.delivery_pickup_start_time ?? rule.delivery_pickup_window_start_time, rule.delivery_pickup_end_time ?? rule.delivery_pickup_window_end_time, interval, date, now)
          : generateSlotsFromRange(rule.pickup_start_time, rule.pickup_end_time ?? rule.return_by_time, interval, date, now)
        : [];
      const returnSlots = rule ? generateSlotsFromRange(rule.return_start_time ?? rule.return_by_time, rule.return_end_time, 60, date, now) : [];
      const hourlySlots = rule ? generateSlotsFromRange(rule.hourly_start_time, rule.hourly_end_time, 60, date, now) : [];

      // Phase 2f.3: date-level availability now also requires at least one generated slot to
      // have room, when the service has a slot-granular requirement. This is a no-op for every
      // service configured today (none has scheduling_granularity = 'slot' yet), so existing
      // day-only behaviour is unchanged; it activates automatically once one is added.
      const annotatedDeliverySlots = annotateSlots(deliverySlots, dateStr, slotGranularItems, reservationIndex);
      const annotatedPickupSlots = annotateSlots(pickupSlots, dateStr, slotGranularItems, reservationIndex);

      if (isAvailable && slotGranularItems.length > 0) {
        const candidateSlots = [...annotatedDeliverySlots, ...annotatedPickupSlots];
        if (candidateSlots.length > 0 && !candidateSlots.some((s) => s.available)) {
          console.log(`  [${dateStr}] slot-granular resource has no free slot — marking unavailable`);
          isAvailable = false;
        }
      }

      availability[dateStr] = {
        available: isAvailable,
        deliverySlots: annotatedDeliverySlots,
        pickupSlots: annotatedPickupSlots,
        returnSlots,
        hourlySlots,
      };
    }

    console.log(`[get-availability] REQUEST COMPLETE`);
    console.log(`${'='.repeat(80)}\n`);
    return new Response(JSON.stringify({ availability }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (error) {
    console.error('[get-availability] ERROR:', error.message, error.stack);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});
