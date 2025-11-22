// Consolidated Edge Functions Backup
// Each function is separated by headers for clarity



// ----------------------------
// Function: create-stripe-checkout-session
// ----------------------------

// --- File: cors.ts ---

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};


// --- File: index.ts ---

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



// ----------------------------
// Function: extend-rental
// ----------------------------

// --- File: cors.ts ---

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};


// --- File: index.ts ---

import { corsHeaders } from "./cors.ts";
import { Stripe } from "npm:stripe@15.8.0";
const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY"), {
  apiVersion: "2024-06-20"
});
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }
  try {
    const { customerId, days, pricePerDay, planName } = await req.json();
    if (!customerId || !days || !pricePerDay || !planName) {
      throw new Error("Missing required parameters.");
    }
    const customer = await stripe.customers.retrieve(customerId);
    if (!customer) throw new Error("Stripe Customer not found.");
    // Create an invoice item for the extension
    await stripe.invoiceItems.create({
      customer: customerId,
      amount: Math.round(days * pricePerDay * 100),
      currency: "usd",
      description: `Rental Extension: ${days} day(s) for ${planName}`
    });
    // Create an invoice
    const invoice = await stripe.invoices.create({
      customer: customerId,
      collection_method: 'charge_automatically',
      auto_advance: true
    });
    // Finalize and send the invoice
    await stripe.invoices.finalizeInvoice(invoice.id);
    await stripe.invoices.sendInvoice(invoice.id);
    // Optionally, attempt to pay it immediately
    await stripe.invoices.pay(invoice.id, {
      payment_method: customer.invoice_settings?.default_payment_method
    });
    return new Response(JSON.stringify({
      message: "Invoice created and sent successfully.",
      invoiceId: invoice.id
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      },
      status: 200
    });
  } catch (error) {
    console.error("Rental extension error:", error);
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



// ----------------------------
// Function: get-stripe-session
// ----------------------------

// --- File: cors.ts ---

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};


// --- File: index.ts ---

import { corsHeaders } from "./cors.ts";
import { Stripe } from "npm:stripe@15.8.0";
const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY"), {
  apiVersion: "2024-06-20"
});
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }
  try {
    const { sessionId } = await req.json();
    if (!sessionId) {
      throw new Error("Session ID is required.");
    }
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    return new Response(JSON.stringify({
      customerId: session.customer
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      },
      status: 200
    });
  } catch (error) {
    console.error("Get Stripe session error:", error);
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



// ----------------------------
// Function: get-booking-by-session
// ----------------------------

// --- File: cors.ts ---

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};


// --- File: index.ts ---

import { corsHeaders } from "./cors.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }
  try {
    const { sessionId } = await req.json();
    if (!sessionId) {
      throw new Error("Session ID is required.");
    }
    console.log("Looking up session:", sessionId);
    // 🔥 FIX: USE SERVICE ROLE KEY (anon cannot read stripe_payment_info due to RLS)
    const supabase = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
    // --- LOOKUP PAYMENT INFO ---
    const { data: paymentInfo, error: paymentError } = await supabase.from("stripe_payment_info").select("booking_id").eq("stripe_checkout_session_id", sessionId).single();
    if (paymentError || !paymentInfo) {
      const errorMessage = paymentError?.message ?? "Payment info not found for the session.";
      console.error("Payment lookup failed:", errorMessage);
      throw new Error(errorMessage);
    }
    console.log("Payment info found:", paymentInfo);
    // --- LOOKUP BOOKING ---
    const { data: booking, error: bookingError } = await supabase.from("bookings").select(`
        *,
        customers(*)
      `).eq("id", paymentInfo.booking_id).single();
    if (bookingError || !booking) {
      const errorMessage = bookingError?.message ?? "Could not find a booking for the provided session.";
      console.error("Booking lookup failed:", errorMessage);
      throw new Error(errorMessage);
    }
    console.log("Booking found:", booking.id);
    return new Response(JSON.stringify({
      booking
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      },
      status: 200
    });
  } catch (error) {
    console.error("Get booking by session error:", error.message);
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



// ----------------------------
// Function: get-session-status
// ----------------------------

// --- File: cors.ts ---

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};


// --- File: index.ts ---

import { corsHeaders } from "./cors.ts";
import { Stripe } from "npm:stripe@15.8.0";
const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY"), {
  apiVersion: "2024-06-20"
});
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }
  try {
    const { sessionId } = await req.json();
    if (!sessionId) {
      throw new Error("Session ID is required.");
    }
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    return new Response(JSON.stringify({
      status: session.status,
      payment_status: session.payment_status
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      },
      status: 200
    });
  } catch (error) {
    console.error("Get Stripe session status error:", error);
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



// ----------------------------
// Function: get-customer-details
// ----------------------------

// --- File: cors.ts ---

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};


// --- File: index.ts ---

import { corsHeaders } from "./cors.ts";
import { createClient } from 'npm:@supabase/supabase-js@2';
const supabase = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }
  try {
    const { customerId } = await req.json();
    if (!customerId) {
      throw new Error("Customer ID is required.");
    }
    const { data: customer, error: customerError } = await supabase.from('customers').select('*').eq('id', customerId).single();
    if (customerError) throw customerError;
    if (!customer) {
      return new Response(JSON.stringify({
        error: "Customer not found"
      }), {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        },
        status: 404
      });
    }
    const { data: bookings, error: bookingsError } = await supabase.from('bookings').select('*, reviews(*)').eq('customer_id', customerId).order('drop_off_date', {
      ascending: false
    });
    if (bookingsError) throw bookingsError;
    const { data: notes, error: notesError } = await supabase.from('customer_notes').select('*').eq('customer_id', customerId).order('created_at', {
      ascending: true
    });
    if (notesError) throw notesError;
    return new Response(JSON.stringify({
      customer,
      bookings,
      notes
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      },
      status: 200
    });
  } catch (error) {
    console.error("Get customer details error:", error.message);
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



// ----------------------------
// Function: get-equipment-inventory
// ----------------------------

// --- File: cors.ts ---

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};


// --- File: index.ts ---

import { corsHeaders } from "./cors.ts";
import { createClient } from 'npm:@supabase/supabase-js@2';
const supabase = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_ANON_KEY'));
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }
  try {
    const { data: equipment, error: equipmentError } = await supabase.from('equipment').select('id, name, total_quantity');
    if (equipmentError) throw equipmentError;
    // total_quantity in the equipment table now represents the current available stock,
    // so we don't need to manually calculate rented items anymore.
    return new Response(JSON.stringify({
      inventory: equipment
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      },
      status: 200
    });
  } catch (error) {
    console.error("Get equipment inventory error:", error.message);
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



// ----------------------------
// Function: get-eta
// ----------------------------

// --- File: cors.ts ---

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};


// --- File: index.ts ---

