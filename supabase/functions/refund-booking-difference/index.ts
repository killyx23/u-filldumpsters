import { getCorsHeaders } from "./cors.ts";
import { Stripe } from "npm:stripe@15.8.0";
import { createClient } from "npm:@supabase/supabase-js@2";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "", {
  apiVersion: "2024-06-20",
});
const supabase = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

/**
 * Partial refund for a reschedule price decrease.
 * Does NOT cancel the booking or reverse loyalty points.
 */
Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const bookingId = body.bookingId ?? body.booking_id;
    const amount = Number(body.amount);
    const reason = String(body.reason || "Reschedule price difference refund").trim();
    let chargeId = body.chargeId ?? body.charge_id ?? null;

    if (!bookingId || !Number.isFinite(amount) || amount <= 0) {
      throw new Error("bookingId and a positive amount are required.");
    }

    if (!chargeId) {
      const { data: paymentInfo, error: payErr } = await supabase
        .from("stripe_payment_info")
        .select("stripe_charge_id")
        .eq("booking_id", bookingId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (payErr) throw new Error(`Failed to load Stripe payment info: ${payErr.message}`);
      chargeId = paymentInfo?.stripe_charge_id || null;
    }

    if (!chargeId) {
      throw new Error("Missing Stripe Charge ID for refund.");
    }

    const refund = await stripe.refunds.create({
      charge: chargeId,
      amount: Math.round(amount * 100),
      reason: "requested_by_customer",
      metadata: {
        admin_reason: reason,
        booking_id: String(bookingId),
        type: "reschedule_difference",
      },
    });

    const { data: bookingData, error: loadErr } = await supabase
      .from("bookings")
      .select("fees")
      .eq("id", bookingId)
      .single();

    if (loadErr) throw new Error(`DB error loading booking: ${loadErr.message}`);

    const existingFees =
      bookingData?.fees && typeof bookingData.fees === "object" ? bookingData.fees : {};
    const newFees = {
      ...existingFees,
      reschedule_difference_refund: {
        amount,
        description: reason,
        refund_id: refund.id,
        charge_id: chargeId,
        status: refund.status,
        created_at: new Date().toISOString(),
      },
    };

    const { error: updErr } = await supabase
      .from("bookings")
      .update({ fees: newFees })
      .eq("id", bookingId);

    if (updErr) {
      throw new Error(
        `Stripe refund succeeded, but failed to update booking fees: ${updErr.message}`,
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `Refund of $${amount.toFixed(2)} processed successfully.`,
        refundId: refund.id,
        refund,
        chargeId,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[refund-booking-difference] Error:", message);
    return new Response(JSON.stringify({ success: false, error: message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
