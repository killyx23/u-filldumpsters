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
      console.error('STRIPE_SECRET_KEY is not set in environment variables');
      throw new Error('Stripe secret key not configured on the server');
    }
    const stripe = new Stripe(stripeKey, {
      apiVersion: '2023-10-16',
      httpClient: Stripe.createFetchHttpClient()
    });
    const body = await req.json();
    const { amount, currency = 'usd', bookingId, description, bookingData } = body;
    console.log(`Received payment intent request for amount: ${amount}`);
    if (!amount || isNaN(amount)) {
      throw new Error('A valid amount is required');
    }
    // Create a PaymentIntent with the order amount and currency
    // amount should already be in cents from the frontend
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount),
      currency,
      description: description || `Booking ${bookingId || 'Unknown'}`,
      metadata: {
        bookingId: bookingId ? String(bookingId) : null,
        customerEmail: bookingData?.email || null
      }
    });
    console.log(`Successfully created PaymentIntent: ${paymentIntent.id}`);
    return new Response(JSON.stringify({
      clientSecret: paymentIntent.client_secret,
      client_secret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 200
    });
  } catch (error) {
    console.error('Error creating payment intent:', error);
    return new Response(JSON.stringify({
      error: error.message
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 400
    });
  }
});