import { corsHeaders } from "./cors.ts";
const GOOGLE_MAPS_API_KEY = Deno.env.get("GOOGLE_MAPS_API_KEY");
const ORIGIN_ADDRESS = "227 West Casi Way, Saratoga Springs, Utah 84045";
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }
  if (!GOOGLE_MAPS_API_KEY) {
    console.error("Google Maps API key is not set.");
    return new Response(JSON.stringify({
      error: "Server configuration error."
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      },
      status: 500
    });
  }
  try {
    const { destination } = await req.json();
    if (!destination) {
      throw new Error("Destination address is required.");
    }
    const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${encodeURIComponent(ORIGIN_ADDRESS)}&destination=${encodeURIComponent(destination)}&key=${GOOGLE_MAPS_API_KEY}&units=imperial`;
    const response = await fetch(url);
    const data = await response.json();
    if (data.status !== 'OK' || !data.routes || data.routes.length === 0) {
      console.error("Google Maps API Error:", data.error_message || data.status);
      throw new Error("Could not calculate ETA. Check address validity.");
    }
    const leg = data.routes[0].legs[0];
    const eta = leg.duration.text;
    const distance = leg.distance.text;
    return new Response(JSON.stringify({
      eta,
      distance
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      },
      status: 200
    });
  } catch (error) {
    console.error("Get ETA function error:", error.message);
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



// ----------------------------
// Function: verify-address
// ----------------------------

// --- File: cors.ts ---

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};


// --- File: index.ts ---

import { corsHeaders } from "./cors.ts";
const GOOGLE_MAPS_API_KEY = Deno.env.get("GOOGLE_MAPS_API_KEY");
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }
  if (!GOOGLE_MAPS_API_KEY) {
    console.error("Google Maps API key is not set.");
    return new Response(JSON.stringify({
      error: "Server configuration error."
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      },
      status: 500
    });
  }
  try {
    const { address } = await req.json();
    if (!address) {
      throw new Error("Address is required for verification.");
    }
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${GOOGLE_MAPS_API_KEY}`;
    const response = await fetch(url);
    const data = await response.json();
    if (data.status === 'OK') {
      // Check for partial matches or rooftop accuracy
      const result = data.results[0];
      const isRooftop = result.geometry.location_type === 'ROOFTOP';
      const isPartialMatch = result.partial_match;
      if (isPartialMatch) {
        return new Response(JSON.stringify({
          isValid: false,
          message: "Address is a partial match. Please verify all details are correct."
        }), {
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          },
          status: 200
        });
      }
      return new Response(JSON.stringify({
        isValid: true,
        isRooftop
      }), {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        },
        status: 200
      });
    } else if (data.status === 'ZERO_RESULTS') {
      return new Response(JSON.stringify({
        isValid: false,
        message: "Address not found."
      }), {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        },
        status: 200
      });
    } else {
      console.error("Google Geocoding API Error:", data.error_message || data.status);
      throw new Error("Could not verify address at this time.");
    }
  } catch (error) {
    console.error("Verify address function error:", error.message);
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



// ----------------------------
// Function: charge-customer
// ----------------------------

// --- File: index.ts ---

// charge-customer Edge Function (auto-collection fix)
// Change: Do not call invoices.pay on charge_automatically invoices.
// After finalize, poll once to confirm auto-charge and persist payment refs.
export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
};
import { Stripe } from "npm:stripe@15.8.0";
import { createClient } from "npm:@supabase/supabase-js@2";
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const stripe = new Stripe(STRIPE_SECRET_KEY ?? "", {
  apiVersion: "2024-06-20"
});
const supabase = createClient(SUPABASE_URL ?? "", SUPABASE_SERVICE_ROLE_KEY ?? "");
async function sleep(ms) {
  return new Promise((res)=>setTimeout(res, ms));
}
async function handleCharge({ customerId, amount, description, bookingId, feeType }) {
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Amount must be a positive number.");
  const { data: customer, error: customerErr } = await supabase.from("customers").select("stripe_customer_id, email, name").eq("id", customerId).single();
  if (customerErr) throw new Error(`DB error loading customer: ${customerErr.message}`);
  if (!customer) throw new Error(`Customer with ID ${customerId} not found.`);
  let stripeCustomerId = customer.stripe_customer_id;
  try {
    if (!stripeCustomerId) {
      const existing = await stripe.customers.list({
        email: customer.email,
        limit: 1
      });
      if (existing.data.length > 0) stripeCustomerId = existing.data[0].id;
      else stripeCustomerId = (await stripe.customers.create({
        email: customer.email,
        name: customer.name
      })).id;
      const { error: upErr } = await supabase.from("customers").update({
        stripe_customer_id: stripeCustomerId
      }).eq("id", customerId);
      if (upErr) throw new Error(`DB error updating stripe_customer_id: ${upErr.message}`);
    }
  } catch (e) {
    throw new Error(`Stripe customer ensure failed: ${e.message}`);
  }
  let invoiceId;
  try {
    await stripe.invoiceItems.create({
      customer: stripeCustomerId,
      amount: Math.round(amount * 100),
      currency: "usd",
      description
    });
    const invoice = await stripe.invoices.create({
      customer: stripeCustomerId,
      collection_method: "charge_automatically",
      auto_advance: true,
      description: `Additional charges for booking #${bookingId}`,
      metadata: {
        booking_id: String(bookingId),
        database_customer_id: String(customerId),
        fee_type: feeType
      }
    });
    invoiceId = invoice.id;
    const finalized = await stripe.invoices.finalizeInvoice(invoice.id);
    // Wait briefly for auto-charge to complete (usually immediate)
    await sleep(800);
    const refreshed = await stripe.invoices.retrieve(finalized.id);
    // If still open or draft, give one more short wait
    if (refreshed.status === "open" || refreshed.status === "draft") {
      await sleep(800);
    }
    const post = await stripe.invoices.retrieve(finalized.id);
    if (post.status !== "paid") {
      const latestChargeId = typeof post.latest_charge === "string" ? post.latest_charge : post.latest_charge?.id;
      let failureMsg = `Invoice status: ${post.status}`;
      if (latestChargeId) {
        try {
          const ch = await stripe.charges.retrieve(latestChargeId);
          if (ch.failure_message) failureMsg = ch.failure_message;
        } catch (_) {}
      }
      throw new Error(`Failed to auto-charge customer. ${failureMsg}`);
    }
    // Persist refs
    const latestCharge = typeof post.latest_charge === "string" ? post.latest_charge : post.latest_charge?.id;
    const paymentIntentId = typeof post.payment_intent === "string" ? post.payment_intent : post.payment_intent?.id;
    const { data: bookingData, error: bookingErr } = await supabase.from("bookings").select("fees").eq("id", bookingId).single();
    if (bookingErr) throw new Error(`DB error loading booking: ${bookingErr.message}`);
    const existingFees = bookingData?.fees || {};
    const newFees = {
      ...existingFees,
      [feeType]: {
        amount,
        description,
        charge_id: latestCharge ?? null,
        payment_intent_id: paymentIntentId ?? null,
        invoice_id: invoiceId ?? null,
        created_at: new Date().toISOString()
      }
    };
    const { error: updErr } = await supabase.from("bookings").update({
      fees: newFees
    }).eq("id", bookingId);
    if (updErr) throw new Error(`DB error updating booking fees: ${updErr.message}`);
    return {
      success: true,
      message: "Customer charged successfully.",
      invoiceId: invoiceId,
      latestCharge,
      paymentIntentId
    };
  } catch (e) {
    // Best-effort cleanup if needed
    if (invoiceId) {
      try {
        const inv = await stripe.invoices.retrieve(invoiceId);
        if (inv.status !== "paid") await stripe.invoices.voidInvoice(invoiceId);
      } catch (_) {}
    }
    throw e;
  }
}
async function handleRefund({ bookingId, amount, reason, paymentIntentId, chargeId }) {
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Amount must be a positive number.");
  const payload = {
    amount: Math.round(amount * 100),
    reason: "requested_by_customer"
  };
  if (paymentIntentId) payload.payment_intent = paymentIntentId;
  else if (chargeId) payload.charge = chargeId;
  else {
    const { data: bookingData, error: loadErr } = await supabase.from("bookings").select("fees").eq("id", bookingId).single();
    if (loadErr) throw new Error(`DB error loading booking for refund: ${loadErr.message}`);
    const fees = bookingData?.fees ?? {};
    const latest = Object.values(fees).slice(-1)[0];
    const pi = latest?.payment_intent_id;
    const ch = latest?.charge_id;
    if (pi) payload.payment_intent = pi;
    else if (ch) payload.charge = ch;
    else throw new Error("Missing payment reference for refund.");
  }
  const refund = await stripe.refunds.create({
    ...payload,
    metadata: {
      admin_reason: reason,
      booking_id: String(bookingId)
    }
  });
  const refundDetails = {
    refund_id: refund.id,
    amount,
    reason,
    status: refund.status,
    created_at: new Date().toISOString()
  };
  const { error: updErr } = await supabase.from("bookings").update({
    status: "Cancelled",
    refund_details: refundDetails
  }).eq("id", bookingId);
  if (updErr) throw new Error(`DB error updating booking refund: ${updErr.message}`);
  return {
    success: true,
    message: `Refund of $${amount.toFixed(2)} processed successfully.`,
    refund
  };
}
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") return new Response("ok", {
    headers: corsHeaders
  });
  try {
    const body = await req.json().catch(()=>({}));
    const headers = {
      ...corsHeaders,
      "Content-Type": "application/json"
    };
    if (body.action === "refund") {
      const { bookingId, amount, reason, paymentIntentId, chargeId } = body;
      if (!bookingId || !amount || !reason) return new Response(JSON.stringify({
        error: "Missing parameters for refund action."
      }), {
        headers,
        status: 400
      });
      const resp = await handleRefund({
        bookingId,
        amount,
        reason,
        paymentIntentId,
        chargeId
      });
      return new Response(JSON.stringify(resp), {
        headers,
        status: 200
      });
    }
    const { customerId, amount, description, bookingId, feeType } = body;
    if (!customerId || !amount || !description || !bookingId || !feeType) return new Response(JSON.stringify({
      error: "Missing required parameters for charge action."
    }), {
      headers,
      status: 400
    });
    const resp = await handleCharge({
      customerId,
      amount,
      description,
      bookingId,
      feeType
    });
    return new Response(JSON.stringify(resp), {
      headers,
      status: 200
    });
  } catch (error) {
    console.error("Charge/Refund customer error:", error);
    return new Response(JSON.stringify({
      error: error?.message ?? "Unknown error"
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      },
      status: 500
    });
  }
});



// ----------------------------
// Function: get-weather
// ----------------------------

// --- File: cors.ts ---

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};


// --- File: index.ts ---

