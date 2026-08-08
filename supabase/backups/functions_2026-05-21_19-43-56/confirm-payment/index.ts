import { corsHeaders } from "./cors.ts";
import Stripe from "https://esm.sh/stripe@14.14.0?target=deno";
Deno.serve(async (req)=>{
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
  }
  try {
    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
    if (!stripeKey) {
      throw new Error('Stripe secret key not configured on server.');
    }
    const stripe = new Stripe(stripeKey, {
      apiVersion: '2023-10-16',
      httpClient: Stripe.createFetchHttpClient()
    });
    const bodyText = await req.text();
    let body;
    try {
      body = JSON.parse(bodyText);
    } catch (e) {
      console.error("Failed to parse request body:", e);
      return new Response(JSON.stringify({
        success: false,
        error: "Invalid JSON body provided."
      }), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        },
        status: 400
      });
    }
    const { payment_intent_id, payment_method_id, amount, currency = 'usd', booking_data, booking_id } = body;
    // Strict Input Validation
    if (!payment_intent_id || typeof payment_intent_id !== 'string' || !payment_intent_id.startsWith('pi_')) {
      console.error(`Validation Error: Missing or invalid payment_intent_id: ${payment_intent_id}`);
      return new Response(JSON.stringify({
        success: false,
        error: "A valid payment_intent_id string is required."
      }), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        },
        status: 400
      });
    }
    if (payment_method_id !== undefined && (typeof payment_method_id !== 'string' || !payment_method_id.startsWith('pm_'))) {
      console.error(`Validation Error: Invalid payment_method_id format: ${payment_method_id}`);
      return new Response(JSON.stringify({
        success: false,
        error: "If provided, payment_method_id must be a valid Stripe PM string."
      }), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        },
        status: 400
      });
    }
    if (amount !== undefined && (!Number.isInteger(amount) || amount <= 0)) {
      console.error(`Validation Error: Invalid amount format: ${amount}`);
      return new Response(JSON.stringify({
        success: false,
        error: "Amount must be a positive integer representing cents."
      }), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        },
        status: 400
      });
    }
    console.log(`Processing confirmation for intent: ${payment_intent_id}`);
    let intent;
    try {
      // If payment_method_id is provided, confirm the intent using it
      if (payment_method_id) {
        const origin = req.headers.get('origin') || 'https://ufilldumpsters.com';
        intent = await stripe.paymentIntents.confirm(payment_intent_id, {
          payment_method: payment_method_id,
          return_url: `${origin}/confirmation?booking_id=${booking_id || ''}`
        });
      } else {
        // Checking status post-3D secure
        intent = await stripe.paymentIntents.retrieve(payment_intent_id);
      }
    } catch (stripeError) {
      console.error('Stripe API Error:', stripeError);
      // Determine HTTP status based on Stripe error type
      let statusCode = 400;
      if (stripeError.type === 'StripeAuthenticationError') statusCode = 401;
      if (stripeError.type === 'StripeCardError') statusCode = 402;
      if (stripeError.type === 'StripeConnectionError' || stripeError.type === 'StripeAPIError') statusCode = 502;
      return new Response(JSON.stringify({
        success: false,
        error: stripeError.message || "Error communicating with payment gateway."
      }), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        },
        status: statusCode
      });
    }
    console.log(`PaymentIntent confirmed status: ${intent.status}`);
    if (intent.status === 'succeeded') {
      return new Response(JSON.stringify({
        success: true,
        status: intent.status,
        booking_id: booking_id
      }), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        },
        status: 200
      });
    } else if (intent.status === 'requires_action' || intent.status === 'requires_source_action') {
      return new Response(JSON.stringify({
        success: false,
        status: 'requires_action',
        client_secret: intent.client_secret,
        booking_id: booking_id
      }), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        },
        status: 200
      });
    } else {
      return new Response(JSON.stringify({
        success: false,
        status: intent.status,
        error: `Payment cannot be processed. Current status: ${intent.status}`
      }), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        },
        status: 400
      });
    }
  } catch (error) {
    console.error('Unexpected edge function error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message || 'An unexpected error occurred during payment processing.'
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 500
    });
  }
});
