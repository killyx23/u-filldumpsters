import { corsHeaders } from "./cors.ts";
import { Stripe } from "npm:stripe@15.8.0";
import { createClient } from 'npm:@supabase/supabase-js@2';
const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY"), {
  apiVersion: "2024-06-20"
});
const supabase = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
const debug = (...args)=>console.log("[WEBHOOK DEBUG]", ...args);
const handleCheckoutCompleted = async (session)=>{
  debug("=== Checkout Session Received ===", session);
  const bookingId = session.metadata?.booking_id || session.client_reference_id;
  const checkoutSessionId = session.id;
  const paymentIntentId = session.payment_intent;
  const stripeCustomerId = session.customer;
  debug("Extracted bookingId:", bookingId);
  debug("checkoutSessionId:", checkoutSessionId);
  debug("paymentIntentId:", paymentIntentId);
  debug("stripeCustomerId:", stripeCustomerId);
  if (!bookingId) {
    console.error("Missing booking_id in metadata or client_reference_id");
    return new Response("Missing booking_id", {
      status: 400
    });
  }
  try {
    debug("Fetching booking with id:", bookingId);
    const { data: existingBooking, error: fetchError } = await supabase.from("bookings").select("*").eq("id", bookingId).single();
    debug("Booking fetch result:", existingBooking);
    debug("Booking fetch error:", fetchError);
    if (fetchError || !existingBooking) {
      console.error("Could not fetch booking:", fetchError?.message);
      return new Response(`Could not fetch booking: ${fetchError?.message}`, {
        status: 500
      });
    }
    if (existingBooking.status !== "pending_payment") {
      debug("Booking already processed. Current status:", existingBooking.status);
      return new Response("Booking already processed", {
        status: 200
      });
    }
    // ------------------------------------------------------
    // RETRIEVE PAYMENT INTENT / CHARGE
    // ------------------------------------------------------
    let chargeId = null;
    debug("Retrieving PaymentIntent…");
    if (typeof paymentIntentId === "string") {
      try {
        const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId, {
          expand: [
            "latest_charge"
          ]
        });
        debug("PaymentIntent retrieved:", paymentIntent);
        if (paymentIntent.latest_charge) {
          chargeId = typeof paymentIntent.latest_charge === "string" ? paymentIntent.latest_charge : paymentIntent.latest_charge.id;
        }
        debug("Computed chargeId:", chargeId);
      } catch (err) {
        console.error("Failed to retrieve paymentIntent:", err);
      }
    }
    // ------------------------------------------------------
    // UPSERT INTO stripe_payment_info
    // ------------------------------------------------------
    debug("Upserting stripe_payment_info row…");
    const { error: paymentInfoError } = await supabase.from("stripe_payment_info").upsert({
      booking_id: bookingId,
      stripe_customer_id: typeof stripeCustomerId === "string" ? stripeCustomerId : null,
      stripe_payment_intent_id: typeof paymentIntentId === "string" ? paymentIntentId : null,
      stripe_checkout_session_id: checkoutSessionId,
      stripe_charge_id: chargeId
    }, {
      onConflict: "booking_id"
    });
    debug("Upsert stripe_payment_info error:", paymentInfoError);
    if (paymentInfoError) throw paymentInfoError;
    // ------------------------------------------------------
    // CREATE CUSTOMER ACCOUNT
    // ------------------------------------------------------
    debug("Invoking handle-booking-account-creation…");
    const { error: accountSetupError } = await supabase.functions.invoke("handle-booking-account-creation", {
      body: {
        customerId: existingBooking.customer_id
      }
    });
    debug("Account creation result:", accountSetupError);
    if (accountSetupError) {
      console.error("Failed to setup account:", accountSetupError.message);
    }
    // ------------------------------------------------------
    // UPDATE BOOKING STATUS
    // ------------------------------------------------------
    let finalStatus = "Confirmed";
    if (existingBooking.was_verification_skipped) {
      finalStatus = "pending_verification";
    } else if (existingBooking.addons?.addressVerificationSkipped) {
      finalStatus = "pending_review";
    }
    debug("Updating booking status to:", finalStatus);
    const { data: updatedBooking, error: updateError } = await supabase.from("bookings").update({
      status: finalStatus
    }).eq("id", bookingId).select("*, customers!inner(*)").single();
    debug("Updated booking:", updatedBooking);
    debug("Booking update error:", updateError);
    if (updateError) throw updateError;
    // ------------------------------------------------------
    // INSERT EQUIPMENT
    // ------------------------------------------------------
    const addons = updatedBooking.addons || {};
    debug("Addons:", addons);
    if (addons.equipment?.length > 0) {
      const equipmentToInsert = addons.equipment.map((item)=>({
          booking_id: bookingId,
          equipment_id: item.dbId,
          quantity: item.quantity
        })).filter((item)=>item.equipment_id);
      debug("Inserting equipment:", equipmentToInsert);
      if (equipmentToInsert.length > 0) {
        const { error: insertError } = await supabase.from("booking_equipment").insert(equipmentToInsert);
        debug("Equipment insert error:", insertError);
        if (insertError) {
          console.error("Failed to insert booking_equipment:", insertError);
        }
      }
    }
    // ------------------------------------------------------
    // SEND CONFIRMATION EMAIL
    // ------------------------------------------------------
    debug("Sending confirmation email…");
    let customEmailMessage = null;
    if (finalStatus === "pending_verification") {
      customEmailMessage = "Your booking is currently on hold due to missing verification items.";
    } else if (finalStatus === "pending_review") {
      customEmailMessage = "Your booking is currently on hold pending manual address verification.";
    }
    await supabase.functions.invoke("send-booking-confirmation", {
      body: {
        booking: updatedBooking,
        customMessage: customEmailMessage
      }
    });
    debug("Email sent.");
    console.log(`Webhook: Successfully processed booking ${bookingId}`);
    return new Response("OK", {
      status: 200
    });
  } catch (error) {
    console.error("Critical webhook error:", error);
    const { error: updateError } = await supabase.from("bookings").update({
      status: "pending_review",
      notes: `Webhook failed: ${error.message}`
    }).eq("id", bookingId);
    if (updateError) {
      console.error("Failed to update booking to pending_review:", updateError);
    }
    return new Response(`Webhook error: ${error.message}`, {
      status: 500
    });
  }
};
Deno.serve(async (req)=>{
  debug("=== Incoming Stripe Webhook Request ===");
  const signature = req.headers.get("Stripe-Signature");
  const body = await req.text();
  debug("Stripe raw body:", body);
  let event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, signature, Deno.env.get("STRIPE_WEBHOOK_SIGNING_SECRET"));
    debug("Stripe event verified:", event.type);
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return new Response(err.message, {
      status: 400
    });
  }
  if (event.type === "checkout.session.completed") {
    debug("Handling checkout.session.completed…");
    return await handleCheckoutCompleted(event.data.object);
  }
  return new Response(JSON.stringify({
    received: true
  }), {
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    },
    status: 200
  });
});
