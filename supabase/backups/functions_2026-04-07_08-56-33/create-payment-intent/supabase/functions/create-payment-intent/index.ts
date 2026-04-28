import { corsHeaders } from "./cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import Stripe from "https://esm.sh/stripe@14.14.0?target=deno";
const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
  apiVersion: "2023-10-16",
  httpClient: Stripe.createFetchHttpClient()
});
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [create-payment-intent] Function invoked.`);
  try {
    // 1. Parse request body
    let body;
    try {
      body = await req.json();
    } catch (parseError) {
      console.error(`[${timestamp}] [create-payment-intent] Failed to parse request JSON:`, parseError);
      throw new Error("Invalid request format. Expected JSON.");
    }
    console.log(`[${timestamp}] [create-payment-intent] Received request body:`, JSON.stringify(body));
    const booking_id = body.booking_id || body.bookingId;
    if (!booking_id) {
      console.error(`[${timestamp}] [create-payment-intent] Missing booking_id in request.`);
      return new Response(JSON.stringify({
        error: "Missing booking_id in request payload"
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseServiceKey) {
      console.error(`[${timestamp}] [create-payment-intent] Supabase environment variables missing.`);
      throw new Error("Server misconfiguration: Database connection details missing.");
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    // 2. Fetch booking data from database
    console.log(`[${timestamp}] [create-payment-intent] Querying database for booking ID: ${booking_id}`);
    const { data: booking, error: fetchError } = await supabase.from("bookings").select("id, total_price, status").eq("id", booking_id).single();
    if (fetchError || !booking) {
      console.error(`[${timestamp}] [create-payment-intent] Database query failed:`, fetchError || "Booking not found");
      return new Response(JSON.stringify({
        error: `Booking not found. ID: ${booking_id}`
      }), {
        status: 404,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    console.log(`[${timestamp}] [create-payment-intent] Retrieved booking details:`, JSON.stringify(booking));
    // 3. Prepare Stripe API call
    const amountInCents = Math.round(booking.total_price * 100);
    console.log(`[${timestamp}] [create-payment-intent] Requesting Stripe PaymentIntent for amount: ${amountInCents} cents.`);
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountInCents,
      currency: "usd",
      metadata: {
        booking_id: booking_id.toString()
      }
    });
    console.log(`[${timestamp}] [create-payment-intent] Stripe PaymentIntent successfully created. ID: ${paymentIntent.id}`);
    // 4. Update booking with Stripe details
    console.log(`[${timestamp}] [create-payment-intent] Updating booking ${booking_id} with payment_intent and client_secret.`);
    const { error: dbError } = await supabase.from("bookings").update({
      payment_intent: paymentIntent.id,
      client_secret: paymentIntent.client_secret
    }).eq("id", booking_id);
    if (dbError) {
      console.error(`[${timestamp}] [create-payment-intent] Database update failed:`, dbError);
      throw new Error(`Failed to save payment details to booking: ${dbError.message}`);
    }
    console.log(`[${timestamp}] [create-payment-intent] Database update successful.`);
    const responsePayload = {
      success: true,
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id
    };
    console.log(`[${timestamp}] [create-payment-intent] Returning successful response to client.`);
    return new Response(JSON.stringify(responsePayload), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  } catch (error) {
    console.error(`[${timestamp}] [create-payment-intent] CRITICAL ERROR:`, error);
    return new Response(JSON.stringify({
      error: error.message || "An unexpected server error occurred."
    }), {
      status: 400,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
});
