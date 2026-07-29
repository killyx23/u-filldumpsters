import { getCorsHeaders } from "./cors.ts";
import { Stripe } from "npm:stripe@15.8.0";
import { createClient } from 'npm:@supabase/supabase-js@2';
const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY"), {
  apiVersion: "2024-06-20"
});
const supabase = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
Deno.serve(async (req)=>{
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }
  try {
    const { bookingId, amount, reason, chargeId } = await req.json();
    if (!bookingId || amount === undefined || !reason || !chargeId) {
      throw new Error("Missing required parameters for refund action. Booking ID, amount, reason, and charge ID are required.");
    }
    const refundAmount = Math.round(amount * 100);
    const refund = await stripe.refunds.create({
      charge: chargeId,
      amount: refundAmount,
      reason: 'requested_by_customer',
      metadata: {
        admin_reason: reason,
        booking_id: bookingId
      }
    });
    const refundDetails = {
      refund_id: refund.id,
      amount: amount,
      reason: reason,
      status: refund.status,
      created_at: new Date().toISOString()
    };
    const { error: updateError } = await supabase.from('bookings').update({
      status: 'Cancelled',
      refund_details: refundDetails
    }).eq('id', bookingId);
    if (updateError) {
      console.error(`Failed to update booking ${bookingId} after refund:`, updateError);
      throw new Error(`Stripe refund succeeded, but database update failed: ${updateError.message}`);
    }

    // Reverse loyalty points with service role (client cannot call admin_adjust_loyalty_points)
    let loyalty = { points_reversed: 0, already_processed: true };
    try {
      const { data: loyaltyResult, error: loyaltyError } = await supabase.rpc('reverse_booking_loyalty_points', {
        p_booking_id: bookingId,
        p_reason: `Cancelled booking #${bookingId} — loyalty points reversed after refund`
      });
      if (loyaltyError) {
        console.error(`[refund-payment] Loyalty reverse failed for booking ${bookingId}:`, loyaltyError);
      } else {
        const row = Array.isArray(loyaltyResult) ? loyaltyResult[0] : loyaltyResult;
        loyalty = {
          points_reversed: Number(row?.points_reversed || 0),
          already_processed: Boolean(row?.already_processed),
          new_balance: Number(row?.new_balance || 0)
        };
        console.log(`[refund-payment] Loyalty reverse for booking ${bookingId}:`, loyalty);
      }
    } catch (loyaltyErr) {
      console.error(`[refund-payment] Loyalty reverse exception for booking ${bookingId}:`, loyaltyErr);
    }

    return new Response(JSON.stringify({
      success: true,
      message: `Refund of ${amount.toFixed(2)} processed successfully.`,
      refund,
      loyalty
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      },
      status: 200
    });
  } catch (error) {
    console.error("Refund payment error:", error);
    return new Response(JSON.stringify({
      error: error.message
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      },
      status: 500
    });
  }
});
