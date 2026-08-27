import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getCorsHeaders } from "./cors.ts";

const ADMIN_DELETE_PASSWORD = Deno.env.get('ADMIN_DELETE_PASSWORD');

function getEquipmentHoldItems(booking) {
  const equipment = booking?.addons?.equipment;
  if (!Array.isArray(equipment) || equipment.length === 0) return [];
  return equipment
    .map((item) => {
      const equipmentId = Number(item.dbId || item.equipment_id || item.id);
      const quantity = Number(item.quantity || 1);
      if (!Number.isFinite(equipmentId) || equipmentId <= 0) return null;
      if (!Number.isFinite(quantity) || quantity <= 0) return null;
      return { equipment_id: equipmentId, quantity };
    })
    .filter(Boolean);
}

function bookingHasActiveEquipmentHold(booking) {
  if (!booking) return false;
  const items = getEquipmentHoldItems(booking);
  if (items.length === 0) return false;
  if (booking.addons?.equipment_hold_active === false) return false;
  if (booking.addons?.equipment_hold_active === true) return true;
  return String(booking.status || '') === 'pending_payment';
}

Deno.serve(async (req)=>{
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
  }
  try {
    const { bookingId, password } = await req.json();
    if (password !== ADMIN_DELETE_PASSWORD) {
      return new Response(JSON.stringify({
        error: 'Invalid password.'
      }), {
        status: 401,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    if (!bookingId) {
      throw new Error('Booking ID is required.');
    }
    const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');

    // Restock unpaid checkout holds before deleting (e.g. abandoned pending_payment)
    const { data: booking, error: bookingFetchError } = await supabaseAdmin
      .from('bookings')
      .select('id, status, addons')
      .eq('id', bookingId)
      .maybeSingle();

    if (bookingFetchError) {
      console.error('[delete-booking] Failed to load booking before delete:', bookingFetchError);
    } else if (bookingHasActiveEquipmentHold(booking)) {
      const items = getEquipmentHoldItems(booking);
      if (items.length > 0) {
        const { error: restockError } = await supabaseAdmin.rpc('increment_equipment_quantities', {
          items_to_increment: items,
        });
        if (restockError) {
          console.error('[delete-booking] Equipment restock failed:', restockError);
          throw new Error(`Could not restock equipment before delete: ${restockError.message}`);
        }
        console.log('[delete-booking] Restocked equipment hold for booking', bookingId, items);
      }
    }

    // Cascade of deletions
    // 1. booking_equipment
    await supabaseAdmin.from('booking_equipment').delete().eq('booking_id', bookingId);
    // 2. stripe_payment_info
    await supabaseAdmin.from('stripe_payment_info').delete().eq('booking_id', bookingId);
    // 3. customer_notes associated with the booking
    await supabaseAdmin.from('customer_notes').delete().eq('booking_id', bookingId);
    // 4. Finally, the booking itself
    const { error } = await supabaseAdmin.from('bookings').delete().eq('id', bookingId);
    if (error) {
      throw error;
    }
    return new Response(JSON.stringify({
      message: 'Booking successfully deleted.'
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error("Delete Booking Error:", error);
    return new Response(JSON.stringify({
      error: error.message
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
});
