import { createClient } from 'npm:@supabase/supabase-js@2';
import { getCorsHeaders } from "./cors.ts";

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
);

function toDateString(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    return value.split('T')[0];
  }
  return null;
}

function isAdminUser(user: { user_metadata?: Record<string, unknown>; app_metadata?: Record<string, unknown> } | null): boolean {
  if (!user) return false;
  return (
    user.user_metadata?.is_admin === true ||
    user.app_metadata?.is_admin === true ||
    user.app_metadata?.app_role === 'admin'
  );
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing Authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError || !user || !isAdminUser(user)) {
      return new Response(JSON.stringify({ error: 'Unauthorized — admin access required' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json();
    const originalBookingId = Number(body.bookingId ?? body.booking_id);
    const rescheduleDetails = body.rescheduleDetails ?? body;
    const initiatedBy = body.initiatedBy === 'customer' ? 'customer' : 'admin';
    const adminEmail = body.adminEmail ?? user.email ?? null;
    const newTotalPrice = body.newTotalPrice ?? rescheduleDetails?.new_total_price ?? null;

    if (!originalBookingId) {
      throw new Error('Booking ID is required.');
    }

    const { data: original, error: fetchError } = await supabaseAdmin
      .from('bookings')
      .select('*, stripe_payment_info(*)')
      .eq('id', originalBookingId)
      .single();

    if (fetchError || !original) {
      throw new Error('Original booking not found.');
    }

    const paymentInfo = Array.isArray(original.stripe_payment_info)
      ? original.stripe_payment_info[0]
      : original.stripe_payment_info;

    const stripeChargeId =
      paymentInfo?.stripe_charge_id ||
      original.payment_intent ||
      original.client_secret ||
      null;

    const newDropOffDate = toDateString(rescheduleDetails.new_drop_off_date);
    const newPickupDate = toDateString(rescheduleDetails.new_pickup_date);
    const newDropOffTime = rescheduleDetails.new_drop_off_time ?? null;
    const newPickupTime = rescheduleDetails.new_pickup_time ?? null;

    if (!newDropOffDate || !newPickupDate) {
      throw new Error('New drop-off and pickup dates are required.');
    }

    let newPlan = original.plan;
    if (rescheduleDetails.new_service_id != null) {
      const { data: service, error: serviceError } = await supabaseAdmin
        .from('services')
        .select('*')
        .eq('id', rescheduleDetails.new_service_id)
        .single();
      if (serviceError || !service) {
        throw new Error('New service not found.');
      }
      newPlan = {
        id: service.id,
        name: service.name,
        base_price: service.base_price,
        daily_rate: service.daily_rate,
        weekly_rate: service.weekly_rate,
        description: service.description,
      };
    }

    const newAddons = rescheduleDetails.new_addons
      ? { ...original.addons, rescheduled_addons: rescheduleDetails.new_addons }
      : original.addons;

    const verificationSkipped = Boolean(
      original.was_verification_skipped ||
      original.addons?.verificationSkipped ||
      original.addons?.wasVerificationSkipped
    );
    const effectiveNewTotal = newTotalPrice != null ? Number(newTotalPrice) : Number(original.total_price || 0);
    const originalTotal = Number(original.total_price || 0);
    const deltaAmount = Math.max(0, Math.round((effectiveNewTotal - originalTotal) * 100) / 100);
    const requiresPaymentDelta = deltaAmount > 0;
    const newStatus = requiresPaymentDelta ? 'pending_payment' : (verificationSkipped ? 'pending_review' : 'Confirmed');

    const cloneFields = {
      name: original.name,
      email: original.email,
      phone: original.phone,
      street: original.street,
      city: original.city,
      state: original.state,
      zip: original.zip,
      first_name: original.first_name,
      last_name: original.last_name,
      contact_address: original.contact_address,
      delivery_address: original.delivery_address,
      customer_id: original.customer_id,
      plan: newPlan,
      addons: newAddons,
      drop_off_date: newDropOffDate,
      pickup_date: newPickupDate,
      drop_off_time_slot: newDropOffTime,
      pickup_time_slot: newPickupTime,
      total_price: newTotalPrice != null ? Number(newTotalPrice) : original.total_price,
      subtotal_before_tax: original.subtotal_before_tax,
      tax_amount: original.tax_amount,
      tax_rate_used: original.tax_rate_used,
      distance_miles: rescheduleDetails.distance_miles ?? original.distance_miles,
      mileage_charge: original.mileage_charge,
      payment_intent: original.payment_intent,
      client_secret: original.client_secret,
      payment_method: original.payment_method,
      delivery_type: original.delivery_type,
      notes: rescheduleDetails.customer_comments ?? original.notes,
      status: newStatus,
      rescheduled_from_booking_id: originalBookingId,
      was_verification_skipped: original.was_verification_skipped,
      is_manually_verified: original.is_manually_verified,
      payment_delta_details: requiresPaymentDelta ? {
        state: 'pending',
        amount_due: deltaAmount,
        original_total_price: originalTotal,
        new_total_price: effectiveNewTotal,
        reason: 'Reschedule pricing difference',
        requested_at: new Date().toISOString(),
        source_booking_id: originalBookingId,
      } : null,
      receipt_original_snapshot: {
        captured_at: new Date().toISOString(),
        booking_id: originalBookingId,
        status: original.status,
        total_price: original.total_price,
        created_at: original.created_at,
      },
      receipt_status_history: requiresPaymentDelta ? [
        {
          at: new Date().toISOString(),
          status: 'pending_payment',
          type: 'payment_delta_required',
          amount: deltaAmount,
          note: 'Reschedule created a payment difference pending approval.',
        }
      ] : [],
    };

    const { data: newBooking, error: insertError } = await supabaseAdmin
      .from('bookings')
      .insert(cloneFields)
      .select()
      .single();

    if (insertError || !newBooking) {
      throw new Error(`Failed to create new booking: ${insertError?.message}`);
    }

    if (paymentInfo) {
      await supabaseAdmin.from('stripe_payment_info').upsert({
        booking_id: newBooking.id,
        stripe_payment_intent_id: paymentInfo.stripe_payment_intent_id,
        stripe_charge_id: paymentInfo.stripe_charge_id,
        stripe_customer_id: paymentInfo.stripe_customer_id,
        stripe_checkout_session_id: paymentInfo.stripe_checkout_session_id,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'booking_id' });
    }

    const actionAt = new Date().toISOString();
    const historyEntry = {
      rescheduled_at: actionAt,
      from_drop_off_date: original.drop_off_date,
      from_pickup_date: original.pickup_date,
      from_drop_off_time: original.drop_off_time_slot,
      from_pickup_time: original.pickup_time_slot,
      to_drop_off_date: newDropOffDate,
      to_pickup_date: newPickupDate,
      to_drop_off_time: newDropOffTime,
      to_pickup_time: newPickupTime,
      original_total_price: original.total_price,
      new_total_price: newTotalPrice ?? original.total_price,
      new_booking_id: newBooking.id,
      initiated_by: initiatedBy,
      admin_email: adminEmail,
      payment_delta_amount: deltaAmount,
    };

    const existingHistory = original.reschedule_history || [];
    const archiveDetails = {
      action: 'rescheduled',
      action_at: actionAt,
      initiated_by: initiatedBy,
      admin_email: adminEmail,
      original_created_at: original.created_at,
      original_total_price: original.total_price,
      stripe_charge_id: stripeChargeId,
      rescheduled_to_booking_id: newBooking.id,
      notes: rescheduleDetails.customer_comments ?? null,
    };

    const { error: updateOriginalError } = await supabaseAdmin
      .from('bookings')
      .update({
        status: 'Rescheduled',
        rescheduled_to_booking_id: newBooking.id,
        archive_details: archiveDetails,
        reschedule_history: [...existingHistory, historyEntry],
        reschedule_timestamp: actionAt,
        receipt_original_snapshot: original.receipt_original_snapshot ?? {
          captured_at: actionAt,
          booking_id: original.id,
          status: original.status,
          total_price: original.total_price,
          created_at: original.created_at,
        },
        receipt_status_history: [
          ...(Array.isArray(original.receipt_status_history) ? original.receipt_status_history : []),
          {
            at: actionAt,
            status: 'Rescheduled',
            type: 'rescheduled_archived',
            note: `Rescheduled to booking #${newBooking.id}`,
          },
        ],
      })
      .eq('id', originalBookingId);

    if (updateOriginalError) {
      throw new Error(`Failed to archive original booking: ${updateOriginalError.message}`);
    }

    await supabaseAdmin.from('reschedule_history_logs').insert({
      booking_id: originalBookingId,
      request_type: 'reschedule',
      request_status: 'approved',
      reschedule_request_time: actionAt,
      approval_timestamp: actionAt,
      admin_id: user.id,
      original_service_id: original.plan?.id ?? null,
      new_service_id: rescheduleDetails.new_service_id ?? original.plan?.id ?? null,
      original_drop_off_date: original.drop_off_date,
      original_pickup_date: original.pickup_date,
      original_drop_off_time: original.drop_off_time_slot,
      original_pickup_time: original.pickup_time_slot,
      new_drop_off_date: newDropOffDate,
      new_pickup_date: newPickupDate,
      new_drop_off_time: newDropOffTime,
      new_pickup_time: newPickupTime,
      original_total: original.total_price,
      new_total: newTotalPrice ?? original.total_price,
      cancellation_reason: rescheduleDetails.customer_comments ?? null,
    });

    await supabaseAdmin.from('customer_notes').insert({
      customer_id: original.customer_id,
      booking_id: originalBookingId,
      source: 'Reschedule Completed',
      content:
        `Booking #${originalBookingId} was rescheduled ${initiatedBy === 'customer' ? 'on behalf of the customer' : 'manually by admin'} (${adminEmail ?? 'admin'}). ` +
        `New booking #${newBooking.id}. Original Stripe charge retained for manual price adjustment.`,
      author_type: 'admin',
      is_read: false,
    });

    if (requiresPaymentDelta) {
      await supabaseAdmin.from('chat_messages').insert({
        conversation_id: `cust_${original.customer_id}`,
        customer_id: original.customer_id,
        booking_id: newBooking.id,
        sender_type: 'admin',
        message_content: `Your reschedule created a payment adjustment of $${deltaAmount.toFixed(2)}. We are processing this update and will contact you if any action is needed.`,
        is_read: false,
        message_severity: 'warning',
        message_context: {
          action: 'reschedule_payment_delta_pending',
          amount_due: deltaAmount,
          original_booking_id: originalBookingId,
          new_booking_id: newBooking.id,
        },
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        originalBookingId,
        newBookingId: newBooking.id,
        newBooking,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[admin-complete-reschedule] Error:', message);
    return new Response(JSON.stringify({ error: message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});