import { corsHeaders } from "./cors.ts";
import { eachDayOfInterval, parseISO } from "npm:date-fns";
const WEATHER_API_KEY = Deno.env.get("WEATHER_API_KEY");
const LOCATION = "Saratoga Springs,UT";
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }
  if (!WEATHER_API_KEY) {
    return new Response(JSON.stringify({
      forecast: {},
      message: "Weather API key not configured."
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      },
      status: 200
    });
  }
  try {
    const { startDate, endDate } = await req.json();
    if (!startDate || !endDate) {
      throw new Error("Start and end dates are required.");
    }
    const sDate = parseISO(startDate);
    const eDate = parseISO(endDate);
    const days = eachDayOfInterval({
      start: sDate,
      end: eDate
    });
    const numberOfDays = Math.min(days.length, 14); // WeatherAPI free tier max forecast is 14 days
    const url = `http://api.weatherapi.com/v1/forecast.json?key=${WEATHER_API_KEY}&q=${LOCATION}&days=${numberOfDays}&aqi=no&alerts=no`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Weather API request failed with status: ${response.status}`);
    }
    const data = await response.json();
    const forecast = {};
    if (data.forecast && data.forecast.forecastday) {
      data.forecast.forecastday.forEach((day)=>{
        forecast[day.date] = day.day.condition.text;
      });
    }
    return new Response(JSON.stringify({
      forecast
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      },
      status: 200
    });
  } catch (error) {
    console.error("Get weather function error:", error.message);
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



// ----------------------------
// Function: verify-address-and-distance
// ----------------------------

// --- File: cors.ts ---

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};


// --- File: index.ts ---

import { corsHeaders } from "./cors.ts";
const GOOGLE_MAPS_API_KEY = Deno.env.get("GOOGLE_MAPS_API_KEY");
const ORIGIN_ADDRESS = "227 West Casi Way, Saratoga Springs, Utah 84045";
// Separate function for address verification
async function verifyAddress(address) {
  if (!GOOGLE_MAPS_API_KEY) {
    console.error("Google Maps API key is not set.");
    return {
      isValid: false,
      message: "Server configuration error."
    };
  }
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${GOOGLE_MAPS_API_KEY}`;
  const response = await fetch(url);
  const data = await response.json();
  if (data.status === 'OK') {
    const result = data.results[0];
    if (result.partial_match) {
      return {
        isValid: false,
        message: "Address is a partial match. Please verify all details are correct."
      };
    }
    return {
      isValid: true,
      message: "Address verified."
    };
  } else if (data.status === 'ZERO_RESULTS') {
    return {
      isValid: false,
      message: "Address not found."
    };
  } else {
    console.error("Google Geocoding API Error:", data.error_message || data.status);
    return {
      isValid: false,
      message: "Could not verify address at this time."
    };
  }
}
// Separate function for distance calculation
async function calculateDistance(destination) {
  if (!GOOGLE_MAPS_API_KEY) {
    console.error("Google Maps API key is not set for distance calculation.");
    return null;
  }
  const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(ORIGIN_ADDRESS)}&destinations=${encodeURIComponent(destination)}&units=imperial&key=${GOOGLE_MAPS_API_KEY}`;
  const response = await fetch(url);
  const data = await response.json();
  if (data.status === 'OK' && data.rows[0].elements[0].status === 'OK') {
    const element = data.rows[0].elements[0];
    const distanceMiles = element.distance.value / 1609.34; // meters to miles
    const extraMiles = Math.max(0, distanceMiles - 30);
    const fee = extraMiles * 0.80;
    return {
      miles: distanceMiles,
      duration: element.duration.text,
      fee: fee
    };
  } else {
    console.error("Google Distance Matrix API Error:", data.error_message || data.status);
    return null;
  }
}
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }
  try {
    const { address, serviceType } = await req.json();
    if (!address) {
      throw new Error("Address is required.");
    }
    const verificationResult = await verifyAddress(address);
    if (!verificationResult.isValid) {
      return new Response(JSON.stringify(verificationResult), {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        },
        status: 200
      });
    }
    let distanceInfo = null;
    // Only calculate distance for non-trailer rentals
    if (serviceType === 1 || serviceType === 3) {
      distanceInfo = await calculateDistance(address);
    }
    return new Response(JSON.stringify({
      isValid: true,
      message: "Address verified",
      distanceInfo
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      },
      status: 200
    });
  } catch (error) {
    console.error("Verify-address-and-distance function error:", error.message);
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



// ----------------------------
// Function: create-first-admin
// ----------------------------

// --- File: cors.ts ---

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};


// --- File: index.ts ---

import { corsHeaders } from "./cors.ts";
import { createClient } from 'npm:@supabase/supabase-js@2';
const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }
  try {
    // 1. Check if any admin user already exists
    const { data: users, error: userError } = await supabaseAdmin.auth.admin.listUsers({
      page: 1,
      perPage: 1000
    });
    if (userError) throw userError;
    const adminExists = users.users.some((user)=>user.user_metadata?.is_admin === true);
    if (adminExists) {
      return new Response(JSON.stringify({
        error: "An admin user already exists. This function can only be used for initial setup."
      }), {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        },
        status: 403
      });
    }
    // 2. If no admin exists, proceed to create one
    const { email } = await req.json();
    if (!email) {
      throw new Error("Email is required to create an admin user.");
    }
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email: email,
      password: "ChangeMeNow8d",
      email_confirm: true,
      user_metadata: {
        is_admin: true,
        full_name: 'Site Administrator'
      }
    });
    if (error) {
      // Handle case where user might already exist but isn't an admin
      if (error.message.includes('already registered')) {
        return new Response(JSON.stringify({
          error: "This email is already registered. Cannot create a new admin account with it."
        }), {
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          },
          status: 409
        });
      }
      throw error;
    }
    return new Response(JSON.stringify({
      message: "Admin user created successfully.",
      user: data.user
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      },
      status: 200
    });
  } catch (error) {
    console.error("Create first admin error:", error.message);
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



// ----------------------------
// Function: refund-payment
// ----------------------------

// --- File: cors.ts ---

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};


// --- File: index.ts ---

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
      // The refund was processed by Stripe, but the DB update failed.
      // This is a critical state that needs manual attention.
      // We'll still return success to the client but log the error.
      throw new Error(`Stripe refund succeeded, but database update failed: ${updateError.message}`);
    }
    return new Response(JSON.stringify({
      success: true,
      message: `Refund of ${amount.toFixed(2)} processed successfully.`,
      refund
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



// ----------------------------
// Function: handle-booking-account-creation
// ----------------------------

// --- File: cors.ts ---

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};


// --- File: index.ts ---

import { corsHeaders } from "./cors.ts";
import { createClient } from 'npm:@supabase/supabase-js@2';
const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }
  try {
    const { customerId } = await req.json();
    if (!customerId) {
      throw new Error("Customer ID is required.");
    }
    console.log(`[Account Creation] Handling account for customer ID: ${customerId}`);
    const { data: customer, error: fetchError } = await supabaseAdmin.from('customers').select('name, email').eq('id', customerId).single();
    if (fetchError) {
      console.error(`[Account Creation] Error fetching customer ${customerId}:`, fetchError);
      throw fetchError;
    }
    if (!customer) {
      throw new Error(`Customer with ID ${customerId} not found.`);
    }
    console.log(`[Account Creation] Found customer email: ${customer.email}`);
    const tempPassword = `portal-login-${Deno.env.get("SUPABASE_JWT_SECRET")}`;
    const { data: { users }, error: listError } = await supabaseAdmin.auth.admin.listUsers({
      email: customer.email
    });
    if (listError) {
      console.error(`[Account Creation] Error listing users for ${customer.email}:`, listError);
      throw listError;
    }
    if (users && users.length > 0) {
      console.log(`[Account Creation] User ${users[0].id} already exists. Ensuring metadata is correct.`);
      await supabaseAdmin.auth.admin.updateUserById(users[0].id, {
        user_metadata: {
          ...users[0].user_metadata,
          customer_db_id: customerId,
          full_name: customer.name
        }
      });
      console.log(`[Account Creation] Metadata updated for user ${users[0].id}.`);
    } else {
      console.log(`[Account Creation] User does not exist for ${customer.email}. Creating new auth user.`);
      const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email: customer.email,
        password: tempPassword,
        email_confirm: true,
        user_metadata: {
          is_admin: false,
          full_name: customer.name,
          customer_db_id: customerId
        }
      });
      if (createError) {
        console.error(`[Account Creation] Failed to create user for ${customer.email}:`, createError);
        throw createError;
      }
      console.log(`[Account Creation] Successfully created new user with ID: ${newUser.user.id}`);
    }
    return new Response(JSON.stringify({
      success: true,
      message: "Account setup or verification successful."
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      },
      status: 200
    });
  } catch (error) {
    console.error("[Account Creation] Top-level error:", error.message);
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



// ----------------------------
// Function: finalize-booking
// ----------------------------

// --- File: cors.ts ---

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};


// --- File: index.ts ---

import { corsHeaders } from "./cors.ts";
import { createClient } from 'npm:@supabase/supabase-js@2';
const supabase = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }
  try {
    const { bookingId } = await req.json();
    if (!bookingId) {
      throw new Error("Booking ID is required to finalize.");
    }
    // Step 1: Fetch the booking data, it should be in 'awaiting_processing' state
    const { data: booking, error: fetchError } = await supabase.from('bookings').select(`*, customers!inner(*)`).eq('id', bookingId).single();
    if (fetchError || !booking) {
      throw new Error(`Could not fetch booking ${bookingId} for finalization. It may not exist or have been processed already.`);
    }
    if (booking.status !== 'awaiting_processing') {
      // This might happen if the function is called twice. It's safe to just return success.
      console.log(`Booking ${bookingId} is already processed. Current status: ${booking.status}`);
      return new Response(JSON.stringify({
        success: true,
        message: "Booking already finalized."
      }), {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        },
        status: 200
      });
    }
    // Step 2: Determine final booking status based on flags
    let finalStatus = 'Confirmed';
    if (booking.was_verification_skipped) {
      finalStatus = 'pending_verification';
    } else if (booking.addons?.addressVerificationSkipped) {
      finalStatus = 'pending_review';
    }
    // Step 3: Update booking with the final status
    const { data: updatedBooking, error: updateError } = await supabase.from('bookings').update({
      status: finalStatus
    }).eq('id', bookingId).select(`*, customers!inner(*)`).single();
    if (updateError) {
      console.error(`Finalize: Failed to update booking status for ${bookingId}:`, updateError);
      throw updateError;
    }
    // Step 4: Process equipment rental records
    const addons = updatedBooking.addons || {};
    if (addons.equipment && addons.equipment.length > 0) {
      const { data: equipmentList, error: equipmentListError } = await supabase.from('equipment').select('id, name');
      if (equipmentListError) throw equipmentListError;
      const equipmentMap = new Map(equipmentList.map((e)=>[
          e.name.toLowerCase().replace(/ /g, ''),
          e.id
        ]));
      const equipmentToInsert = addons.equipment.map((item)=>{
        const equipmentKey = item.id.toLowerCase().replace(/ /g, '');
        const equipmentId = equipmentMap.get(equipmentKey);
        if (!equipmentId) {
          console.warn(`Finalize: Could not find equipment mapping for addon ID: ${item.id}`);
          return null;
        }
        return {
          booking_id: bookingId,
          equipment_id: equipmentId,
          quantity: item.quantity
        };
      }).filter((item)=>item !== null);
      if (equipmentToInsert.length > 0) {
        const { error: insertError } = await supabase.from('booking_equipment').insert(equipmentToInsert);
        if (insertError) {
          console.error(`Finalize: Failed to insert booking_equipment for booking ${bookingId}`, insertError);
        }
      }
    }
    // Step 5: Send the confirmation email
    let customEmailMessage = null;
    if (finalStatus === 'pending_verification') {
      customEmailMessage = 'Your booking is currently on hold. This is because essential verification information (such as license plate and/or driver’s license photos) was not provided. Our team will manually review your booking. If we cannot complete verification, your booking may be subject to cancellation as per our rental agreement.';
    } else if (finalStatus === 'pending_review') {
      customEmailMessage = 'Your booking is currently on hold for manual review because the provided address could not be automatically verified. Our team will check the details and contact you if there are any issues with servicing your location.';
    }
    console.log("Finalize booking start before send-booking-confirmation", {
      bookingId,
      time: new Date().toISOString()
    });
    await supabase.functions.invoke('send-booking-confirmation', {
      body: {
        booking: updatedBooking,
        customMessage: customEmailMessage
      }
    });
    console.log("Finalize booking start after send-booking-confirmation", {
      bookingId,
      time: new Date().toISOString()
    });
    return new Response(JSON.stringify({
      success: true,
      booking: updatedBooking
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      },
      status: 200
    });
  } catch (error) {
    console.error(`Finalize Booking Error:`, error.message);
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



// ----------------------------
// Function: send-booking-confirmation
// ----------------------------

// --- File: cors.ts ---

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};


// --- File: index.ts ---

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from './cors.ts';
const brevoApiKey = Deno.env.get('BREVO_API_KEY');
const fromEmail = Deno.env.get('BREVO_FROM_EMAIL');
const generateEmailHtml = (name, subject, message, portalInfo)=>`
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; color: #333; line-height: 1.6; }
          .container { max-width: 600px; margin: 20px auto; padding: 20px; border: 1px solid #ddd; border-radius: 8px; background-color: #f9f9f9; }
          .header { font-size: 24px; font-weight: bold; color: #003366; text-align: center; margin-bottom: 20px; }
          .footer { font-size: 12px; color: #777; margin-top: 20px; text-align: center; }
          .portal-note { background-color: #eef7ff; border: 1px solid #b3d7ff; padding: 15px; border-radius: 5px; margin-top: 20px; }
          .custom-message { background-color: #fffbe6; border: 1px solid #ffe58f; padding: 15px; border-radius: 5px; margin-top: 20px; color: #8a6d3b; }
          strong { color: #003366; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">${subject}</div>
          <p>Hello ${name},</p>
          <div class="custom-message">${message}</div>
          ${portalInfo}
          <p>We look forward to serving you!</p>
          <p>Sincerely,<br>The U-Fill Dumpsters Team</p>
          <div class="footer">
            U-Fill Dumpsters LLC | Saratoga Springs, UT | (801) 810-8832
          </div>
        </div>
      </body>
      </html>
    `;
Deno.serve(async (req)=>{
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
  }
  try {
    const { bookingId } = await req.json();
    if (!bookingId) throw new Error('Booking ID is required.');
    if (!brevoApiKey || !fromEmail) throw new Error('Missing environment variables.');
    const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
    const { data: booking, error: bookingError } = await supabaseAdmin.from('bookings').select(`*, customers(*)`).eq('id', bookingId).single();
    if (bookingError || !booking) throw new Error(bookingError?.message || 'Booking not found.');
    const { email, name, customer_id_text, phone } = booking.customers;
    const rawPhone = phone ? phone.replace(/\D/g, '') : '';
    const serviceName = booking.plan?.name + (booking.addons?.isDelivery ? ' with Delivery' : '');
    const isPending = booking.status === 'pending_review' || booking.status === 'pending_verification';
    let subject, message, portalInfo, attachment = [];
    // Only try to generate and attach the receipt for confirmed bookings
    if (!isPending) {
      const { data: receiptData, error: receiptError } = await supabaseAdmin.functions.invoke('get-receipt-pdf', {
        body: {
          bookingId: booking.id
        }
      });
      if (receiptError || !receiptData.pdf) {
        console.error('Failed to generate PDF receipt for attachment:', receiptError?.message || receiptData?.error || 'PDF data missing.');
      } else {
        attachment.push({
          name: `U-Fill-Receipt-${booking.id}.pdf`,
          content: receiptData.pdf
        });
      }
    }
    const customerPortalLink = `https://www.u-filldumpsters.com/login?cid=${encodeURIComponent(customer_id_text)}&phone=${encodeURIComponent(rawPhone)}`;
    if (isPending) {
      subject = `Action Required: Your Booking for ${serviceName} is On Hold`;
      message = `Thank you for your rental request for the <strong>${serviceName}</strong>. Your booking (#${booking.id}) is currently on hold and requires manual review by our team. This is a standard procedure for certain bookings to ensure accuracy and availability. We will process it shortly.`;
      portalInfo = `
            <div class="portal-note">
              <strong>Please check your Customer Portal for updates.</strong><br>
              You can view the status of your booking and any required actions by logging into the <a href="${customerPortalLink}">Customer Portal</a>.
              <br><br>
              <strong>Login with:</strong><br>
              Customer ID: <strong>${customer_id_text}</strong><br>
              Phone Number: <strong>${phone}</strong>
            </div>
          `;
    } else {
      subject = `Booking Confirmed: Your ${serviceName}`;
      message = `Thank you for your booking with U-Fill Dumpsters! Your <strong>${serviceName}</strong> service (Booking #${booking.id}) is confirmed. A detailed receipt has been attached to this email. If you cannot view the attachment, you can log in to your Customer Portal to download it at any time.`;
      portalInfo = `
            <div class="portal-note">
              <strong>Access Your Customer Portal:</strong><br>
              To view your booking details, add notes, or manage your rental, please visit our <a href="${customerPortalLink}">Customer Portal</a>.
              <br><br>
              <strong>Login with:</strong><br>
              Customer ID: <strong>${customer_id_text}</strong><br>
              Phone Number (as password): <strong>${phone}</strong>
            </div>
          `;
    }
    const emailHtml = generateEmailHtml(name, subject, message, portalInfo);
    const emailPayload = {
      sender: {
        email: fromEmail,
        name: 'U-Fill Dumpsters'
      },
      to: [
        {
          email,
          name
        }
      ],
      subject,
      htmlContent: emailHtml,
      attachment
    };
    const brevoResponse = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': brevoApiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(emailPayload)
    });
    if (!brevoResponse.ok) {
      const errorBody = await brevoResponse.json();
      throw new Error(`Brevo API Error: ${brevoResponse.status} ${errorBody.message}`);
    }
    return new Response(JSON.stringify({
      message: "Confirmation email sent successfully."
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error("Send Confirmation Email Error:", error);
    return new Response(JSON.stringify({
      error: error.message
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
});



// ----------------------------
// Function: get-distance-and-calculate-fee
// ----------------------------

// --- File: cors.ts ---

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};


// --- File: index.ts ---

import { corsHeaders } from "./cors.ts";
const GOOGLE_MAPS_API_KEY = Deno.env.get("GOOGLE_MAPS_API_KEY");
const BUSINESS_ADDRESS = "227 W Casi Way, Saratoga Springs, UT 84045";
const DELIVERY_BASE_FEE = 30;
const PER_MILE_RATE = 0.85;
Deno.serve(async (req)=>{
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
  }
  try {
    const { address } = await req.json();
    if (!address) {
      throw new Error("Address is required.");
    }
    const mapsUrl = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(BUSINESS_ADDRESS)}&destinations=${encodeURIComponent(address)}&units=imperial&key=${GOOGLE_MAPS_API_KEY}`;
    const mapsResponse = await fetch(mapsUrl);
    if (!mapsResponse.ok) {
      const errorText = await mapsResponse.text();
      console.error("Google Maps API Error:", errorText);
      throw new Error(`Google Maps API request failed with status: ${mapsResponse.status}.`);
    }
    const mapsData = await mapsResponse.json();
    if (mapsData.status !== 'OK' || !mapsData.rows[0].elements[0]) {
      console.error("Google Maps API returned non-OK status:", mapsData);
      throw new Error(`Could not calculate distance. Status: ${mapsData.status}.`);
    }
    const element = mapsData.rows[0].elements[0];
    if (element.status !== 'OK') {
      if (element.status === 'NOT_FOUND') {
        return new Response(JSON.stringify({
          error: "We couldn't find a route to that address. Please double-check for typos or try a different format."
        }), {
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          },
          status: 400
        });
      }
      console.error("Google Maps Matrix Element Error:", element);
      throw new Error(`Could not find a route to the address. Status: ${element.status}.`);
    }
    const distanceInMeters = element.distance.value;
    const miles = distanceInMeters / 1609.34;
    const roundTripMiles = miles * 2;
    const mileageFee = roundTripMiles * PER_MILE_RATE;
    const totalFee = DELIVERY_BASE_FEE + mileageFee;
    return new Response(JSON.stringify({
      miles: miles,
      roundTripMiles: roundTripMiles,
      mileageFee: mileageFee,
      deliveryFee: DELIVERY_BASE_FEE,
      totalFee: totalFee
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      },
      status: 200
    });
  } catch (error) {
    console.error("Error in get-distance-and-calculate-fee function:", error.message);
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



// ----------------------------
// Function: get-distance-fee
// ----------------------------

// --- File: cors.ts ---

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};


// --- File: index.ts ---

import { corsHeaders } from "./cors.ts";
const businessAddress = "227 W Casi Way, Saratoga Springs, UT 84045";
const perMileRate = 0.85;
const baseFee = 30;
Deno.serve(async (req)=>{
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
  }
  try {
    const { destinationAddress } = await req.json();
    if (!destinationAddress) {
      throw new Error("Destination address is required.");
    }
    const googleMapsApiKey = Deno.env.get("GOOGLE_MAPS_API_KEY");
    if (!googleMapsApiKey) {
      throw new Error("Google Maps API key is not configured.");
    }
    const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(businessAddress)}&destinations=${encodeURIComponent(destinationAddress)}&units=imperial&key=${googleMapsApiKey}`;
    const response = await fetch(url);
    const data = await response.json();
    if (data.status !== "OK" || !data.rows[0].elements[0]) {
      console.error("Google Maps API Error:", data);
      let errorMessage = "Could not calculate distance. Please check the address.";
      if (data.error_message) {
        errorMessage += ` Details: ${data.error_message}`;
      }
      throw new Error(errorMessage);
    }
    const element = data.rows[0].elements[0];
    if (element.status !== "OK") {
      if (element.status === "NOT_FOUND") {
        throw new Error("The delivery address could not be found. Please check and try again.");
      }
      if (element.status === "ZERO_RESULTS") {
        throw new Error("Could not calculate a driving route to the delivery address. It may be unreachable.");
      }
      throw new Error(`Could not calculate distance. Status: ${element.status}`);
    }
    const distanceInMeters = element.distance.value;
    const distanceInMiles = distanceInMeters / 1609.34;
    const roundTripMiles = distanceInMiles * 2;
    const mileageFee = roundTripMiles * perMileRate;
    const totalFee = baseFee + mileageFee;
    return new Response(JSON.stringify({
      miles: distanceInMiles,
      roundTripMiles: roundTripMiles,
      deliveryFee: totalFee,
      baseFee: baseFee,
      mileageFee: mileageFee,
      success: true
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  } catch (error) {
    console.error('Error in get-distance-fee function:', error);
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



// ----------------------------
// Function: get-availability
// ----------------------------

// --- File: cors.ts ---

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};


// --- File: index.ts ---

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from './cors.ts';
import { addDays, format, parseISO, isBefore, parse, set, addMinutes, isSameDay, startOfDay, endOfDay } from 'https://esm.sh/date-fns@2';
const generateSlotsFromRange = (startTime, endTime, intervalMinutes, currentDate, now)=>{
  if (!startTime || !endTime) return [];
  let start = parse(startTime, 'HH:mm:ss', currentDate);
  const end = parse(endTime, 'HH:mm:ss', currentDate);
  if (isSameDay(currentDate, now)) {
    const twoHoursFromNow = addMinutes(now, 120);
    if (isBefore(start, twoHoursFromNow)) {
      start = twoHoursFromNow;
    }
  }
  const minutes = start.getMinutes();
  const roundedMinutes = Math.ceil(minutes / intervalMinutes) * intervalMinutes;
  let currentTime = set(start, {
    minutes: roundedMinutes,
    seconds: 0,
    milliseconds: 0
  });
  const slots = [];
  while(isBefore(currentTime, end)){
    const slotEnd = addMinutes(currentTime, intervalMinutes);
    if (isBefore(slotEnd, addMinutes(end, 1))) {
      const isWindow = intervalMinutes >= 120;
      const label = isWindow ? `${format(currentTime, 'h:mm a')} - ${format(slotEnd, 'h:mm a')}` : `${format(currentTime, 'h:mm a')}`;
      slots.push({
        value: format(currentTime, 'HH:mm:ss'),
        label: label
      });
    }
    currentTime = addMinutes(currentTime, intervalMinutes);
  }
  return slots;
};
Deno.serve(async (req)=>{
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
  }
  try {
    const { serviceId, startDate, endDate, isDelivery } = await req.json();
    if (!serviceId || !startDate || !endDate) {
      throw new Error("An unexpected error occurred: Service ID, start date, and end date are required.");
    }
    const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
    const start = parseISO(startDate);
    const end = parseISO(endDate);
    const dateRange = [];
    for(let d = start; d <= end; d = addDays(d, 1)){
      dateRange.push(format(d, 'yyyy-MM-dd'));
    }
    const serviceIdForAvail = isDelivery && Number(serviceId) === 2 ? 4 : Number(serviceId);
    const [{ data: weeklyRules, error: weeklyError }, { data: dateSpecificRules, error: specificError }, { data: bookings, error: bookingsError }, { data: inventoryRules, error: inventoryRulesError }] = await Promise.all([
      supabaseAdmin.from('service_availability').select('*').eq('service_id', serviceIdForAvail),
      supabaseAdmin.from('date_specific_availability').select('*').eq('service_id', serviceIdForAvail).in('date', dateRange),
      supabaseAdmin.from('bookings').select('plan, drop_off_date, pickup_date, addons').lte('drop_off_date', endDate).gte('pickup_date', startDate).in('status', [
        'Confirmed',
        'Rescheduled',
        'Delivered',
        'waiting_to_be_returned',
        'pending_review'
      ]),
      supabaseAdmin.from('inventory_rules').select('service_id, inventory_item_id, quantity_required, inventory_items(id, total_quantity)')
    ]);
    if (weeklyError) throw weeklyError;
    if (specificError) throw specificError;
    if (bookingsError) throw bookingsError;
    if (inventoryRulesError) throw inventoryRulesError;
    const weeklyRulesMap = new Map(weeklyRules.map((r)=>[
        r.day_of_week,
        r
      ]));
    const specificRulesMap = new Map(dateSpecificRules.map((r)=>[
        r.date,
        r
      ]));
    const availability = {};
    const now = new Date();
    for (const dateStr of dateRange){
      const date = startOfDay(parseISO(dateStr));
      const dayOfWeek = date.getDay();
      let rule = specificRulesMap.get(dateStr) || weeklyRulesMap.get(dayOfWeek);
      let isAvailable = rule ? rule.is_available !== false : false;
      if (isAvailable) {
        const requiredItems = inventoryRules.filter((r)=>r.service_id === serviceIdForAvail);
        for (const requiredItem of requiredItems){
          const item = requiredItem.inventory_items;
          if (!item) continue;
          const bookingsUsingItem = bookings.filter((b)=>{
            const bookingStart = startOfDay(parseISO(b.drop_off_date));
            const bookingEnd = endOfDay(parseISO(b.pickup_date));
            const bookingServiceId = b.addons?.isDelivery && b.plan.id === 2 ? 4 : b.plan.id;
            const bookingRequiresItem = inventoryRules.some((ir)=>ir.service_id === bookingServiceId && ir.inventory_item_id === item.id);
            return bookingRequiresItem && date >= bookingStart && date <= bookingEnd;
          });
          const quantityUsed = bookingsUsingItem.reduce((acc, curr)=>{
            const bookingServiceId = curr.addons?.isDelivery && curr.plan.id === 2 ? 4 : curr.plan.id;
            const ruleForItem = inventoryRules.find((ir)=>ir.service_id === bookingServiceId && ir.inventory_item_id === item.id);
            return acc + (ruleForItem ? ruleForItem.quantity_required : 0);
          }, 0);
          if (quantityUsed + requiredItem.quantity_required > item.total_quantity) {
            isAvailable = false;
            break;
          }
        }
      }
      const intervalMap = {
        1: 120,
        2: 60,
        3: 60,
        4: 120
      };
      const interval = intervalMap[serviceIdForAvail] || 120;
      const deliverySlots = rule ? generateSlotsFromRange(rule.delivery_start_time, rule.delivery_end_time, interval, date, now) : [];
      const pickupSlots = rule ? generateSlotsFromRange(rule.pickup_start_time, rule.pickup_end_time, interval, date, now) : [];
      const returnSlots = rule ? generateSlotsFromRange(rule.return_start_time, rule.return_end_time, 60, date, now) : [];
      const hourlySlots = rule ? generateSlotsFromRange(rule.hourly_start_time, rule.hourly_end_time, 60, date, now) : [];
      availability[dateStr] = {
        available: isAvailable,
        deliverySlots,
        pickupSlots,
        returnSlots,
        hourlySlots
      };
    }
    return new Response(JSON.stringify({
      availability
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 200
    });
  } catch (error) {
    console.error('Get Availability Error:', error.message, error.stack);
    return new Response(JSON.stringify({
      error: error.message
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 500
    });
  }
});



// ----------------------------
// Function: request-booking-change
// ----------------------------

// --- File: cors.ts ---

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
};


// --- File: index.ts ---

import { corsHeaders } from "./cors.ts";
import { createClient } from 'npm:@supabase/supabase-js@2';
const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }
  try {
    // ✅ Verify the caller is logged in
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({
        error: "Missing Authorization header"
      }), {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        },
        status: 401
      });
    }
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError || !user) {
      return new Response(JSON.stringify({
        error: "Unauthorized"
      }), {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        },
        status: 401
      });
    }
    const { bookingId, reason } = await req.json();
    if (!bookingId || !reason) throw new Error("Booking ID and reason are required.");
    console.log(`[Request Booking Change] User ${user.id} requesting change for booking ${bookingId}`);
    // Fetch booking with customer info
    const { data: booking, error: bookingError } = await supabaseAdmin.from("bookings").select("*, customers(*)").eq("id", bookingId).single();
    if (bookingError || !booking) throw new Error("Booking not found.");
    // ✅ Optional: verify that this user owns the booking
    // if (booking.customer_id !== user.id) {
    //   return new Response(JSON.stringify({
    //     error: "You do not own this booking."
    //   }), {
    //     headers: {
    //       ...corsHeaders,
    //       "Content-Type": "application/json"
    //     },
    //     status: 403
    //   });
    // }
    // Update booking status
    const { error: updateError } = await supabaseAdmin.from("bookings").update({
      status: "pending_review",
      notes: reason
    }).eq("id", bookingId);
    if (updateError) throw new Error(`Failed to update booking: ${updateError.message}`);
    // Insert customer note
    const { error: noteError } = await supabaseAdmin.from("customer_notes").insert({
      customer_id: booking.customer_id,
      booking_id: bookingId,
      source: "Customer Portal - Cancellation Request",
      content: `Customer requested cancellation/rescheduling. Reason: ${reason}`,
      author_type: "customer"
    });
    if (noteError) console.error(`Failed to add customer note: ${noteError.message}`);
    console.log(`[Request Booking Change] Successfully processed request for booking ${bookingId}`);
    return new Response(JSON.stringify({
      success: true,
      message: "Your cancellation/rescheduling request has been submitted for review."
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      },
      status: 200
    });
  } catch (error) {
    console.error("[Request Booking Change] Error:", error.message);
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



// ----------------------------
// Function: validate-coupon
// ----------------------------

// --- File: cors.ts ---

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};


// --- File: index.ts ---

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from './cors.ts';
Deno.serve(async (req)=>{
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
  }
  try {
    const { couponCode, serviceId } = await req.json();
    if (!couponCode || !serviceId) {
      throw new Error("Coupon code and service ID are required.");
    }
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error("Missing authorization header");
    }
    const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
      global: {
        headers: {
          Authorization: authHeader
        }
      }
    });
    const { data, error } = await supabase.rpc('validate_coupon', {
      coupon_code: couponCode,
      service_id_arg: serviceId
    });
    if (error) {
      throw error;
    }
    return new Response(JSON.stringify(data), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 200
    });
  } catch (error) {
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



// ----------------------------
// Function: stripe-webhook
// ----------------------------

// --- File: cors.ts ---

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};


// --- File: index.ts ---

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



// ----------------------------
// Function: customer-portal-login
// ----------------------------

// --- File: cors.ts ---

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};


