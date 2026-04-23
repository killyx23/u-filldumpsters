import { corsHeaders } from "./cors.ts";
import { Stripe } from "npm:stripe@15.8.0";
import { createClient } from 'npm:@supabase/supabase-js@2';
const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY"), {
  apiVersion: "2024-06-20"
});
const supabase = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }
  try {
    const { totalPrice, planName, customerEmail, customerName, success_url, cancel_url, bookingId } = await req.json();
    if (!totalPrice || !planName || !customerEmail || !customerName || !success_url || !cancel_url || !bookingId) {
      throw new Error("Missing one or more required parameters for checkout session creation.");
    }
    let stripeCustomer;
    const existingCustomers = await stripe.customers.list({
      email: customerEmail,
      limit: 1
    });
    if (existingCustomers.data.length > 0) {
      stripeCustomer = existingCustomers.data[0];
    } else {
      stripeCustomer = await stripe.customers.create({
        email: customerEmail,
        name: customerName
      });
    }
    const { data: dbCustomer, error: customerFetchError } = await supabase.from('bookings').select('customers!inner(id)').eq('id', bookingId).single();
    if (customerFetchError) throw new Error(`Could not find customer for booking ${bookingId}: ${customerFetchError.message}`);
    if (dbCustomer && dbCustomer.customers) {
      const { error: customerUpdateError } = await supabase.from('customers').update({
        stripe_customer_id: stripeCustomer.id
      }).eq('id', dbCustomer.customers.id);
      if (customerUpdateError) {
        console.warn(`Could not update customer ${dbCustomer.customers.id} with stripe_customer_id: ${customerUpdateError.message}`);
      }
    } else {
      console.warn(`Could not find associated DB customer for booking ${bookingId} to update Stripe ID.`);
    }
    const session = await stripe.checkout.sessions.create({
      payment_method_types: [
        'card'
      ],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: planName
            },
            unit_amount: Math.round(totalPrice * 100)
          },
          quantity: 1
        }
      ],
      mode: 'payment',
      customer: stripeCustomer.id,
      success_url: success_url,
      cancel_url: cancel_url,
      client_reference_id: bookingId.toString(),
      metadata: {
        booking_id: bookingId.toString()
      },
      customer_update: {
        address: 'auto',
        name: 'auto'
      }
    });
    return new Response(JSON.stringify({
      sessionId: session.id
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      },
      status: 200
    });
  } catch (error) {
    console.error("Stripe session creation error:", error);
    return new Response(JSON.stringify({
      error: `Failed to create Stripe session: ${error.message}`
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      },
      status: 500
    });
  }
});
