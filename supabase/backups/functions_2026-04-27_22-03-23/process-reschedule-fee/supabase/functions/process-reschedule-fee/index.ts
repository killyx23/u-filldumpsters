import { corsHeaders } from "./cors.ts";
import Stripe from "https://esm.sh/stripe@14.5.0?target=deno";
const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "", {
  apiVersion: "2023-10-16",
  httpClient: Stripe.createFetchHttpClient()
});
Deno.serve(async (req)=>{
  if (req.method === 'OPTIONS') return new Response('ok', {
    headers: corsHeaders
  });
  try {
    const { bookingId, customerId, feeAmount, paymentMethodId } = await req.json();
    if (feeAmount > 0) {
      if (!customerId) {
        throw new Error('Customer ID is missing, cannot process charge.');
      }
      const charge = await stripe.paymentIntents.create({
        amount: Math.round(feeAmount * 100),
        currency: 'usd',
        customer: customerId,
        payment_method: paymentMethodId,
        confirm: true,
        off_session: true,
        description: `Reschedule fee and/or difference for booking #${bookingId}`
      });
      return new Response(JSON.stringify({
        success: true,
        chargeId: charge.id
      }), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    return new Response(JSON.stringify({
      success: true,
      chargeId: null
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      status: 400,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
});