// --- File: index.ts ---

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from './cors.ts';
const DOMAIN = 'ufilldumpsters.com';
// You can set SUPABASE_PASSWORD_SUFFIX in secrets to enforce complexity, e.g., "Aa!"
// If blank, password will be just the 10-digit phone number.
const ENV_PASSWORD_SUFFIX = (Deno.env.get('SUPABASE_PASSWORD_SUFFIX') ?? '').trim();
function buildPasswordFromPhone(cleanedPhone) {
  // If you want exactly the phone (no suffix), set SUPABASE_PASSWORD_SUFFIX to empty.
  // If policy requires stronger passwords, set SUPABASE_PASSWORD_SUFFIX to something like "Aa!".
  return `${cleanedPhone}${ENV_PASSWORD_SUFFIX}`;
}
Deno.serve(async (req)=>{
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
  }
  try {
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({
        error: 'Method not allowed'
      }), {
        status: 405,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    const body = await req.json().catch(()=>({}));
    const customerIdRaw = String(body.customerId ?? '').trim();
    const phoneRaw = String(body.phone ?? '').trim();
    if (!customerIdRaw || !phoneRaw) {
      return new Response(JSON.stringify({
        error: 'Customer ID and phone number are required.'
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    const cleanedPhone = phoneRaw.replace(/\D/g, '');
    if (cleanedPhone.length !== 10) {
      return new Response(JSON.stringify({
        error: 'Invalid phone number format.'
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
    const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
      console.error('Missing required environment variables.');
      return new Response(JSON.stringify({
        error: 'Server misconfiguration.'
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    // 1) Fetch customer by customer_id_text
    const { data: customer, error: customerError } = await supabaseAdmin.from('customers').select('id, name, email, user_id, customer_id_text, phone').eq('customer_id_text', customerIdRaw).single();
    if (customerError || !customer) {
      return new Response(JSON.stringify({
        error: 'Invalid credentials. Customer not found.'
      }), {
        status: 401,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // 2) Validate phone
    const customerPhoneInDb = String(customer.phone ?? '').replace(/\D/g, '');
    if (customerPhoneInDb !== cleanedPhone) {
      return new Response(JSON.stringify({
        error: 'Invalid credentials. Phone number does not match.'
      }), {
        status: 401,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // 3) Build normalized auth email and password
    const authEmail = `${String(customer.customer_id_text).trim()}@${DOMAIN}`.toLowerCase();
    const password = buildPasswordFromPhone(cleanedPhone);
    // 4) Ensure Auth user exists and is updated
    let authUserId = null;
    // Find exact user by email
    const { data: userList, error: listErr } = await supabaseAdmin.auth.admin.listUsers({
      email: authEmail
    });
    if (listErr) {
      return new Response(JSON.stringify({
        error: `Error checking existing user: ${listErr.message}`
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    const exact = userList?.users?.find((u)=>(u.email ?? '').toLowerCase() === authEmail) ?? null;
    if (exact) {
      authUserId = exact.id;
      // Update password and metadata. Confirm email to allow password sign-in if required.
      const { error: updErr } = await supabaseAdmin.auth.admin.updateUserById(authUserId, {
        password,
        email_confirm: true,
        user_metadata: {
          name: customer.name,
          customer_db_id: customer.id,
          original_email: customer.email
        }
      });
      if (updErr) {
        return new Response(JSON.stringify({
          error: `Failed to update auth user: ${updErr.message}`
        }), {
          status: 500,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
      }
    } else {
      // Create user
      const { data: created, error: crtErr } = await supabaseAdmin.auth.admin.createUser({
        email: authEmail,
        password,
        email_confirm: true,
        user_metadata: {
          name: customer.name,
          customer_db_id: customer.id,
          original_email: customer.email
        }
      });
      if (crtErr || !created?.user) {
        return new Response(JSON.stringify({
          error: `Failed to create auth user: ${crtErr?.message}`
        }), {
          status: 500,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
      }
      authUserId = created.user.id;
    }
    // 5) Link user_id on customers if needed
    if (authUserId && customer.user_id !== authUserId) {
      const { error: linkErr } = await supabaseAdmin.from('customers').update({
        user_id: authUserId
      }).eq('id', customer.id);
      if (linkErr) {
        console.error('Warning: failed to link user to customer', linkErr.message);
      }
    }
    // 6) Re-read exact user to ensure email is correct before sign-in
    const { data: verifyList, error: verifyErr } = await supabaseAdmin.auth.admin.listUsers({
      email: authEmail
    });
    if (verifyErr || !verifyList?.users?.some((u)=>(u.email ?? '').toLowerCase() === authEmail)) {
      return new Response(JSON.stringify({
        error: 'User not found after update/create.'
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // 7) Sign in with anon client
    const supabaseAnon = createClient(SUPABASE_URL, ANON_KEY);
    const { data: signInData, error: signInError } = await supabaseAnon.auth.signInWithPassword({
      email: authEmail,
      password
    });
    if (signInError) {
      // Helpful hints to debug quickly
      const hints = [
        'Ensure SUPABASE_PASSWORD_SUFFIX matches what you intend (empty if you want pure 10-digit phone).',
        'Check Auth > Settings > Password policy; if numeric-only is disallowed, use a suffix.',
        'Check Auth > Settings > Email: if email confirmation is required for password sign-in, keep email_confirm: true.',
        'Confirm the computed email exactly equals customer_id_text@ufilldumpsters.com (lowercase, no spaces).'
      ];
      return new Response(JSON.stringify({
        error: `Failed to sign in user: ${signInError.message}`,
        hints
      }), {
        status: 401,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    return new Response(JSON.stringify({
      message: 'Signed in successfully',
      session: signInData.session,
      user: signInData.user
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (e) {
    console.error('Customer Portal Login Function Error:', e);
    return new Response(JSON.stringify({
      error: e?.message ?? 'Unexpected error'
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
});



// ----------------------------
// Function: reschedule-booking
// ----------------------------

// --- File: cors.ts ---

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};


// --- File: index.ts ---

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from './cors.ts';
import { differenceInCalendarDays } from 'https://esm.sh/date-fns@2.30.0';
// Helper to calculate price based on service and duration
const calculatePrice = (plan, startDate, endDate, isDelivery)=>{
  const dailyRate = plan.daily_rate || 100; // Default daily rate
  const weeklyRate = plan.weekly_rate || 500; // Default weekly rate
  let duration = differenceInCalendarDays(new Date(endDate), new Date(startDate));
  if (duration < 1) duration = 1;
  let total = 0;
  if (plan.id === 2 && !isDelivery) {
    const weeks = Math.floor(duration / 7);
    const days = duration % 7;
    total = weeks * weeklyRate + days * dailyRate;
  } else {
    total = plan.base_price || 0;
    if (duration > 7) {
      const extraDays = duration - 7;
      total += extraDays * 20; // $20 for each extra day
    }
  }
  return total;
};
Deno.serve(async (req)=>{
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
  }
  try {
    const { bookingId, newDropOffDate, newPickupDate, newDropOffTime, newPickupTime, priceDifference, rescheduleFee, newTotalPrice } = await req.json();
    if (!bookingId || !newDropOffDate || !newPickupDate || !newDropOffTime || !newPickupTime) {
      throw new Error("Missing required date/time fields.");
    }
    if (priceDifference === undefined || rescheduleFee === undefined || newTotalPrice === undefined) {
      throw new Error("Missing required pricing fields.");
    }
    const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
    // 1. Fetch the original booking
    const { data: booking, error: bookingError } = await supabaseAdmin.from('bookings').select('*, customers(id, name)').eq('id', bookingId).single();
    if (bookingError) throw bookingError;
    if (!booking) throw new Error("Booking not found.");
    // 2. Prepare reschedule history
    const newHistoryEntry = {
      rescheduled_at: new Date().toISOString(),
      from_drop_off_date: booking.drop_off_date,
      from_pickup_date: booking.pickup_date,
      from_drop_off_time: booking.drop_off_time_slot,
      from_pickup_time: booking.pickup_time_slot,
      to_drop_off_date: newDropOffDate,
      to_pickup_date: newPickupDate,
      to_drop_off_time: newDropOffTime,
      to_pickup_time: newPickupTime,
      price_difference: priceDifference,
      reschedule_fee: rescheduleFee,
      original_total_price: booking.total_price,
      new_total_price: newTotalPrice
    };
    const existingHistory = booking.reschedule_history || [];
    const updatedHistory = [
      ...existingHistory,
      newHistoryEntry
    ];
    // 3. Update the booking with new dates, times, status, and history
    // The status is set to 'pending_review' for admin approval
    const { data: updatedBooking, error: updateError } = await supabaseAdmin.from('bookings').update({
      drop_off_date: newDropOffDate,
      pickup_date: newPickupDate,
      drop_off_time_slot: newDropOffTime,
      pickup_time_slot: newPickupTime,
      status: 'pending_review',
      reschedule_history: updatedHistory
    }).eq('id', bookingId).select().single();
    if (updateError) throw updateError;
    // 4. Create a detailed note for the admin
    let noteContent = `Customer requested to reschedule booking #${bookingId}. This requires your approval.\n\n`;
    noteContent += `Original Dates: ${booking.drop_off_date} -> ${booking.pickup_date}\n`;
    noteContent += `New Dates: ${newDropOffDate} -> ${newPickupDate}\n\n`;
    noteContent += `Original Price: $${booking.total_price.toFixed(2)}\n`;
    noteContent += `New Calculated Price: $${(newTotalPrice - rescheduleFee).toFixed(2)}\n`;
    noteContent += `Reschedule Fee (10%): $${rescheduleFee.toFixed(2)}\n`;
    noteContent += `Price Difference: $${priceDifference.toFixed(2)}\n`;
    noteContent += `New Grand Total: $${newTotalPrice.toFixed(2)}\n\n`;
    noteContent += `ACTION REQUIRED: Please review this change. If approved, you must manually charge the customer $${priceDifference.toFixed(2)} and update the booking's total price to $${newTotalPrice.toFixed(2)}.`;
    const { error: noteError } = await supabaseAdmin.from('customer_notes').insert({
      customer_id: booking.customers.id,
      booking_id: booking.id,
      source: 'Change Request',
      content: noteContent,
      author_type: 'customer',
      is_read: false
    });
    if (noteError) {
      console.error('Failed to create reschedule note:', noteError);
    }
    return new Response(JSON.stringify({
      success: true,
      booking: updatedBooking
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 200
    });
  } catch (error) {
    console.error('Error in reschedule-booking function:', error);
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



// ----------------------------
// Function: send-customer-id
// ----------------------------

// --- File: cors.ts ---

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};


// --- File: index.ts ---

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from './cors.ts';
const brevoApiKey = Deno.env.get('BREVO_API_KEY');
const fromEmail = Deno.env.get('BREVO_FROM_EMAIL');
const siteUrl = 'https://www.u-filldumpsters.com';
Deno.serve(async (req)=>{
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
  }
  try {
    const { email } = await req.json();
    if (!email) {
      throw new Error('Email address is required.');
    }
    const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
    const { data: customer, error: customerError } = await supabaseAdmin.from('customers').select('name, email, phone, customer_id_text').eq('email', email).single();
    if (customerError || !customer) {
      return new Response(JSON.stringify({
        message: "Request processed."
      }), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        },
        status: 200
      });
    }
    await supabaseAdmin.functions.invoke('customer-portal-login', {
      body: {
        customerId: customer.customer_id_text,
        phone: customer.phone
      }
    });
    const rawPhone = customer.phone.replace(/\D/g, '');
    const loginUrl = `${siteUrl}/login?cid=${encodeURIComponent(customer.customer_id_text)}&phone=${encodeURIComponent(rawPhone)}`;
    const emailHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: sans-serif; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 5px; }
          .header { font-size: 24px; font-weight: bold; color: #003366; }
          .credentials { background-color: #f0f8ff; border: 1px solid #cce5ff; padding: 15px; border-radius: 5px; margin-top: 20px; font-family: monospace; }
          .button { display: inline-block; padding: 12px 24px; margin-top: 20px; background-color: #f59e0b; color: #000 !important; text-decoration: none; border-radius: 5px; font-weight: bold; }
          .footer { font-size: 12px; color: #777; margin-top: 20px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">Your Customer Portal Login Details</div>
          <p>Hello ${customer.name},</p>
          <p>As requested, here are your login credentials for the U-Fill Dumpsters customer portal. You will use your Customer ID as the username and your 10-digit phone number as the password.</p>
          
          <div class="credentials">
            <strong>Customer ID:</strong> ${customer.customer_id_text}<br>
            <strong>Phone Number (Password):</strong> ${customer.phone}
          </div>
          
          <p>Click the button below to go to the login page with your details pre-filled. You will just need to click the "Login" button.</p>
          <a href="${loginUrl}" class="button">Go to Customer Portal</a>
          
          <div class="footer">
            U-Fill Dumpsters LLC | Saratoga Springs, UT | (801) 810-8832
          </div>
        </div>
      </body>
      </html>
    `;
    const emailPayload = {
      sender: {
        email: fromEmail,
        name: 'U-Fill Dumpsters'
      },
      to: [
        {
          email: customer.email,
          name: customer.name
        }
      ],
      subject: 'Your U-Fill Dumpsters Login Information',
      htmlContent: emailHtml
    };
    const brevoResponse = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': brevoApiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(emailPayload)
    });
    if (!brevoResponse.ok) {
      const errorBody = await brevoResponse.json();
      throw new Error(`Brevo API Error: ${errorBody.message}`);
    }
    return new Response(JSON.stringify({
      message: "Request processed."
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 200
    });
  } catch (error) {
    console.error('Send Customer ID Error:', error);
    return new Response(JSON.stringify({
      error: error.message
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
});



// ----------------------------
// Function: send-admin-message
// ----------------------------

// --- File: cors.ts ---

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};


// --- File: index.ts ---

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from './cors.ts';
Deno.serve(async (req)=>{
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
  }
  try {
    const { customer_id, content, attachment_url, attachment_name } = await req.json();
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('Missing authorization header');
    }
    const supabaseUserClient = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
      global: {
        headers: {
          Authorization: authHeader
        }
      }
    });
    const { data: { user }, error: userError } = await supabaseUserClient.auth.getUser();
    if (userError) throw userError;
    if (!user) throw new Error("User not authenticated");
    const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
    const { data: newNote, error: insertError } = await supabaseAdmin.from('customer_notes').insert({
      customer_id,
      content,
      source: 'Admin Message',
      author_type: 'admin',
      author_id: user.id,
      is_read: true,
      attachment_url,
      attachment_name
    }).select().single();
    if (insertError) {
      throw insertError;
    }
    // This update will trigger the customer portal subscription
    await supabaseAdmin.from('customers').update({
      has_unread_notes: true
    }).eq('id', customer_id);
    return new Response(JSON.stringify(newNote), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 200
    });
  } catch (error) {
    return new Response(JSON.stringify({
      error: error.message
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 500
    });
  }
});



// ----------------------------
// Function: get-receipt-pdf
// ----------------------------

// --- File: cors.ts ---

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};


// --- File: index.ts ---

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from './cors.ts';
import { format } from 'https://deno.land/std@0.208.0/datetime/mod.ts';
const generateHTMLReceipt = (booking)=>{
  const formatDate = (dateStr)=>dateStr ? format(new Date(dateStr), 'MM/dd/yyyy') : 'N/A';
  const formatCurrency = (amount)=>amount != null ? `$${Number(amount).toFixed(2)}` : '$0.00';
  const serviceName = booking.plan?.name + (booking.addons?.isDelivery ? ' with Delivery' : '');
  const dropOffDate = formatDate(booking.drop_off_date);
  const pickupDate = formatDate(booking.pickup_date);
  let subtotal = booking.plan?.price || 0;
  const fees = [];
  if (booking.addons?.deliveryFee) {
    subtotal += booking.addons.deliveryFee;
    fees.push({
      name: 'Delivery Fee',
      amount: booking.addons.deliveryFee
    });
  }
  if (booking.addons?.fuelSurcharge) {
    subtotal += booking.addons.fuelSurcharge;
    fees.push({
      name: 'Fuel Surcharge',
      amount: booking.addons.fuelSurcharge
    });
  }
  if (booking.addons?.protectionPlan) {
    subtotal += booking.addons.protectionPlan;
    fees.push({
      name: 'Damage Protection',
      amount: booking.addons.protectionPlan
    });
  }
  // Assuming 6% tax. It's better to calculate this based on the final price if possible.
  const tax = booking.total_price / 1.06 * 0.06;
  const basePrice = booking.total_price - tax;
  const subtotalWithoutCoupon = basePrice - fees.reduce((acc, fee)=>acc + fee.amount, 0);
  const coupon = booking.addons?.coupon;
  let discountLine = '';
  if (coupon && coupon.isValid) {
    let discountAmount = 0;
    if (coupon.discountType === 'fixed') {
      discountAmount = coupon.discountValue;
    } else if (coupon.discountType === 'percentage') {
      // This is a rough calculation, depends on what the percentage is applied to
      discountAmount = booking.plan.price * (coupon.discountValue / 100);
    }
    discountLine = `
          <tr class="item">
            <td>Coupon (${coupon.code})</td>
            <td class="text-right">-${formatCurrency(discountAmount)}</td>
          </tr>
        `;
  }
  return `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>Receipt #${booking.id}</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; color: #333; }
            .invoice-box { max-width: 800px; margin: auto; padding: 30px; border: 1px solid #eee; box-shadow: 0 0 10px rgba(0, 0, 0, .15); font-size: 16px; line-height: 24px; }
            .invoice-box table { width: 100%; line-height: inherit; text-align: left; border-collapse: collapse; }
            .invoice-box table td { padding: 5px; vertical-align: top; }
            .invoice-box table tr td:nth-child(2) { text-align: right; }
            .invoice-box table tr.top table td { padding-bottom: 20px; }
            .invoice-box table tr.top table td.title { font-size: 45px; line-height: 45px; color: #333; }
            .invoice-box table tr.information table td { padding-bottom: 40px; }
            .invoice-box table tr.heading td { background: #eee; border-bottom: 1px solid #ddd; font-weight: bold; }
            .invoice-box table tr.details td { padding-bottom: 20px; }
            .invoice-box table tr.item td { border-bottom: 1px solid #eee; }
            .invoice-box table tr.item.last td { border-bottom: none; }
            .invoice-box table tr.total td:nth-child(2) { border-top: 2px solid #eee; font-weight: bold; }
            .text-right { text-align: right; }
          </style>
        </head>
        <body>
          <div class="invoice-box">
            <table>
              <tr class="top">
                <td colspan="2">
                  <table>
                    <tr>
                      <td class="title">U-Fill Dumpsters</td>
                      <td>
                        Receipt #: ${booking.id}<br>
                        Created: ${formatDate(booking.created_at)}<br>
                        Booking Status: ${booking.status}
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              <tr class="information">
                <td colspan="2">
                  <table>
                    <tr>
                      <td>
                        U-Fill Dumpsters LLC<br>
                        Saratoga Springs, UT<br>
                        (801) 810-8832
                      </td>
                      <td>
                        <strong>Billed To:</strong><br>
                        ${booking.customers.name}<br>
                        ${booking.customers.email}<br>
                        ${booking.street}, ${booking.city}, ${booking.state} ${booking.zip}
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              <tr class="heading">
                <td>Service Details</td>
                <td class="text-right">Price</td>
              </tr>
              <tr class="item">
                <td>
                  <strong>${serviceName}</strong><br>
                  <small>Drop-off: ${dropOffDate} (${booking.drop_off_time_slot || 'N/A'})</small><br>
                  <small>Pick-up: ${pickupDate} (${booking.pickup_time_slot || 'N/A'})</small>
                </td>
                <td class="text-right">${formatCurrency(booking.plan?.price)}</td>
              </tr>
              ${fees.map((fee)=>`
                <tr class="item">
                  <td>${fee.name}</td>
                  <td class="text-right">${formatCurrency(fee.amount)}</td>
                </tr>
              `).join('')}
              ${discountLine}
              <tr class="total">
                <td></td>
                <td class="text-right">Subtotal: ${formatCurrency(basePrice)}</td>
              </tr>
              <tr class="total">
                <td></td>
                <td class="text-right">Tax (6%): ${formatCurrency(tax)}</td>
              </tr>
              <tr class="total">
                <td></td>
                <td class="text-right"><strong>Total Paid: ${formatCurrency(booking.total_price)}</strong></td>
              </tr>
            </table>
          </div>
        </body>
        </html>
      `;
};
Deno.serve(async (req)=>{
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
  }
  try {
    const { bookingId } = await req.json();
    if (!bookingId) {
      throw new Error('Booking ID is required.');
    }
    const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
    const { data: booking, error: bookingError } = await supabaseAdmin.from('bookings').select('*, customers(*), plan:plan, addons:addons').eq('id', bookingId).single();
    if (bookingError || !booking) {
      throw new Error(bookingError?.message || 'Booking not found.');
    }
    const { data: serviceData, error: serviceError } = await supabaseAdmin.from('services').select('*').eq('id', booking.plan.id).single();
    if (serviceError || !serviceData) {
      throw new Error(serviceError?.message || 'Service details not found for receipt.');
    }
    booking.plan.name = serviceData.name;
    const htmlContent = generateHTMLReceipt(booking);
    // This is a simulation of PDF generation. We encode the HTML to base64.
    const pdfBytes = new TextEncoder().encode(htmlContent);
    const pdfBase64 = btoa(String.fromCharCode.apply(null, pdfBytes));
    return new Response(JSON.stringify({
      pdf: pdfBase64
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error("Get Receipt PDF Error:", error);
    return new Response(JSON.stringify({
      error: error.message
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
});



// ----------------------------
// Function: send-confirmation
// ----------------------------

// --- File: index.ts ---

// send-confirmation/index.ts
// Update: remove the secondary receipt link; keep a single portal link or a single direct receipt link (if provided)
import { createClient } from 'npm:@supabase/supabase-js@2.45.1';
const BREVO_API_KEY = (Deno.env.get('BREVO_API_KEY') ?? '').trim();
const FROM_EMAIL = (Deno.env.get('BREVO_FROM_EMAIL') ?? '').trim();
// Optional URLs
const PORTAL_URL = (Deno.env.get('PORTAL_URL') ?? 'https://www.u-filldumpsters.com/login').trim();
const RECEIPT_URL = (Deno.env.get('RECEIPT_URL') ?? 'https://www.u-filldumpsters.com/receipt').trim();
const MAX_ATTACHMENT_BASE64_BYTES = 8 * 1024 * 1024; // 8MB
Deno.serve(async (req)=>{
  try {
    if (req.method === 'OPTIONS') return new Response('ok', {
      headers: corsHeaders()
    });
    if (req.method !== 'POST') {
      return json({
        error: 'Method not allowed'
      }, 405);
    }
    if (!BREVO_API_KEY || !FROM_EMAIL) {
      return json({
        error: 'Missing BREVO_API_KEY or BREVO_FROM_EMAIL'
      }, 500);
    }
    // Strictly parse JSON body
    let body = null;
    try {
      body = await req.json();
    } catch  {
      return json({
        error: 'Invalid JSON. Expecting { "bookingId": <id> }'
      }, 400);
    }
    const bookingId = body?.bookingId;
    if (!bookingId || ![
      'string',
      'number'
    ].includes(typeof bookingId)) {
      return json({
        error: 'Booking ID is required.'
      }, 400);
    }
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
    const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      return json({
        error: 'Server misconfiguration (missing SUPABASE_URL or SERVICE_ROLE_KEY).'
      }, 500);
    }
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    // Load booking + related customer; adjust select/path to your schema
    const { data: booking, error: bookingError } = await admin.from('bookings').select(`
        id,
        status,
        customers:customers (
          email,
          name,
          customer_id_text,
          phone
        )
      `).eq('id', bookingId).single();
    if (bookingError || !booking) {
      return json({
        error: `Booking not found for id ${bookingId}`,
        detail: bookingError?.message ?? null
      }, 404);
    }
    const customer = booking.customers;
    if (!customer) return json({
      error: 'Booking has no related customer.'
    }, 422);
    const email = String(customer.email ?? '').trim();
    const name = String(customer.name ?? '').trim() || 'Customer';
    const customerIdText = String(customer.customer_id_text ?? '').trim();
    const phone = String(customer.phone ?? '').trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({
        error: `Invalid or missing customer email: "${email}"`
      }, 422);
    }
    // Build links (single link preference)
    const portalLink = `${PORTAL_URL}?cid=${encodeURIComponent(customerIdText)}&phone=${encodeURIComponent(phone)}`;
    const receiptLink = RECEIPT_URL ? `${RECEIPT_URL}?bookingId=${encodeURIComponent(String(booking.id))}` : '';
    // Try to generate PDF; only attach if valid
    const { pdfBase64, pdfDiagnostics } = await tryGeneratePdf(admin, bookingId);
    // Email content
    const isPending = booking.status === 'pending_review' || booking.status === 'pending_verification';
    const subject = isPending ? `Action Required: Your Booking #${booking.id} is On Hold` : `Booking Confirmed: U-Fill Dumpsters Service #${booking.id}`;
    const confirmedBase = 'Thank you for your booking with U-Fill Dumpsters! Your service is confirmed.';
    const attachmentLine = pdfBase64 ? ' A detailed receipt is attached.' : '';
    // Single-link rule: prefer direct receipt if available; otherwise portal
    const primaryLink = receiptLink || portalLink;
    const primaryLabel = receiptLink ? 'Download your receipt' : 'Open your Customer Portal';
    const linkLine = primaryLink ? ` You can ${receiptLink ? 'also ' : ''} ${receiptLink ? '' : ''}access it here: ${primaryLink}` : '';
    const message = isPending ? 'Thank you for your rental request. Your booking is currently on hold and requires manual review. We will process it shortly.' : `${confirmedBase}${attachmentLine}${linkLine}`;
    // Single callout block with only one actionable link
    const infoBlock = singleActionBlock(primaryLink, primaryLabel, customerIdText, phone, isPending);
    const htmlContent = generateEmailHtml(name, subject, message, infoBlock);
    // Build Brevo payload; only include attachments when we have a valid base64
    const emailPayload = {
      sender: {
        email: FROM_EMAIL,
        name: 'U-Fill Dumpsters'
      },
      to: [
        {
          email,
          name
        }
      ],
      subject,
      htmlContent
    };
    if (pdfBase64) emailPayload.attachments = [
      {
        name: `U-Fill-Receipt-${booking.id}.pdf`,
        content: pdfBase64
      }
    ];
    const emailRes = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': BREVO_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(emailPayload)
    });
    const emailText = await safeReadText(emailRes);
    if (!emailRes.ok) {
      return json({
        error: `Brevo API Error: ${emailRes.status} ${emailRes.statusText}`,
        brevo: tryParseJson(emailText) ?? emailText ?? null,
        pdfAttached: Boolean(pdfBase64),
        pdfDiagnostics,
        primaryLink
      }, 502);
    }
    return json({
      message: 'Confirmation email accepted by Brevo.',
      pdfAttached: Boolean(pdfBase64),
      pdfDiagnostics,
      primaryLink
    }, 200);
  } catch (e) {
    console.error('Send Confirmation Email Error:', e);
    return json({
      error: e?.message ?? 'Unexpected error'
    }, 500);
  }
});
// Helpers
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Content-Type': 'application/json'
  };
}
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: corsHeaders()
  });
}
async function tryGeneratePdf(admin, bookingId) {
  const pdfDiagnostics = [];
  let pdfBase64 = null;
  try {
    const { data, error } = await admin.functions.invoke('generate-receipt-pdf', {
      body: {
        booking: {
          id: bookingId
        }
      }
    });
    if (error) {
      pdfDiagnostics.push(`generate-receipt-pdf error: ${error.message}`);
    } else {
      // If function returns application/pdf stream in other flows, this path may be JSON-only.
      // Here we expect JSON with { pdf: base64 } for attachment use-cases only.
      const candidate = data?.pdf;
      if (typeof candidate === 'string' && candidate.trim().length > 0) {
        const stripped = candidate.trim();
        if (!isLikelyBase64(stripped)) {
          pdfDiagnostics.push('PDF not valid base64; skipping attachment.');
        } else {
          const approxBytes = Math.floor(stripped.length * 3 / 4);
          if (approxBytes > MAX_ATTACHMENT_BASE64_BYTES) {
            pdfDiagnostics.push(`PDF too large (~${(approxBytes / (1024 * 1024)).toFixed(2)}MB); skipping attachment.`);
          } else {
            pdfBase64 = stripped;
          }
        }
      } else {
        pdfDiagnostics.push('No base64 PDF payload received; email will include single action link only.');
      }
    }
  } catch (e) {
    pdfDiagnostics.push(`invoke error: ${e?.message ?? 'unknown'}`);
  }
  return {
    pdfBase64,
    pdfDiagnostics
  };
}
function singleActionBlock(link, label, cid, phone, isPending) {
  const creds = isPending ? `<br><br><strong>Pre-filled login details:</strong><br>Customer ID: <strong>${escapeHtml(cid)}</strong><br>Phone: <strong>${escapeHtml(phone)}</strong>` : '';
  return `
    <div style="background-color:#eef7ff;border:1px solid #b3d7ff;padding:15px;border-radius:5px;margin-top:20px;">
      <a href="${linkSafe(link)}" style="display:inline-block;background:#0b5cab;color:#fff;padding:10px 14px;border-radius:4px;text-decoration:none;">${escapeHtml(label)}</a>
      ${creds}
    </div>
  `;
}
function generateEmailHtml(name, subject, message, actionBlock) {
  return `
  <!doctype html>
  <html>
  <head>
    <meta charset="utf-8">
    <style>
      body { font-family: -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif; color:#333; line-height:1.6; }
      .container { max-width:600px; margin:20px auto; padding:20px; border:1px solid #ddd; border-radius:8px; background:#f9f9f9; }
      .header { font-size:22px; font-weight:bold; color:#003366; text-align:center; margin-bottom:18px; }
      .footer { font-size:12px; color:#777; margin-top:20px; text-align:center; }
      a { color:#0b5cab; }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="header">${escapeHtml(subject)}</div>
      <p>Hello ${escapeHtml(name)},</p>
      <p>${escapeHtml(message)}</p>
      ${actionBlock}
      <p>We look forward to serving you!</p>
      <p>Sincerely,<br>U-Fill Dumpsters Team</p>
      <div class="footer">U-Fill Dumpsters LLC | Saratoga Springs, UT | (801) 810-8832</div>
    </div>
  </body>
  </html>`;
}
function isLikelyBase64(s) {
  return /^[A-Za-z0-9+/=\r\n]+$/.test(s) && s.replace(/\r|\n/g, '').length % 4 === 0;
}
async function safeReadText(res) {
  try {
    return await res.text();
  } catch  {
    return '';
  }
}
function tryParseJson(text) {
  try {
    return text ? JSON.parse(text) : null;
  } catch  {
    return null;
  }
}
function linkSafe(url) {
  return String(url).replaceAll('"', '%22').replaceAll('<', '%3C').replaceAll('>', '%3E');
}
function escapeHtml(input) {
  return String(input).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}



// ----------------------------
// Function: generate-receipt-pdf
// ----------------------------

// --- File: cors.ts ---

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};


// --- File: index.ts ---

import { corsHeaders } from './cors.ts';
// This function is now a simple pass-through. 
// The actual HTML generation and PDF conversion logic has been moved to 'get-receipt-pdf'
// to simplify the function chain and reduce potential points of failure.
// This function can be deprecated or repurposed later if needed.
Deno.serve(async (req)=>{
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
  }
  try {
    // This function now expects the full booking object.
    const { booking } = await req.json();
    if (!booking) {
      throw new Error('Booking data is required.');
    }
    // It simply returns the booking data it received.
    // The caller ('get-receipt-pdf') will handle the HTML generation.
    return new Response(JSON.stringify({
      bookingData: booking
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error("Generate Receipt PDF (Pass-through) Error:", error);
    return new Response(JSON.stringify({
      error: error.message
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
});



// ----------------------------
// Function: delete-booking
// ----------------------------

// --- File: cors.ts ---

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};


// --- File: index.ts ---

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from './cors.ts';
const ADMIN_DELETE_PASSWORD = Deno.env.get('ADMIN_DELETE_PASSWORD');
Deno.serve(async (req)=>{
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
  }
  try {
    const { bookingId, password } = await req.json();
    if (password !== ADMIN_DELETE_PASSWORD) {
      return new Response(JSON.stringify({
        error: 'Invalid password.'
      }), {
        status: 401,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    if (!bookingId) {
      throw new Error('Booking ID is required.');
    }
    const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
    // Cascade of deletions
    // 1. booking_equipment
    await supabaseAdmin.from('booking_equipment').delete().eq('booking_id', bookingId);
    // 2. stripe_payment_info
    await supabaseAdmin.from('stripe_payment_info').delete().eq('booking_id', bookingId);
    // 3. customer_notes associated with the booking
    await supabaseAdmin.from('customer_notes').delete().eq('booking_id', bookingId);
    // 4. Finally, the booking itself
    const { error } = await supabaseAdmin.from('bookings').delete().eq('id', bookingId);
    if (error) {
      throw error;
    }
    return new Response(JSON.stringify({
      message: 'Booking successfully deleted.'
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error("Delete Booking Error:", error);
    return new Response(JSON.stringify({
      error: error.message
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
});



// ----------------------------
// Function: create-payment-intent
// ----------------------------

// --- File: cors.ts ---

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};


// --- File: index.ts ---

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

