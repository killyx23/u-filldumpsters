import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getCorsHeaders } from './cors.ts';

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

function jsonError(corsHeaders, error, status) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}

async function requireAdminCaller(req, corsHeaders) {
  const authHeader = req.headers.get('Authorization') || '';
  if (!authHeader.startsWith('Bearer ')) {
    return { error: jsonError(corsHeaders, 'Admin authentication required.', 401) };
  }

  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    return { error: jsonError(corsHeaders, 'Admin authentication required.', 401) };
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) {
    return { error: jsonError(corsHeaders, 'Unauthorized. Please sign in again.', 401) };
  }
  if (user.app_metadata?.is_admin !== true) {
    return { error: jsonError(corsHeaders, 'Admin access required.', 403) };
  }

  return { user, token };
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const adminAuth = await requireAdminCaller(req, corsHeaders);
    if (adminAuth.error) return adminAuth.error;

    const { bookingId, password, verifyOnly } = await req.json();

    const configuredPassword = String(ADMIN_DELETE_PASSWORD || '').trim();
    if (configuredPassword) {
      if (password !== configuredPassword) {
        return jsonError(corsHeaders, 'Invalid password.', 401);
      }
    } else {
      // Local/dev fallback when ADMIN_DELETE_PASSWORD is not configured:
      // still require a non-empty confirmation password from the admin UI.
      console.warn(
        '[delete-booking] ADMIN_DELETE_PASSWORD is not set — allowing delete for authenticated admin only.',
      );
      if (!password || String(password).trim().length === 0) {
        return jsonError(
          corsHeaders,
          'Confirmation password is required.',
          401,
        );
      }
    }

    // Password-only check for other admin permanent-delete actions (e.g. damage photos).
    if (verifyOnly === true) {
      return new Response(JSON.stringify({ ok: true }), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      });
    }

    if (!bookingId) {
      throw new Error('Booking ID is required.');
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    // Restock unpaid checkout holds before deleting (e.g. abandoned pending_payment)
    const { data: booking, error: bookingFetchError } = await supabaseAdmin
      .from('bookings')
      .select('id, status, addons')
      .eq('id', bookingId)
      .maybeSingle();

    if (bookingFetchError) {
      console.error('[delete-booking] Failed to load booking before delete:', bookingFetchError);
    } else if (!booking) {
      return jsonError(corsHeaders, `Booking #${bookingId} was not found.`, 404);
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

    // Clear relationships that can block hard deletes
    await supabaseAdmin
      .from('pending_customers')
      .update({ booking_id: null })
      .eq('booking_id', bookingId);

    await supabaseAdmin.from('abandoned_checkouts').delete().eq('booking_id', bookingId);
    await supabaseAdmin.from('feedback_tokens').delete().eq('booking_id', bookingId);
    await supabaseAdmin.from('unsubscribe_tokens').delete().eq('booking_id', bookingId);

    // Clear self-referential reschedule links (no ON DELETE action)
    await supabaseAdmin
      .from('bookings')
      .update({ rescheduled_to_booking_id: null })
      .eq('rescheduled_to_booking_id', bookingId);
    await supabaseAdmin
      .from('bookings')
      .update({ rescheduled_from_booking_id: null })
      .eq('rescheduled_from_booking_id', bookingId);

    await supabaseAdmin.from('booking_equipment').delete().eq('booking_id', bookingId);
    await supabaseAdmin.from('stripe_payment_info').delete().eq('booking_id', bookingId);
    await supabaseAdmin.from('customer_notes').delete().eq('booking_id', bookingId);

    const { error } = await supabaseAdmin.from('bookings').delete().eq('id', bookingId);
    if (error) {
      throw error;
    }

    console.log(
      `[delete-booking] Deleted booking #${bookingId} by admin ${adminAuth.user.email || adminAuth.user.id}`,
    );

    return new Response(
      JSON.stringify({ message: 'Booking successfully deleted.' }),
      {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      },
    );
  } catch (error) {
    console.error('Delete Booking Error:', error);
    return jsonError(
      corsHeaders,
      error?.message || 'Failed to delete booking.',
      500,
    );
  }
});
