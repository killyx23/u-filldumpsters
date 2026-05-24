import { createClient } from 'npm:@supabase/supabase-js@2';
import { Stripe } from 'npm:stripe@15.8.0';
import { getCorsHeaders } from "./cors.ts";

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
);

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', {
  apiVersion: '2024-06-20',
});

type Json = Record<string, unknown>;

function isAdminUser(user: { user_metadata?: Record<string, unknown>; app_metadata?: Record<string, unknown> } | null): boolean {
  if (!user) return false;
  return (
    user.user_metadata?.is_admin === true ||
    user.app_metadata?.is_admin === true ||
    user.app_metadata?.app_role === 'admin'
  );
}

function toMoney(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.round(parsed * 100) / 100);
}

function appendHistory(existing: unknown, entry: Json): Json[] {
  const base = Array.isArray(existing) ? existing : [];
  return [...base, entry];
}

async function sendChatMessage(params: {
  customerId: number;
  bookingId: number;
  content: string;
  severity: 'success' | 'warning' | 'urgent' | 'info';
  context?: Json;
}) {
  await supabaseAdmin.from('chat_messages').insert({
    conversation_id: `cust_${params.customerId}`,
    customer_id: params.customerId,
    booking_id: params.bookingId,
    sender_type: 'admin',
    message_content: params.content,
    is_read: false,
    message_severity: params.severity,
    message_context: params.context ?? {},
  });
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
    const bookingId = Number(body.bookingId ?? body.booking_id);
    const action = String(body.action ?? 'auto');
    const amount = toMoney(body.amount);
    const reason = String(body.reason ?? '').trim();
    const manualChargeId = body.manualChargeId ?? null;
    const paymentMethodOverride = body.paymentMethodId ?? null;

    if (!bookingId || amount <= 0) {
      throw new Error('Booking ID and positive amount are required.');
    }

    const { data: booking, error: bookingError } = await supabaseAdmin
      .from('bookings')
      .select('*, stripe_payment_info(*)')
      .eq('id', bookingId)
      .single();
    if (bookingError || !booking) throw new Error('Booking not found.');

    const paymentInfo = Array.isArray(booking.stripe_payment_info)
      ? booking.stripe_payment_info[0]
      : booking.stripe_payment_info;

    const now = new Date().toISOString();
    const existingChargeHistory = booking.charge_outcome_history ?? [];
    const existingReceiptHistory = booking.receipt_status_history ?? [];
    const existingDelta = (booking.payment_delta_details ?? {}) as Json;

    const baseDelta: Json = {
      ...existingDelta,
      amount_due: amount,
      reason: reason || existingDelta.reason || 'Reschedule/payment difference',
      requested_at: existingDelta.requested_at ?? now,
      last_updated_at: now,
      requested_by_admin: user.email ?? 'admin',
    };

    const ensureOriginalReceipt =
      booking.receipt_original_snapshot ??
      {
        captured_at: now,
        booking_id: booking.id,
        status: booking.status,
        total_price: booking.total_price,
        tax_amount: booking.tax_amount,
        subtotal_before_tax: booking.subtotal_before_tax,
        created_at: booking.created_at,
      };

    if (action === 'manual_success') {
      const historyEntry = {
        type: 'manual_charge_success',
        at: now,
        amount,
        reason,
        manual_charge_id: manualChargeId,
        actor: user.email,
      };
      const statusEntry = {
        at: now,
        status: 'Confirmed',
        type: 'payment_delta_cleared_manual',
        amount,
        note: reason || 'Manual charge confirmed by admin.',
      };

      const { error: updateError } = await supabaseAdmin
        .from('bookings')
        .update({
          status: 'Confirmed',
          verification_notes: `Payment difference charged manually by ${user.email ?? 'admin'}.`,
          is_manually_verified: true,
          payment_delta_details: {
            ...baseDelta,
            state: 'charged_manual',
            charged_at: now,
            charge_reference: manualChargeId,
          },
          charge_outcome_history: appendHistory(existingChargeHistory, historyEntry),
          receipt_original_snapshot: ensureOriginalReceipt,
          receipt_status_history: appendHistory(existingReceiptHistory, statusEntry),
        })
        .eq('id', bookingId);
      if (updateError) throw new Error(updateError.message);

      await sendChatMessage({
        customerId: booking.customer_id,
        bookingId,
        severity: 'success',
        content: `Your booking #${bookingId} payment update is complete. A charge of $${amount.toFixed(2)} was successfully processed and your booking is moving forward.`,
        context: { action: 'manual_success', amount, manualChargeId },
      });

      return new Response(JSON.stringify({ success: true, mode: 'manual_success' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'cancel') {
      const historyEntry = {
        type: 'charge_cancelled',
        at: now,
        amount,
        reason,
        actor: user.email,
      };
      const statusEntry = {
        at: now,
        status: booking.status,
        type: 'payment_delta_cancelled',
        amount,
        note: reason || 'Charge was not approved by admin.',
      };
      const { error: updateError } = await supabaseAdmin
        .from('bookings')
        .update({
          payment_delta_details: {
            ...baseDelta,
            state: 'cancelled',
            cancelled_at: now,
            cancellation_reason: reason || 'Cancelled by admin',
          },
          charge_outcome_history: appendHistory(existingChargeHistory, historyEntry),
          receipt_original_snapshot: ensureOriginalReceipt,
          receipt_status_history: appendHistory(existingReceiptHistory, statusEntry),
        })
        .eq('id', bookingId);
      if (updateError) throw new Error(updateError.message);

      await sendChatMessage({
        customerId: booking.customer_id,
        bookingId,
        severity: 'urgent',
        content: `Action required for booking #${bookingId}: we could not proceed with the additional payment (${reason || 'charge was cancelled'}). Please contact support to avoid delays.`,
        context: { action: 'cancel', amount, reason },
      });

      return new Response(JSON.stringify({ success: true, mode: 'cancel' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Default hybrid auto-charge attempt.
    const stripeCustomerId = paymentInfo?.stripe_customer_id ?? null;
    const paymentIntentId = paymentInfo?.stripe_payment_intent_id ?? booking.payment_intent ?? null;
    let paymentMethodId: string | null = paymentMethodOverride;

    if (!stripeCustomerId) {
      throw new Error('No Stripe customer ID linked to this booking.');
    }

    if (!paymentMethodId && paymentIntentId) {
      try {
        const existingPi = await stripe.paymentIntents.retrieve(String(paymentIntentId));
        if (existingPi.payment_method) {
          paymentMethodId = String(existingPi.payment_method);
        }
      } catch (stripeLookupError) {
        console.warn('[charge-booking-difference] Failed to retrieve payment method from existing payment intent', stripeLookupError);
      }
    }

    if (!paymentMethodId) {
      const historyEntry = {
        type: 'auto_charge_unavailable',
        at: now,
        amount,
        reason,
        actor: user.email,
      };
      await supabaseAdmin
        .from('bookings')
        .update({
          status: 'pending_payment',
          payment_delta_details: {
            ...baseDelta,
            state: 'manual_required',
            auto_charge_error: 'No reusable payment method available',
          },
          charge_outcome_history: appendHistory(existingChargeHistory, historyEntry),
          receipt_original_snapshot: ensureOriginalReceipt,
        })
        .eq('id', bookingId);

      await sendChatMessage({
        customerId: booking.customer_id,
        bookingId,
        severity: 'warning',
        content: `Booking #${bookingId} has a pending payment adjustment of $${amount.toFixed(2)}. We were unable to auto-charge your saved card and need your attention.`,
        context: { action: 'auto_charge_unavailable', amount },
      });

      return new Response(JSON.stringify({
        success: false,
        manualRequired: true,
        message: 'No reusable payment method available for auto-charge.',
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    try {
      const pi = await stripe.paymentIntents.create({
        amount: Math.round(amount * 100),
        currency: 'usd',
        customer: String(stripeCustomerId),
        payment_method: String(paymentMethodId),
        confirm: true,
        off_session: true,
        description: `Booking #${bookingId} payment difference`,
        metadata: {
          booking_id: String(bookingId),
          reason: reason || 'Payment difference',
          actor: user.email ?? 'admin',
        },
      });

      const historyEntry = {
        type: 'auto_charge_success',
        at: now,
        amount,
        reason,
        actor: user.email,
        payment_intent_id: pi.id,
      };
      const statusEntry = {
        at: now,
        status: 'Confirmed',
        type: 'payment_delta_cleared_auto',
        amount,
        note: reason || 'Auto charge successful',
      };

      const { error: updateError } = await supabaseAdmin
        .from('bookings')
        .update({
          status: 'Confirmed',
          verification_notes: `Auto-charged payment difference by ${user.email ?? 'admin'}.`,
          is_manually_verified: true,
          payment_delta_details: {
            ...baseDelta,
            state: 'charged_auto',
            charged_at: now,
            payment_intent_id: pi.id,
            payment_method_id: paymentMethodId,
          },
          charge_outcome_history: appendHistory(existingChargeHistory, historyEntry),
          receipt_original_snapshot: ensureOriginalReceipt,
          receipt_status_history: appendHistory(existingReceiptHistory, statusEntry),
        })
        .eq('id', bookingId);
      if (updateError) throw new Error(updateError.message);

      await sendChatMessage({
        customerId: booking.customer_id,
        bookingId,
        severity: 'success',
        content: `Good news — your booking #${bookingId} payment adjustment of $${amount.toFixed(2)} was processed successfully. Your booking will continue as scheduled.`,
        context: { action: 'auto_charge_success', amount, paymentIntentId: pi.id },
      });

      return new Response(JSON.stringify({
        success: true,
        mode: 'auto_charge',
        paymentIntentId: pi.id,
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    } catch (stripeError) {
      const message = stripeError instanceof Error ? stripeError.message : String(stripeError);
      const historyEntry = {
        type: 'auto_charge_failed',
        at: now,
        amount,
        reason,
        actor: user.email,
        error: message,
      };
      await supabaseAdmin
        .from('bookings')
        .update({
          status: 'pending_payment',
          payment_delta_details: {
            ...baseDelta,
            state: 'manual_required',
            auto_charge_error: message,
          },
          charge_outcome_history: appendHistory(existingChargeHistory, historyEntry),
          receipt_original_snapshot: ensureOriginalReceipt,
        })
        .eq('id', bookingId);

      await sendChatMessage({
        customerId: booking.customer_id,
        bookingId,
        severity: 'warning',
        content: `Booking #${bookingId} needs attention: we could not complete the additional payment of $${amount.toFixed(2)} automatically. Support will follow up.`,
        context: { action: 'auto_charge_failed', amount, error: message },
      });

      return new Response(JSON.stringify({
        success: false,
        manualRequired: true,
        message,
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[charge-booking-difference] Error:', message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
