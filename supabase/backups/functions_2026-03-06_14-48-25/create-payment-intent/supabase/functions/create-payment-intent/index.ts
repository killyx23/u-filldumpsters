import { corsHeaders } from "./cors.ts";
// @ts-ignore
import Stripe from "https://esm.sh/stripe@12.3.0";
const stripe = Stripe(Deno.env.get("STRIPE_SECRET_KEY"));
Deno.serve(async (req)=>{
  // This is needed if you're planning to invoke your function from a browser.
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }
  try {
    const { amount, bookingId } = await req.json();
    if (!amount || !bookingId) {
      throw new Error("Amount and Booking ID are required.");
    }
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amount,
      currency: "usd",
      automatic_payment_methods: {
        enabled: true
      },
      metadata: {
        booking_id: bookingId
      }
    });
    return new Response(JSON.stringify({
      clientSecret: paymentIntent.client_secret
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      },
      status: 200
    });
  } catch (error) {
    return new Response(JSON.stringify({
      error: error.message
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      },
      status: 400
    });
  }
});
