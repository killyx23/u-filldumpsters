// Consolidated Edge Functions Backup
// Each function/shared module is separated by headers for clarity

// ============================
// Function: create-stripe-checkout-session
// ============================

// --- File: create-stripe-checkout-session/cors.ts ---

export { getCorsHeaders } from '../_shared/cors.ts';


// --- File: create-stripe-checkout-session/index.ts ---

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


// ============================
// Function: extend-rental
// ============================

// --- File: extend-rental/cors.ts ---

export { getCorsHeaders } from '../_shared/cors.ts';


// --- File: extend-rental/index.ts ---

import { getCorsHeaders } from "./cors.ts";
import { Stripe } from "npm:stripe@15.8.0";
const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY"), {
  apiVersion: "2024-06-20"
});
Deno.serve(async (req)=>{
  const corsHeaders = getCorsHeaders(req);
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


// ============================
// Function: get-stripe-session
// ============================

// --- File: get-stripe-session/cors.ts ---

export { getCorsHeaders } from '../_shared/cors.ts';


// --- File: get-stripe-session/index.ts ---

import { getCorsHeaders } from "./cors.ts";
import { Stripe } from "npm:stripe@15.8.0";
const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY"), {
  apiVersion: "2024-06-20"
});
Deno.serve(async (req)=>{
  const corsHeaders = getCorsHeaders(req);
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


// ============================
// Function: get-booking-by-session
// ============================

// --- File: get-booking-by-session/cors.ts ---

export { getCorsHeaders } from '../_shared/cors.ts';


// --- File: get-booking-by-session/index.ts ---

import { getCorsHeaders } from "./cors.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
Deno.serve(async (req)=>{
  const corsHeaders = getCorsHeaders(req);
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


// ============================
// Function: get-session-status
// ============================

// --- File: get-session-status/cors.ts ---

export { getCorsHeaders } from '../_shared/cors.ts';


// --- File: get-session-status/index.ts ---

import { getCorsHeaders } from "./cors.ts";
import { Stripe } from "npm:stripe@15.8.0";
const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY"), {
  apiVersion: "2024-06-20"
});
Deno.serve(async (req)=>{
  const corsHeaders = getCorsHeaders(req);
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


// ============================
// Function: get-equipment-inventory
// ============================

// --- File: get-equipment-inventory/cors.ts ---

export { getCorsHeaders } from '../_shared/cors.ts';


// --- File: get-equipment-inventory/index.ts ---

import { getCorsHeaders } from "./cors.ts";
import { createClient } from 'npm:@supabase/supabase-js@2';
const supabase = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_ANON_KEY'));
Deno.serve(async (req)=>{
  const corsHeaders = getCorsHeaders(req);
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


// ============================
// Function: get-eta
// ============================

// --- File: get-eta/cors.ts ---

export { getCorsHeaders } from '../_shared/cors.ts';


// --- File: get-eta/index.ts ---

import { getCorsHeaders } from "./cors.ts";
const GOOGLE_MAPS_API_KEY = Deno.env.get("GOOGLE_MAPS_API_KEY");
const ORIGIN_ADDRESS = "227 West Casi Way, Saratoga Springs, Utah 84045";
Deno.serve(async (req)=>{
  const corsHeaders = getCorsHeaders(req);
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


// ============================
// Function: verify-address
// ============================

// --- File: verify-address/cors.ts ---

export { getCorsHeaders } from '../_shared/cors.ts';


// --- File: verify-address/index.ts ---

import { getCorsHeaders } from "./cors.ts";
Deno.serve(async (req)=>{
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }
  let apiKey = Deno.env.get("GOOGLE_MAPS_API_KEY");
  if (!apiKey) {
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
  apiKey = apiKey.trim();
  try {
    const { address } = await req.json();
    if (!address) {
      throw new Error("Address is required for verification.");
    }
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${apiKey}`;
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
      throw new Error(`Could not verify address. Status: ${data.status}`);
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


// ============================
// Function: charge-customer
// ============================

// --- File: charge-customer/cors.ts ---

export { getCorsHeaders } from '../_shared/cors.ts';


// --- File: charge-customer/index.ts ---

import { getCorsHeaders } from "./cors.ts";
// charge-customer Edge Function (auto-collection fix)
// Change: Do not call invoices.pay on charge_automatically invoices.
// After finalize, poll once to confirm auto-charge and persist payment refs.
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
  const corsHeaders = getCorsHeaders(req);
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


// ============================
// Function: get-weather
// ============================

// --- File: get-weather/cors.ts ---

export { getCorsHeaders } from '../_shared/cors.ts';


// --- File: get-weather/index.ts ---

import { getCorsHeaders } from "./cors.ts";
import { eachDayOfInterval, parseISO } from "npm:date-fns";
const WEATHER_API_KEY = Deno.env.get("WEATHER_API_KEY");
const LOCATION = "Saratoga Springs,UT";
Deno.serve(async (req)=>{
  const corsHeaders = getCorsHeaders(req);
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


// ============================
// Function: verify-address-and-distance
// ============================

// --- File: verify-address-and-distance/cors.ts ---

export { getCorsHeaders } from '../_shared/cors.ts';


// --- File: verify-address-and-distance/index.ts ---

import { getCorsHeaders } from "./cors.ts";
const GOOGLE_MAPS_API_KEY = Deno.env.get("GOOGLE_MAPS_API_KEY");
const ORIGIN_ADDRESS = "227 West Casi Way, Saratoga Springs, Utah 84045";
// Separate function for address verification
async function verifyAddress(address) {
  if (!GOOGLE_MAPS_API_KEY) {
    console.error("[CRITICAL] Google Maps API key is not set in environment variables.");
    return {
      isValid: false,
      message: "Server configuration error: API key missing.",
      errorCode: "MISSING_API_KEY"
    };
  }
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${GOOGLE_MAPS_API_KEY}`;
  console.log(`[INFO] Verifying address: ${address}`);
  try {
    const response = await fetch(url);
    const data = await response.json();
    console.log(`[INFO] Google Geocoding API response status: ${data.status}`);
    if (data.status === 'REQUEST_DENIED') {
      console.error(`[ERROR] Google Geocoding API REQUEST_DENIED. Error message: ${data.error_message || 'No error message provided'}`);
      console.error(`[ERROR] This usually means: 1) API key is invalid, 2) Geocoding API is not enabled, 3) Billing is not set up, or 4) API restrictions are blocking the request`);
      return {
        isValid: false,
        message: "Address verification service is temporarily unavailable. Please try again later or contact support.",
        errorCode: "API_REQUEST_DENIED",
        details: data.error_message
      };
    }
    if (data.status === 'OVER_QUERY_LIMIT') {
      console.error(`[ERROR] Google Geocoding API OVER_QUERY_LIMIT`);
      return {
        isValid: false,
        message: "Address verification service is temporarily unavailable due to high demand. Please try again in a few moments.",
        errorCode: "QUOTA_EXCEEDED"
      };
    }
    if (data.status === 'INVALID_REQUEST') {
      console.error(`[ERROR] Google Geocoding API INVALID_REQUEST. Address: ${address}`);
      return {
        isValid: false,
        message: "The provided address format is invalid. Please check and try again.",
        errorCode: "INVALID_ADDRESS_FORMAT"
      };
    }
    if (data.status === 'OK') {
      const result = data.results[0];
      if (result.partial_match) {
        console.warn(`[WARN] Address is a partial match: ${address}`);
        return {
          isValid: false,
          message: "Address is a partial match. Please verify all details are correct.",
          errorCode: "PARTIAL_MATCH"
        };
      }
      console.log(`[SUCCESS] Address verified successfully: ${address}`);
      return {
        isValid: true,
        message: "Address verified."
      };
    }
    if (data.status === 'ZERO_RESULTS') {
      console.warn(`[WARN] Address not found: ${address}`);
      return {
        isValid: false,
        message: "Address not found. Please check your entry.",
        errorCode: "ADDRESS_NOT_FOUND"
      };
    }
    // Catch-all for other statuses
    console.error(`[ERROR] Unexpected Google Geocoding API status: ${data.status}. Message: ${data.error_message || 'None'}`);
    return {
      isValid: false,
      message: "Could not verify address at this time. Please try again later.",
      errorCode: "UNKNOWN_ERROR",
      details: data.status
    };
  } catch (fetchError) {
    console.error(`[ERROR] Network error calling Google Geocoding API: ${fetchError.message}`);
    return {
      isValid: false,
      message: "Network error while verifying address. Please check your connection and try again.",
      errorCode: "NETWORK_ERROR",
      details: fetchError.message
    };
  }
}
// Separate function for distance calculation
async function calculateDistance(destination) {
  if (!GOOGLE_MAPS_API_KEY) {
    console.error("[CRITICAL] Google Maps API key is not set for distance calculation.");
    return null;
  }
  const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(ORIGIN_ADDRESS)}&destinations=${encodeURIComponent(destination)}&units=imperial&key=${GOOGLE_MAPS_API_KEY}`;
  console.log(`[INFO] Calculating distance to: ${destination}`);
  try {
    const response = await fetch(url);
    const data = await response.json();
    console.log(`[INFO] Google Distance Matrix API response status: ${data.status}`);
    if (data.status === 'REQUEST_DENIED') {
      console.error(`[ERROR] Google Distance Matrix API REQUEST_DENIED. Error: ${data.error_message || 'No error message'}`);
      return null;
    }
    if (data.status === 'OK' && data.rows[0].elements[0].status === 'OK') {
      const element = data.rows[0].elements[0];
      const distanceMiles = element.distance.value / 1609.34; // meters to miles
      const extraMiles = Math.max(0, distanceMiles - 30);
      const fee = extraMiles * 0.80;
      console.log(`[SUCCESS] Distance calculated: ${distanceMiles.toFixed(2)} miles, fee: $${fee.toFixed(2)}`);
      return {
        miles: distanceMiles,
        duration: element.duration.text,
        fee: fee
      };
    } else {
      console.error(`[ERROR] Google Distance Matrix API Error. Status: ${data.status}, Element status: ${data.rows[0]?.elements[0]?.status}`);
      console.error(`[ERROR] Error message: ${data.error_message || 'None'}`);
      return null;
    }
  } catch (fetchError) {
    console.error(`[ERROR] Network error calling Google Distance Matrix API: ${fetchError.message}`);
    return null;
  }
}
Deno.serve(async (req)=>{
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }
  try {
    const { address, serviceType } = await req.json();
    if (!address) {
      console.error("[ERROR] Address is required but was not provided");
      return new Response(JSON.stringify({
        error: "Address is required.",
        errorCode: "MISSING_ADDRESS"
      }), {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        },
        status: 400
      });
    }
    console.log(`[INFO] Processing verification request for service type: ${serviceType}`);
    const verificationResult = await verifyAddress(address);
    if (!verificationResult.isValid) {
      console.log(`[INFO] Address verification failed. Returning structured error response.`);
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
      if (distanceInfo === null) {
        console.warn(`[WARN] Distance calculation failed but address was verified. Proceeding without distance info.`);
      }
    }
    console.log(`[SUCCESS] Verification completed successfully`);
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
    console.error(`[ERROR] Unhandled error in verify-address-and-distance function: ${error.message}`);
    console.error(`[ERROR] Stack trace: ${error.stack}`);
    return new Response(JSON.stringify({
      error: "An unexpected error occurred during address verification.",
      errorCode: "INTERNAL_ERROR",
      details: error.message
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      },
      status: 500
    });
  }
});


// ============================
// Function: handle-booking-account-creation
// ============================

// --- File: handle-booking-account-creation/cors.ts ---

export { getCorsHeaders } from '../_shared/cors.ts';


// --- File: handle-booking-account-creation/index.ts ---

import { getCorsHeaders } from "./cors.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
const DOMAIN = "ufilldumpsters.com";
const ENV_PASSWORD_SUFFIX = (Deno.env.get("SUPABASE_PASSWORD_SUFFIX") ?? "").trim();
function buildPasswordFromPhone(cleanedPhone) {
  return `${cleanedPhone}${ENV_PASSWORD_SUFFIX}`;
}
function buildAuthEmail(customerIdText) {
  return `${String(customerIdText).trim()}@${DOMAIN}`.toLowerCase();
}
Deno.serve(async (req)=>{
  const corsHeaders = getCorsHeaders(req);
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
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error("Server misconfiguration.");
    }
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
    console.log(`[Account Creation] Handling account for customer ID: ${customerId}`);
    const { data: customer, error: fetchError } = await supabaseAdmin.from("customers").select("id, name, email, phone, user_id, customer_id_text").eq("id", customerId).single();
    if (fetchError || !customer) {
      console.error(`[Account Creation] Error fetching customer ${customerId}:`, fetchError);
      throw fetchError ?? new Error(`Customer with ID ${customerId} not found.`);
    }
    const portalId = String(customer.customer_id_text ?? "").trim();
    if (!portalId) {
      throw new Error(`Customer ${customerId} is missing customer_id_text.`);
    }
    const cleanedPhone = String(customer.phone ?? "").replace(/\D/g, "");
    if (cleanedPhone.length !== 10) {
      throw new Error(`Customer ${customerId} has invalid phone for portal auth.`);
    }
    const authEmail = buildAuthEmail(portalId);
    const password = buildPasswordFromPhone(cleanedPhone);
    console.log(`[Account Creation] Provisioning auth user ${authEmail} for customer ${customerId}`);
    const { data: userList, error: listError } = await supabaseAdmin.auth.admin.listUsers({
      email: authEmail
    });
    if (listError) {
      console.error(`[Account Creation] Error listing users for ${authEmail}:`, listError);
      throw listError;
    }
    const existingUser = userList?.users?.find((u)=>(u.email ?? "").toLowerCase() === authEmail) ?? null;
    let authUserId;
    if (existingUser) {
      authUserId = existingUser.id;
      console.log(`[Account Creation] Updating existing auth user: ${authUserId}`);
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
        throw new Error(`Failed to update auth user: ${updErr.message}`);
      }
    } else {
      console.log(`[Account Creation] Creating new auth user for: ${authEmail}`);
      const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email: authEmail,
        password,
        email_confirm: true,
        user_metadata: {
          name: customer.name,
          customer_db_id: customer.id,
          original_email: customer.email
        }
      });
      if (createError || !created?.user) {
        console.error(`[Account Creation] Failed to create user for ${authEmail}:`, createError);
        throw createError ?? new Error("Failed to create auth user.");
      }
      authUserId = created.user.id;
      console.log(`[Account Creation] Successfully created auth user: ${authUserId}`);
    }
    if (customer.user_id !== authUserId) {
      const { error: linkErr } = await supabaseAdmin.from("customers").update({
        user_id: authUserId
      }).eq("id", customer.id);
      if (linkErr) {
        console.error("[Account Creation] Warning: failed to link user_id to customer:", linkErr.message);
      } else {
        console.log(`[Account Creation] Linked customer ${customer.id} to auth user ${authUserId}`);
      }
    }
    return new Response(JSON.stringify({
      success: true,
      authUserId,
      authEmail,
      message: "Account setup or verification successful."
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      },
      status: 200
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[Account Creation] Top-level error:", message);
    return new Response(JSON.stringify({
      error: message
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      },
      status: 500
    });
  }
});


// ============================
// Function: get-distance-and-calculate-fee
// ============================

// --- File: get-distance-and-calculate-fee/cors.ts ---

export { getCorsHeaders } from '../_shared/cors.ts';


// --- File: get-distance-and-calculate-fee/index.ts ---

import { getCorsHeaders } from "./cors.ts";
const GOOGLE_MAPS_API_KEY = Deno.env.get("GOOGLE_MAPS_API_KEY") || Deno.env.get("VITE_GOOGLE_MAPS_API_KEY");
const BUSINESS_ADDRESS = "227 W Casi Way, Saratoga Springs, UT 84045";
const DELIVERY_BASE_FEE = 30;
const PER_MILE_RATE = 0.85;
Deno.serve(async (req)=>{
  const corsHeaders1 = getCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders1
    });
  }
  try {
    console.log("[get-distance-and-calculate-fee] Function invoked");
    const { address } = await req.json();
    if (!address) {
      throw new Error("Address is required.");
    }
    console.log(`[get-distance-and-calculate-fee] Calculating distance from ${BUSINESS_ADDRESS} to ${address}`);
    if (!GOOGLE_MAPS_API_KEY) {
      console.error("[get-distance-and-calculate-fee] GOOGLE_MAPS_API_KEY is missing");
      return generateWarningResponse("Server configuration error: Maps API Key missing.");
    }
    const mapsUrl = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(BUSINESS_ADDRESS)}&destinations=${encodeURIComponent(address)}&units=imperial&key=${GOOGLE_MAPS_API_KEY}`;
    const mapsResponse = await fetch(mapsUrl);
    if (!mapsResponse.ok) {
      const errorText = await mapsResponse.text();
      console.error("[get-distance-and-calculate-fee] Google Maps API Error:", errorText);
      return generateWarningResponse("Google Maps API request failed.");
    }
    const mapsData = await mapsResponse.json();
    console.log("[get-distance-and-calculate-fee] Google Maps API Response Status:", mapsData.status);
    if (mapsData.status !== 'OK' || !mapsData.rows[0]?.elements[0]) {
      console.warn(`[get-distance-and-calculate-fee] Google Maps API returned non-OK status: ${mapsData.status}`, mapsData);
      return generateWarningResponse(`Could not calculate distance accurately. API Status: ${mapsData.status}`);
    }
    const element = mapsData.rows[0].elements[0];
    if (element.status !== 'OK') {
      console.warn(`[get-distance-and-calculate-fee] Element status not OK: ${element.status}`);
      return generateWarningResponse(element.status === 'NOT_FOUND' ? "We couldn't find a route to that address. Please double-check for typos." : `Could not verify route. Status: ${element.status}`);
    }
    const distanceInMeters = element.distance.value;
    const miles = distanceInMeters / 1609.34;
    const roundTripMiles = miles * 2;
    const mileageFee = roundTripMiles * PER_MILE_RATE;
    const totalFee = DELIVERY_BASE_FEE + mileageFee;
    console.log(`[get-distance-and-calculate-fee] Success! Miles: ${miles.toFixed(2)}, Fee: $${totalFee.toFixed(2)}`);
    return new Response(JSON.stringify({
      success: true,
      miles: miles,
      roundTripMiles: roundTripMiles,
      mileageFee: mileageFee,
      deliveryFee: DELIVERY_BASE_FEE,
      totalFee: totalFee,
      unverifiedAddress: false
    }), {
      headers: {
        ...corsHeaders1,
        "Content-Type": "application/json"
      },
      status: 200
    });
  } catch (error) {
    console.error("[get-distance-and-calculate-fee] Exception caught:", error);
    return generateWarningResponse(error.message);
  }
});
function generateWarningResponse(reason) {
  console.warn(`[get-distance-and-calculate-fee] Returning warning response: ${reason}`);
  return new Response(JSON.stringify({
    success: true,
    miles: null,
    roundTripMiles: null,
    mileageFee: 0,
    deliveryFee: DELIVERY_BASE_FEE,
    totalFee: DELIVERY_BASE_FEE,
    unverifiedAddress: true,
    warning: "Address could not be verified automatically. Proceeding with caution. " + reason
  }), {
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    },
    status: 200
  });
}


// ============================
// Function: get-distance-fee
// ============================

// --- File: get-distance-fee/cors.ts ---

export { getCorsHeaders } from '../_shared/cors.ts';


// --- File: get-distance-fee/index.ts ---

import { getCorsHeaders } from "./cors.ts";
const businessAddress = "227 W Casi Way, Saratoga Springs, UT 84045";
const perMileRate = 0.85;
const baseFee = 30;
Deno.serve(async (req)=>{
  const corsHeaders = getCorsHeaders(req);
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


// ============================
// Function: get-availability
// ============================

// --- File: get-availability/cors.ts ---

export { getCorsHeaders } from '../_shared/cors.ts';


// --- File: get-availability/index.ts ---

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getCorsHeaders } from "./cors.ts";
import { addDays, format, parseISO, isBefore, parse, set, addMinutes, isSameDay, startOfDay } from 'npm:date-fns@2.30.0';
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
        end: format(slotEnd, 'HH:mm:ss'),
        label
      });
    }
    currentTime = addMinutes(currentTime, intervalMinutes);
  }
  return slots;
};
/**
 * Resolves which service's inventory_rules/reservations a request is actually asking about.
 *
 * Phase 2d: replaces the hardcoded `serviceId === 2 && isDelivery -> 4` with a lookup of
 * services.delivery_variant_service_id, so any future delivery variant is covered without an
 * edge function edit — the same fix Phase 1 applied to the write-time trigger.
 */ function resolveServiceIdForAvailability(serviceId, isDelivery, servicesById) {
  const base = Number(serviceId);
  if (!isDelivery) return base;
  const variant = servicesById.get(base)?.delivery_variant_service_id;
  return variant ? Number(variant) : base;
}
/** Phase 2d: services.slot_interval_minutes replaces the hardcoded intervalMap. */ function slotIntervalFor(serviceIdForAvail, servicesById) {
  return servicesById.get(serviceIdForAvail)?.slot_interval_minutes || 120;
}
/**
 * Sum of reservation rows for one resource/date, split into the part that blocks any request
 * ("day" rows, plus any slot row — see resource_quantity_used) and the individual slot rows a
 * candidate window needs to be overlap-tested against.
 *
 * Mirrors public.resource_quantity_used exactly, but as a single bulk in-memory reduction over
 * one query instead of one RPC call per (date, slot, resource) — at this business's data volume
 * that is a handful of rows per resource per month, so the O(n) scan costs nothing, and it keeps
 * get-availability's one Supabase round trip per request. scripts/verify-resource-reservations.mjs
 * exercises public.resource_quantity_used directly so the two can't silently drift apart.
 */ function buildReservationIndex(reservations) {
  const index = new Map(); // `${resource_id}|${date}` -> { dayQty, slotRows: [{start,end,qty}] }
  for (const r of reservations ?? []){
    const key = `${r.resource_id}|${r.reserved_date}`;
    const entry = index.get(key) ?? {
      dayQty: 0,
      slotRows: []
    };
    if (r.granularity === 'day') {
      entry.dayQty += r.quantity;
    } else {
      entry.slotRows.push({
        start: r.slot_start,
        end: r.slot_end,
        qty: r.quantity
      });
    }
    index.set(key, entry);
  }
  return index;
}
function dayUsage(index, resourceId, dateStr) {
  const entry = index.get(`${resourceId}|${dateStr}`);
  if (!entry) return 0;
  return entry.dayQty + entry.slotRows.reduce((sum, row)=>sum + row.qty, 0);
}
function slotUsage(index, resourceId, dateStr, slotStart, slotEnd) {
  const entry = index.get(`${resourceId}|${dateStr}`);
  if (!entry) return 0;
  const overlapping = entry.slotRows.filter((row)=>row.start < slotEnd && row.end > slotStart).reduce((sum, row)=>sum + row.qty, 0);
  return entry.dayQty + overlapping;
}
/**
 * Phase 2f.3: annotates a generated slot list with per-slot capacity for slot-granular
 * requirements. No-op (every slot stays available) when the service has none, which is every
 * service today — Phase 2f is infrastructure ahead of any service actually being configured for
 * slot granularity (see the design doc's Phase 1 data-audit deferral).
 */ function annotateSlots(slots, dateStr, slotGranularItems, reservationIndex) {
  if (slotGranularItems.length === 0) {
    return slots.map((s)=>({
        ...s,
        available: true
      }));
  }
  return slots.map((slot)=>{
    let remaining = Infinity;
    for (const item of slotGranularItems){
      const used = slotUsage(reservationIndex, item.inventory_item_id, dateStr, slot.value, slot.end ?? slot.value);
      const itemRemaining = item.inventory_items.total_quantity - used;
      remaining = Math.min(remaining, itemRemaining);
    }
    return {
      ...slot,
      available: remaining >= 1,
      remaining: Math.max(0, remaining)
    };
  });
}
Deno.serve(async (req)=>{
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
  }
  try {
    const { serviceId, startDate, endDate, isDelivery, excludeBookingId } = await req.json();
    if (!serviceId || !startDate || !endDate) {
      throw new Error('Service ID, start date, and end date are required.');
    }
    const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
    const start = parseISO(startDate);
    const end = parseISO(endDate);
    const dateRange = [];
    for(let d = start; d <= end; d = addDays(d, 1)){
      dateRange.push(format(d, 'yyyy-MM-dd'));
    }
    const excludeId = excludeBookingId != null && excludeBookingId !== '' ? Number(excludeBookingId) : null;
    // Fetched up front (small table) so delivery-variant resolution and slot intervals are data
    // lookups rather than hardcoded ids — see resolveServiceIdForAvailability / slotIntervalFor.
    const { data: services, error: servicesError } = await supabaseAdmin.from('services').select('id, occupancy_model, delivery_variant_service_id, slot_interval_minutes, service_type');
    if (servicesError) throw servicesError;
    const servicesById = new Map((services ?? []).map((s)=>[
        Number(s.id),
        s
      ]));
    const serviceIdForAvail = resolveServiceIdForAvailability(serviceId, isDelivery, servicesById);
    const interval = slotIntervalFor(serviceIdForAvail, servicesById);
    const isWindowService = servicesById.get(serviceIdForAvail)?.service_type === 'window';
    console.log(`\n${'='.repeat(80)}`);
    console.log(`[get-availability] serviceId=${serviceId}, isDelivery=${isDelivery}, serviceIdForAvail=${serviceIdForAvail}, interval=${interval}min`);
    console.log(`[get-availability] dateRange: ${startDate} → ${endDate} (${dateRange.length} days)`);
    console.log(`[get-availability] excludeBookingId=${excludeId ?? 'none'}`);
    console.log(`${'='.repeat(80)}`);
    const [{ data: weeklyRules, error: weeklyError }, { data: dateSpecificRules, error: specificError }, { data: inventoryRules, error: inventoryRulesError }] = await Promise.all([
      supabaseAdmin.from('service_availability').select('*').eq('service_id', serviceIdForAvail),
      supabaseAdmin.from('date_specific_availability').select('*').eq('service_id', serviceIdForAvail).in('date', dateRange),
      supabaseAdmin.from('inventory_rules').select('service_id, inventory_item_id, quantity_required, occupancy_model, scheduling_granularity, inventory_items(id, total_quantity, name)')
    ]);
    if (weeklyError) throw weeklyError;
    if (specificError) throw specificError;
    if (inventoryRulesError) throw inventoryRulesError;
    const requiredItems = (inventoryRules ?? []).filter((r)=>r.service_id === serviceIdForAvail);
    const dayGranularItems = requiredItems.filter((r)=>(r.scheduling_granularity ?? 'day') !== 'slot');
    const slotGranularItems = requiredItems.filter((r)=>r.scheduling_granularity === 'slot');
    const resourceIds = [
      ...new Set(requiredItems.map((r)=>r.inventory_item_id))
    ];
    if (requiredItems.length === 0) {
      console.log(`  ⚠️  NO INVENTORY RULES for service ${serviceIdForAvail} — capacity is UNCHECKED`);
    }
    // Reservations are pre-expanded one row per occupied day (see booking_reservation_rows), so
    // this single indexed range query replaces the old nested loop over every booking's raw
    // plan/addons JSONB (bookingOccupiesDate + the O(bookings × rules) scan it drove).
    let reservationIndex = new Map();
    if (resourceIds.length > 0) {
      let reservationsQuery = supabaseAdmin.from('booking_resource_reservations').select('resource_id, reserved_date, quantity, slot_start, slot_end, granularity, booking_id').in('resource_id', resourceIds).gte('reserved_date', startDate).lte('reserved_date', endDate);
      if (Number.isFinite(excludeId)) {
        reservationsQuery = reservationsQuery.neq('booking_id', excludeId);
      }
      const { data: reservations, error: reservationsError } = await reservationsQuery;
      if (reservationsError) throw reservationsError;
      reservationIndex = buildReservationIndex(reservations);
      console.log(`  Reservations in range for resources [${resourceIds.join(',')}]: ${reservations?.length ?? 0}`);
    }
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
      const rule = specificRulesMap.get(dateStr) || weeklyRulesMap.get(dayOfWeek);
      let isAvailable = rule ? rule.is_available !== false : false;
      // Independent of yard hours: a closed Sunday can still be occupied overnight.
      let inventoryAvailable = true;
      for (const requiredItem of dayGranularItems){
        const item = requiredItem.inventory_items;
        if (!item) {
          console.log(`  ⚠️  inventory_items join is null for rule service_id=${requiredItem.service_id}, item_id=${requiredItem.inventory_item_id} — SKIPPING`);
          continue;
        }
        const used = dayUsage(reservationIndex, item.id, dateStr);
        const wouldExceed = used + requiredItem.quantity_required > item.total_quantity;
        if (wouldExceed) {
          console.log(`  [${dateStr}] "${item.name}" full: ${used} + ${requiredItem.quantity_required} > ${item.total_quantity}`);
          inventoryAvailable = false;
          break;
        }
      }
      if (isAvailable && !inventoryAvailable) {
        isAvailable = false;
      }
      // Delivery-window services (16-yard dumpster, delivered trailer) have a distinct
      // "delivery pickup window" for the return trip, separate from the self-pickup
      // pickup/return-by config used by hourly services. Phase 2f.4 relies on this being
      // correct: BookingForm now sources plan 1/4's pickup window from here instead of
      // querying date_specific_availability directly.
      const deliverySlots = rule ? generateSlotsFromRange(rule.delivery_start_time ?? rule.delivery_window_start_time, rule.delivery_end_time ?? rule.delivery_window_end_time, interval, date, now) : [];
      const pickupSlots = rule ? isWindowService ? generateSlotsFromRange(rule.delivery_pickup_start_time ?? rule.delivery_pickup_window_start_time, rule.delivery_pickup_end_time ?? rule.delivery_pickup_window_end_time, interval, date, now) : generateSlotsFromRange(rule.pickup_start_time, rule.pickup_end_time ?? rule.return_by_time, interval, date, now) : [];
      const returnSlots = rule ? generateSlotsFromRange(rule.return_start_time ?? rule.return_by_time, rule.return_end_time, 60, date, now) : [];
      const hourlySlots = rule ? generateSlotsFromRange(rule.hourly_start_time, rule.hourly_end_time, 60, date, now) : [];
      // Phase 2f.3: date-level availability now also requires at least one generated slot to
      // have room, when the service has a slot-granular requirement. This is a no-op for every
      // service configured today (none has scheduling_granularity = 'slot' yet), so existing
      // day-only behaviour is unchanged; it activates automatically once one is added.
      const annotatedDeliverySlots = annotateSlots(deliverySlots, dateStr, slotGranularItems, reservationIndex);
      const annotatedPickupSlots = annotateSlots(pickupSlots, dateStr, slotGranularItems, reservationIndex);
      if (isAvailable && slotGranularItems.length > 0) {
        const candidateSlots = [
          ...annotatedDeliverySlots,
          ...annotatedPickupSlots
        ];
        if (candidateSlots.length > 0 && !candidateSlots.some((s)=>s.available)) {
          console.log(`  [${dateStr}] slot-granular resource has no free slot — marking unavailable`);
          isAvailable = false;
        }
      }
      availability[dateStr] = {
        available: isAvailable,
        inventoryAvailable,
        deliverySlots: annotatedDeliverySlots,
        pickupSlots: annotatedPickupSlots,
        returnSlots,
        hourlySlots
      };
    }
    console.log(`[get-availability] REQUEST COMPLETE`);
    console.log(`${'='.repeat(80)}\n`);
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
    console.error('[get-availability] ERROR:', error.message, error.stack);
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


// ============================
// Function: request-booking-change
// ============================

// --- File: request-booking-change/cors.ts ---

export { getCorsHeaders } from '../_shared/cors.ts';


// --- File: request-booking-change/index.ts ---

import { getCorsHeaders } from "./cors.ts";
import { createClient } from 'npm:@supabase/supabase-js@2';
import { buildRescheduleRequestChatMessage } from "../_shared/formatRescheduleChat.ts";
const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}
function toDateString(value) {
  if (!value) return null;
  if (value instanceof Date && !isNaN(value.getTime())) {
    return value.toISOString().split('T')[0];
  }
  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.split('T')[0];
    const parsed = new Date(value);
    if (!isNaN(parsed.getTime())) return parsed.toISOString().split('T')[0];
    return value;
  }
  return null;
}
function formatAddressParts(street, city, state, zip) {
  const line1 = (street || '').trim();
  const line2 = [
    city,
    state
  ].filter(Boolean).join(', ');
  const withZip = [
    line2,
    (zip || '').trim()
  ].filter(Boolean).join(' ');
  return [
    line1,
    withZip
  ].filter(Boolean).join(', ');
}
function parseAddressString(full) {
  const trimmed = (full || '').trim();
  if (!trimmed) return {
    street: '',
    city: '',
    state: '',
    zip: ''
  };
  const parts = trimmed.split(',').map((p)=>p.trim()).filter(Boolean);
  if (parts.length >= 3) {
    const street = parts[0];
    const city = parts[1];
    const stateZip = parts.slice(2).join(' ').trim();
    const match = stateZip.match(/^([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/);
    if (match) {
      return {
        street,
        city,
        state: match[1].toUpperCase(),
        zip: match[2]
      };
    }
    const loose = stateZip.match(/^([A-Za-z]{2})\s*(.*)$/);
    if (loose) {
      return {
        street,
        city,
        state: loose[1].toUpperCase(),
        zip: (loose[2] || '').trim()
      };
    }
    return {
      street,
      city,
      state: stateZip,
      zip: ''
    };
  }
  if (parts.length === 2) {
    const street = parts[0];
    const rest = parts[1];
    const match = rest.match(/^(.+?)\s+([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/);
    if (match) {
      return {
        street,
        city: match[1].trim(),
        state: match[2].toUpperCase(),
        zip: match[3]
      };
    }
    return {
      street,
      city: rest,
      state: '',
      zip: ''
    };
  }
  return {
    street: trimmed,
    city: '',
    state: '',
    zip: ''
  };
}
function normalizeAddress(input) {
  if (!input) return null;
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!trimmed) return null;
    const parsed = parseAddressString(trimmed);
    return {
      street: parsed.street || trimmed,
      city: parsed.city || '',
      state: parsed.state || '',
      zip: parsed.zip || '',
      formatted_address: trimmed
    };
  }
  if (typeof input !== 'object') return null;
  const obj = input;
  const street = String(obj.street || '').trim();
  const city = String(obj.city || '').trim();
  const state = String(obj.state || '').trim();
  const zip = String(obj.zip || '').trim();
  const formatted = String(obj.formatted_address || '').trim() || formatAddressParts(street, city, state, zip);
  if (!street && !formatted) return null;
  return {
    street: street || formatted,
    city,
    state,
    zip,
    formatted_address: formatted
  };
}
function addressesAreEqual(a, b) {
  const left = (normalizeAddress(a)?.formatted_address || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const right = (normalizeAddress(b)?.formatted_address || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!left || !right) return false;
  return left === right;
}
function formatContactAddressForNote(addr) {
  const normalized = normalizeAddress(addr);
  return normalized?.formatted_address || null;
}
function resolveToAddress(details) {
  const contact = normalizeAddress(details.new_contact_address);
  if (contact) {
    return {
      address: contact,
      kind: 'contact'
    };
  }
  const deliveryObj = normalizeAddress(details.new_delivery_address_obj);
  if (deliveryObj) {
    return {
      address: deliveryObj,
      kind: 'delivery'
    };
  }
  const deliveryStr = normalizeAddress(details.new_delivery_address);
  return {
    address: deliveryStr,
    kind: 'delivery'
  };
}
function resolveFromAddress(booking) {
  return normalizeAddress(booking.delivery_address) || normalizeAddress(booking.contact_address) || normalizeAddress({
    street: booking.street,
    city: booking.city,
    state: booking.state,
    zip: booking.zip
  });
}
function buildDetailedNote(booking, reason, details) {
  if (!details) {
    return `Customer requested a booking change.\nNeeds scheduling approval.\n\n${reason}`;
  }
  // Portal reason is already human-readable — avoid duplicating technical dumps
  let note = (reason || "").trim();
  if (!note) {
    note = `Reschedule request for booking #${booking.id}.`;
  }
  if (!/scheduling approval|customer service approval/i.test(note)) {
    note = `Reschedule request for booking #${booking.id}.\nNeeds scheduling approval.\n\n${note}`;
  }
  if (details.is_manual_address && !/address verification/i.test(note)) {
    note += `\nAddress needs verification by customer service.`;
  }
  const inv = details.inventory_changes;
  if (inv) {
    const toReturn = inv.to_return;
    const toAllocate = inv.to_allocate;
    const hasReturn = Array.isArray(toReturn) && toReturn.length > 0;
    const hasAllocate = Array.isArray(toAllocate) && toAllocate.length > 0;
    if ((hasReturn || hasAllocate) && !/Equipment to return:|Equipment to allocate:/i.test(note)) {
      if (hasReturn) note += `\nEquipment to return: ${JSON.stringify(toReturn)}`;
      if (hasAllocate) note += `\nEquipment to allocate: ${JSON.stringify(toAllocate)}`;
    }
  }
  const submitted = details.request_timestamp ?? new Date().toISOString();
  if (!/Submitted\s*(at)?:/i.test(note)) {
    note += `\n\nSubmitted at: ${submitted}`;
  }
  return note;
}
Deno.serve(async (req)=>{
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }
  try {
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
    const body = await req.json();
    const bookingId = body.bookingId ?? body.booking_id;
    const rescheduleDetails = body.rescheduleDetails ?? body;
    const reasonRaw = body.reason ?? body.customer_comments ?? rescheduleDetails?.customer_comments;
    const reason = typeof reasonRaw === 'string' ? reasonRaw.trim() : '';
    if (!bookingId) {
      throw new Error("Booking ID and reason are required.");
    }
    if (!reason) {
      throw new Error("Booking ID and reason are required.");
    }
    const numericBookingId = Number(bookingId);
    console.log(`[Request Booking Change] User ${user.id} requesting change for booking ${numericBookingId}`);
    const { data: booking, error: bookingError } = await supabaseAdmin.from("bookings").select("*, customers(*)").eq("id", numericBookingId).single();
    if (bookingError || !booking) throw new Error("Booking not found.");
    const customerDbId = user.user_metadata?.customer_db_id;
    if (customerDbId != null && Number(customerDbId) !== Number(booking.customer_id)) {
      console.warn(`[Request Booking Change] customer_db_id mismatch: user ${customerDbId} booking ${booking.customer_id}`);
    }
    const noteContent = buildDetailedNote(booking, reason, rescheduleDetails);
    const details = rescheduleDetails && typeof rescheduleDetails === "object" ? rescheduleDetails : null;
    const originalTotal = round2(details?.original_total ?? details?.original_total_price ?? booking.total_price ?? 0);
    const newTotal = round2(details?.new_total ?? details?.new_total_price ?? details?.pricing?.total ?? originalTotal);
    const amountDue = round2(newTotal - originalTotal);
    const requestedAt = new Date().toISOString();
    const fromAddress = resolveFromAddress(booking);
    const { address: toAddress, kind: addressKind } = details ? resolveToAddress(details) : {
      address: null,
      kind: "delivery"
    };
    const explicitlyChanged = details?.address_changed === true;
    const addressChanged = Boolean(toAddress) && (explicitlyChanged || (fromAddress ? !addressesAreEqual(toAddress, fromAddress) : true));
    const existingHistory = Array.isArray(booking.reschedule_history) ? [
      ...booking.reschedule_history
    ] : [];
    if (addressChanged && toAddress) {
      existingHistory.push({
        type: "address_change",
        status: "pending",
        requested_at: requestedAt,
        from_address: fromAddress,
        to_address: toAddress,
        distance_miles: details?.distance_miles ?? null,
        is_manual_address: Boolean(details?.is_manual_address),
        address_kind: addressKind
      });
    }
    const originalServiceName = String(details?.original_service_name || booking.plan?.name || "").trim() || null;
    const newServiceName = String(details?.new_service_name || "").trim() || originalServiceName;
    const snapshotEntry = {
      type: "reschedule_request",
      status: "pending",
      requested_at: requestedAt,
      original_service_id: booking.plan?.id ?? null,
      original_service_name: originalServiceName,
      new_service_id: details?.new_service_id ?? null,
      new_service_name: newServiceName,
      original_drop_off_date: booking.drop_off_date,
      original_pickup_date: booking.pickup_date,
      original_drop_off_time: booking.drop_off_time_slot,
      original_pickup_time: booking.pickup_time_slot,
      new_drop_off_date: details ? toDateString(details.new_drop_off_date) : null,
      new_pickup_date: details ? toDateString(details.new_pickup_date) : null,
      new_drop_off_time: details?.new_drop_off_time ?? null,
      new_pickup_time: details?.new_pickup_time ?? null,
      original_address: fromAddress?.formatted_address || String(details?.original_address_display || "").trim() || null,
      new_address: toAddress?.formatted_address || String(details?.new_address_display || details?.new_delivery_address || "").trim() || null,
      address_changed: addressChanged,
      is_manual_address: Boolean(details?.is_manual_address),
      original_addons: details?.original_addons ?? [],
      new_addons: details?.new_addons ?? [],
      inventory_changes: details?.inventory_changes ?? null,
      pricing: details?.pricing ?? null,
      original_total: originalTotal,
      new_total: newTotal,
      amount_due: amountDue,
      customer_comments: details?.customer_comments ?? null
    };
    existingHistory.push(snapshotEntry);
    const bookingUpdate = {
      status: "pending_review",
      notes: reason,
      reschedule_history: existingHistory,
      payment_delta_details: {
        amount_due: amountDue,
        original_total_price: originalTotal,
        new_total_price: newTotal,
        reason: "Reschedule request pending scheduling approval",
        state: "pending",
        requested_at: requestedAt,
        last_updated_at: requestedAt
      }
    };
    if (!booking.receipt_original_snapshot) {
      bookingUpdate.receipt_original_snapshot = {
        captured_at: requestedAt,
        status: "pending_review",
        total_price: originalTotal,
        drop_off_date: booking.drop_off_date,
        pickup_date: booking.pickup_date,
        drop_off_time_slot: booking.drop_off_time_slot,
        pickup_time_slot: booking.pickup_time_slot,
        plan: booking.plan
      };
    }
    const { error: updateError } = await supabaseAdmin.from("bookings").update(bookingUpdate).eq("id", numericBookingId);
    if (updateError) throw new Error(`Failed to update booking: ${updateError.message}`);
    const hasStructuredReschedule = details && (details.new_drop_off_date != null || details.new_service_id != null);
    if (hasStructuredReschedule) {
      const logRow = {
        booking_id: numericBookingId,
        request_type: "reschedule",
        request_status: "pending",
        reschedule_request_time: requestedAt,
        original_service_id: booking.plan?.id ?? null,
        original_drop_off_date: booking.drop_off_date,
        original_pickup_date: booking.pickup_date,
        original_drop_off_time: booking.drop_off_time_slot,
        original_pickup_time: booking.pickup_time_slot,
        original_total: originalTotal,
        new_total: newTotal,
        fee_amount: amountDue > 0 ? amountDue : null,
        refund_amount: amountDue < 0 ? Math.abs(amountDue) : null,
        new_service_id: details.new_service_id ?? null,
        new_drop_off_date: toDateString(details.new_drop_off_date),
        new_pickup_date: toDateString(details.new_pickup_date),
        new_drop_off_time: details.new_drop_off_time ?? null,
        new_pickup_time: details.new_pickup_time ?? null
      };
      const { error: logError } = await supabaseAdmin.from("reschedule_history_logs").insert(logRow);
      if (logError) {
        console.error(`[Request Booking Change] reschedule_history_logs insert failed:`, logError.message);
      }
    }
    const { error: noteError } = await supabaseAdmin.from("customer_notes").insert({
      customer_id: booking.customer_id,
      booking_id: numericBookingId,
      source: "Change Request",
      content: noteContent,
      author_type: "customer",
      is_read: false
    });
    if (noteError) console.error(`Failed to add customer note: ${noteError.message}`);
    const chatMessage = buildRescheduleRequestChatMessage({
      bookingId: numericBookingId,
      originalBooking: booking,
      originalServiceName,
      newServiceName,
      newDropOffDate: details?.new_drop_off_date,
      newPickupDate: details?.new_pickup_date,
      newDropOffTime: details?.new_drop_off_time,
      newPickupTime: details?.new_pickup_time,
      originalAddons: details?.original_addons,
      newAddons: details?.new_addons,
      originalAddress: snapshotEntry.original_address,
      newAddress: snapshotEntry.new_address,
      addressChanged,
      isManualAddress: Boolean(details?.is_manual_address),
      comments: typeof details?.customer_comments === "string" ? details.customer_comments : null
    });
    const { error: chatError } = await supabaseAdmin.from("chat_messages").insert({
      conversation_id: `cust_${booking.customer_id}`,
      customer_id: booking.customer_id,
      booking_id: numericBookingId,
      sender_type: "customer",
      message_content: chatMessage,
      is_read: false,
      message_context: {
        action: "reschedule_requested",
        booking_id: numericBookingId
      }
    });
    if (chatError) {
      console.error(`[Request Booking Change] chat_messages insert failed:`, chatError.message);
    }
    console.log(`[Request Booking Change] Successfully processed request for booking ${numericBookingId}`);
    return new Response(JSON.stringify({
      success: true,
      message: "Your reschedule request has been submitted for review."
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      },
      status: 200
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[Request Booking Change] Error:", message);
    return new Response(JSON.stringify({
      error: message
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      },
      status: 500
    });
  }
});


// ============================
// Function: validate-coupon
// ============================

// --- File: validate-coupon/cors.ts ---

export { getCorsHeaders } from '../_shared/cors.ts';


// --- File: validate-coupon/index.ts ---

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getCorsHeaders } from "./cors.ts";
Deno.serve(async (req)=>{
  const corsHeaders = getCorsHeaders(req);
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


// ============================
// Function: customer-portal-login
// ============================

// --- File: customer-portal-login/cors.ts ---

export { getCorsHeaders } from '../_shared/cors.ts';


// --- File: customer-portal-login/index.ts ---

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.30.0";
import { getCorsHeaders } from "./cors.ts";
const DOMAIN = "ufilldumpsters.com";
const ENV_PASSWORD_SUFFIX = (Deno.env.get("SUPABASE_PASSWORD_SUFFIX") ?? "").trim();
function buildPasswordFromPhone(cleanedPhone) {
  return `${cleanedPhone}${ENV_PASSWORD_SUFFIX}`;
}
serve(async (req)=>{
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }
  try {
    console.log(`[Customer Portal Login] Received request: ${req.method} ${req.url}`);
    const contentType = req.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      return new Response(JSON.stringify({
        error: "Invalid Content-Type. Expected application/json."
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const rawBody = await req.text();
    console.log(`[Customer Portal Login] Raw request body:`, rawBody);
    if (!rawBody || rawBody.trim() === "") {
      return new Response(JSON.stringify({
        error: "Request body cannot be empty."
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    let payload;
    try {
      payload = JSON.parse(rawBody);
    } catch (parseError) {
      return new Response(JSON.stringify({
        error: "Invalid JSON in request body."
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const { portal_number, customerId, phone } = payload;
    const identifier = String(portal_number || customerId || "").trim();
    if (!identifier) {
      return new Response(JSON.stringify({
        error: "Customer ID is required."
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const cleanedPhone = String(phone || "").replace(/\D/g, "");
    if (cleanedPhone.length !== 10) {
      return new Response(JSON.stringify({
        error: "Invalid phone number format. Must be 10 digits."
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    if (!supabaseUrl || !supabaseServiceKey || !supabaseAnonKey) {
      console.error("[Customer Portal Login] Missing environment variables.");
      return new Response(JSON.stringify({
        error: "Server misconfiguration."
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
    // 1. Look up customer
    const { data: customer, error: fetchError } = await supabaseAdmin.from("customers").select("id, name, email, user_id, customer_id_text, phone").eq("customer_id_text", identifier).single();
    if (fetchError || !customer) {
      console.log(`[Customer Portal Login] Customer not found for CID: ${identifier}`);
      return new Response(JSON.stringify({
        error: "Invalid customer ID or phone number."
      }), {
        status: 401,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    // 2. Validate phone
    const cleanDbPhone = String(customer.phone || "").replace(/\D/g, "");
    console.log(`[Customer Portal Login] Phone comparison - Input: ${cleanedPhone}, DB: ${cleanDbPhone}`);
    if (cleanedPhone !== cleanDbPhone) {
      console.log(`[Customer Portal Login] Phone mismatch for CID: ${identifier}`);
      return new Response(JSON.stringify({
        error: "Invalid customer ID or phone number."
      }), {
        status: 401,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    // 3. Build deterministic auth email + password (same as old working version)
    const authEmail = `${identifier}@${DOMAIN}`.toLowerCase();
    const password = buildPasswordFromPhone(cleanedPhone);
    // 4. Ensure auth user exists and is up to date
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
          "Content-Type": "application/json"
        }
      });
    }
    const existingUser = userList?.users?.find((u)=>(u.email ?? "").toLowerCase() === authEmail) ?? null;
    let authUserId;
    if (existingUser) {
      authUserId = existingUser.id;
      console.log(`[Customer Portal Login] Updating existing auth user: ${authUserId}`);
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
            "Content-Type": "application/json"
          }
        });
      }
    } else {
      console.log(`[Customer Portal Login] Creating new auth user for: ${authEmail}`);
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
            "Content-Type": "application/json"
          }
        });
      }
      authUserId = created.user.id;
    }
    // 5. Link user_id on customers row if needed
    if (customer.user_id !== authUserId) {
      const { error: linkErr } = await supabaseAdmin.from("customers").update({
        user_id: authUserId
      }).eq("id", customer.id);
      if (linkErr) {
        console.error("[Customer Portal Login] Warning: failed to link user_id to customer:", linkErr.message);
      }
    }
    // 6. Sign in with password — no OTP, no magic links, no expiry issues
    console.log(`[Customer Portal Login] Signing in with password for: ${authEmail}`);
    const supabaseAnon = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
    const { data: signInData, error: signInError } = await supabaseAnon.auth.signInWithPassword({
      email: authEmail,
      password
    });
    if (signInError || !signInData?.session) {
      console.error("[Customer Portal Login] Sign-in failed:", signInError);
      return new Response(JSON.stringify({
        error: `Failed to sign in: ${signInError?.message}`,
        hints: [
          "Check SUPABASE_PASSWORD_SUFFIX — must match what was used when user was created.",
          "Ensure Auth > Settings > Password policy allows the password format.",
          "Ensure email_confirm: true is set so the user can sign in without confirming email."
        ]
      }), {
        status: 401,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    console.log(`[Customer Portal Login] Success for customer ${customer.id}`);
    return new Response(JSON.stringify({
      success: true,
      session: signInData.session,
      user: signInData.user,
      customer
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  } catch (err) {
    console.error("[Customer Portal Login] Unhandled Exception:", err);
    return new Response(JSON.stringify({
      error: err.message || "Internal server error during login."
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
});


// ============================
// Function: send-customer-id
// ============================

// --- File: send-customer-id/cors.ts ---

export { getCorsHeaders } from '../_shared/cors.ts';


// --- File: send-customer-id/index.ts ---

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getCorsHeaders } from "./cors.ts";
import { normalizeSiteUrl } from "../_shared/normalizeSiteUrl.ts";
const brevoApiKey = Deno.env.get('BREVO_API_KEY');
const fromEmail = Deno.env.get('BREVO_FROM_EMAIL');
Deno.serve(async (req)=>{
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
  }
  try {
    const { email, site_url } = await req.json();
    if (!email) {
      throw new Error('Email address is required.');
    }
    const emailLower = String(email).trim().toLowerCase();
    const siteUrl = normalizeSiteUrl(site_url);
    const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
    const { data: customers, error: customerError } = await supabaseAdmin.from('customers').select('name, email, phone, customer_id_text').ilike('email', emailLower).limit(1);
    const customer = customers?.[0] ?? null;
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
    const loginUrl = `${siteUrl}/customer-login?cid=${encodeURIComponent(customer.customer_id_text)}&phone=${encodeURIComponent(rawPhone)}`;
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


// ============================
// Function: send-admin-message
// ============================

// --- File: send-admin-message/cors.ts ---

export { getCorsHeaders } from '../_shared/cors.ts';


// --- File: send-admin-message/index.ts ---

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getCorsHeaders } from "./cors.ts";
Deno.serve(async (req)=>{
  const corsHeaders = getCorsHeaders(req);
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


// ============================
// Function: get-receipt-pdf
// ============================

// --- File: get-receipt-pdf/cors.ts ---

export { getCorsHeaders } from '../_shared/cors.ts';


// --- File: get-receipt-pdf/index.ts ---

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getCorsHeaders } from "./cors.ts";
import { PDFDocument, rgb, StandardFonts } from 'https://esm.sh/pdf-lib@1.17.1';
import { format } from 'https://deno.land/std@0.208.0/datetime/mod.ts';
import { resolveBookingGrandTotal } from '../_shared/resolveBookingGrandTotal.ts';
import { formatPlainBookingTime, formatDeliveryTimeWindowBetween } from '../_shared/formatBookingTime.ts';
import { formatCustomerFacingPlanName } from '../_shared/displayPlanName.ts';
const formatDate = (dateStr)=>dateStr ? format(new Date(dateStr), 'MM/dd/yyyy') : 'N/A';
const formatCurrency = (amount)=>amount != null ? `$${Number(amount).toFixed(2)}` : '$0.00';
const formatSlot = (slot, isDelivery = false)=>{
  if (!slot) return 'N/A';
  return isDelivery ? formatDeliveryTimeWindowBetween(String(slot)) : formatPlainBookingTime(String(slot));
};
const drawDivider = (page, y, margin, pageWidth, color)=>{
  page.drawLine({
    start: {
      x: margin,
      y
    },
    end: {
      x: pageWidth - margin,
      y
    },
    thickness: 0.5,
    color
  });
};
async function generatePDFReceipt(booking) {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([
    612,
    792
  ]); // US Letter
  const { width, height } = page.getSize();
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const margin = 50;
  const col2X = width - margin - 160;
  const navy = rgb(0, 0.2, 0.4);
  const gray = rgb(0.5, 0.5, 0.5);
  const lightGray = rgb(0.85, 0.85, 0.85);
  const black = rgb(0, 0, 0);
  const green = rgb(0, 0.5, 0.2);
  const red = rgb(0.7, 0, 0);
  let y = height - margin;
  const drawText = (text, x, yPos, { font = fontRegular, size = 10, color = black, align = 'left' } = {})=>{
    const textWidth = font.widthOfTextAtSize(text, size);
    const drawX = align === 'right' ? x - textWidth : x;
    page.drawText(text, {
      x: drawX,
      y: yPos,
      size,
      font,
      color
    });
    return textWidth;
  };
  // ── Header ──────────────────────────────────────────────────────────
  drawText('U-Fill Dumpsters', margin, y, {
    font: fontBold,
    size: 26,
    color: navy
  });
  drawText('RECEIPT', width - margin, y, {
    font: fontBold,
    size: 20,
    color: navy,
    align: 'right'
  });
  y -= 18;
  drawText('Saratoga Springs, UT  |  (801) 810-8832', margin, y, {
    size: 9,
    color: gray
  });
  drawText(`Receipt #: ${booking.id}`, width - margin, y, {
    size: 9,
    color: gray,
    align: 'right'
  });
  y -= 14;
  drawText('u-filldumpsters.com', margin, y, {
    size: 9,
    color: gray
  });
  drawText(`Date: ${formatDate(booking.created_at)}`, width - margin, y, {
    size: 9,
    color: gray,
    align: 'right'
  });
  y -= 14;
  const statusColor = booking.status === 'confirmed' ? green : booking.status?.includes('pending') ? red : gray;
  drawText(`Status: ${(booking.status || 'N/A').replace(/_/g, ' ').toUpperCase()}`, width - margin, y, {
    font: fontBold,
    size: 9,
    color: statusColor,
    align: 'right'
  });
  y -= 20;
  drawDivider(page, y, margin, width, navy);
  // ── Billed To ────────────────────────────────────────────────────────
  y -= 20;
  drawText('BILLED TO', margin, y, {
    font: fontBold,
    size: 9,
    color: gray
  });
  y -= 14;
  drawText(booking.customers?.name || 'N/A', margin, y, {
    font: fontBold,
    size: 11,
    color: black
  });
  y -= 14;
  drawText(booking.customers?.email || 'N/A', margin, y, {
    size: 10,
    color: black
  });
  y -= 14;
  drawText(booking.customers?.phone || 'N/A', margin, y, {
    size: 10,
    color: black
  });
  const street = booking.customers?.street || booking.street || '';
  const city = booking.customers?.city || booking.city || '';
  const state = booking.customers?.state || booking.state || '';
  const zip = booking.customers?.zip || booking.zip || '';
  if (street) {
    y -= 14;
    drawText(`${street}, ${city}, ${state} ${zip}`, margin, y, {
      size: 10,
      color: black
    });
  }
  // ── Service Details ───────────────────────────────────────────────────
  y -= 30;
  drawDivider(page, y, margin, width, lightGray);
  y -= 16;
  page.drawRectangle({
    x: margin,
    y: y - 4,
    width: width - margin * 2,
    height: 18,
    color: navy
  });
  drawText('SERVICE DETAILS', margin + 6, y, {
    font: fontBold,
    size: 9,
    color: rgb(1, 1, 1)
  });
  drawText('AMOUNT', width - margin, y, {
    font: fontBold,
    size: 9,
    color: rgb(1, 1, 1),
    align: 'right'
  });
  y -= 22;
  const serviceName = (formatCustomerFacingPlanName(booking.plan?.name) || 'Service') + (booking.addons?.isDelivery ? ' with Delivery' : '');
  const dropOff = formatDate(booking.drop_off_date);
  const pickup = formatDate(booking.pickup_date);
  const isDelivery = Boolean(booking.addons?.isDelivery || booking.addons?.deliveryService || Number(booking.plan?.id) === 1 || Number(booking.plan?.id) === 4);
  drawText(serviceName, margin, y, {
    font: fontBold,
    size: 10,
    color: black
  });
  drawText(formatCurrency(booking.plan?.price || 0), width - margin, y, {
    size: 10,
    align: 'right'
  });
  y -= 14;
  drawText(`Drop-off: ${dropOff}  (${formatSlot(booking.drop_off_time_slot, isDelivery)})`, margin + 10, y, {
    size: 9,
    color: gray
  });
  y -= 12;
  drawText(`Pick-up:  ${pickup}  (${formatSlot(booking.pickup_time_slot, isDelivery)})`, margin + 10, y, {
    size: 9,
    color: gray
  });
  const receiptHistory = Array.isArray(booking.receipt_status_history) ? booking.receipt_status_history : [];
  const rescheduleApproval = [
    ...receiptHistory
  ].reverse().find((e)=>e?.action === 'reschedule_approved');
  if (rescheduleApproval) {
    y -= 18;
    drawText('RESCHEDULE CONFIRMATION', margin, y, {
      font: fontBold,
      size: 9,
      color: navy
    });
    y -= 12;
    drawText(`Original total: ${formatCurrency(rescheduleApproval.original_total)}  →  New total: ${formatCurrency(rescheduleApproval.new_total)}`, margin + 10, y, {
      size: 9,
      color: gray
    });
    y -= 12;
    const stripeLine = rescheduleApproval.stripe_type === 'charge' ? `Card charged ${formatCurrency(rescheduleApproval.amount_processed ?? Math.abs(Number(rescheduleApproval.delta) || 0))}` : rescheduleApproval.stripe_type === 'refund' ? `Refunded ${formatCurrency(rescheduleApproval.amount_processed ?? Math.abs(Number(rescheduleApproval.delta) || 0))}` : 'No additional charge or refund';
    drawText(stripeLine, margin + 10, y, {
      size: 9,
      color: gray
    });
  }
  // ── Fees ──────────────────────────────────────────────────────────────
  const fees = [];
  if (booking.addons?.deliveryFee) fees.push({
    name: 'Delivery Fee',
    amount: booking.addons.deliveryFee
  });
  if (booking.addons?.fuelSurcharge) fees.push({
    name: 'Fuel Surcharge',
    amount: booking.addons.fuelSurcharge
  });
  if (booking.addons?.protectionPlan) fees.push({
    name: 'Damage Protection',
    amount: booking.addons.protectionPlan
  });
  for (const fee of fees){
    y -= 20;
    drawDivider(page, y + 8, margin, width, lightGray);
    drawText(fee.name, margin, y, {
      size: 10,
      color: black
    });
    drawText(formatCurrency(fee.amount), width - margin, y, {
      size: 10,
      align: 'right'
    });
  }
  // ── Coupon ────────────────────────────────────────────────────────────
  const coupon = booking.addons?.coupon;
  if (coupon?.isValid) {
    let discountAmount = 0;
    if (coupon.discountType === 'fixed') {
      discountAmount = coupon.discountValue;
    } else if (coupon.discountType === 'percentage') {
      discountAmount = (booking.plan?.price || 0) * (coupon.discountValue / 100);
    }
    y -= 20;
    drawDivider(page, y + 8, margin, width, lightGray);
    drawText(`Coupon (${coupon.code})`, margin, y, {
      size: 10,
      color: green
    });
    drawText(`-${formatCurrency(discountAmount)}`, width - margin, y, {
      size: 10,
      color: green,
      align: 'right'
    });
  }
  // ── Totals ────────────────────────────────────────────────────────────
  // Use stored tax fields persisted by PaymentPage before payment was taken.
  // Falls back to a back-calculation using the stored rate only when those fields are null.
  y -= 10;
  drawDivider(page, y, margin, width, navy);
  const storedTaxAmount = Number(booking.tax_amount ?? 0);
  const storedTaxRate = Number(booking.tax_rate_used ?? 7.45);
  const storedSubtotal = Number(booking.subtotal_before_tax ?? 0);
  const tax = storedTaxAmount > 0 ? storedTaxAmount : Math.round((booking.total_price || 0) / (1 + storedTaxRate / 100) * (storedTaxRate / 100) * 100) / 100;
  const subtotal = storedSubtotal > 0 ? storedSubtotal : (booking.total_price || 0) - tax;
  const taxRateDisplay = storedTaxRate.toFixed(2);
  y -= 18;
  drawText('Subtotal:', col2X, y, {
    size: 10,
    color: gray
  });
  drawText(formatCurrency(subtotal), width - margin, y, {
    size: 10,
    color: gray,
    align: 'right'
  });
  y -= 14;
  drawText(`Tax (${taxRateDisplay}%):`, col2X, y, {
    size: 10,
    color: gray
  });
  drawText(formatCurrency(tax), width - margin, y, {
    size: 10,
    color: gray,
    align: 'right'
  });
  y -= 18;
  drawDivider(page, y, col2X, width, lightGray);
  y -= 14;
  drawText('TOTAL PAID:', col2X, y, {
    font: fontBold,
    size: 12,
    color: navy
  });
  drawText(formatCurrency(resolveBookingGrandTotal(booking)), width - margin, y, {
    font: fontBold,
    size: 12,
    color: navy,
    align: 'right'
  });
  // ── Footer ────────────────────────────────────────────────────────────
  y -= 40;
  drawDivider(page, y, margin, width, lightGray);
  y -= 16;
  const thankText = 'Thank you for choosing U-Fill Dumpsters!';
  const thankWidth = fontBold.widthOfTextAtSize(thankText, 10);
  page.drawText(thankText, {
    x: (width - thankWidth) / 2,
    y,
    size: 10,
    font: fontBold,
    color: navy
  });
  y -= 14;
  const noteText = 'Questions? Call (801) 810-8832 or visit u-filldumpsters.com';
  const noteWidth = fontRegular.widthOfTextAtSize(noteText, 9);
  page.drawText(noteText, {
    x: (width - noteWidth) / 2,
    y,
    size: 9,
    font: fontRegular,
    color: gray
  });
  return await pdfDoc.save();
}
Deno.serve(async (req)=>{
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
  }
  try {
    const { bookingId } = await req.json();
    if (!bookingId) throw new Error('Booking ID is required.');
    const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
    const { data: booking, error: bookingError } = await supabaseAdmin.from('bookings').select('*, customers(*)').eq('id', bookingId).single();
    if (bookingError || !booking) throw new Error(bookingError?.message || 'Booking not found.');
    const { data: serviceData, error: serviceError } = await supabaseAdmin.from('services').select('*').eq('id', booking.plan?.id).single();
    if (serviceError || !serviceData) throw new Error(serviceError?.message || 'Service not found.');
    booking.plan.name = serviceData.name;
    const pdfBytes = await generatePDFReceipt(booking);
    // Safe Base64 encoding (chunked to avoid stack overflow on large PDFs)
    let binary = '';
    const chunkSize = 8192;
    for(let i = 0; i < pdfBytes.length; i += chunkSize){
      binary += String.fromCharCode(...pdfBytes.slice(i, i + chunkSize));
    }
    const pdfBase64 = btoa(binary);
    return new Response(JSON.stringify({
      pdf: pdfBase64
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Get Receipt PDF Error:', error);
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


// ============================
// Function: send-confirmation
// ============================

// --- File: send-confirmation/cors.ts ---

export { getCorsHeaders } from '../_shared/cors.ts';


// --- File: send-confirmation/index.ts ---

// send-confirmation/index.ts
// Update: remove the secondary receipt link; keep a single portal link or a single direct receipt link (if provided)
import { createClient } from 'npm:@supabase/supabase-js@2.45.1';
import { getCorsHeaders } from './cors.ts';
const BREVO_API_KEY = (Deno.env.get('BREVO_API_KEY') ?? '').trim();
const FROM_EMAIL = (Deno.env.get('BREVO_FROM_EMAIL') ?? '').trim();
// Optional URLs
const PORTAL_URL = (Deno.env.get('PORTAL_URL') ?? 'https://www.u-filldumpsters.com/login').trim();
const RECEIPT_URL = (Deno.env.get('RECEIPT_URL') ?? 'https://www.u-filldumpsters.com/receipt').trim();
const MAX_ATTACHMENT_BASE64_BYTES = 8 * 1024 * 1024; // 8MB
Deno.serve(async (req)=>{
  const corsHeaders = getCorsHeaders(req);
  const json = (obj, status = 200)=>new Response(JSON.stringify(obj), {
      status,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  try {
    if (req.method === 'OPTIONS') return new Response('ok', {
      headers: corsHeaders
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


// ============================
// Function: generate-receipt-pdf
// ============================

// --- File: generate-receipt-pdf/cors.ts ---

export { getCorsHeaders } from '../_shared/cors.ts';


// --- File: generate-receipt-pdf/index.ts ---

import { getCorsHeaders } from "./cors.ts";
// This function is now a simple pass-through. 
// The actual HTML generation and PDF conversion logic has been moved to 'get-receipt-pdf'
// to simplify the function chain and reduce potential points of failure.
// This function can be deprecated or repurposed later if needed.
Deno.serve(async (req)=>{
  const corsHeaders = getCorsHeaders(req);
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


// ============================
// Function: delete-booking
// ============================

// --- File: delete-booking/cors.ts ---

export { getCorsHeaders } from '../_shared/cors.ts';


// --- File: delete-booking/index.ts ---

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getCorsHeaders } from './cors.ts';
const ADMIN_DELETE_PASSWORD = Deno.env.get('ADMIN_DELETE_PASSWORD');
function getEquipmentHoldItems(booking) {
  const equipment = booking?.addons?.equipment;
  if (!Array.isArray(equipment) || equipment.length === 0) return [];
  return equipment.map((item)=>{
    const equipmentId = Number(item.dbId || item.equipment_id || item.id);
    const quantity = Number(item.quantity || 1);
    if (!Number.isFinite(equipmentId) || equipmentId <= 0) return null;
    if (!Number.isFinite(quantity) || quantity <= 0) return null;
    return {
      equipment_id: equipmentId,
      quantity
    };
  }).filter(Boolean);
}
function bookingHasActiveEquipmentHold(booking) {
  if (!booking) return false;
  const items = getEquipmentHoldItems(booking);
  if (items.length === 0) return false;
  if (booking.addons?.equipment_hold_active === false) return false;
  if (booking.addons?.equipment_hold_active === true) return true;
  return String(booking.status || '') === 'pending_payment';
}
function jsonError(corsHeaders, error, status) {
  return new Response(JSON.stringify({
    error
  }), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json'
    }
  });
}
async function requireAdminCaller(req, corsHeaders) {
  const authHeader = req.headers.get('Authorization') || '';
  if (!authHeader.startsWith('Bearer ')) {
    return {
      error: jsonError(corsHeaders, 'Admin authentication required.', 401)
    };
  }
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    return {
      error: jsonError(corsHeaders, 'Admin authentication required.', 401)
    };
  }
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const userClient = createClient(supabaseUrl, anonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${token}`
      }
    }
  });
  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) {
    return {
      error: jsonError(corsHeaders, 'Unauthorized. Please sign in again.', 401)
    };
  }
  if (user.app_metadata?.is_admin !== true) {
    return {
      error: jsonError(corsHeaders, 'Admin access required.', 403)
    };
  }
  return {
    user,
    token
  };
}
Deno.serve(async (req)=>{
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
  }
  try {
    const adminAuth = await requireAdminCaller(req, corsHeaders);
    if (adminAuth.error) return adminAuth.error;
    const { bookingId, password, verifyOnly } = await req.json();
    const configuredPassword = String(ADMIN_DELETE_PASSWORD || '').trim();
    if (configuredPassword) {
      if (password !== configuredPassword) {
        return jsonError(corsHeaders, 'Invalid password.', 401);
      }
    } else {
      // Local/dev fallback when ADMIN_DELETE_PASSWORD is not configured:
      // still require a non-empty confirmation password from the admin UI.
      console.warn('[delete-booking] ADMIN_DELETE_PASSWORD is not set — allowing delete for authenticated admin only.');
      if (!password || String(password).trim().length === 0) {
        return jsonError(corsHeaders, 'Confirmation password is required.', 401);
      }
    }
    // Password-only check for other admin permanent-delete actions (e.g. damage photos).
    if (verifyOnly === true) {
      return new Response(JSON.stringify({
        ok: true
      }), {
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
    // Restock unpaid checkout holds before deleting (e.g. abandoned pending_payment)
    const { data: booking, error: bookingFetchError } = await supabaseAdmin.from('bookings').select('id, status, addons').eq('id', bookingId).maybeSingle();
    if (bookingFetchError) {
      console.error('[delete-booking] Failed to load booking before delete:', bookingFetchError);
    } else if (!booking) {
      return jsonError(corsHeaders, `Booking #${bookingId} was not found.`, 404);
    } else if (bookingHasActiveEquipmentHold(booking)) {
      const items = getEquipmentHoldItems(booking);
      if (items.length > 0) {
        const { error: restockError } = await supabaseAdmin.rpc('increment_equipment_quantities', {
          items_to_increment: items
        });
        if (restockError) {
          console.error('[delete-booking] Equipment restock failed:', restockError);
          throw new Error(`Could not restock equipment before delete: ${restockError.message}`);
        }
        console.log('[delete-booking] Restocked equipment hold for booking', bookingId, items);
      }
    }
    // Clear relationships that can block hard deletes
    await supabaseAdmin.from('pending_customers').update({
      booking_id: null
    }).eq('booking_id', bookingId);
    await supabaseAdmin.from('abandoned_checkouts').delete().eq('booking_id', bookingId);
    await supabaseAdmin.from('feedback_tokens').delete().eq('booking_id', bookingId);
    await supabaseAdmin.from('unsubscribe_tokens').delete().eq('booking_id', bookingId);
    // Clear self-referential reschedule links (no ON DELETE action)
    await supabaseAdmin.from('bookings').update({
      rescheduled_to_booking_id: null
    }).eq('rescheduled_to_booking_id', bookingId);
    await supabaseAdmin.from('bookings').update({
      rescheduled_from_booking_id: null
    }).eq('rescheduled_from_booking_id', bookingId);
    await supabaseAdmin.from('booking_equipment').delete().eq('booking_id', bookingId);
    await supabaseAdmin.from('stripe_payment_info').delete().eq('booking_id', bookingId);
    await supabaseAdmin.from('customer_notes').delete().eq('booking_id', bookingId);
    const { error } = await supabaseAdmin.from('bookings').delete().eq('id', bookingId);
    if (error) {
      throw error;
    }
    console.log(`[delete-booking] Deleted booking #${bookingId} by admin ${adminAuth.user.email || adminAuth.user.id}`);
    return new Response(JSON.stringify({
      message: 'Booking successfully deleted.'
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Delete Booking Error:', error);
    return jsonError(corsHeaders, error?.message || 'Failed to delete booking.', 500);
  }
});


// ============================
// Function: send-verification-email
// ============================

// --- File: send-verification-email/cors.ts ---

const ALLOWED_HEADERS = 'authorization, x-client-info, apikey, content-type';
const ALLOWED_METHODS = 'GET, POST, PUT, PATCH, DELETE, OPTIONS';
function parseAllowedOrigins() {
  const raw = Deno.env.get('ALLOWED_ORIGINS') ?? '';
  return new Set(raw.split(',').map((origin)=>origin.trim()).filter(Boolean));
}
let cachedOrigins = null;
function getAllowedOrigins() {
  if (!cachedOrigins) {
    cachedOrigins = parseAllowedOrigins();
  }
  return cachedOrigins;
}
/** Origin-aware CORS headers. Set ALLOWED_ORIGINS (comma-separated) in env. */ export function getCorsHeaders(req) {
  const headers = {
    'Access-Control-Allow-Headers': ALLOWED_HEADERS,
    'Access-Control-Allow-Methods': ALLOWED_METHODS
  };
  const origin = req.headers.get('Origin');
  if (origin && getAllowedOrigins().has(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Vary'] = 'Origin';
  }
  return headers;
}


// --- File: send-verification-email/index.ts ---

import { getCorsHeaders } from "./cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
const BREVO_API_KEY = Deno.env.get("BREVO_API_KEY");
const BREVO_FROM_EMAIL = Deno.env.get("BREVO_FROM_EMAIL") || "noreply@u-filldumpsters.com";
const DEFAULT_SITE_URL = "https://u-filldumpsters.com";
/** Checkout codes hold a date/time slot, so they expire quickly. */ const CHECKOUT_CODE_TTL_MS = 15 * 60 * 1000;
const DEFAULT_CODE_TTL_MS = 24 * 60 * 60 * 1000;
function normalizeSiteUrl(url) {
  const fallback = Deno.env.get("SITE_URL") || DEFAULT_SITE_URL;
  const candidate = url && url.trim().length > 0 ? url : fallback;
  try {
    const parsed = new URL(candidate);
    return `${parsed.origin}`.replace(/\/$/, "");
  } catch  {
    return DEFAULT_SITE_URL;
  }
}
Deno.serve(async (req)=>{
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  try {
    const { email, name, pending_customer_id, token, site_url, purpose } = await req.json();
    if (!email) {
      return new Response(JSON.stringify({
        error: "Email is required"
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    if (!BREVO_API_KEY || BREVO_API_KEY.trim().length === 0) {
      console.error("[send-verification-email] Missing BREVO_API_KEY");
      return new Response(JSON.stringify({
        error: "Email service is not configured. Please contact support."
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    if (!BREVO_FROM_EMAIL || BREVO_FROM_EMAIL.trim().length === 0) {
      console.error("[send-verification-email] Missing BREVO_FROM_EMAIL");
      return new Response(JSON.stringify({
        error: "Sender email is not configured. Please contact support."
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    // Initialize Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const supabase = createClient(supabaseUrl, supabaseKey);
    // Generate 6-digit verification code
    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
    const pendingToken = String(pending_customer_id ?? token ?? "").trim();
    const normalizedPurpose = String(purpose || "").trim().toLowerCase();
    const isCheckoutVerification = Boolean(pendingToken) || normalizedPurpose === "checkout";
    // Checkout codes hold the customer's date/time, so that window stays short.
    const expiresAt = new Date(Date.now() + (isCheckoutVerification ? CHECKOUT_CODE_TTL_MS : DEFAULT_CODE_TTL_MS));
    const emailLowerForStore = email.toLowerCase();
    console.log("[send-verification-email] Generating code for:", email);
    // Preserve prior verification so checkout save still works if a new code is resent
    const { data: existingVerification } = await supabase.from("email_verifications").select("is_verified").eq("email", emailLowerForStore).maybeSingle();
    const { error: dbError } = await supabase.from("email_verifications").upsert({
      email: emailLowerForStore,
      verification_code: verificationCode,
      code_expires_at: expiresAt.toISOString(),
      is_verified: Boolean(existingVerification?.is_verified),
      attempts: 0,
      created_at: new Date().toISOString()
    }, {
      onConflict: "email"
    });
    if (dbError) {
      console.error("[send-verification-email] Database error:", dbError);
      throw new Error("Failed to store verification code");
    }
    const siteUrl = normalizeSiteUrl(site_url);
    const emailLower = email.toLowerCase();
    // checkout (pending booking) → /verify-email
    // portal (forgot login) → /customer-login recovery
    // returning (default when no pending token) → homepage returning-customer flow
    let verifyPath;
    if (isCheckoutVerification) {
      const tokenQuery = pendingToken ? `token=${encodeURIComponent(pendingToken)}&` : "";
      verifyPath = `/verify-email?${tokenQuery}code=${encodeURIComponent(verificationCode)}`;
    } else if (normalizedPurpose === "portal") {
      verifyPath = `/customer-login?code=${encodeURIComponent(verificationCode)}&email=${encodeURIComponent(emailLower)}&recover=1`;
    } else {
      verifyPath = `/?email=${encodeURIComponent(emailLower)}&code=${encodeURIComponent(verificationCode)}&flow=returning`;
    }
    const verifyLink = `${siteUrl}${verifyPath}`;
    console.log("[send-verification-email] Verification link:", verifyLink, "purpose:", normalizedPurpose || (pendingToken ? "checkout" : "returning"));
    // Send email via Brevo
    const emailHtml = generateEmailTemplate(verificationCode, verifyLink, name || "Customer", siteUrl, isCheckoutVerification);
    const brevoResponse = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": BREVO_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        sender: {
          name: "U-Fill Dumpsters",
          email: BREVO_FROM_EMAIL
        },
        to: [
          {
            email,
            name: name || "Customer"
          }
        ],
        subject: "Verify Your Email - U-Fill Dumpsters",
        htmlContent: emailHtml
      })
    });
    if (!brevoResponse.ok) {
      const errorText = await brevoResponse.text();
      console.error("[send-verification-email] Brevo error:", errorText);
      throw new Error("Failed to send verification email");
    }
    console.log("[send-verification-email] ✓ Email sent successfully to:", email);
    return new Response(JSON.stringify({
      success: true,
      message: "Verification email sent successfully",
      expiresAt: expiresAt.toISOString()
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  } catch (error) {
    console.error("[send-verification-email] Error:", error);
    return new Response(JSON.stringify({
      error: error.message || "Failed to send verification email"
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
});
function generateEmailTemplate(code, verifyLink, name, siteUrl = DEFAULT_SITE_URL, isCheckoutVerification = false) {
  const currentYear = new Date().getFullYear();
  const expiryNotice = isCheckoutVerification ? `This verification code and link expire in 15 minutes. While you verify, we hold your
       selected date and time so that no one else can book it. Keeping that hold short prevents the
       same slot from being double-booked and gives other customers who are waiting a fair chance at
       it. If your code expires, you are welcome to start a new booking at any time.` : "This verification code and link will expire in 24 hours for your security.";
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Verify Your Email Address</title>
      <!--[if mso]>
      <style type="text/css">
        body, table, td {font-family: Arial, Helvetica, sans-serif !important;}
      </style>
      <![endif]-->
      <style>
        body {
          font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
          background-color: #f3f4f6;
          margin: 0;
          padding: 0;
          -webkit-font-smoothing: antialiased;
        }
        .container {
          max-width: 600px;
          margin: 40px auto;
          background-color: #ffffff;
          border-radius: 12px;
          overflow: hidden;
          box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
        }
        .header {
          background-color: #1e3a8a;
          padding: 35px 20px;
          text-align: center;
        }
        .header h1 {
          color: #ffffff;
          margin: 0;
          font-size: 28px;
          font-weight: 700;
          letter-spacing: 0.5px;
        }
        .header p {
          color: #bfdbfe;
          margin: 10px 0 0;
          font-size: 16px;
        }
        .content {
          padding: 40px 30px;
          color: #374151;
          line-height: 1.6;
        }
        .content h2 {
          color: #111827;
          font-size: 22px;
          margin-top: 0;
          margin-bottom: 20px;
        }
        .content p {
          font-size: 16px;
          margin-bottom: 20px;
        }
        .code-container {
          background-color: #f8fafc;
          border: 2px dashed #94a3b8;
          border-radius: 8px;
          padding: 25px;
          text-align: center;
          margin: 35px 0;
        }
        .code-container .code {
          font-size: 42px;
          font-weight: 800;
          color: #1e3a8a;
          letter-spacing: 6px;
          margin: 0;
        }
        .code-container .label {
          font-size: 14px;
          color: #64748b;
          text-transform: uppercase;
          letter-spacing: 1px;
          margin-bottom: 10px;
        }
        .btn-container {
          text-align: center;
          margin: 35px 0;
        }
        .btn {
          display: inline-block;
          background-color: #2563eb;
          color: #ffffff !important;
          text-decoration: none;
          padding: 16px 36px;
          border-radius: 8px;
          font-size: 18px;
          font-weight: 600;
          box-shadow: 0 4px 6px -1px rgba(37, 99, 235, 0.3);
        }
        .notice {
          background-color: #fffbeb;
          border-left: 4px solid #f59e0b;
          padding: 15px;
          border-radius: 4px;
          font-size: 14px;
          color: #92400e;
          margin-top: 30px;
        }
        .footer {
          background-color: #f8fafc;
          padding: 25px 30px;
          text-align: center;
          border-top: 1px solid #e2e8f0;
        }
        .footer p {
          color: #64748b;
          font-size: 13px;
          margin: 5px 0;
        }
        .footer a {
          color: #3b82f6;
          text-decoration: none;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>U-Fill Dumpsters</h1>
          <p>Reliable Waste Solutions</p>
        </div>
        
        <div class="content">
          <h2>Verify Your Email Address</h2>
          <p>Hello ${name},</p>
          <p>Thank you for booking with U-Fill Dumpsters. To complete your booking and receive your access PIN, please verify your email address using the code or button below.</p>
          
          <div class="code-container">
            <div class="label">Your Verification Code</div>
            <div class="code">${code}</div>
          </div>
          
          <p style="text-align: center; font-weight: 600; color: #475569;">Or verify instantly by clicking the button below:</p>
          
          <div class="btn-container">
            <a href="${verifyLink}" class="btn">Verify Email Address</a>
          </div>
          
          <div class="notice">
            <strong>Note:</strong> ${expiryNotice}
          </div>
        </div>
        
        <div class="footer">
          <p>&copy; ${currentYear} U-Fill Dumpsters LLC. All rights reserved.</p>
          <p>If you did not request this verification, you can safely ignore this email.</p>
          <p><a href="${siteUrl}/contact">Contact Support</a> | <a href="${siteUrl}/faqs">FAQ</a></p>
        </div>
      </div>
    </body>
    </html>
  `;
}


// ============================
// Function: verify-email-code
// ============================

// --- File: verify-email-code/cors.ts ---

export { getCorsHeaders } from '../_shared/cors.ts';


// --- File: verify-email-code/index.ts ---

import { getCorsHeaders } from "./cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
const jsonResponse = (corsHeaders, body, status)=>new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
Deno.serve(async (req)=>{
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  try {
    const { email, code, pending_customer_id } = await req.json();
    if (!email || typeof email !== "string") {
      return jsonResponse(corsHeaders, {
        success: false,
        error: "Email is required"
      }, 400);
    }
    if (!code || typeof code !== "string") {
      return jsonResponse(corsHeaders, {
        success: false,
        error: "Verification code is required"
      }, 400);
    }
    const emailLower = email.trim().toLowerCase();
    const trimmedCode = code.trim();
    if (!emailLower.includes("@")) {
      return jsonResponse(corsHeaders, {
        success: false,
        error: "Invalid email address"
      }, 400);
    }
    if (!/^\d{6}$/.test(trimmedCode)) {
      return jsonResponse(corsHeaders, {
        success: false,
        error: "Invalid code format. Enter the 6-digit code from your email."
      }, 400);
    }
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseKey) {
      console.error("[verify-email-code] Missing Supabase configuration");
      return jsonResponse(corsHeaders, {
        success: false,
        error: "Server configuration error"
      }, 500);
    }
    const supabase = createClient(supabaseUrl, supabaseKey);
    console.log("[verify-email-code] Verifying:", {
      email: emailLower,
      code: trimmedCode
    });
    const { data: verification, error: fetchError } = await supabase.from("email_verifications").select("email, verification_code, code_expires_at, is_verified").eq("email", emailLower).eq("verification_code", trimmedCode).maybeSingle();
    if (fetchError) {
      console.error("[verify-email-code] Database query error:", fetchError);
      return jsonResponse(corsHeaders, {
        success: false,
        error: "Verification failed. Please try again."
      }, 500);
    }
    if (!verification) {
      console.warn("[verify-email-code] No matching record for email + code");
      return jsonResponse(corsHeaders, {
        success: false,
        error: "Invalid verification code"
      }, 400);
    }
    const expiresAt = new Date(verification.code_expires_at);
    const now = new Date();
    if (now > expiresAt) {
      console.warn("[verify-email-code] Code expired:", {
        email: emailLower,
        expiresAt
      });
      return jsonResponse(corsHeaders, {
        success: false,
        error: "Verification code has expired. Please request a new one."
      }, 400);
    }
    if (!verification.is_verified) {
      const { error: updateError } = await supabase.from("email_verifications").update({
        is_verified: true
      }).eq("email", emailLower).eq("verification_code", trimmedCode);
      if (updateError) {
        console.error("[verify-email-code] Update error:", updateError);
        return jsonResponse(corsHeaders, {
          success: false,
          error: "Failed to mark email as verified"
        }, 500);
      }
    } else {
      console.log("[verify-email-code] Already verified, reusing valid code for:", emailLower);
    }
    if (pending_customer_id) {
      const { error: pendingError } = await supabase.from("pending_customers").update({
        is_verified: true,
        verified_at: new Date().toISOString()
      }).eq("id", pending_customer_id);
      if (pendingError) {
        console.error("[verify-email-code] pending_customers update error:", pendingError);
      }
    }
    const { data: bookings, error: bookingsError } = await supabase.from("bookings").select("*").ilike("email", emailLower).order("created_at", {
      ascending: false
    }).limit(5);
    if (bookingsError) {
      console.error("[verify-email-code] bookings fetch error:", bookingsError);
    }
    let customer = null;
    const { data: customersByEmail, error: customerError } = await supabase.from("customers").select("*").ilike("email", emailLower).limit(1);
    if (customerError) {
      console.error("[verify-email-code] customer fetch error:", customerError);
    } else if (customersByEmail?.[0]) {
      customer = customersByEmail[0];
    }
    if (!customer) {
      const bookingCustomerId = bookings?.find((b)=>b.customer_id)?.customer_id;
      if (bookingCustomerId) {
        const { data: customerByBooking, error: bookingCustomerError } = await supabase.from("customers").select("*").eq("id", bookingCustomerId).maybeSingle();
        if (bookingCustomerError) {
          console.error("[verify-email-code] customer by booking id error:", bookingCustomerError);
        } else if (customerByBooking) {
          customer = customerByBooking;
        }
      }
    }
    console.log("[verify-email-code] ✓ Verified:", emailLower, "customer_id_text:", customer?.customer_id_text ?? null, "booking_id:", bookings?.[0]?.id ?? null);
    return jsonResponse(corsHeaders, {
      success: true,
      message: verification.is_verified ? "Email already verified" : "Email verified successfully",
      booking_id: bookings?.[0]?.id ?? null,
      email: emailLower,
      customer: customer ?? null,
      bookings: bookings ?? [],
      ...pending_customer_id ? {
        pending_customer_id
      } : {}
    }, 200);
  } catch (error) {
    console.error("[verify-email-code] Error:", error);
    return jsonResponse(corsHeaders, {
      success: false,
      error: error instanceof Error ? error.message : "Verification failed"
    }, 500);
  }
});


// ============================
// Function: calculate-distance-and-travel-time
// ============================

// --- File: calculate-distance-and-travel-time/cors.ts ---

export { getCorsHeaders } from '../_shared/cors.ts';


// --- File: calculate-distance-and-travel-time/index.ts ---

import { getCorsHeaders } from "./cors.ts";
Deno.serve(async (req)=>{
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
  }
  try {
    const body = await req.json();
    console.log("[Distance API] Received request body floppy:", body);
    const { customerAddress, businessLat, businessLng } = body;
    if (!customerAddress || typeof customerAddress !== 'string') {
      console.error("[Distance API] Missing or invalid customerAddress");
      throw new Error('customerAddress is required and must be a string');
    }
    const apiKey = Deno.env.get('GOOGLE_MAPS_API_KEY');
    if (!apiKey) {
      console.error("[Distance API] GOOGLE_MAPS_API_KEY secret is missing");
      throw new Error('Server configuration error: Google Maps API key is missing');
    }
    // Default coordinates if not provided (e.g., U-Fill Dumpsters default location)
    // Validating latitude (-90 to 90) and longitude (-180 to 180)
    let lat = 28.6122;
    let lng = -80.8075;
    if (businessLat !== undefined && !isNaN(businessLat) && businessLat >= -90 && businessLat <= 90) {
      lat = businessLat;
    }
    if (businessLng !== undefined && !isNaN(businessLng) && businessLng >= -180 && businessLng <= 180) {
      lng = businessLng;
    }
    const origin = `${lat},${lng}`;
    const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${origin}&destinations=${encodeURIComponent(customerAddress)}&units=imperial&key=${apiKey}`;
    console.log(`[Distance API] Fetching distance from origin: ${origin} to destination: ${customerAddress}`);
    const res = await fetch(url);
    const data = await res.json();
    console.log(`[Distance API] Google Maps Response Status:`, data.status);
    if (data.status !== 'OK') {
      const errorMsg = data.error_message ? ` - ${data.error_message}` : '';
      console.error(`[Distance API] API Error: ${data.status}${errorMsg}`);
      throw new Error(`Google Maps API error: ${data.status}${errorMsg}`);
    }
    if (!data.rows || !data.rows[0] || !data.rows[0].elements || !data.rows[0].elements[0]) {
      console.error("[Distance API] Unexpected API response structure:", data);
      throw new Error("Unexpected response from Google Maps");
    }
    const element = data.rows[0].elements[0];
    if (element.status !== 'OK') {
      console.error(`[Distance API] Element Status Error: ${element.status}`);
      throw new Error(`Cannot calculate route to this address: ${element.status}`);
    }
    // distance.value is in meters, duration.value is in seconds
    const distanceMiles = parseFloat((element.distance.value / 1609.34).toFixed(1));
    const travelTimeMinutes = Math.round(element.duration.value / 60);
    console.log(`[Distance API] Calculation Success - Distance: ${distanceMiles}mi, Time: ${travelTimeMinutes}min`);
    return new Response(JSON.stringify({
      distance: distanceMiles,
      travelTime: travelTimeMinutes
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 200
    });
  } catch (error) {
    console.error("[Distance API] Unhandled Exception:", error.message);
    return new Response(JSON.stringify({
      error: error.message || 'An unknown error occurred during calculation'
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 400
    });
  }
});


// ============================
// Function: confirm-payment
// ============================

// --- File: confirm-payment/cors.ts ---

export { getCorsHeaders } from '../_shared/cors.ts';


// --- File: confirm-payment/index.ts ---

import { getCorsHeaders } from "./cors.ts";
import Stripe from "https://esm.sh/stripe@14.14.0?target=deno";
Deno.serve(async (req)=>{
  const corsHeaders = getCorsHeaders(req);
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


// ============================
// Function: resend-confirmation-email
// ============================

// --- File: resend-confirmation-email/cors.ts ---

export { getCorsHeaders } from '../_shared/cors.ts';


// --- File: resend-confirmation-email/index.ts ---

import { getCorsHeaders } from "./cors.ts";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
Deno.serve(async (req)=>{
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [resend-confirmation-email] Function entry`);
  try {
    const body = await req.json();
    const booking_id = body.booking_id ?? body.bookingId;
    const site_url = body.site_url;
    console.log(`[${timestamp}] [resend-confirmation-email] Booking ID: ${booking_id}`);
    if (!booking_id) {
      console.error(`[${timestamp}] [resend-confirmation-email] ERROR: Missing booking_id`);
      return new Response(JSON.stringify({
        error: "booking_id is required"
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    // Call send-booking-confirmation function
    console.log(`[${timestamp}] [resend-confirmation-email] Calling send-booking-confirmation`);
    const response = await fetch(`${SUPABASE_URL}/functions/v1/send-booking-confirmation`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
      },
      body: JSON.stringify({
        bookingId: booking_id,
        site_url,
        force: true
      })
    });
    const result = await response.json();
    if (response.ok && result.success) {
      console.log(`[${timestamp}] [resend-confirmation-email] SUCCESS: Email resent successfully`);
      return new Response(JSON.stringify({
        success: true,
        message: result.message || "Confirmation email resent successfully",
        recipient: result.recipient,
        email_type: result.email_type || result.emailType || "confirmation"
      }), {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    } else {
      console.error(`[${timestamp}] [resend-confirmation-email] FAILED:`, result);
      return new Response(JSON.stringify({
        success: false,
        error: result.error || "Failed to resend confirmation email",
        details: result.details
      }), {
        status: response.status,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
  } catch (error) {
    const timestamp = new Date().toISOString();
    console.error(`[${timestamp}] [resend-confirmation-email] CRITICAL ERROR:`, error);
    return new Response(JSON.stringify({
      error: "Internal server error",
      details: error.message
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
});


// ============================
// Function: send-booking-confirmation
// ============================

// --- File: send-booking-confirmation/cors.ts ---

export { getCorsHeaders } from '../_shared/cors.ts';


// --- File: send-booking-confirmation/index.ts ---

import { getCorsHeaders } from "./cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { resolveBookingGrandTotal } from "../_shared/resolveBookingGrandTotal.ts";
import { formatBookingTime, formatPlainBookingTime, formatDeliveryTimeWindowBetween } from "../_shared/formatBookingTime.ts";
import { parseBookingTimeSlot, businessWallTimeToUtc } from "../_shared/parseBookingTimeSlot.ts";
import { normalizeSiteUrl } from "../_shared/normalizeSiteUrl.ts";
import { sendSms } from "../_shared/notify.ts";
import { formatCustomerFacingPlanName } from "../_shared/displayPlanName.ts";
import { isDeliveryBooking } from "../_shared/deliveryBooking.ts";
const VERIFICATION_LEAD_HOURS = 12;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const BREVO_API_KEY = Deno.env.get("BREVO_API_KEY");
const BREVO_FROM_EMAIL = Deno.env.get("BREVO_FROM_EMAIL") || "noreply@u-filldumpsters.com";
const formatCurrency = (amount)=>{
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD"
  }).format(amount);
};
const formatDate = (dateString)=>{
  if (!dateString) return "N/A";
  try {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric"
    });
  } catch  {
    return dateString;
  }
};
const EQUIPMENT_LABELS = {
  wheelbarrow: "Wheelbarrow",
  handTruck: "Hand Truck",
  gloves: "Working Gloves (Pair)",
  "1": "Wheelbarrow",
  "2": "Hand Truck",
  "3": "Working Gloves (Pair)"
};
const resolveEquipmentLabel = (item)=>{
  if (item.label) return item.label;
  if (item.name) return item.name;
  const bySlug = item.id != null ? EQUIPMENT_LABELS[String(item.id)] : undefined;
  if (bySlug) return bySlug;
  const byDb = item.dbId != null ? EQUIPMENT_LABELS[String(item.dbId)] : undefined;
  if (byDb) return byDb;
  return "Equipment";
};
/** Gloves and other buy-once add-ons (not inventory-returned). */ const isPurchaseEquipmentItem = (item)=>{
  if (String(item.type || "").toLowerCase() === "purchase") return true;
  if (String(item.id || "").toLowerCase() === "gloves") return true;
  const numericId = Number(item.dbId ?? item.equipment_id ?? item.id);
  return Number.isFinite(numericId) && numericId === 3;
};
/** Dump Loader customer pickup (plan 2, no delivery) — matches src/utils/customerPickupService.js */ const CUSTOMER_PICKUP_PLAN_IDS = [
  2
];
const parseJsonField = (value)=>{
  if (value == null) return {};
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch  {
      return {};
    }
  }
  if (typeof value === "object") return value;
  return {};
};
const normalizeBookingJsonFields = (booking)=>{
  booking.plan = parseJsonField(booking.plan);
  booking.addons = parseJsonField(booking.addons);
  return booking;
};
const isTrailerSelfService = (booking)=>{
  if (isDeliveryBooking(booking)) return false;
  const plan = booking.plan || {};
  if (booking.delivery_type === "self_service_trailer" || booking.delivery_type === "self_pickup") {
    return true;
  }
  return CUSTOMER_PICKUP_PLAN_IDS.includes(Number(plan.id));
};
const CONFIRMED_STATUSES = new Set([
  "Confirmed",
  "confirmed",
  "Completed",
  "completed",
  "Cancelled",
  "cancelled"
]);
const resolveActionRequiredKind = (booking)=>{
  const status = String(booking.status || "");
  if (status === "pending_verification") return "pending_verification";
  if (status === "pending_review") return "pending_review";
  const skipped = Boolean(booking.was_verification_skipped || booking.addons?.verificationSkipped || booking.addons?.wasVerificationSkipped);
  if (skipped && !CONFIRMED_STATUSES.has(status)) return "pending_verification";
  return null;
};
const getVerificationDeadlineInfo = (booking)=>{
  const dateStr = booking.drop_off_date ? String(booking.drop_off_date) : "";
  if (!dateStr) {
    return {
      hoursRemaining: null,
      isPastDeadline: false
    };
  }
  const window = parseBookingTimeSlot(booking.drop_off_time_slot, 0);
  const start = window?.start || {
    hour: 8,
    minute: 0,
    second: 0
  };
  const appointmentAt = businessWallTimeToUtc(dateStr, start);
  if (!appointmentAt) {
    return {
      hoursRemaining: null,
      isPastDeadline: false
    };
  }
  const deadlineAt = new Date(appointmentAt.getTime() - VERIFICATION_LEAD_HOURS * 60 * 60 * 1000);
  const now = Date.now();
  const isPastDeadline = now >= deadlineAt.getTime();
  if (isPastDeadline) {
    return {
      hoursRemaining: 0,
      isPastDeadline: true
    };
  }
  const hoursRemaining = Math.max(1, Math.ceil((deadlineAt.getTime() - now) / (1000 * 60 * 60)));
  return {
    hoursRemaining,
    isPastDeadline: false
  };
};
/** Merge service row into booking.plan when JSON snapshot is missing fields. */ const hydrateBookingPlanFromService = async (supabase, booking)=>{
  const planId = booking.plan?.id ?? booking.plan?.service_id;
  if (!planId) return booking;
  const { data: service } = await supabase.from("services").select("id, name, description, service_type, base_price").eq("id", planId).maybeSingle();
  if (!service) return booking;
  booking.plan = {
    ...booking.plan,
    id: booking.plan?.id ?? service.id,
    name: booking.plan?.name ?? service.name,
    description: booking.plan?.description ?? service.description,
    service_type: booking.plan?.service_type ?? service.service_type,
    base_price: booking.plan?.base_price ?? service.base_price
  };
  return booking;
};
const DEFAULT_INSURANCE_PRICE = 25;
const resolveInsuranceAmount = (addons, fallbackPrice = DEFAULT_INSURANCE_PRICE)=>{
  if (addons?.insurance !== "accept") return 0;
  const snap = Number(addons.insurancePriceApplied);
  if (snap > 0) return snap;
  return Number(fallbackPrice) || DEFAULT_INSURANCE_PRICE;
};
const buildPriceSummaryHTML = (booking, insuranceAmount)=>{
  const plan = booking.plan || {};
  const addons = booking.addons || {};
  const offersDrivewayProtection = Number(plan?.id) === 1;
  const basePrice = Number(plan.price ?? plan.base_price ?? 0);
  const subtotal = Number(booking.subtotal_before_tax ?? 0);
  const tax = Number(booking.tax_amount ?? 0);
  const total = resolveBookingGrandTotal(booking);
  const taxRate = Number(booking.tax_rate_used ?? 7.45);
  const loyaltyDiscountAmount = Number(addons?.loyaltyDiscountAmount ?? 0);
  const referralDiscountAmount = Number(addons?.referralDiscountAmount ?? 0);
  const couponDiscountAmount = Number(addons?.coupon?.discountAmount ?? addons?.couponDiscountAmount ?? 0);
  const couponCode = addons?.coupon?.code || null;
  const totalRewardsDiscount = Math.max(0, loyaltyDiscountAmount + referralDiscountAmount + couponDiscountAmount);
  const snapshot = Array.isArray(addons.taxLineItemsSnapshot) ? addons.taxLineItemsSnapshot : [];
  let rows = "";
  if (snapshot.length > 0) {
    for (const line of snapshot){
      const amount = Number(line.amountAfterDiscount ?? line.amount ?? 0);
      if (amount <= 0) continue;
      const label = line.label || line.key || "Charge";
      if (!offersDrivewayProtection && /driveway/i.test(String(label))) continue;
      rows += `<tr>
      <td style="padding: 6px 0; color: #4b5563;">${label}</td>
      <td style="padding: 6px 0; color: #1f2937; text-align: right;">${formatCurrency(amount)}</td>
    </tr>`;
    }
  } else {
    if (basePrice > 0) {
      rows += `<tr>
      <td style="padding: 6px 0; color: #4b5563;">Base Rental</td>
      <td style="padding: 6px 0; color: #1f2937; text-align: right;">${formatCurrency(basePrice)}</td>
    </tr>`;
    }
    if (insuranceAmount > 0) {
      rows += `<tr>
      <td style="padding: 6px 0; color: #4b5563;">Rental Insurance</td>
      <td style="padding: 6px 0; color: #1f2937; text-align: right;">${formatCurrency(insuranceAmount)}</td>
    </tr>`;
    }
    if (offersDrivewayProtection && addons.drivewayProtection === "accept") {
      const drivewayAmt = Number(addons.drivewayPriceApplied ?? 0);
      if (drivewayAmt > 0) {
        rows += `<tr>
      <td style="padding: 6px 0; color: #4b5563;">Driveway Protection</td>
      <td style="padding: 6px 0; color: #1f2937; text-align: right;">${formatCurrency(drivewayAmt)}</td>
    </tr>`;
      }
    }
    if (addons.deliveryFee > 0) {
      rows += `<tr>
      <td style="padding: 6px 0; color: #4b5563;">Delivery Fee</td>
      <td style="padding: 6px 0; color: #1f2937; text-align: right;">${formatCurrency(addons.deliveryFee)}</td>
    </tr>`;
    }
    const mileageFee = addons.distanceInfo?.mileageFee ?? addons.mileageCharge ?? 0;
    if (mileageFee > 0) {
      rows += `<tr>
      <td style="padding: 6px 0; color: #4b5563;">Mileage Charge</td>
      <td style="padding: 6px 0; color: #1f2937; text-align: right;">${formatCurrency(mileageFee)}</td>
    </tr>`;
    }
    if (addons.equipment && Array.isArray(addons.equipment)) {
      for (const item of addons.equipment){
        const dbId = item.dbId ?? item.equipment_id;
        const unitPrice = Number(item.price ?? item.unitPrice ?? 0);
        const qty = Number(item.quantity || 1);
        const amount = unitPrice > 0 ? unitPrice * qty : 0;
        if (amount <= 0) continue;
        rows += `<tr>
      <td style="padding: 6px 0; color: #4b5563;">${resolveEquipmentLabel(item)}</td>
      <td style="padding: 6px 0; color: #1f2937; text-align: right;">${formatCurrency(amount)}</td>
    </tr>`;
      }
    }
  }
  if (couponDiscountAmount > 0) {
    rows += `<tr>
      <td style="padding: 6px 0; color: #047857;">Coupon Discount${couponCode ? ` (${couponCode})` : ""}</td>
      <td style="padding: 6px 0; color: #047857; text-align: right;">-${formatCurrency(couponDiscountAmount)}</td>
    </tr>`;
  }
  if (loyaltyDiscountAmount > 0) {
    rows += `<tr>
      <td style="padding: 6px 0; color: #047857;">Loyalty Points Discount (${Number(addons?.loyaltyPointsToRedeem || 0)} pts)</td>
      <td style="padding: 6px 0; color: #047857; text-align: right;">-${formatCurrency(loyaltyDiscountAmount)}</td>
    </tr>`;
  }
  if (referralDiscountAmount > 0) {
    rows += `<tr>
      <td style="padding: 6px 0; color: #047857;">Referral Wallet Discount</td>
      <td style="padding: 6px 0; color: #047857; text-align: right;">-${formatCurrency(referralDiscountAmount)}</td>
    </tr>`;
  }
  const thankYouRewardsHTML = totalRewardsDiscount > 0 ? `
    <div style="margin-top: 12px; padding: 10px 12px; background: #ecfdf5; border: 1px solid #86efac; border-radius: 8px; color: #065f46; font-size: 13px;">
      Thank you for your loyalty and continued business. Your rewards discount has been applied to this booking.
    </div>
  ` : "";
  return `
      <div style="margin-top: 25px;">
        <h2 style="color: #1f2937; font-size: 20px; margin-bottom: 15px; border-bottom: 2px solid #3b82f6; padding-bottom: 10px;">Price Summary</h2>
        <table style="width: 100%; border-collapse: collapse;">
          ${rows}
          <tr style="border-top: 1px solid #e5e7eb;">
            <td style="padding: 10px 0 6px; color: #1f2937; font-weight: bold;">Subtotal</td>
            <td style="padding: 10px 0 6px; color: #1f2937; font-weight: bold; text-align: right;">${formatCurrency(subtotal)}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #4b5563;">Tax (${taxRate.toFixed(2)}%)</td>
            <td style="padding: 6px 0; color: #1f2937; text-align: right;">${formatCurrency(tax)}</td>
          </tr>
          <tr style="border-top: 2px solid #3b82f6;">
            <td style="padding: 12px 0 6px; color: #1e40af; font-weight: bold; font-size: 16px;">Total Paid</td>
            <td style="padding: 12px 0 6px; color: #1e40af; font-weight: bold; font-size: 16px; text-align: right;">${formatCurrency(total)}</td>
          </tr>
        </table>
        ${thankYouRewardsHTML}
      </div>`;
};
const generateRefundEmailHTML = (booking)=>{
  const customerName = booking.customers?.name || booking.name || "there";
  const refundDetails = booking.refund_details || {};
  const cancellationDetails = booking.cancellation_details || {};
  const originalTotal = Number(booking.total_price || 0);
  const refundAmount = Number(refundDetails.amount ?? cancellationDetails.refund_amount ?? 0);
  const feeAmount = Number(cancellationDetails.fee_amount ?? Math.max(0, originalTotal - refundAmount));
  const hoursRaw = cancellationDetails.hours_before_appointment;
  const hours = hoursRaw != null && hoursRaw !== "" ? Math.max(0, Math.round(Number(hoursRaw))) : null;
  const isLate = cancellationDetails.fee_type === "late" || hours != null && hours <= 24;
  const feeTypeLabel = isLate ? "Last-minute exception cancellation fee" : "Standard cancellation fee";
  const feePct = cancellationDetails.fee_percentage != null ? Number(cancellationDetails.fee_percentage) : null;
  const reason = cancellationDetails.reason || refundDetails.reason || null;
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Refund Confirmation - U-Fill Dumpsters</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f3f4f6;">
  <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
    <div style="background: linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%); padding: 40px 20px; text-align: center;">
      <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: bold;">Refund Confirmation</h1>
      <p style="color: #e0f2fe; margin: 10px 0 0 0; font-size: 16px;">Booking #${booking.id}</p>
    </div>
    <div style="padding: 30px 20px;">
      <div style="background-color: #dbeafe; border-left: 4px solid #2563eb; padding: 15px; border-radius: 4px; margin-bottom: 25px;">
        <p style="margin: 0; color: #1e3a8a; font-weight: bold;">Your cancellation has been approved and your refund has been processed.</p>
      </div>
      <p style="color: #374151; font-size: 15px; line-height: 1.6;">
        Hi ${customerName},
      </p>
      <p style="color: #374151; font-size: 15px; line-height: 1.6;">
        We're sorry to see you go. We truly miss your business and hope that in the future you'll be able to provide the proper verification information so we can welcome you back to purchase with us again.
        Your cancellation for Booking #${booking.id} has been approved, and a refund of
        <strong>${formatCurrency(refundAmount)}</strong> has been processed
        ${feeAmount > 0 ? ` (cancellation fee: <strong>${formatCurrency(feeAmount)}</strong>)` : ""}.
      </p>
      <div style="margin-top: 25px;">
        <h2 style="color: #1f2937; font-size: 20px; margin-bottom: 15px; border-bottom: 2px solid #3b82f6; padding-bottom: 10px;">Refund Summary</h2>
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 8px 0; color: #4b5563;">Original Total</td>
            <td style="padding: 8px 0; color: #1f2937; text-align: right;">${formatCurrency(originalTotal)}</td>
          </tr>
          ${hours != null ? `
          <tr>
            <td style="padding: 8px 0; color: #4b5563;">Hours before appointment</td>
            <td style="padding: 8px 0; color: #1f2937; text-align: right;">${hours} hours</td>
          </tr>` : ""}
          <tr>
            <td style="padding: 8px 0; color: #4b5563;">Fee type</td>
            <td style="padding: 8px 0; color: #1f2937; text-align: right;">
              ${feeTypeLabel}${feePct != null ? ` — up to ${feePct}%` : ""}
            </td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #4b5563;">Cancellation fee charged</td>
            <td style="padding: 8px 0; color: #b91c1c; text-align: right;">-${formatCurrency(feeAmount)}</td>
          </tr>
          <tr style="border-top: 2px solid #3b82f6;">
            <td style="padding: 12px 0 6px; color: #047857; font-weight: bold; font-size: 16px;">Amount Refunded</td>
            <td style="padding: 12px 0 6px; color: #047857; font-weight: bold; font-size: 16px; text-align: right;">${formatCurrency(refundAmount)}</td>
          </tr>
        </table>
      </div>
      ${reason ? `
      <div style="margin-top: 20px; padding: 12px 14px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px;">
        <p style="margin: 0 0 6px 0; color: #6b7280; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em;">Note</p>
        <p style="margin: 0; color: #374151; font-size: 14px; line-height: 1.5;">${reason}</p>
      </div>` : ""}
      <p style="color: #6b7280; font-size: 13px; line-height: 1.5; margin-top: 25px;">
        Per our rental agreement, refunds are typically processed within 1–2 business days. Your bank or card issuer usually posts the credit within 5–10 business days; in rare cases it may take up to 30 days.
        If you have any questions, reply to this email or contact us through your Customer Portal.
      </p>
    </div>
    <div style="background-color: #f9fafb; padding: 20px; text-align: center; border-top: 1px solid #e5e7eb;">
      <p style="margin: 0; color: #6b7280; font-size: 13px;">Thank you for considering U-Fill Dumpsters. We hope to serve you again soon with complete verification on file.</p>
    </div>
  </div>
</body>
</html>`;
};
const generateActionRequiredEmailHTML = (booking, serviceDetails, insuranceAmount = 0, siteUrl = normalizeSiteUrl(), options)=>{
  const grandTotal = resolveBookingGrandTotal(booking);
  const plan = booking.plan || {};
  const deliveryAddress = booking.delivery_address || booking.contact_address || {};
  const customerIdText = booking.customers?.customer_id_text || "N/A";
  const phone = booking.customers?.phone || booking.phone || "N/A";
  const rawPhone = String(phone).replace(/\D/g, "");
  const portalUrl = `${siteUrl}/customer-login?cid=${encodeURIComponent(customerIdText)}&phone=${encodeURIComponent(rawPhone)}`;
  const serviceName = formatCustomerFacingPlanName(serviceDetails?.name || plan.name || "N/A");
  const selfService = isTrailerSelfService(booking);
  const eventNoun = selfService ? "pickup" : "delivery";
  const customerName = booking.customers?.name || booking.name || `${booking.first_name || ""} ${booking.last_name || ""}`.trim() || "there";
  const pickupScheduleLabel = selfService ? "Pickup By:" : "Drop-off:";
  const returnScheduleLabel = selfService ? "Return By:" : "Pickup:";
  const deliveryWindowDropOff = formatDeliveryTimeWindowBetween(booking.drop_off_time_slot);
  const deliveryWindowPickup = formatDeliveryTimeWindowBetween(booking.pickup_time_slot);
  const pickupScheduleValue = selfService ? `${formatDate(booking.drop_off_date)} ${formatBookingTime(booking.drop_off_time_slot, {
    isSelfService: true,
    isReturnBy: false
  })}` : `${formatDate(booking.drop_off_date)} ${deliveryWindowDropOff}`;
  const returnScheduleValue = selfService ? `${formatDate(booking.pickup_date)} ${formatBookingTime(booking.pickup_time_slot, {
    isSelfService: true,
    isReturnBy: true
  })}` : `${formatDate(booking.pickup_date)} ${deliveryWindowPickup}`;
  const isVerification = options.kind === "pending_verification";
  const hoursLabel = options.hoursRemaining === 1 ? "1 hour" : `${options.hoursRemaining} hours`;
  const deadlineBanner = isVerification ? options.isPastDeadline ? `Your verification deadline has passed. Complete this immediately or your scheduled ${eventNoun} may be delayed or cancelled.` : options.hoursRemaining != null ? `You have <strong>${hoursLabel}</strong> to finish this, or your scheduled ${eventNoun} may be delayed or you may not be able to receive your equipment.` : `Documents are required at least ${VERIFICATION_LEAD_HOURS} hours before your scheduled ${eventNoun}, or your ${eventNoun} may be delayed or cancelled.` : "Your booking is on hold until we finish reviewing your address. We will follow up if anything else is needed.";
  const actionTitle = isVerification ? "Action Required — Finish Verification" : "Action Required — Booking On Hold";
  const actionIntro = isVerification ? "We received your payment, but your booking is <strong>not confirmed yet</strong>. You skipped driver and vehicle verification, so we still need your towing vehicle license plate, driver’s license (front and back), and auto insurance." : "We received your payment, but your booking is <strong>not confirmed yet</strong>. Your address still needs review before we can lock in the reservation.";
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${actionTitle} - U-Fill Dumpsters</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f3f4f6;">
  <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
    <div style="background: linear-gradient(135deg, #9a3412 0%, #f59e0b 100%); padding: 40px 20px; text-align: center;">
      <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: bold;">${actionTitle}</h1>
      <p style="color: #fef3c7; margin: 10px 0 0 0; font-size: 16px;">Booking #${booking.id} is pending — not confirmed yet</p>
    </div>
    <div style="padding: 30px 20px;">
      <div style="background-color: #fef3c7; border-left: 4px solid #d97706; padding: 15px; border-radius: 4px; margin-bottom: 25px;">
        <p style="margin: 0; color: #92400e; font-weight: bold; font-size: 15px;">⚠ ${deadlineBanner}</p>
      </div>
      <p style="color: #374151; font-size: 15px; line-height: 1.6;">Hi ${customerName},</p>
      <p style="color: #374151; font-size: 15px; line-height: 1.6;">${actionIntro}</p>
      ${isVerification ? `
      <div style="margin: 20px 0; padding: 16px 18px; background-color: #fff7ed; border: 1px solid #fdba74; border-radius: 8px;">
        <p style="margin: 0 0 10px 0; color: #9a3412; font-weight: bold;">What you need to submit in the Customer Portal:</p>
        <ul style="margin: 0; padding-left: 20px; color: #7c2d12; line-height: 1.7;">
          <li>Towing vehicle license plate</li>
          <li>Driver’s license — front and back</li>
          <li>Current auto insurance document</li>
        </ul>
      </div>
      ` : ""}
      <div style="text-align: center; margin: 24px 0;">
        <a href="${portalUrl}" style="display: inline-block; padding: 14px 28px; background-color: #d97706; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 16px;">Open Customer Portal</a>
      </div>
      <p style="color: #4b5563; font-size: 14px; line-height: 1.6;">
        Once your information is submitted and approved, we will send the full booking confirmation email with next steps.
        Until then, your ${eventNoun} is not guaranteed.
      </p>
      <div style="text-align: center; margin: 24px 0; padding: 20px; background-color: #f9fafb; border-radius: 8px;">
        <p style="margin: 0; color: #6b7280; font-size: 14px; text-transform: uppercase; letter-spacing: 1px;">Booking ID</p>
        <p style="margin: 5px 0 0 0; color: #9a3412; font-size: 32px; font-weight: bold;">#${booking.id}</p>
      </div>
      <div style="margin-bottom: 25px;">
        <h2 style="color: #1f2937; font-size: 20px; margin-bottom: 15px; border-bottom: 2px solid #f59e0b; padding-bottom: 10px;">Customer Information</h2>
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 8px 0; color: #6b7280; font-weight: bold;">Name:</td>
            <td style="padding: 8px 0; color: #1f2937;">${booking.name || `${booking.first_name} ${booking.last_name}`}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #6b7280; font-weight: bold;">Email:</td>
            <td style="padding: 8px 0; color: #1f2937;">${booking.email}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #6b7280; font-weight: bold;">Phone:</td>
            <td style="padding: 8px 0; color: #1f2937;">${booking.phone}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #6b7280; font-weight: bold;">Address:</td>
            <td style="padding: 8px 0; color: #1f2937;">${deliveryAddress.street || booking.street}, ${deliveryAddress.city || booking.city}, ${deliveryAddress.state || booking.state} ${deliveryAddress.zip || booking.zip}</td>
          </tr>
        </table>
      </div>
      <div style="margin-bottom: 25px;">
        <h2 style="color: #1f2937; font-size: 20px; margin-bottom: 15px; border-bottom: 2px solid #f59e0b; padding-bottom: 10px;">Service Details</h2>
        <p style="margin: 0 0 10px 0; color: #9a3412; font-weight: bold; font-size: 16px;">${serviceName}</p>
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 8px 0; color: #6b7280; font-weight: bold;">${pickupScheduleLabel}</td>
            <td style="padding: 8px 0; color: #1f2937;">${pickupScheduleValue}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #6b7280; font-weight: bold;">${returnScheduleLabel}</td>
            <td style="padding: 8px 0; color: #1f2937;">${returnScheduleValue}</td>
          </tr>
        </table>
      </div>
      ${buildPriceSummaryHTML(booking, insuranceAmount)}
      <div style="margin-top: 30px; padding: 20px; background-color: #eff6ff; border-radius: 8px; text-align: center;">
        <p style="margin: 0; color: #6b7280; font-size: 16px;">Amount Paid</p>
        <p style="margin: 10px 0 0 0; color: #1e40af; font-size: 36px; font-weight: bold;">${formatCurrency(grandTotal)}</p>
      </div>
      <div style="margin-top: 30px; padding: 25px 20px; background-color: #fffbeb; border: 1px solid #fde68a; border-radius: 8px;">
        <h3 style="color: #92400e; margin: 0 0 15px 0; font-size: 18px;">🔑 Customer Portal Access</h3>
        <p style="margin: 0 0 20px 0; color: #78350f; font-size: 15px; line-height: 1.5;">Log in to finish verification, view this booking, and track status.</p>
        <table style="width: 100%; border-collapse: separate; border-spacing: 15px 0; margin-bottom: 25px; margin-left: -15px;">
          <tr>
            <td style="padding: 15px; background-color: #ffffff; border-radius: 6px; border: 1px solid #fcd34d; width: 50%; vertical-align: top;">
              <p style="margin: 0; color: #9ca3af; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; font-weight: bold;">Portal ID</p>
              <p style="margin: 8px 0 0 0; color: #1f2937; font-size: 20px; font-weight: bold; font-family: monospace;">${customerIdText}</p>
            </td>
            <td style="padding: 15px; background-color: #ffffff; border-radius: 6px; border: 1px solid #fcd34d; width: 50%; vertical-align: top;">
              <p style="margin: 0; color: #9ca3af; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; font-weight: bold;">Phone Number</p>
              <p style="margin: 8px 0 0 0; color: #1f2937; font-size: 20px; font-weight: bold; font-family: monospace;">${phone}</p>
            </td>
          </tr>
        </table>
        <div style="text-align: center;">
          <a href="${portalUrl}" style="display: inline-block; padding: 14px 28px; background-color: #d97706; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 16px;">Go to Customer Portal</a>
        </div>
      </div>
    </div>
    <div style="background-color: #1f2937; padding: 20px; text-align: center;">
      <p style="margin: 0; color: #9ca3af; font-size: 14px;">© 2026 U-Fill Dumpsters LLC. All rights reserved.</p>
      <p style="margin: 10px 0 0 0; color: #9ca3af; font-size: 12px;">This is an automated notification. Please do not reply.</p>
    </div>
  </div>
</body>
</html>
  `;
};
const generateEmailHTML = (booking, serviceDetails, insuranceAmount = 0, siteUrl = normalizeSiteUrl())=>{
  const grandTotal = resolveBookingGrandTotal(booking);
  const plan = booking.plan || {};
  const addons = booking.addons || {};
  const deliveryAddress = booking.delivery_address || booking.contact_address || {};
  const customerIdText = booking.customers?.customer_id_text || 'N/A';
  const phone = booking.customers?.phone || booking.phone || 'N/A';
  const rawPhone = String(phone).replace(/\D/g, '');
  console.log(` site url: ${siteUrl}`);
  const portalUrl = `${siteUrl}/customer-login?cid=${encodeURIComponent(customerIdText)}&phone=${encodeURIComponent(rawPhone)}`;
  console.log(`portal URL: ${portalUrl}`);
  const serviceName = formatCustomerFacingPlanName(serviceDetails?.name || plan.name || "N/A");
  const serviceType = serviceDetails?.service_type || plan.service_type || "";
  let addonsHTML = "";
  if (addons.insurance === "accept") {
    addonsHTML += `<li style="padding: 5px 0;">✓ Rental Insurance</li>`;
  }
  const offersDrivewayProtection = Number(plan?.id) === 1;
  if (offersDrivewayProtection && addons.drivewayProtection === "accept") {
    addonsHTML += `<li style="padding: 5px 0;">✓ Driveway Protection</li>`;
  }
  const selfService = isTrailerSelfService(booking);
  console.log(`[send-booking-confirmation] selfService=${selfService} planId=${plan.id} serviceType=${serviceType} isDelivery=${Boolean(addons.isDelivery || addons.deliveryService)}`);
  const pickupScheduleLabel = selfService ? "Pickup By:" : "Drop-off:";
  const returnScheduleLabel = selfService ? "Return By:" : "Pickup:";
  const deliveryWindowDropOff = formatDeliveryTimeWindowBetween(booking.drop_off_time_slot);
  const deliveryWindowPickup = formatDeliveryTimeWindowBetween(booking.pickup_time_slot);
  const pickupScheduleValue = selfService ? `${formatDate(booking.drop_off_date)} ${formatBookingTime(booking.drop_off_time_slot, {
    isSelfService: true,
    isReturnBy: false
  })}` : `${formatDate(booking.drop_off_date)} ${deliveryWindowDropOff}`;
  const returnScheduleValue = selfService ? `${formatDate(booking.pickup_date)} ${formatBookingTime(booking.pickup_time_slot, {
    isSelfService: true,
    isReturnBy: true
  })}` : `${formatDate(booking.pickup_date)} ${deliveryWindowPickup}`;
  let equipmentHTML = "";
  const equipmentList = Array.isArray(addons.equipment) ? addons.equipment : [];
  if (equipmentList.length > 0) {
    const rentalItems = equipmentList.filter((item)=>!isPurchaseEquipmentItem(item));
    const purchaseItems = equipmentList.filter((item)=>isPurchaseEquipmentItem(item));
    const sections = [];
    if (rentalItems.length > 0) {
      sections.push(`
      <div style="margin-top: 20px;">
        <h3 style="color: #1e40af; margin-bottom: 10px;">Equipment Rental:</h3>
        <ul style="list-style: none; padding: 0;">
          ${rentalItems.map((item)=>`
            <li style="padding: 8px 0; border-bottom: 1px solid #e5e7eb;">
              <div style="color: #1f2937; font-weight: bold;">${resolveEquipmentLabel(item)} (Quantity: ${item.quantity})</div>
              <div style="margin-top: 4px; color: #6b7280; font-size: 14px;">
                <strong>Must be returned by:</strong> ${returnScheduleValue}
              </div>
            </li>
          `).join("")}
        </ul>
      </div>`);
    }
    if (purchaseItems.length > 0) {
      sections.push(`
      <div style="margin-top: 20px;">
        <h3 style="color: #1e40af; margin-bottom: 10px;">Purchased Items:</h3>
        <ul style="list-style: none; padding: 0;">
          ${purchaseItems.map((item)=>`
            <li style="padding: 5px 0; border-bottom: 1px solid #e5e7eb;">
              ${resolveEquipmentLabel(item)} (Quantity: ${item.quantity})
            </li>
          `).join("")}
        </ul>
      </div>`);
    }
    equipmentHTML = sections.join("");
  }
  const pickupDateFormatted = formatDate(booking.drop_off_date);
  const pickupStartTimeFormatted = formatBookingTime(booking.drop_off_time_slot, {
    isSelfService: true,
    isReturnBy: false
  });
  const returnDateFormatted = formatDate(booking.pickup_date);
  const returnByTimePlain = formatPlainBookingTime(booking.pickup_time_slot);
  const pointsEarned = Number(addons?.loyaltyPointsEarned || 0);
  const referralPendingDollars = Number(addons?.referralDollarsPending || 0);
  let nextStepsHTML = "";
  if (selfService) {
    nextStepsHTML = `
      <li><strong>🔑 Access Codes:</strong> At least 12 hours before your scheduled pickup time, you will receive a text and email with the exact location address and unlock code.</li>
      <li><strong>🗓️ Pickup:</strong> You can pick up the trailer at our location on the south side of Saratoga Springs on ${pickupDateFormatted} ${pickupStartTimeFormatted}.</li>
      <li><strong>🛻 Towing Requirements:</strong> Ensure your towing vehicle meets the minimum requirements. Your truck must have a 2-5/16 inch ball hitch.</li>
      <li><strong>📖 Safety & Operation:</strong> Follow all safety and operating instructions. Detailed operating instructions and videos can be found in the Customer Portal.</li>
      <li><strong>🪵 Usage:</strong> Fill the trailer at your convenience during your rental period.</li>
      <li><strong>⏳ Return:</strong> Return the trailer by ${returnDateFormatted} at ${returnByTimePlain}.</li>
      <li><strong>🔒 Drop-off & Security:</strong> Ensure the trailer is returned to the exact same location and is securely locked.</li>
      <li><strong>🧹 Cleaning:</strong> Ensure the trailer is empty and clean before returning it to avoid cleaning fees.</li>
     `;
  } else {
    nextStepsHTML = `
      <li>We'll arrive at your location on ${formatDate(booking.drop_off_date)} ${deliveryWindowDropOff}.</li>
      <li>Our team will place the dumpster in your designated area.</li>
      <li>Fill the dumpster at your convenience during the rental period.</li>
      <li>We'll pick up the dumpster on ${formatDate(booking.pickup_date)} ${deliveryWindowPickup}.</li>
     `;
  }
  return `
<!-- email-template: self-service-v2 -->
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Booking Confirmation - U-Fill Dumpsters</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f3f4f6;">
  <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
    
    <!-- Header -->
    <div style="background: linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%); padding: 40px 20px; text-align: center;">
      <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: bold;">Booking Confirmed!</h1>
      <p style="color: #e0f2fe; margin: 10px 0 0 0; font-size: 16px;">Thank you for choosing U-Fill Dumpsters</p>
    </div>

    <!-- Body -->
    <div style="padding: 30px 20px;">
      
      <!-- Success Message -->
      <div style="background-color: #d1fae5; border-left: 4px solid #10b981; padding: 15px; border-radius: 4px; margin-bottom: 25px;">
        <p style="margin: 0; color: #065f46; font-weight: bold;">✓ Your booking has been confirmed successfully!</p>
      </div>

      <!-- Booking ID -->
      <div style="text-align: center; margin-bottom: 30px; padding: 20px; background-color: #f9fafb; border-radius: 8px;">
        <p style="margin: 0; color: #6b7280; font-size: 14px; text-transform: uppercase; letter-spacing: 1px;">Booking ID</p>
        <p style="margin: 5px 0 0 0; color: #1e40af; font-size: 32px; font-weight: bold;">#${booking.id}</p>
      </div>

      <!-- Customer Information -->
      <div style="margin-bottom: 25px;">
        <h2 style="color: #1f2937; font-size: 20px; margin-bottom: 15px; border-bottom: 2px solid #3b82f6; padding-bottom: 10px;">Customer Information</h2>
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 8px 0; color: #6b7280; font-weight: bold;">Name:</td>
            <td style="padding: 8px 0; color: #1f2937;">${booking.name || `${booking.first_name} ${booking.last_name}`}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #6b7280; font-weight: bold;">Email:</td>
            <td style="padding: 8px 0; color: #1f2937;">${booking.email}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #6b7280; font-weight: bold;">Phone:</td>
            <td style="padding: 8px 0; color: #1f2937;">${booking.phone}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #6b7280; font-weight: bold;">Address:</td>
            <td style="padding: 8px 0; color: #1f2937;">${deliveryAddress.street || booking.street}, ${deliveryAddress.city || booking.city}, ${deliveryAddress.state || booking.state} ${deliveryAddress.zip || booking.zip}</td>
          </tr>
        </table>
      </div>

      <!-- Service Details -->
      <div style="margin-bottom: 25px;">
        <h2 style="color: #1f2937; font-size: 20px; margin-bottom: 15px; border-bottom: 2px solid #3b82f6; padding-bottom: 10px;">Service Details</h2>
        <p style="margin: 0 0 10px 0; color: #1e40af; font-weight: bold; font-size: 16px;">${serviceName}</p>
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 8px 0; color: #6b7280; font-weight: bold;">${pickupScheduleLabel}</td>
            <td style="padding: 8px 0; color: #1f2937;">${pickupScheduleValue}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #6b7280; font-weight: bold;">${returnScheduleLabel}</td>
            <td style="padding: 8px 0; color: #1f2937;">${returnScheduleValue}</td>
          </tr>
        </table>
      </div>

      ${equipmentHTML}

      ${addonsHTML ? `
      <div style="margin-top: 20px;">
        <h3 style="color: #1e40af; margin-bottom: 10px;">Additional Services:</h3>
        <ul style="list-style: none; padding: 0;">
          ${addonsHTML}
        </ul>
      </div>
      ` : ""}

      ${buildPriceSummaryHTML(booking, insuranceAmount)}

      ${pointsEarned > 0 || referralPendingDollars > 0 ? `
      <div style="margin-top: 20px; padding: 14px 16px; background-color: #ecfdf5; border: 1px solid #86efac; border-radius: 8px;">
        <p style="margin: 0; color: #065f46; font-size: 14px; line-height: 1.5;">
          <strong>Rewards Update:</strong> Thank you for your booking.
          ${pointsEarned > 0 ? ` You earned <strong>${pointsEarned} loyalty points</strong> from this order.` : ''}
          ${referralPendingDollars > 0 ? ` Because you were referred, you just helped a friend or family member earn a referral reward!` : ''}
          Visit your Customer Portal anytime to track your balances, where you can also invite friends and family to try our services and start earning rewards yourself.
        </p>
      </div>
      ` : ""}

      <!-- Total -->
      <div style="margin-top: 30px; padding: 20px; background-color: #eff6ff; border-radius: 8px; text-align: center;">
        <p style="margin: 0; color: #6b7280; font-size: 16px;">Total Amount Paid</p>
        <p style="margin: 10px 0 0 0; color: #1e40af; font-size: 36px; font-weight: bold;">${formatCurrency(grandTotal)}</p>
      </div>

      <!-- Special Notes -->
      ${booking.notes ? `
      <div style="margin-top: 25px; padding: 15px; background-color: #fef3c7; border-left: 4px solid #f59e0b; border-radius: 4px;">
        <p style="margin: 0; color: #92400e; font-weight: bold;">Special Instructions:</p>
        <p style="margin: 10px 0 0 0; color: #78350f;">${booking.notes}</p>
      </div>
      ` : ""}

      <!-- Next Steps -->
      <div style="margin-top: 30px; padding: 20px; background-color: #f3f4f6; border-radius: 8px;">
        <h3 style="color: #1f2937; margin: 0 0 15px 0; font-size: 18px;">What's Next?</h3>
        <ol style="margin: 0; padding-left: 20px; color: #4b5563; line-height: 1.8;">
          ${nextStepsHTML}
        </ol>
      </div>

      <!-- Customer Portal Access -->
      <div style="margin-top: 30px; padding: 25px 20px; background-color: #fffbeb; border: 1px solid #fde68a; border-radius: 8px;">
        <h3 style="color: #92400e; margin: 0 0 15px 0; font-size: 18px;">🔑 Customer Portal Access</h3>
        <p style="margin: 0 0 20px 0; color: #78350f; font-size: 15px; line-height: 1.5;">Access your booking details, make changes, and track your rental anytime through our Customer Portal. (Most all questions and changes can be access through the portal)</p>
        <p style="margin: 0 0 20px 0; color: #991b1b; font-size: 14px; line-height: 1.6; background-color: #fef2f2; border: 1px solid #fecaca; border-radius: 6px; padding: 12px 14px;"><strong>⚠️ Privacy Notice:</strong> This portal information is private and personal. Please keep this email secure and do not share your Portal ID, phone number, or access links with anyone. 🔒</p>
        
        <table style="width: 100%; border-collapse: separate; border-spacing: 15px 0; margin-bottom: 25px; margin-left: -15px;">
          <tr>
            <td style="padding: 15px; background-color: #ffffff; border-radius: 6px; border: 1px solid #fcd34d; width: 50%; vertical-align: top;">
              <p style="margin: 0; color: #9ca3af; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; font-weight: bold;">Portal ID</p>
              <p style="margin: 8px 0 0 0; color: #1f2937; font-size: 20px; font-weight: bold; font-family: monospace;">${customerIdText}</p>
            </td>
            <td style="padding: 15px; background-color: #ffffff; border-radius: 6px; border: 1px solid #fcd34d; width: 50%; vertical-align: top;">
              <p style="margin: 0; color: #9ca3af; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; font-weight: bold;">Phone Number</p>
              <p style="margin: 8px 0 0 0; color: #1f2937; font-size: 20px; font-weight: bold; font-family: monospace;">${phone}</p>
            </td>
          </tr>
        </table>

        <div style="text-align: center;">
          <a href="${portalUrl}" style="display: inline-block; padding: 14px 28px; background-color: #d97706; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 16px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">Go to Customer Portal</a>
        </div>
      </div>

      <!-- Contact Information -->
      <div style="margin-top: 30px; text-align: center; padding: 20px; background-color: #f9fafb; border-radius: 8px;">
        <p style="margin: 0 0 10px 0; color: #6b7280; font-size: 14px;">Need to make changes or have questions?</p>
        <p style="margin: 0; color: #1f2937; font-weight: bold;">Contact Us</p>
        <p style="margin: 5px 0 0 0; color: #3b82f6;">support@u-filldumpsters.com</p>
      </div>

    </div>

    <!-- Footer -->
    <div style="background-color: #1f2937; padding: 20px; text-align: center;">
      <p style="margin: 0; color: #9ca3af; font-size: 14px;">© 2026 U-Fill Dumpsters LLC. All rights reserved.</p>
      <p style="margin: 10px 0 0 0; color: #9ca3af; font-size: 12px;">This is an automated confirmation email. Please do not reply.</p>
    </div>

  </div>
</body>
</html>
  `;
};
const sendEmailWithRetry = async (toEmail, subject, htmlContent, maxRetries = 2)=>{
  let lastError = null;
  for(let attempt = 1; attempt <= maxRetries; attempt++){
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [send-booking-confirmation] Attempt ${attempt}/${maxRetries} to send email to ${toEmail}`);
    try {
      if (BREVO_API_KEY) {
        console.log(`[${timestamp}] [send-booking-confirmation] Using Brevo API`);
        const brevoResponse = await fetch("https://api.brevo.com/v3/smtp/email", {
          method: "POST",
          headers: {
            "api-key": BREVO_API_KEY,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            sender: {
              email: BREVO_FROM_EMAIL,
              name: "U-Fill Dumpsters"
            },
            to: [
              {
                email: toEmail
              }
            ],
            subject: subject,
            htmlContent: htmlContent
          })
        });
        if (brevoResponse.ok) {
          const result = await brevoResponse.json();
          console.log(`[${timestamp}] [send-booking-confirmation] Email sent successfully via Brevo:`, result);
          return {
            success: true,
            provider: "brevo",
            result
          };
        } else {
          const errorText = await brevoResponse.text();
          lastError = `Brevo API error: ${errorText}`;
          console.error(`[${timestamp}] [send-booking-confirmation] Brevo failed:`, lastError);
        }
      }
      if (RESEND_API_KEY) {
        console.log(`[${timestamp}] [send-booking-confirmation] Using Resend API`);
        const resendResponse = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${RESEND_API_KEY}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            from: "U-Fill Dumpsters <noreply@u-filldumpsters.com>",
            to: [
              toEmail
            ],
            subject: subject,
            html: htmlContent
          })
        });
        if (resendResponse.ok) {
          const result = await resendResponse.json();
          console.log(`[${timestamp}] [send-booking-confirmation] Email sent successfully via Resend:`, result);
          return {
            success: true,
            provider: "resend",
            result
          };
        } else {
          const errorText = await resendResponse.text();
          lastError = `Resend API error: ${errorText}`;
          console.error(`[${timestamp}] [send-booking-confirmation] Resend failed:`, lastError);
        }
      }
      if (!RESEND_API_KEY && !BREVO_API_KEY) {
        lastError = "No email service configured (missing RESEND_API_KEY and BREVO_API_KEY)";
        console.error(`[${timestamp}] [send-booking-confirmation] ${lastError}`);
        break;
      }
      if (attempt < maxRetries) {
        const waitTime = Math.pow(2, attempt) * 1000;
        console.log(`[${timestamp}] [send-booking-confirmation] Waiting ${waitTime}ms before retry...`);
        await new Promise((resolve)=>setTimeout(resolve, waitTime));
      }
    } catch (error) {
      lastError = error.message;
      console.error(`[${timestamp}] [send-booking-confirmation] Exception on attempt ${attempt}:`, error);
      if (attempt < maxRetries) {
        const waitTime = Math.pow(2, attempt) * 1000;
        await new Promise((resolve)=>setTimeout(resolve, waitTime));
      }
    }
  }
  return {
    success: false,
    error: lastError
  };
};
const buildReferrerThankYouEmailHTML = ({ referrerName, bonusDollars, bookingId, customerIdText, phoneDisplay, loginUrl })=>{
  const safeName = referrerName || "Valued Customer";
  const amount = formatCurrency(Number(bonusDollars || 0));
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Thank You for Your Referral</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f3f4f6;">
  <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
    <div style="background: linear-gradient(135deg, #065f46 0%, #10b981 100%); padding: 32px 20px; text-align: center;">
      <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: bold;">Thank You for Your Referral</h1>
      <p style="color: #d1fae5; margin: 10px 0 0 0; font-size: 15px;">A friend or family member just booked with your link</p>
    </div>
    <div style="padding: 28px 22px; color: #1f2937; font-size: 15px; line-height: 1.6;">
      <p style="margin: 0 0 16px 0;">Hello ${safeName},</p>
      <p style="margin: 0 0 16px 0;">
        Thank you for referring someone to U-Fill Dumpsters. We appreciate your trust and support.
      </p>
      <p style="margin: 0 0 16px 0;">
        A <strong>${amount}</strong> referral reward has been added to your account as
        <strong>pending</strong> for referred booking <strong>#${bookingId}</strong>.
        Once that rental is marked <strong>Completed</strong>, the reward will become available
        in your Customer Portal for use on a future booking.
      </p>
      <div style="background-color: #f0f8ff; border: 1px solid #cce5ff; padding: 14px 16px; border-radius: 6px; margin: 20px 0; font-family: monospace; font-size: 14px;">
        <strong>Customer ID:</strong> ${customerIdText || "N/A"}<br>
        <strong>Phone Number (Password):</strong> ${phoneDisplay || "N/A"}
      </div>
      <p style="margin: 0 0 20px 0;">
        Use the button below to open the Customer Portal with your details pre-filled.
        You can track pending and available referral rewards under Welcome.
      </p>
      <p style="text-align: center; margin: 0 0 24px 0;">
        <a href="${loginUrl}" style="display: inline-block; padding: 12px 24px; background-color: #f59e0b; color: #000000 !important; text-decoration: none; border-radius: 6px; font-weight: bold;">
          Open Customer Portal
        </a>
      </p>
      <p style="margin: 0; font-size: 13px; color: #6b7280;">
        If the button does not work, copy and paste this link into your browser:<br>
        <a href="${loginUrl}" style="color: #1d4ed8; word-break: break-all;">${loginUrl}</a>
      </p>
    </div>
    <div style="background-color: #1f2937; padding: 18px; text-align: center;">
      <p style="margin: 0; color: #9ca3af; font-size: 13px;">U-Fill Dumpsters LLC | Saratoga Springs, UT | (801) 810-8832</p>
      <p style="margin: 8px 0 0 0; color: #9ca3af; font-size: 12px;">support@u-filldumpsters.com</p>
    </div>
  </div>
</body>
</html>
  `;
};
const sendReferrerThankYouEmail = async (supabase, booking, siteUrl, timestamp)=>{
  try {
    const addons = booking?.addons && typeof booking.addons === "object" ? booking.addons : {};
    const pendingDollars = Number(addons.referralDollarsPending || 0);
    if (!(pendingDollars > 0)) {
      return {
        sent: false,
        skipped: true,
        reason: "no_pending_referral_dollars"
      };
    }
    const referralCode = String(addons.referralCode || addons.referral_code || "").trim();
    if (!referralCode) {
      return {
        sent: false,
        skipped: true,
        reason: "missing_referral_code"
      };
    }
    const { data: referralRow, error: referralError } = await supabase.from("referrals").select("id, referrer_customer_id, referral_code, status").ilike("referral_code", referralCode).order("id", {
      ascending: false
    }).limit(1).maybeSingle();
    if (referralError || !referralRow?.referrer_customer_id) {
      console.error(`[${timestamp}] [send-booking-confirmation] Referrer lookup failed:`, referralError);
      return {
        sent: false,
        skipped: false,
        reason: "referrer_not_found"
      };
    }
    const { data: referrer, error: referrerError } = await supabase.from("customers").select("id, name, email, phone, customer_id_text").eq("id", referralRow.referrer_customer_id).maybeSingle();
    if (referrerError || !referrer?.email) {
      console.error(`[${timestamp}] [send-booking-confirmation] Referrer customer fetch failed:`, referrerError);
      return {
        sent: false,
        skipped: false,
        reason: "referrer_email_missing"
      };
    }
    const rawPhone = String(referrer.phone || "").replace(/\D/g, "");
    const customerIdText = referrer.customer_id_text || "";
    if (!customerIdText || rawPhone.length < 10) {
      console.error(`[${timestamp}] [send-booking-confirmation] Referrer missing portal login credentials`);
      return {
        sent: false,
        skipped: false,
        reason: "referrer_login_incomplete"
      };
    }
    const loginUrl = `${siteUrl}/customer-login?cid=${encodeURIComponent(customerIdText)}&phone=${encodeURIComponent(rawPhone)}`;
    const html = buildReferrerThankYouEmailHTML({
      referrerName: referrer.name,
      bonusDollars: pendingDollars,
      bookingId: booking.id,
      customerIdText,
      phoneDisplay: referrer.phone,
      loginUrl
    });
    const subject = "Thank you for your referral – reward pending";
    const emailResult = await sendEmailWithRetry(referrer.email, subject, html);
    if (emailResult.success) {
      console.log(`[${timestamp}] [send-booking-confirmation] Referrer thank-you sent to ${referrer.email} via ${emailResult.provider}`);
      return {
        sent: true,
        recipient: referrer.email,
        provider: emailResult.provider
      };
    }
    console.error(`[${timestamp}] [send-booking-confirmation] Referrer thank-you failed:`, emailResult.error);
    return {
      sent: false,
      skipped: false,
      reason: emailResult.error || "send_failed"
    };
  } catch (err) {
    console.error(`[${timestamp}] [send-booking-confirmation] Referrer thank-you exception:`, err);
    return {
      sent: false,
      skipped: false,
      reason: err?.message || "exception"
    };
  }
};
Deno.serve(async (req)=>{
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [send-booking-confirmation] Function entry`);
  try {
    const body = await req.json();
    const bookingId = body.bookingId ?? body.booking_id;
    const email = body.email;
    const siteUrl = normalizeSiteUrl(body.site_url);
    const force = body.force === true || body.force_resend === true;
    console.log(`[${timestamp}] [send-booking-confirmation] Parameters - Booking ID: ${bookingId}, Email: ${email}, siteUrl: ${siteUrl}, force: ${force}`);
    if (!bookingId) {
      console.error(`[${timestamp}] [send-booking-confirmation] ERROR: Missing bookingId`);
      return new Response(JSON.stringify({
        error: "bookingId is required"
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    console.log(`[${timestamp}] [send-booking-confirmation] Fetching booking #${bookingId}`);
    const { data: booking, error: fetchError } = await supabase.from("bookings").select("*, customers(*)").eq("id", bookingId).single();
    if (fetchError || !booking) {
      console.error(`[${timestamp}] [send-booking-confirmation] ERROR: Booking not found:`, fetchError);
      return new Response(JSON.stringify({
        error: "Booking not found",
        details: fetchError?.message
      }), {
        status: 404,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    normalizeBookingJsonFields(booking);
    await hydrateBookingPlanFromService(supabase, booking);
    const serviceId = booking.plan?.id ?? booking.plan?.service_id;
    let serviceDetails = null;
    if (serviceId) {
      const { data: service } = await supabase.from("services").select("*").eq("id", serviceId).maybeSingle();
      serviceDetails = service;
    }
    console.log(`[${timestamp}] [send-booking-confirmation] Booking fetched successfully planId=${booking.plan?.id} serviceType=${booking.plan?.service_type}`);
    const recipientEmail = email || booking.email;
    if (!recipientEmail) {
      console.error(`[${timestamp}] [send-booking-confirmation] ERROR: No email address available`);
      return new Response(JSON.stringify({
        error: "No email address available"
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    // PIN email (issued ~12h before pickup). Delivery bookings never get a padlock code.
    const emailType = body.email_type || body.emailType || "confirmation";
    if (emailType === "pin_update" || emailType === "pin_reminder") {
      if (isDeliveryBooking(booking)) {
        console.log(`[${timestamp}] [send-booking-confirmation] Skipping ${emailType} for delivery booking #${booking.id}`);
        return new Response(JSON.stringify({
          success: true,
          skipped: true,
          skippedReason: "delivery",
          email_type: emailType
        }), {
          status: 200,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }
    }
    if (emailType === "pin_update") {
      const pin = body.pin || body.access_pin;
      if (!pin) {
        return new Response(JSON.stringify({
          error: "pin is required for pin_update"
        }), {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }
      const pickupDateLabel = formatDate(booking.drop_off_date);
      const pickupTimeLabel = formatPlainBookingTime(booking.drop_off_time_slot) || booking.drop_off_time_slot || "";
      const returnDateLabel = formatDate(booking.pickup_date);
      const returnTimeLabel = formatPlainBookingTime(booking.pickup_time_slot) || booking.pickup_time_slot || "";
      // Activation is 5 minutes before the scheduled pickup (matches getPinActivationStart).
      const activationLabel = pickupTimeLabel ? `${pickupDateLabel} at ${pickupTimeLabel} (code works 5 minutes early)` : `${pickupDateLabel} (code works 5 minutes early)`;
      const pinHtml = `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#f3f4f6;padding:24px;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
    <div style="background:#1e3a8a;color:#fff;padding:20px 24px;">
      <h1 style="margin:0;font-size:22px;">Your Access Code — Order #${booking.id}</h1>
    </div>
    <div style="padding:28px 24px;color:#1f2937;line-height:1.55;">
      <p>Hi ${booking.name || "there"},</p>
      <p>Your Dump Trailer access code is ready. Enter it on the padlock at pickup.</p>
      <div style="text-align:center;margin:28px 0;padding:20px;background:#0f172a;border-radius:10px;">
        <p style="margin:0 0 8px;color:#fbbf24;font-size:12px;letter-spacing:0.12em;text-transform:uppercase;">Access PIN</p>
        <p style="margin:0;color:#fff;font-size:40px;font-weight:bold;letter-spacing:0.2em;font-family:monospace;">${pin}</p>
      </div>
      <p><strong>Activates:</strong> ${activationLabel}</p>
      <p><strong>Return by:</strong> ${returnDateLabel}${returnTimeLabel ? ` at ${returnTimeLabel}` : ""}</p>
      <p style="color:#6b7280;font-size:13px;">The code works during your scheduled rental window. Have everything loaded and locked by your return time.</p>
      <p style="text-align:center;margin:24px 0;">
        <a href="${siteUrl}/customer-portal?tab=access-codes" style="display:inline-block;background:#3b82f6;color:#fff;padding:12px 22px;text-decoration:none;border-radius:8px;font-weight:bold;">View in Customer Portal</a>
      </p>
    </div>
  </div>
</body></html>`;
      const pinSubject = `Your Access Code for Order #${booking.id} — U-Fill Dumpsters`;
      console.log(`[${timestamp}] [send-booking-confirmation] Sending pin_update to ${recipientEmail}`);
      const pinResult = await sendEmailWithRetry(recipientEmail, pinSubject, pinHtml);
      if (!pinResult.success) {
        return new Response(JSON.stringify({
          success: false,
          error: "Failed to send PIN email",
          details: pinResult.error
        }), {
          status: 500,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }
      // SMS companion (respects customers.sms_opt_in). Email success is enough to mark notified.
      const phone = booking.customers?.phone || booking.phone || "";
      const smsOptIn = booking.customers?.sms_opt_in !== false;
      const smsContent = `U-Fill Dumpsters: Your access PIN for Order #${booking.id} is ${pin}. ` + `Activates ${activationLabel}. View: ${siteUrl}/customer-portal?tab=access-codes`;
      const smsResult = await sendSms(phone, smsContent, {
        smsOptIn
      });
      console.log(`[${timestamp}] [send-booking-confirmation] pin_update SMS:`, smsResult);
      const notifiedAt = new Date().toISOString();
      await supabase.from("bookings").update({
        pin_notification_sent_at: notifiedAt
      }).eq("id", booking.id);
      await supabase.from("rental_access_codes").update({
        notified_at: notifiedAt
      }).eq("order_id", booking.id).eq("status", "active");
      return new Response(JSON.stringify({
        success: true,
        message: "PIN email sent successfully",
        provider: pinResult.provider,
        recipient: recipientEmail,
        email_type: "pin_update",
        sms: smsResult
      }), {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    if (emailType === "pin_reminder") {
      const pin = body.pin || body.access_pin;
      if (!pin) {
        return new Response(JSON.stringify({
          error: "pin is required for pin_reminder"
        }), {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }
      const pickupDateLabel = formatDate(booking.drop_off_date);
      const pickupTimeLabel = formatPlainBookingTime(booking.drop_off_time_slot) || booking.drop_off_time_slot || "";
      const whenLabel = pickupTimeLabel ? `${pickupDateLabel} at ${pickupTimeLabel}` : pickupDateLabel;
      const reminderHtml = `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#f3f4f6;padding:24px;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
    <div style="background:#1e3a8a;color:#fff;padding:20px 24px;">
      <h1 style="margin:0;font-size:22px;">Pickup in about an hour — Order #${booking.id}</h1>
    </div>
    <div style="padding:28px 24px;color:#1f2937;line-height:1.55;">
      <p>Hi ${booking.name || "there"},</p>
      <p>Reminder: your Dump Trailer pickup is around <strong>${whenLabel}</strong>. Your padlock code:</p>
      <div style="text-align:center;margin:28px 0;padding:20px;background:#0f172a;border-radius:10px;">
        <p style="margin:0 0 8px;color:#fbbf24;font-size:12px;letter-spacing:0.12em;text-transform:uppercase;">Access PIN</p>
        <p style="margin:0;color:#fff;font-size:40px;font-weight:bold;letter-spacing:0.2em;font-family:monospace;">${pin}</p>
      </div>
      <p style="text-align:center;margin:24px 0;">
        <a href="${siteUrl}/customer-portal?tab=access-codes" style="display:inline-block;background:#3b82f6;color:#fff;padding:12px 22px;text-decoration:none;border-radius:8px;font-weight:bold;">View in Customer Portal</a>
      </p>
    </div>
  </div>
</body></html>`;
      const reminderSubject = `Pickup soon — Order #${booking.id} access code — U-Fill Dumpsters`;
      console.log(`[${timestamp}] [send-booking-confirmation] Sending pin_reminder to ${recipientEmail}`);
      const reminderResult = await sendEmailWithRetry(recipientEmail, reminderSubject, reminderHtml);
      if (!reminderResult.success) {
        return new Response(JSON.stringify({
          success: false,
          error: "Failed to send PIN reminder email",
          details: reminderResult.error
        }), {
          status: 500,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }
      const phone = booking.customers?.phone || booking.phone || "";
      const smsOptIn = booking.customers?.sms_opt_in !== false;
      const smsContent = `U-Fill Dumpsters: Pickup in about an hour for Order #${booking.id}. Your access PIN is ${pin}. ` + `View: ${siteUrl}/customer-portal?tab=access-codes`;
      const smsResult = await sendSms(phone, smsContent, {
        smsOptIn
      });
      console.log(`[${timestamp}] [send-booking-confirmation] pin_reminder SMS:`, smsResult);
      const remindedAt = new Date().toISOString();
      await supabase.from("bookings").update({
        pin_reminder_sent_at: remindedAt
      }).eq("id", booking.id);
      return new Response(JSON.stringify({
        success: true,
        message: "PIN reminder sent successfully",
        provider: reminderResult.provider,
        recipient: recipientEmail,
        email_type: "pin_reminder",
        sms: smsResult
      }), {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    console.log(`[${timestamp}] [send-booking-confirmation] Generating email content`);
    let insuranceFallbackPrice = DEFAULT_INSURANCE_PRICE;
    const { data: premiumPlan } = await supabase.from("protection_plans").select("price").eq("plan_key", "premium_insurance").maybeSingle();
    if (premiumPlan?.price != null) {
      insuranceFallbackPrice = Number(premiumPlan.price);
    }
    const insuranceAmount = resolveInsuranceAmount(booking.addons, insuranceFallbackPrice);
    const isCancelledRefund = booking.status === "Cancelled" && (booking.refund_details || booking.cancellation_details);
    const actionRequiredKind = isCancelledRefund ? null : resolveActionRequiredKind(booking);
    const deadlineInfo = actionRequiredKind === "pending_verification" ? getVerificationDeadlineInfo(booking) : {
      hoursRemaining: null,
      isPastDeadline: false
    };
    const emailKind = isCancelledRefund ? "refund" : actionRequiredKind || "confirmation";
    // Send-once claim for normal confirmation emails (not pin/refund/action-required).
    // force=true (explicit resend) bypasses the claim.
    let confirmationClaimAt = null;
    if (emailKind === "confirmation" && !force) {
      confirmationClaimAt = new Date().toISOString();
      const { data: claimed, error: claimError } = await supabase.from("bookings").update({
        confirmation_email_sent_at: confirmationClaimAt
      }).eq("id", booking.id).is("confirmation_email_sent_at", null).select("id").maybeSingle();
      if (claimError) {
        console.error(`[${timestamp}] [send-booking-confirmation] Claim failed:`, claimError);
        return new Response(JSON.stringify({
          success: false,
          error: "Failed to claim confirmation email send",
          details: claimError.message
        }), {
          status: 500,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }
      if (!claimed) {
        console.log(`[${timestamp}] [send-booking-confirmation] Already sent for booking #${booking.id}; skipping`);
        return new Response(JSON.stringify({
          success: true,
          already_sent: true,
          message: "Confirmation email already sent",
          recipient: recipientEmail,
          email_type: "confirmation"
        }), {
          status: 200,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }
    }
    const emailHTML = isCancelledRefund ? generateRefundEmailHTML(booking) : actionRequiredKind ? generateActionRequiredEmailHTML(booking, serviceDetails, insuranceAmount, siteUrl, {
      kind: actionRequiredKind,
      hoursRemaining: deadlineInfo.hoursRemaining,
      isPastDeadline: deadlineInfo.isPastDeadline
    }) : generateEmailHTML(booking, serviceDetails, insuranceAmount, siteUrl);
    const subject = isCancelledRefund ? `Refund Confirmation #${booking.id} — U-Fill Dumpsters` : actionRequiredKind === "pending_verification" ? `Action Required: Finish verification for Booking #${booking.id} — U-Fill Dumpsters` : actionRequiredKind === "pending_review" ? `Action Required: Booking #${booking.id} is on hold — U-Fill Dumpsters` : `Booking Confirmation #${booking.id} - U-Fill Dumpsters`;
    console.log(`[${timestamp}] [send-booking-confirmation] Sending email to ${recipientEmail} (type=${emailKind})`);
    const emailResult = await sendEmailWithRetry(recipientEmail, subject, emailHTML);
    if (emailResult.success) {
      console.log(`[${timestamp}] [send-booking-confirmation] SUCCESS: Email sent via ${emailResult.provider}`);
      if (emailKind === "confirmation" && force) {
        await supabase.from("bookings").update({
          confirmation_email_sent_at: new Date().toISOString()
        }).eq("id", booking.id);
      }
      const referrerEmailResult = isCancelledRefund || actionRequiredKind ? {
        skipped: true,
        reason: isCancelledRefund ? "cancelled_refund" : "action_required"
      } : await sendReferrerThankYouEmail(supabase, booking, siteUrl, timestamp);
      return new Response(JSON.stringify({
        success: true,
        message: isCancelledRefund ? "Refund confirmation email sent successfully" : actionRequiredKind ? "Action-required email sent successfully" : "Confirmation email sent successfully",
        provider: emailResult.provider,
        recipient: recipientEmail,
        email_type: emailKind,
        referrerThankYou: referrerEmailResult
      }), {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    } else {
      if (confirmationClaimAt) {
        await supabase.from("bookings").update({
          confirmation_email_sent_at: null
        }).eq("id", booking.id).eq("confirmation_email_sent_at", confirmationClaimAt);
      }
      console.error(`[${timestamp}] [send-booking-confirmation] FAILED: All email attempts failed:`, emailResult.error);
      return new Response(JSON.stringify({
        success: false,
        error: "Failed to send confirmation email",
        details: emailResult.error
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
  } catch (error) {
    const timestamp = new Date().toISOString();
    console.error(`[${timestamp}] [send-booking-confirmation] CRITICAL ERROR:`, error);
    return new Response(JSON.stringify({
      error: "Internal server error",
      details: error.message
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
});


// ============================
// Function: create-payment-intent
// ============================

// --- File: create-payment-intent/cors.ts ---

export { getCorsHeaders } from '../_shared/cors.ts';


// --- File: create-payment-intent/index.ts ---

import { getCorsHeaders } from "./cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import Stripe from "https://esm.sh/stripe@14.14.0?target=deno";
function getStripeClient() {
  const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY")?.trim();
  if (!stripeSecretKey) {
    throw new Error("Stripe is not configured on the server. Set STRIPE_SECRET_KEY in Supabase Edge Function secrets (production) or supabase/functions/.env (local).");
  }
  return new Stripe(stripeSecretKey, {
    apiVersion: "2023-10-16",
    httpClient: Stripe.createFetchHttpClient()
  });
}
const updatablePiStatuses = new Set([
  "requires_payment_method",
  "requires_confirmation",
  "requires_action"
]);
function resolveBookingGrandTotal(booking) {
  const subtotal = Number(booking.subtotal_before_tax ?? 0);
  const tax = Number(booking.tax_amount ?? 0);
  const stored = Number(booking.total_price ?? 0);
  const computed = Math.round((subtotal + tax) * 100) / 100;
  if (subtotal > 0 && tax > 0 && Math.abs(stored - subtotal) < 0.02) return computed;
  return stored > 0 ? stored : computed;
}
function lineItemsFromAddonsSnapshot(addons) {
  const snapshot = addons?.taxLineItemsSnapshot;
  if (!Array.isArray(snapshot) || snapshot.length === 0) return null;
  return snapshot.map((row)=>({
      amount: Number(row.amount ?? row.amountAfterDiscount ?? 0),
      is_taxable: row.is_taxable === true
    }));
}
function buildPaymentMetadata(booking, bookingId, grandTotal) {
  const addons = booking.addons ?? {};
  let taxableSubtotal = Number(addons.taxableSubtotal ?? 0);
  let nonTaxableSubtotal = Number(addons.nonTaxableSubtotal ?? 0);
  const subtotalBeforeTax = Number(booking.subtotal_before_tax ?? 0);
  const taxAmount = Number(booking.tax_amount ?? 0);
  const taxRateUsed = Number(booking.tax_rate_used ?? 0);
  const snapshotLines = lineItemsFromAddonsSnapshot(addons);
  if (snapshotLines && taxableSubtotal === 0 && nonTaxableSubtotal === 0) {
    taxableSubtotal = snapshotLines.filter((l)=>l.is_taxable).reduce((s, l)=>s + l.amount, 0);
    nonTaxableSubtotal = snapshotLines.filter((l)=>!l.is_taxable).reduce((s, l)=>s + l.amount, 0);
  }
  return {
    booking_id: String(bookingId),
    total_price: String(grandTotal),
    subtotal_before_tax: String(subtotalBeforeTax),
    tax_amount: String(taxAmount),
    tax_rate_used: String(taxRateUsed),
    taxable_subtotal: String(taxableSubtotal),
    non_taxable_subtotal: String(nonTaxableSubtotal)
  };
}
Deno.serve(async (req)=>{
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [create-payment-intent] Function invoked.`);
  try {
    const stripe = getStripeClient();
    let body;
    try {
      body = await req.json();
    } catch (parseError) {
      console.error(`[${timestamp}] [create-payment-intent] Failed to parse request JSON:`, parseError);
      throw new Error("Invalid request format. Expected JSON.");
    }
    const booking_id = body.booking_id || body.bookingId;
    const sync_amount_only = body.sync_amount_only === true;
    if (!booking_id) {
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
      throw new Error("Server misconfiguration: Database connection details missing.");
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { data: booking, error: fetchError } = await supabase.from("bookings").select("id, total_price, subtotal_before_tax, tax_amount, tax_rate_used, status, payment_intent, client_secret, addons").eq("id", booking_id).single();
    if (fetchError || !booking) {
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
    const grandTotal = resolveBookingGrandTotal(booking);
    const subtotalBeforeTax = Number(booking.subtotal_before_tax ?? 0);
    const taxAmount = Number(booking.tax_amount ?? 0);
    if (grandTotal <= 0 && subtotalBeforeTax <= 0 && taxAmount <= 0) {
      throw new Error("Booking has no valid pricing. Cannot create payment intent.");
    }
    const amountInCents = Math.max(50, Math.round(grandTotal * 100));
    const metadata = buildPaymentMetadata(booking, booking_id, grandTotal);
    console.log(`[${timestamp}] [create-payment-intent] amount=${amountInCents}c metadata=`, metadata);
    if (sync_amount_only && booking.payment_intent) {
      const pi = await stripe.paymentIntents.retrieve(booking.payment_intent);
      if (updatablePiStatuses.has(pi.status)) {
        await stripe.paymentIntents.update(booking.payment_intent, {
          amount: amountInCents,
          metadata,
          automatic_payment_methods: {
            enabled: true
          }
        });
      }
      return new Response(JSON.stringify({
        success: true,
        clientSecret: pi.client_secret ?? booking.client_secret,
        paymentIntentId: pi.id,
        synced: true
      }), {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const paymentIntentCreateParams = {
      amount: amountInCents,
      currency: "usd",
      metadata,
      automatic_payment_methods: {
        enabled: true
      }
    };
    const paymentIntentUpdateParams = {
      amount: amountInCents,
      metadata,
      automatic_payment_methods: {
        enabled: true
      }
    };
    // Reuse an existing open PaymentIntent when possible (page refresh / retries).
    if (booking.payment_intent) {
      try {
        const existing = await stripe.paymentIntents.retrieve(booking.payment_intent);
        if (updatablePiStatuses.has(existing.status)) {
          const updated = await stripe.paymentIntents.update(booking.payment_intent, paymentIntentUpdateParams);
          return new Response(JSON.stringify({
            success: true,
            clientSecret: updated.client_secret ?? booking.client_secret,
            paymentIntentId: updated.id,
            reused: true
          }), {
            status: 200,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json"
            }
          });
        }
      } catch (retrieveError) {
        console.warn(`[${timestamp}] [create-payment-intent] Could not reuse PI ${booking.payment_intent}:`, retrieveError);
      }
    }
    const paymentIntent = await stripe.paymentIntents.create(paymentIntentCreateParams);
    const { error: dbError } = await supabase.from("bookings").update({
      payment_intent: paymentIntent.id,
      client_secret: paymentIntent.client_secret
    }).eq("id", booking_id);
    if (dbError) {
      throw new Error(`Failed to save payment details to booking: ${dbError.message}`);
    }
    return new Response(JSON.stringify({
      success: true,
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  } catch (error) {
    console.error(`[${timestamp}] [create-payment-intent] CRITICAL ERROR:`, error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : "An unexpected server error occurred."
    }), {
      status: 400,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
});


// ============================
// Function: refund-payment
// ============================

// --- File: refund-payment/cors.ts ---

export { getCorsHeaders } from '../_shared/cors.ts';


// --- File: refund-payment/index.ts ---

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
    let loyalty = {
      points_reversed: 0,
      already_processed: true
    };
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


// ============================
// Function: process-reschedule-fee
// ============================

// --- File: process-reschedule-fee/cors.ts ---

export { getCorsHeaders } from '../_shared/cors.ts';


// --- File: process-reschedule-fee/index.ts ---

import { getCorsHeaders } from "./cors.ts";
import Stripe from "https://esm.sh/stripe@14.5.0?target=deno";
const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "", {
  apiVersion: "2023-10-16",
  httpClient: Stripe.createFetchHttpClient()
});
Deno.serve(async (req)=>{
  const corsHeaders = getCorsHeaders(req);
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


// ============================
// Function: send-reschedule-confirmation-email
// ============================

// --- File: send-reschedule-confirmation-email/cors.ts ---

export { getCorsHeaders } from '../_shared/cors.ts';


// --- File: send-reschedule-confirmation-email/index.ts ---

import { getCorsHeaders } from "./cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { formatPlainBookingTime } from "../_shared/formatBookingTime.ts";
import { normalizeSiteUrl } from "../_shared/normalizeSiteUrl.ts";
import { formatCustomerFacingPlanName } from "../_shared/displayPlanName.ts";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const BREVO_API_KEY = Deno.env.get("BREVO_API_KEY");
const BREVO_FROM_EMAIL = Deno.env.get("BREVO_FROM_EMAIL") || "noreply@u-filldumpsters.com";
const formatCurrency = (amount)=>new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD"
  }).format(Number(amount) || 0);
const formatDate = (dateString)=>{
  if (!dateString) return "N/A";
  try {
    const raw = String(dateString);
    const dateOnly = raw.match(/^(\d{4}-\d{2}-\d{2})/);
    if (dateOnly) {
      const [y, m, d] = dateOnly[1].split("-").map(Number);
      const local = new Date(y, m - 1, d);
      return local.toLocaleDateString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric"
      });
    }
    return new Date(raw).toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric"
    });
  } catch  {
    return String(dateString);
  }
};
const formatDateTime = (dateValue, timeValue)=>{
  const datePart = formatDate(dateValue);
  const timePart = timeValue ? formatPlainBookingTime(String(timeValue)) : null;
  if (datePart !== "N/A" && timePart && timePart !== "N/A") return `${datePart} at ${timePart}`;
  return datePart;
};
const formatAddonList = (addons)=>{
  if (!Array.isArray(addons) || addons.length === 0) return "None";
  return addons.map((a)=>{
    const name = String(a?.name || a?.label || "Add-on");
    const qty = Number(a?.quantity || 1);
    return `${name} (qty ${qty})`;
  }).join(", ");
};
const parseJsonField = (value)=>{
  if (value == null) return {};
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch  {
      return {};
    }
  }
  if (typeof value === "object") return value;
  return {};
};
const sendEmailWithRetry = async (toEmail, subject, htmlContent, maxRetries = 2)=>{
  let lastError = null;
  for(let attempt = 1; attempt <= maxRetries; attempt++){
    try {
      if (BREVO_API_KEY) {
        const brevoResponse = await fetch("https://api.brevo.com/v3/smtp/email", {
          method: "POST",
          headers: {
            "api-key": BREVO_API_KEY,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            sender: {
              email: BREVO_FROM_EMAIL,
              name: "U-Fill Dumpsters"
            },
            to: [
              {
                email: toEmail
              }
            ],
            subject,
            htmlContent
          })
        });
        if (brevoResponse.ok) {
          return {
            success: true,
            provider: "brevo",
            result: await brevoResponse.json()
          };
        }
        lastError = `Brevo API error: ${await brevoResponse.text()}`;
      }
      if (RESEND_API_KEY) {
        const resendResponse = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${RESEND_API_KEY}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            from: "U-Fill Dumpsters <noreply@u-filldumpsters.com>",
            to: [
              toEmail
            ],
            subject,
            html: htmlContent
          })
        });
        if (resendResponse.ok) {
          return {
            success: true,
            provider: "resend",
            result: await resendResponse.json()
          };
        }
        lastError = `Resend API error: ${await resendResponse.text()}`;
      }
      if (!RESEND_API_KEY && !BREVO_API_KEY) {
        lastError = "No email service configured";
        break;
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }
  return {
    success: false,
    error: lastError
  };
};
const sectionBlock = (title, rows)=>{
  const body = rows.filter(([, v])=>v).map(([label, value])=>`<tr><td style="padding:6px 0;color:#6b7280;width:140px;vertical-align:top;">${label}</td><td style="padding:6px 0;color:#111827;font-weight:600;">${value}</td></tr>`).join("");
  if (!body) return "";
  return `
    <div style="margin: 0 0 22px 0;">
      <h3 style="margin:0 0 10px 0;color:#1f2937;font-size:15px;text-transform:uppercase;letter-spacing:0.04em;">${title}</h3>
      <table style="width:100%;border-collapse:collapse;">${body}</table>
    </div>`;
};
const generateRescheduleEmailHTML = (opts)=>{
  const { booking, customerName, originalTotal, newTotal, delta, stripeType, stripeTransactionId, amountProcessed, snapshot, siteUrl } = opts;
  const snap = snapshot || {};
  const receiptHistory = Array.isArray(booking.receipt_status_history) ? booking.receipt_status_history : [];
  const latestApproval = [
    ...receiptHistory
  ].reverse().find((e)=>e?.action === "reschedule_approved") || null;
  const source = {
    ...snap,
    ...latestApproval || {}
  };
  const originalDrop = formatDateTime(source.original_drop_off_date || booking.drop_off_date, source.original_drop_off_time || booking.drop_off_time_slot);
  const originalPick = formatDateTime(source.original_pickup_date || booking.pickup_date, source.original_pickup_time || booking.pickup_time_slot);
  const newDrop = formatDateTime(source.new_drop_off_date || booking.drop_off_date, source.new_drop_off_time || booking.drop_off_time_slot);
  const newPick = formatDateTime(source.new_pickup_date || booking.pickup_date, source.new_pickup_time || booking.pickup_time_slot);
  const serviceFrom = formatCustomerFacingPlanName(String(source.original_service_name || booking.plan?.name || "N/A"));
  const serviceTo = formatCustomerFacingPlanName(String(source.new_service_name || booking.plan?.name || serviceFrom));
  const serviceChanged = serviceFrom !== serviceTo;
  const addressChanged = Boolean(source.address_changed);
  const fromAddr = String(source.original_address || "").trim();
  const toAddr = String(source.new_address || "").trim();
  let stripeLine = "No additional charge or refund.";
  if (stripeType === "charge") stripeLine = `Card charged ${formatCurrency(amountProcessed || Math.abs(delta))}`;
  if (stripeType === "refund") stripeLine = `Refunded to card ${formatCurrency(amountProcessed || Math.abs(delta))}`;
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Reschedule Approved</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:640px;margin:24px auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
    <div style="background:#1d4ed8;padding:28px 24px;color:#fff;">
      <h1 style="margin:0;font-size:24px;">Reschedule Approved</h1>
      <p style="margin:8px 0 0;opacity:0.9;">Booking #${booking.id} — confirmation of your approved changes</p>
    </div>
    <div style="padding:28px 24px;">
      <p style="color:#374151;font-size:15px;line-height:1.5;">Hi ${customerName},</p>
      <p style="color:#374151;font-size:15px;line-height:1.5;">Your reschedule request has been reviewed and approved. Below is a clear summary of what changed and how your payment was updated.</p>

      ${sectionBlock("Previous schedule", [
    [
      "Drop-off",
      originalDrop
    ],
    [
      "Pickup",
      originalPick
    ]
  ])}
      ${sectionBlock("Approved schedule", [
    [
      "Drop-off",
      newDrop
    ],
    [
      "Pickup",
      newPick
    ]
  ])}
      ${serviceChanged ? sectionBlock("Service", [
    [
      "Change",
      `${serviceFrom} → ${serviceTo}`
    ]
  ]) : sectionBlock("Service", [
    [
      "Service",
      serviceTo
    ]
  ])}
      ${addressChanged || fromAddr && toAddr && fromAddr !== toAddr ? sectionBlock("Delivery address", [
    [
      "From",
      fromAddr || "N/A"
    ],
    [
      "To",
      toAddr || "N/A"
    ]
  ]) : ""}
      ${sectionBlock("Equipment & add-ons", [
    [
      "Previous",
      formatAddonList(source.original_addons)
    ],
    [
      "Approved",
      formatAddonList(source.new_addons)
    ]
  ])}
      ${sectionBlock("Pricing", [
    [
      "Original total",
      formatCurrency(originalTotal)
    ],
    [
      "New total",
      formatCurrency(newTotal)
    ],
    [
      "Difference",
      formatCurrency(delta)
    ],
    [
      "Payment",
      stripeLine
    ]
  ])}

      <div style="margin-top:24px;padding:16px;background:#eff6ff;border-radius:8px;border:1px solid #bfdbfe;">
        <p style="margin:0;color:#1e40af;font-size:14px;line-height:1.5;">
          You can review this booking anytime in your Customer Portal under Communication and Receipts.
          ${siteUrl ? ` Portal: <a href="${siteUrl}" style="color:#1d4ed8;">${siteUrl}</a>` : ""}
        </p>
      </div>
      <div style="margin-top:24px;text-align:center;color:#6b7280;font-size:13px;">
        Questions? Contact support@u-filldumpsters.com
      </div>
    </div>
    <div style="background:#111827;padding:16px;text-align:center;color:#9ca3af;font-size:12px;">
      © ${new Date().getFullYear()} U-Fill Dumpsters LLC. All rights reserved.
    </div>
  </div>
</body>
</html>`;
};
Deno.serve(async (req)=>{
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }
  try {
    const body = await req.json();
    const bookingId = body.bookingId ?? body.booking_id;
    if (!bookingId) throw new Error("bookingId is required");
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: booking, error } = await supabase.from("bookings").select("*, customers(*)").eq("id", bookingId).single();
    if (error || !booking) throw new Error("Booking not found");
    booking.plan = parseJsonField(booking.plan);
    booking.addons = parseJsonField(booking.addons);
    const recipientEmail = body.email || booking.email || booking.customers?.email;
    if (!recipientEmail) throw new Error("No email address available");
    const customerName = booking.customers?.name || [
      booking.customers?.first_name,
      booking.customers?.last_name
    ].filter(Boolean).join(" ") || "Customer";
    const paymentDelta = parseJsonField(booking.payment_delta_details);
    const originalTotal = Number(body.originalTotal ?? paymentDelta.original_total_price ?? booking.total_price ?? 0);
    const newTotal = Number(body.newTotal ?? paymentDelta.new_total_price ?? booking.total_price ?? 0);
    const delta = Number(body.delta ?? newTotal - originalTotal);
    const stripeType = String(body.stripeType ?? paymentDelta.stripe_type ?? "none");
    const stripeTransactionId = body.stripeTransactionId ?? paymentDelta.stripe_transaction_id ?? null;
    const amountProcessed = Number(body.amountProcessed ?? paymentDelta.amount_processed ?? Math.abs(delta));
    const history = Array.isArray(booking.reschedule_history) ? booking.reschedule_history : [];
    const snapshot = body.approvalSnapshot || [
      ...history
    ].reverse().find((e)=>e?.type === "reschedule_request") || null;
    const siteUrl = normalizeSiteUrl(body.site_url);
    const html = generateRescheduleEmailHTML({
      booking,
      customerName,
      originalTotal,
      newTotal,
      delta,
      stripeType,
      stripeTransactionId,
      amountProcessed,
      snapshot,
      siteUrl
    });
    const subject = `Reschedule approved – Booking #${booking.id} — U-Fill Dumpsters`;
    const emailResult = await sendEmailWithRetry(recipientEmail, subject, html);
    if (!emailResult.success) {
      return new Response(JSON.stringify({
        success: false,
        error: emailResult.error || "Failed to send email"
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    return new Response(JSON.stringify({
      success: true,
      message: "Reschedule confirmation email sent.",
      provider: emailResult.provider,
      recipient: recipientEmail
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[send-reschedule-confirmation-email]", message);
    return new Response(JSON.stringify({
      success: false,
      error: message
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
});


// ============================
// Function: reschedule-booking
// ============================

// --- File: reschedule-booking/cors.ts ---

export { getCorsHeaders } from '../_shared/cors.ts';


// --- File: reschedule-booking/index.ts ---

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getCorsHeaders } from "./cors.ts";
import { differenceInCalendarDays } from 'npm:date-fns@2.30.0';
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
  const corsHeaders = getCorsHeaders(req);
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


// ============================
// Function: send-reschedule-cancellation-notification
// ============================

// --- File: send-reschedule-cancellation-notification/cors.ts ---

export { getCorsHeaders } from '../_shared/cors.ts';


// --- File: send-reschedule-cancellation-notification/index.ts ---

import { getCorsHeaders } from "./cors.ts";
Deno.serve(async (req)=>{
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
  }
  try {
    const { notificationType, bookingId, customerEmail, details } = await req.json();
    // In a real scenario, this would use SendGrid or Resend to dispatch the email.
    // We log the attempt and return success.
    console.log(`Sending ${notificationType} to ${customerEmail} for booking ${bookingId}`);
    console.log('Details:', details);
    return new Response(JSON.stringify({
      success: true,
      message: "Notification sent."
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    return new Response(JSON.stringify({
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


// ============================
// Function: calculate-delivery-distance
// ============================

// --- File: calculate-delivery-distance/cors.ts ---

export { getCorsHeaders } from '../_shared/cors.ts';


// --- File: calculate-delivery-distance/index.ts ---

import { getCorsHeaders } from "./cors.ts";
Deno.serve(async (req)=>{
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
  }
  try {
    const { pickup_location = "South Saratoga Springs, UT", delivery_address } = await req.json();
    if (!delivery_address) {
      return new Response(JSON.stringify({
        error: 'Delivery address is required'
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    const apiKey = Deno.env.get('GOOGLE_MAPS_API_KEY');
    if (!apiKey) {
      console.error('Google Maps API key is not configured in environment variables');
      return new Response(JSON.stringify({
        error: 'Distance calculation service is currently unavailable (Missing API Key)'
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    console.log(`[Distance Calculation] Origin: ${pickup_location} | Destination: ${delivery_address}`);
    const origin = encodeURIComponent(pickup_location);
    const destination = encodeURIComponent(delivery_address);
    const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${origin}&destinations=${destination}&units=imperial&key=${apiKey}`;
    const response = await fetch(url);
    const data = await response.json();
    console.log('[Distance Calculation] Google API Response Status:', data.status);
    if (data.status === 'OK' && data.rows[0].elements[0].status === 'OK') {
      const distanceText = data.rows[0].elements[0].distance.text;
      const oneWayDistance = parseFloat(distanceText.replace(/[^0-9.]/g, ''));
      // Calculate round-trip distance as per standard delivery fee practices
      const distance_miles = oneWayDistance * 2;
      const distance_km = distance_miles * 1.60934;
      console.log(`[Distance Calculation] Success: ${distance_miles} miles (round trip)`);
      return new Response(JSON.stringify({
        distance_miles,
        distance_km,
        one_way_miles: oneWayDistance
      }), {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    } else {
      const apiStatus = data.rows?.[0]?.elements?.[0]?.status || data.status;
      console.error('[Distance Calculation] Google Maps API Error Details:', JSON.stringify(data));
      throw new Error(`Unable to calculate route. API Status: ${apiStatus}. Please check if the address is valid and accessible.`);
    }
  } catch (error) {
    console.error('[Distance Calculation] Execution Error:', error.message);
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


// ============================
// Function: get-customer-details
// ============================

// --- File: get-customer-details/cors.ts ---

export { getCorsHeaders } from '../_shared/cors.ts';


// --- File: get-customer-details/index.ts ---

import { getCorsHeaders } from "./cors.ts";
import { createClient } from 'npm:@supabase/supabase-js@2';
import { isAdminWithMfa } from '../_shared/jwtAal.ts';
Deno.serve(async (req)=>{
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    if (!supabaseUrl || !serviceRoleKey || !anonKey) {
      throw new Error('Supabase configuration missing');
    }
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({
        error: 'Authentication required'
      }), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        },
        status: 401
      });
    }
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!token || token === anonKey) {
      return new Response(JSON.stringify({
        error: 'Invalid session'
      }), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        },
        status: 401
      });
    }
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
    const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError || !userData?.user) {
      console.error('Get customer details auth error:', userError?.message);
      return new Response(JSON.stringify({
        error: 'Invalid session'
      }), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        },
        status: 401
      });
    }
    const { customerId } = await req.json();
    if (!customerId) {
      throw new Error('Customer ID is required.');
    }
    const parsedCustomerId = Number.parseInt(String(customerId), 10);
    if (!Number.isFinite(parsedCustomerId)) {
      throw new Error('Invalid customer ID.');
    }
    const { data: customer, error: customerError } = await supabaseAdmin.from('customers').select('*').eq('id', parsedCustomerId).single();
    if (customerError) throw customerError;
    if (!customer) {
      return new Response(JSON.stringify({
        error: 'Customer not found'
      }), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        },
        status: 404
      });
    }
    const caller = userData.user;
    const isAdmin = isAdminWithMfa(caller, token);
    const ownsCustomer = customer.user_id === caller.id || Number.parseInt(String(caller.user_metadata?.customer_db_id), 10) === parsedCustomerId;
    if (!isAdmin && !ownsCustomer) {
      return new Response(JSON.stringify({
        error: 'Forbidden'
      }), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        },
        status: 403
      });
    }
    const { data: bookings, error: bookingsError } = await supabaseAdmin.from('bookings').select('*, reviews(*)').eq('customer_id', parsedCustomerId).order('drop_off_date', {
      ascending: false
    });
    if (bookingsError) throw bookingsError;
    const { data: notes, error: notesError } = await supabaseAdmin.from('customer_notes').select('*').eq('customer_id', parsedCustomerId).order('created_at', {
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
        'Content-Type': 'application/json'
      },
      status: 200
    });
  } catch (error) {
    console.error('Get customer details error:', error.message);
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


// ============================
// Function: poll-lock-history
// ============================

// --- File: poll-lock-history/cors.ts ---

export { getCorsHeaders } from '../_shared/cors.ts';


// --- File: poll-lock-history/index.ts ---

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.30.0';
import { getCorsHeaders } from "./cors.ts";
// Legacy Connect API poller — superseded by igloohome-webhook + sync-lock-activity.
// Fail closed: no hardcoded credentials or bridge-id-as-lock defaults.
const IGLOOHOME_API_KEY = Deno.env.get('IGLOOHOME_API_KEY');
const LOCK_ID = Deno.env.get('IGLOOHOME_LOCK_ID') || Deno.env.get('IGLOOHOME_DEVICE_ID');
const IGLOOHOME_API_BASE = 'https://connect.igloohome.co/v2';
const BREVO_API_KEY = Deno.env.get('BREVO_API_KEY');
const BREVO_FROM_EMAIL = Deno.env.get('BREVO_FROM_EMAIL');
Deno.serve(async (req)=>{
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
  }
  try {
    if (!IGLOOHOME_API_KEY || !LOCK_ID) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Missing IGLOOHOME_API_KEY or IGLOOHOME_LOCK_ID/IGLOOHOME_DEVICE_ID. Prefer igloohome-webhook + sync-lock-activity.'
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    const supabaseClient = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
    console.log('[poll-lock-history] Starting lock history poll...');
    // Get all active rentals (status not 'Returned' or 'Cancelled')
    const { data: activeRentals, error: rentalsError } = await supabaseClient.from('bookings').select('id, email, phone, drop_off_date, pickup_date, status, access_pin').not('status', 'in', '("Returned","Cancelled")').not('access_pin', 'is', null);
    if (rentalsError) throw rentalsError;
    console.log(`[poll-lock-history] Found ${activeRentals?.length || 0} active rentals`);
    const processedEvents = [];
    const overdueRentals = [];
    for (const rental of activeRentals || []){
      try {
        // Get last sync timestamp for this order
        const { data: lastLog } = await supabaseClient.from('rental_tracking_logs').select('api_sync_timestamp').eq('order_id', rental.id).not('api_sync_timestamp', 'is', null).order('api_sync_timestamp', {
          ascending: false
        }).limit(1).single();
        const lastSyncTime = lastLog?.api_sync_timestamp || new Date(rental.drop_off_date).toISOString();
        // Call Igloohome API for lock history
        const params = new URLSearchParams({
          lock_id: LOCK_ID,
          start_date: lastSyncTime,
          end_date: new Date().toISOString()
        });
        const response = await fetch(`${IGLOOHOME_API_BASE}/locks/${LOCK_ID}/history?${params}`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${IGLOOHOME_API_KEY}`
          }
        });
        if (!response.ok) {
          console.error(`[poll-lock-history] API error for order ${rental.id}`);
          continue;
        }
        const historyData = await response.json();
        const events = historyData.events || [];
        // Filter events for this rental's PIN
        const rentalEvents = events.filter((e)=>e.pin_code === rental.access_pin);
        for (const event of rentalEvents){
          const eventType = event.action === 'unlock' ? 'unlock' : 'lock';
          // Save to rental_tracking_logs
          await supabaseClient.from('rental_tracking_logs').insert({
            order_id: rental.id,
            event_type: eventType,
            event_timestamp: event.timestamp,
            api_sync_timestamp: new Date().toISOString(),
            notes: `${eventType} event detected via API poll`
          });
          // Update booking status
          if (eventType === 'unlock' && rental.status !== 'In Progress') {
            await supabaseClient.from('bookings').update({
              status: 'In Progress'
            }).eq('id', rental.id);
          } else if (eventType === 'lock') {
            await supabaseClient.from('bookings').update({
              status: 'Returned - Pending Inspection'
            }).eq('id', rental.id);
          }
          processedEvents.push({
            order_id: rental.id,
            event_type: eventType,
            timestamp: event.timestamp
          });
        }
        // Check for overdue rentals
        const scheduledReturnTime = new Date(rental.pickup_date);
        const overdueThreshold = new Date(scheduledReturnTime.getTime() + 30 * 60 * 1000); // +30 minutes
        const now = new Date();
        if (now > overdueThreshold) {
          // Check if there's a 'lock' event
          const { data: lockEvent } = await supabaseClient.from('rental_tracking_logs').select('id').eq('order_id', rental.id).eq('event_type', 'lock').single();
          if (!lockEvent) {
            // Flag as overdue
            await supabaseClient.from('bookings').update({
              status: 'Overdue/No Sync'
            }).eq('id', rental.id);
            overdueRentals.push(rental);
            // Send admin alert email
            if (BREVO_API_KEY && BREVO_FROM_EMAIL) {
              await fetch('https://api.brevo.com/v3/smtp/email', {
                method: 'POST',
                headers: {
                  'Accept': 'application/json',
                  'Content-Type': 'application/json',
                  'api-key': BREVO_API_KEY
                },
                body: JSON.stringify({
                  sender: {
                    email: BREVO_FROM_EMAIL,
                    name: 'U-Fill Dumpsters - System Alert'
                  },
                  to: [
                    {
                      email: BREVO_FROM_EMAIL,
                      name: 'Admin'
                    }
                  ],
                  subject: `ALERT: Overdue Rental - Order #${rental.id}`,
                  htmlContent: `
                    <h2>Overdue Rental Alert</h2>
                    <p><strong>Order ID:</strong> ${rental.id}</p>
                    <p><strong>Customer:</strong> ${rental.email}</p>
                    <p><strong>Scheduled Return:</strong> ${scheduledReturnTime.toLocaleString()}</p>
                    <p><strong>Current Status:</strong> No lock event detected 30+ minutes past return time</p>
                    <p>Please contact customer immediately.</p>
                  `
                })
              });
            }
          }
        }
      } catch (error) {
        console.error(`[poll-lock-history] Error processing rental ${rental.id}:`, error);
      }
    }
    console.log('[poll-lock-history] ✓ Poll completed:', {
      processed_events: processedEvents.length,
      overdue_rentals: overdueRentals.length
    });
    return new Response(JSON.stringify({
      success: true,
      processed_events: processedEvents,
      overdue_rentals: overdueRentals.length
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('[poll-lock-history] ❌ Error:', error.message);
    return new Response(JSON.stringify({
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


// ============================
// Function: send-return-confirmation
// ============================

// --- File: send-return-confirmation/cors.ts ---

export { getCorsHeaders } from '../_shared/cors.ts';


// --- File: send-return-confirmation/index.ts ---

/**
 * send-return-confirmation
 *
 * Fired when the final lock of a self-pickup rental is detected (at/after
 * scheduled end). Sends thank-you email + SMS with referral info and review CTA.
 *
 * Status / returned_at are written by the lock event state machine — this
 * function only notifies and sets return_notified_at.
 */ import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getCorsHeaders } from "./cors.ts";
import { sendEmail, sendSms } from "../_shared/notify.ts";
import { normalizeSiteUrl } from "../_shared/normalizeSiteUrl.ts";
function makeJsonResponse(corsHeaders) {
  return (body, status = 200)=>new Response(JSON.stringify(body), {
      status,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
}
function formatFriendly(iso) {
  try {
    return new Date(iso).toLocaleString("en-US", {
      timeZone: "America/Denver",
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit"
    });
  } catch  {
    return iso;
  }
}
function formatDollars(amount) {
  const n = Number(amount) || 0;
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD"
  });
}
function buildEmailHTML(opts) {
  const { name, orderId, returnedAt, portalUrl, reviewUrl, referralUrl, referralBalance } = opts;
  const referralBlock = referralUrl ? `<div style="background:#ecfdf5;border:1px solid #10b981;border-radius:8px;padding:16px;margin:20px 0;">
        <p style="margin:0 0 8px 0;font-weight:bold;color:#065f46;">Share the love — earn referral rewards</p>
        <p style="margin:0 0 8px 0;color:#047857;">
          ${referralBalance > 0 ? `You currently have <strong>${formatDollars(referralBalance)}</strong> in referral rewards available for your next booking.` : "Invite friends and family to book with U-Fill Dumpsters and earn referral rewards you can use on your next rental."}
        </p>
        <p style="margin:0;color:#047857;">Your personal referral link:<br/>
          <a href="${referralUrl}" style="color:#047857;font-weight:bold;word-break:break-all;">${referralUrl}</a>
        </p>
      </div>` : "";
  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,sans-serif;">
  <div style="max-width:600px;margin:24px auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,0.08);">
    <div style="background:linear-gradient(135deg,#065f46 0%,#10b981 100%);padding:36px 24px;text-align:center;">
      <h1 style="color:#ffffff;margin:0;font-size:26px;">Thank You for Your Rental!</h1>
      <p style="color:#d1fae5;margin:10px 0 0 0;">Order #${orderId}</p>
    </div>
    <div style="padding:28px 24px;color:#1f2937;line-height:1.55;">
      <p>Hi ${name || "there"},</p>
      <p>Thank you for using <strong>U-Fill Dumpsters</strong>. We confirmed that your rental was locked and returned at <strong>${returnedAt}</strong>.</p>
      <p>Our team will complete a final inspection shortly. <strong>Any final charges</strong> (dump fees, overtime, damage, or other adjustments) will be sent to this email separately. If there are no additional charges, you are all set.</p>
      ${referralBlock}
      <div style="background:#eff6ff;border:1px solid #3b82f6;border-radius:8px;padding:16px;margin:20px 0;">
        <p style="margin:0 0 8px 0;font-weight:bold;color:#1e3a8a;">Loved the service?</p>
        <p style="margin:0;color:#1e40af;">We would be grateful if you left a quick review in your customer portal, and please share your referral link with friends and family so they can enjoy the same convenience — and so you can earn referral rewards.</p>
      </div>
      <p style="text-align:center;margin:24px 0;">
        <a href="${reviewUrl}" style="display:inline-block;background:#1e3a8a;color:#ffffff;padding:12px 22px;text-decoration:none;border-radius:8px;font-weight:bold;margin:4px;">Leave a Review</a>
        <a href="${portalUrl}" style="display:inline-block;background:#3b82f6;color:#ffffff;padding:12px 22px;text-decoration:none;border-radius:8px;font-weight:bold;margin:4px;">Customer Portal</a>
      </p>
      <p>We appreciate your business and hope to see you again soon.</p>
      <p style="color:#6b7280;font-size:12px;">If you did not return this rental, please contact us immediately.</p>
    </div>
  </div>
</body></html>`;
}
Deno.serve(async (req)=>{
  const corsHeaders = getCorsHeaders(req);
  const jsonResponse = makeJsonResponse(corsHeaders);
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  try {
    const body = await req.json();
    const orderId = body.order_id ?? body.bookingId ?? body.booking_id;
    const lockEventTimestamp = body.lock_event_timestamp || new Date().toISOString();
    if (!orderId) {
      return jsonResponse({
        success: false,
        error: "order_id required"
      }, 400);
    }
    const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
    const { data: booking, error } = await supabase.from("bookings").select("*, customers(*)").eq("id", orderId).single();
    if (error || !booking) {
      return jsonResponse({
        success: false,
        error: error?.message || "Booking not found"
      }, 404);
    }
    if (booking.return_notified_at) {
      return jsonResponse({
        success: true,
        skipped: true,
        reason: "already_notified",
        order_id: orderId
      });
    }
    const customer = booking.customers || {};
    const customerId = booking.customer_id || customer.id;
    const name = booking.name || customer.name || "Customer";
    const email = booking.email || customer.email;
    const phone = booking.phone || customer.phone;
    const smsOptIn = customer.sms_opt_in !== false;
    const siteUrl = normalizeSiteUrl(body.site_url || Deno.env.get("SITE_URL"));
    const portalUrl = `${siteUrl}/customer-portal`;
    const reviewUrl = `${siteUrl}/customer-portal?tab=communication`;
    let referralUrl = null;
    let referralBalance = 0;
    if (customerId) {
      const [{ data: referralRows }, { data: wallet }] = await Promise.all([
        supabase.from("referrals").select("referral_code").eq("referrer_customer_id", customerId).order("created_at", {
          ascending: true
        }).limit(1),
        supabase.from("customer_referral_wallets").select("available_balance").eq("customer_id", customerId).maybeSingle()
      ]);
      const code = referralRows?.[0]?.referral_code;
      if (code) {
        referralUrl = `${siteUrl}/?ref=${encodeURIComponent(code)}`;
      }
      referralBalance = Number(wallet?.available_balance) || 0;
    }
    const returnedAtFriendly = formatFriendly(lockEventTimestamp);
    const html = buildEmailHTML({
      name,
      orderId,
      returnedAt: returnedAtFriendly,
      portalUrl,
      reviewUrl,
      referralUrl,
      referralBalance
    });
    const emailResult = email ? await sendEmail(email, `Thank you for your rental! (Order #${orderId})`, html) : {
      success: false,
      error: "No email"
    };
    const smsParts = [
      `U-Fill Dumpsters: Thanks for returning your rental (locked ${returnedAtFriendly}).`,
      "Any final charges will be emailed after inspection."
    ];
    if (referralUrl) {
      smsParts.push(`Share & earn rewards: ${referralUrl}`);
    }
    smsParts.push(`Review us: ${reviewUrl}`);
    const smsResult = await sendSms(phone, smsParts.join(" "), {
      smsOptIn
    });
    // Admin alert (best-effort)
    const adminEmail = Deno.env.get("BREVO_FROM_EMAIL");
    if (adminEmail) {
      await sendEmail(adminEmail, `Trailer Returned — Order #${orderId}`, `<h2>Trailer Return Notification</h2>
         <p><strong>Order:</strong> #${orderId}</p>
         <p><strong>Customer:</strong> ${name} (${email || "n/a"})</p>
         <p><strong>Return Time:</strong> ${returnedAtFriendly}</p>
         <p><strong>Status:</strong> pending_checklist — awaiting inspection</p>`);
    }
    const now = new Date().toISOString();
    await supabase.from("bookings").update({
      return_notified_at: now
    }).eq("id", orderId);
    console.log("[send-return-confirmation] Done", {
      orderId,
      emailResult,
      smsResult
    });
    return jsonResponse({
      success: true,
      order_id: orderId,
      email: emailResult,
      sms: smsResult
    });
  } catch (error) {
    console.error("[send-return-confirmation] Error:", error);
    return jsonResponse({
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }, 500);
  }
});


// ============================
// Function: generate-magic-link-token
// ============================

// --- File: generate-magic-link-token/cors.ts ---

export { getCorsHeaders } from '../_shared/cors.ts';


// --- File: generate-magic-link-token/index.ts ---

import { getCorsHeaders } from "./cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.30.0";
Deno.serve(async (req)=>{
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const supabase = createClient(supabaseUrl, supabaseKey);
    const { customer_id, phone, order_id } = await req.json();
    if (!customer_id || !phone) {
      return new Response(JSON.stringify({
        error: "Missing customer_id or phone"
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    // Verify customer exists
    const { data: customer, error: customerError } = await supabase.from("customers").select("id, phone").eq("id", customer_id).single();
    if (customerError || !customer) {
      return new Response(JSON.stringify({
        error: "Customer not found"
      }), {
        status: 404,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    // Normalize phone numbers for comparison
    const normalizedPhone = phone.replace(/\D/g, "");
    const normalizedCustomerPhone = (customer.phone || "").replace(/\D/g, "");
    if (!normalizedCustomerPhone.endsWith(normalizedPhone.slice(-4))) {
      return new Response(JSON.stringify({
        error: "Phone number does not match customer"
      }), {
        status: 403,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    let normalizedOrderId = null;
    if (order_id !== null && order_id !== undefined && String(order_id).trim() !== "") {
      const parsedOrderId = Number(order_id);
      if (!Number.isFinite(parsedOrderId)) {
        return new Response(JSON.stringify({
          error: "Invalid order_id"
        }), {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }
      const { data: booking, error: bookingError } = await supabase.from("bookings").select("id, customer_id").eq("id", parsedOrderId).maybeSingle();
      if (bookingError || !booking) {
        return new Response(JSON.stringify({
          error: "Booking not found"
        }), {
          status: 404,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }
      if (booking.customer_id && Number(booking.customer_id) !== Number(customer_id)) {
        return new Response(JSON.stringify({
          error: "Booking does not belong to this customer"
        }), {
          status: 403,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }
      normalizedOrderId = Number(booking.id);
    }
    // Generate secure token
    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    // Store token in database
    const { data: tokenData, error: tokenError } = await supabase.from("magic_link_tokens").insert({
      token,
      customer_id,
      phone: customer.phone,
      order_id: normalizedOrderId,
      expires_at: expiresAt
    }).select().single();
    if (tokenError) {
      console.error("[generate-magic-link-token] Error storing token:", tokenError);
      return new Response(JSON.stringify({
        error: "Failed to generate token"
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    return new Response(JSON.stringify({
      token,
      expires_at: expiresAt
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  } catch (error) {
    console.error("[generate-magic-link-token] Error:", error);
    return new Response(JSON.stringify({
      error: error.message || "Internal server error"
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
});


// ============================
// Function: validate-magic-link-token
// ============================

// --- File: validate-magic-link-token/cors.ts ---

export { getCorsHeaders } from '../_shared/cors.ts';


// --- File: validate-magic-link-token/index.ts ---

import { getCorsHeaders } from "./cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.30.0";
const ACTIVE_BOOKING_STATUSES = new Set([
  "confirmed",
  "delivered",
  "waiting_to_be_returned",
  "rescheduled",
  "pending_payment",
  "pending_verification",
  "pending_review",
  "active"
]);
Deno.serve(async (req)=>{
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const supabase = createClient(supabaseUrl, supabaseKey);
    const { token, order_id } = await req.json();
    if (!token) {
      return new Response(JSON.stringify({
        error: "Missing token"
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    // Find token in database
    const { data: tokenData, error: tokenError } = await supabase.from("magic_link_tokens").select("*").eq("token", token).single();
    if (tokenError || !tokenData) {
      return new Response(JSON.stringify({
        error: "Invalid token",
        valid: false
      }), {
        status: 404,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const resolvedOrderId = tokenData.order_id ?? order_id;
    if (!resolvedOrderId) {
      return new Response(JSON.stringify({
        error: "Token is missing booking context",
        error_code: "booking_missing",
        valid: false
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const parsedOrderId = Number(resolvedOrderId);
    if (!Number.isFinite(parsedOrderId)) {
      return new Response(JSON.stringify({
        error: "Invalid booking reference",
        error_code: "booking_invalid",
        valid: false
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const { data: booking, error: bookingError } = await supabase.from("bookings").select("id, customer_id, status").eq("id", parsedOrderId).maybeSingle();
    if (bookingError || !booking) {
      return new Response(JSON.stringify({
        error: "Booking not found",
        error_code: "booking_not_found",
        valid: false
      }), {
        status: 404,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    if (booking.customer_id && Number(booking.customer_id) !== Number(tokenData.customer_id)) {
      return new Response(JSON.stringify({
        error: "Booking does not belong to this token",
        error_code: "booking_mismatch",
        valid: false
      }), {
        status: 403,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const normalizedStatus = String(booking.status || "").toLowerCase();
    if (!ACTIVE_BOOKING_STATUSES.has(normalizedStatus)) {
      return new Response(JSON.stringify({
        error: "Booking is no longer active. Please sign in to the portal.",
        error_code: "booking_inactive",
        booking_status: booking.status,
        valid: false
      }), {
        status: 403,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    if (!tokenData.order_id) {
      await supabase.from("magic_link_tokens").update({
        order_id: parsedOrderId
      }).eq("id", tokenData.id);
    }
    // Fetch customer details
    const { data: customer, error: customerError } = await supabase.from("customers").select("*").eq("id", tokenData.customer_id).single();
    if (customerError || !customer) {
      return new Response(JSON.stringify({
        error: "Customer not found",
        valid: false
      }), {
        status: 404,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    return new Response(JSON.stringify({
      valid: true,
      customer_id: customer.id,
      phone: customer.phone,
      customer,
      order_id: parsedOrderId,
      booking_status: booking.status
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  } catch (error) {
    console.error("[validate-magic-link-token] Error:", error);
    return new Response(JSON.stringify({
      error: error.message || "Internal server error",
      valid: false
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
});


// ============================
// Function: finalize-booking
// ============================

// --- File: finalize-booking/cors.ts ---

export { getCorsHeaders } from '../_shared/cors.ts';


// --- File: finalize-booking/index.ts ---

import { getCorsHeaders } from "./cors.ts";
import { Stripe } from "npm:stripe@15.8.0";
import { createClient } from "npm:@supabase/supabase-js@2";
const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "", {
  apiVersion: "2024-06-20"
});
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const log = (msg, data)=>console.log(`[finalize-booking] ${msg}`, data !== undefined ? data : "");
async function sendBookingConfirmationEmail(bookingId, siteUrl) {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/send-booking-confirmation`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
    },
    body: JSON.stringify({
      bookingId,
      site_url: siteUrl
    })
  });
  let result = {};
  try {
    result = await response.json();
  } catch  {
    result = {
      error: "Invalid response from send-booking-confirmation"
    };
  }
  if (response.ok && result.success === true) {
    return {
      sent: true,
      alreadySent: result.already_sent === true,
      recipient: result.recipient ?? null,
      emailType: String(result.email_type || "confirmation")
    };
  }
  const errorMessage = String(result.error ?? result.details ?? `HTTP ${response.status}`);
  console.error("[finalize-booking] send-booking-confirmation failed:", errorMessage);
  return {
    sent: false,
    error: errorMessage
  };
}
const toPositiveInt = (value)=>{
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
};
async function upsertTaxLedgerForBooking(booking) {
  const bookingId = Number(booking?.id);
  if (!Number.isFinite(bookingId) || bookingId <= 0) return;
  const taxAmount = Number(booking.tax_amount || 0);
  const taxRate = Number(booking.tax_rate_used || 0);
  if (taxAmount <= 0 && taxRate <= 0) return;
  try {
    const { error } = await supabase.rpc("upsert_booking_tax_record", {
      p_booking_id: bookingId
    });
    if (error) {
      console.error("[finalize-booking] upsert_booking_tax_record failed:", error);
    } else {
      log("Tax ledger upserted for booking", bookingId);
    }
  } catch (err) {
    console.error("[finalize-booking] tax ledger exception:", err);
  }
}
Deno.serve(async (req)=>{
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }
  try {
    const body = await req.json();
    const bookingId = body.bookingId ?? body.booking_id;
    const paymentIntentId = body.paymentIntentId ?? body.payment_intent_id ?? null;
    const siteUrl = body.site_url;
    if (!bookingId) {
      throw new Error("bookingId is required.");
    }
    log("Received request", {
      bookingId,
      paymentIntentId
    });
    // ----------------------------------------------------------------
    // Step 1: Fetch booking — guard against double-processing
    // ----------------------------------------------------------------
    const { data: booking, error: fetchError } = await supabase.from("bookings").select("*, customers!inner(*)").eq("id", bookingId).single();
    if (fetchError || !booking) {
      throw new Error(`Could not fetch booking ${bookingId}: ${fetchError?.message ?? "not found"}`);
    }
    // If already past pending_payment, run catch-up steps (email/loyalty may have failed mid-flight).
    if (booking.status !== "pending_payment") {
      log(`Booking ${bookingId} already finalized. Status: ${booking.status}. Running catch-up.`);
      let emailSent = false;
      let pointsAwarded = 0;
      const bookingTotal = Number(booking.total_price || 0);
      const { data: loyaltySettings } = await supabase.from("loyalty_settings").select("points_per_dollar").maybeSingle();
      const pointsPerDollar = Number(loyaltySettings?.points_per_dollar || 10);
      if (booking.customer_id && bookingTotal > 0) {
        const pointsToAward = Math.floor(bookingTotal * pointsPerDollar);
        if (pointsToAward > 0) {
          const { data: awardResult, error: awardError } = await supabase.rpc("adjust_loyalty_points", {
            p_customer_id: booking.customer_id,
            p_points: pointsToAward,
            p_transaction_type: "earned",
            p_booking_id: booking.id,
            p_referral_id: null,
            p_notes: "Booking completion points"
          });
          if (awardError) {
            console.error("[finalize-booking] Loyalty catch-up failed:", awardError);
          } else {
            const award = Array.isArray(awardResult) ? awardResult[0] : awardResult;
            if (!award?.already_processed) {
              pointsAwarded = pointsToAward;
            }
          }
        }
      }
      await upsertTaxLedgerForBooking(booking);
      let emailError = null;
      let emailType = null;
      if (booking.confirmation_email_sent_at) {
        emailSent = true;
        emailType = "confirmation";
        log("Skipping confirmation email catch-up; already sent.");
      } else {
        const emailResult = await sendBookingConfirmationEmail(booking.id, siteUrl);
        if (emailResult.sent) {
          emailSent = true;
          emailType = emailResult.emailType;
          if (emailResult.alreadySent) {
            log("Booking email catch-up skipped (already claimed).", emailType);
          } else {
            log("Booking email catch-up sent successfully.", emailType);
          }
        } else {
          emailError = emailResult.error;
        }
      }
      if (booking.customer_id && !booking.customers?.user_id) {
        log("Invoking handle-booking-account-creation (catch-up)…");
        const { error: accountError } = await supabase.functions.invoke("handle-booking-account-creation", {
          body: {
            customerId: booking.customer_id
          }
        });
        if (accountError) {
          console.error("[finalize-booking] handle-booking-account-creation catch-up failed:", accountError);
        } else {
          log("Account creation catch-up invoked successfully.");
        }
      }
      return new Response(JSON.stringify({
        success: true,
        message: "Booking already finalized.",
        alreadyProcessed: true,
        emailSent,
        emailError,
        emailType,
        status: booking.status,
        loyalty: {
          pointsAwarded,
          pointsRedeemed: 0,
          referralBonusAwarded: 0,
          referralApplied: false,
          referralDollarsRedeemed: 0,
          referralPendingRecorded: false
        }
      }), {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        },
        status: 200
      });
    }
    // ----------------------------------------------------------------
    // Step 2: Retrieve PaymentIntent from Stripe
    // ----------------------------------------------------------------
    let chargeId = null;
    let stripeCustomerId = null;
    let verifiedPaymentIntentId = paymentIntentId;
    if (paymentIntentId) {
      try {
        log("Retrieving PaymentIntent from Stripe…", paymentIntentId);
        const pi = await stripe.paymentIntents.retrieve(paymentIntentId, {
          expand: [
            "latest_charge"
          ]
        });
        log("PaymentIntent status", pi.status);
        if (pi.status !== "succeeded") {
          log("PaymentIntent not succeeded — aborting finalization", pi.status);
          return new Response(JSON.stringify({
            success: false,
            error: `Payment not completed. Stripe status: ${pi.status}`
          }), {
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json"
            },
            status: 402
          });
        }
        verifiedPaymentIntentId = pi.id;
        if (pi.latest_charge) {
          chargeId = typeof pi.latest_charge === "string" ? pi.latest_charge : pi.latest_charge.id;
        }
        log("Resolved chargeId", chargeId);
        const customerEmail = booking.customers?.email ?? booking.email ?? "";
        const customerName = booking.customers?.name ?? `${booking.first_name ?? ""} ${booking.last_name ?? ""}`.trim();
        if (customerEmail) {
          const existingStripeId = booking.customers?.stripe_customer_id ?? null;
          if (existingStripeId) {
            stripeCustomerId = existingStripeId;
            log("Using existing Stripe customer", stripeCustomerId);
          } else {
            const existing = await stripe.customers.list({
              email: customerEmail,
              limit: 1
            });
            if (existing.data.length > 0) {
              stripeCustomerId = existing.data[0].id;
              log("Found existing Stripe customer by email", stripeCustomerId);
            } else {
              const created = await stripe.customers.create({
                email: customerEmail,
                name: customerName || undefined,
                phone: booking.customers?.phone ?? booking.phone ?? undefined,
                metadata: {
                  supabase_customer_id: String(booking.customers?.id ?? ""),
                  booking_id: String(bookingId)
                }
              });
              stripeCustomerId = created.id;
              log("Created new Stripe customer", stripeCustomerId);
            }
          }
        }
      } catch (stripeErr) {
        console.error("[finalize-booking] Stripe retrieval error:", stripeErr);
      }
    } else {
      log("No paymentIntentId provided — skipping Stripe retrieval.");
    }
    // ----------------------------------------------------------------
    // Step 3: Upsert stripe_payment_info
    // ----------------------------------------------------------------
    log("Upserting stripe_payment_info…", {
      bookingId,
      verifiedPaymentIntentId,
      chargeId,
      stripeCustomerId
    });
    const { error: paymentInfoError } = await supabase.from("stripe_payment_info").upsert({
      booking_id: bookingId,
      stripe_payment_intent_id: verifiedPaymentIntentId,
      stripe_charge_id: chargeId,
      stripe_customer_id: stripeCustomerId,
      stripe_checkout_session_id: null,
      updated_at: new Date().toISOString()
    }, {
      onConflict: "booking_id"
    });
    if (paymentInfoError) {
      console.error("[finalize-booking] stripe_payment_info upsert failed:", paymentInfoError);
    } else {
      log("stripe_payment_info upserted successfully.");
    }
    // ----------------------------------------------------------------
    // Step 4: Determine final booking status
    // ----------------------------------------------------------------
    const verificationSkipped = Boolean(booking.was_verification_skipped || booking.addons?.verificationSkipped || booking.addons?.wasVerificationSkipped);
    let finalStatus = "Confirmed";
    if (verificationSkipped) {
      finalStatus = "pending_verification";
    } else if (booking.addons?.addressVerificationSkipped) {
      finalStatus = "pending_review";
    }
    log("Determined final status", finalStatus);
    // ----------------------------------------------------------------
    // Step 5: Update booking status
    // ----------------------------------------------------------------
    const bookingUpdatePayload = {
      status: finalStatus
    };
    if (verificationSkipped && !booking.was_verification_skipped) {
      bookingUpdatePayload.was_verification_skipped = true;
    }
    // Paid — keep stock allocated; clear unpaid hold flag so cleanup/cancel do not restock
    if (booking.addons?.equipment_hold_active === true) {
      bookingUpdatePayload.addons = {
        ...booking.addons,
        equipment_hold_active: false
      };
    }
    const { data: updatedBooking, error: updateError } = await supabase.from("bookings").update(bookingUpdatePayload).eq("id", bookingId).select("*, customers!inner(*)").single();
    if (updateError || !updatedBooking) {
      throw new Error(`Failed to update booking status: ${updateError?.message ?? "unknown"}`);
    }
    log("Booking status updated", finalStatus);
    // If customer saw the idle "still here" prompt and then paid, mark CRM converted
    if (updatedBooking.addons?.idle_prompt_shown === true) {
      const { error: convertedError } = await supabase.rpc("upsert_abandoned_checkout_from_booking", {
        p_booking_id: bookingId,
        p_status: "converted",
        p_set_reminder_sent: false
      });
      if (convertedError) {
        console.error("[finalize-booking] converted abandoned_checkout upsert failed:", convertedError);
      } else {
        log("Abandoned checkout marked converted after idle-prompt recovery.");
      }
    }
    // ----------------------------------------------------------------
    // Step 5b: Loyalty, coupon, and referral side effects
    // ----------------------------------------------------------------
    const loyaltyOutcome = {
      pointsAwarded: 0,
      pointsRedeemed: 0,
      referralBonusAwarded: 0,
      referralApplied: false,
      referralDollarsRedeemed: 0,
      referralPendingRecorded: false
    };
    const bookingTotal = Number(updatedBooking.total_price || 0);
    const redeemedPoints = toPositiveInt(updatedBooking.addons?.loyaltyPointsToRedeem);
    const referralCode = (updatedBooking.addons?.referralCode || updatedBooking.addons?.referral_code || "").trim();
    const couponId = Number(updatedBooking.addons?.coupon?.id || 0);
    const { data: loyaltySettings } = await supabase.from("loyalty_settings").select("points_per_dollar, referral_bonus_dollars").maybeSingle();
    const pointsPerDollar = Number(loyaltySettings?.points_per_dollar || 10);
    const referralBonusDollars = Number(loyaltySettings?.referral_bonus_dollars || 25);
    const redeemedReferralDollars = Number(updatedBooking.addons?.referralDollarsToRedeem || updatedBooking.addons?.referral_wallet_to_redeem || 0);
    if (updatedBooking.customer_id && redeemedPoints > 0) {
      const { data: redeemResult, error: redeemError } = await supabase.rpc("adjust_loyalty_points", {
        p_customer_id: updatedBooking.customer_id,
        p_points: redeemedPoints,
        p_transaction_type: "redeemed",
        p_booking_id: updatedBooking.id,
        p_referral_id: null,
        p_notes: "Redeemed during checkout"
      });
      if (redeemError) {
        throw new Error(`Loyalty redemption failed: ${redeemError.message}`);
      }
      const redemption = Array.isArray(redeemResult) ? redeemResult[0] : redeemResult;
      if (!redemption?.already_processed) {
        loyaltyOutcome.pointsRedeemed = redeemedPoints;
      }
    }
    if (updatedBooking.customer_id && redeemedReferralDollars > 0) {
      const { data: referralRedeemResult, error: referralRedeemError } = await supabase.rpc("adjust_referral_wallet", {
        p_customer_id: updatedBooking.customer_id,
        p_amount: redeemedReferralDollars,
        p_transaction_type: "redeemed",
        p_booking_id: updatedBooking.id,
        p_referral_id: null,
        p_notes: "Redeemed during checkout"
      });
      if (referralRedeemError) {
        throw new Error(`Referral wallet redemption failed: ${referralRedeemError.message}`);
      }
      const redemption = Array.isArray(referralRedeemResult) ? referralRedeemResult[0] : referralRedeemResult;
      if (!redemption?.already_processed) {
        loyaltyOutcome.referralDollarsRedeemed = Number(redeemedReferralDollars.toFixed(2));
      }
    }
    if (updatedBooking.customer_id && bookingTotal > 0) {
      const pointsToAward = Math.floor(bookingTotal * pointsPerDollar);
      if (pointsToAward > 0) {
        const { data: awardResult, error: awardError } = await supabase.rpc("adjust_loyalty_points", {
          p_customer_id: updatedBooking.customer_id,
          p_points: pointsToAward,
          p_transaction_type: "earned",
          p_booking_id: updatedBooking.id,
          p_referral_id: null,
          p_notes: "Booking completion points"
        });
        if (awardError) {
          throw new Error(`Loyalty award failed: ${awardError.message}`);
        }
        const award = Array.isArray(awardResult) ? awardResult[0] : awardResult;
        if (!award?.already_processed) {
          loyaltyOutcome.pointsAwarded = pointsToAward;
        }
      }
    }
    let referralRegistrationError = null;
    if (updatedBooking.customer_id && referralCode) {
      const { data: referralResult, error: referralError } = await supabase.rpc("register_referral_for_booking", {
        p_booking_id: updatedBooking.id,
        p_referee_customer_id: updatedBooking.customer_id,
        p_referral_code: referralCode,
        p_bonus_dollars: referralBonusDollars
      });
      if (referralError) {
        referralRegistrationError = referralError.message || "Referral registration failed";
        console.error("[finalize-booking] Referral completion failed:", referralError);
      } else {
        const referral = Array.isArray(referralResult) ? referralResult[0] : referralResult;
        if (referral?.referral_id) {
          loyaltyOutcome.referralApplied = true;
          if (referral?.pending_recorded) {
            loyaltyOutcome.referralPendingRecorded = true;
          }
          if (referral?.already_rewarded) {
            loyaltyOutcome.referralBonusAwarded = Number(referralBonusDollars.toFixed(2));
          }
        }
      }
    }
    if (couponId > 0) {
      const { data: couponRow } = await supabase.from("coupons").select("id, usage_count").eq("id", couponId).maybeSingle();
      const nextUsage = Number(couponRow?.usage_count || 0) + 1;
      const { error: couponError } = await supabase.from("coupons").update({
        usage_count: nextUsage
      }).eq("id", couponId);
      if (couponError) {
        console.error("[finalize-booking] coupon usage increment failed:", couponError);
      }
    }
    const rewardsAddonsPatch = {
      ...updatedBooking.addons || {},
      loyaltyPointsEarned: Number(loyaltyOutcome.pointsAwarded || 0),
      loyaltyPointsRedeemed: Number(loyaltyOutcome.pointsRedeemed || 0),
      referralDollarsRedeemed: Number(loyaltyOutcome.referralDollarsRedeemed || 0),
      referralDollarsPending: loyaltyOutcome.referralPendingRecorded ? Number(referralBonusDollars.toFixed(2)) : Number(updatedBooking.addons?.referralDollarsPending || 0),
      rewardsSummaryUpdatedAt: new Date().toISOString(),
      ...referralRegistrationError ? {
        referralRegistrationError,
        referralRegistrationFailedAt: new Date().toISOString()
      } : {
        referralRegistrationError: null
      }
    };
    const { data: bookingWithRewards, error: rewardsPatchError } = await supabase.from("bookings").update({
      addons: rewardsAddonsPatch
    }).eq("id", updatedBooking.id).select("*, customers!inner(*)").single();
    if (rewardsPatchError) {
      console.error("[finalize-booking] rewards summary patch failed:", rewardsPatchError);
    } else if (bookingWithRewards) {
      Object.assign(updatedBooking, bookingWithRewards);
    }
    await upsertTaxLedgerForBooking(updatedBooking);
    // ----------------------------------------------------------------
    // Step 5c: Notify admin chat when verification was skipped
    // ----------------------------------------------------------------
    if (finalStatus === "pending_verification") {
      const skipReason = updatedBooking.verification_notes?.trim() || "No reason provided.";
      const chatContent = `Driver & Vehicle Verification was skipped for Booking #${bookingId}. ` + `Reason: ${skipReason} ` + `This booking requires customer service review before it can be confirmed.`;
      const { error: chatError } = await supabase.from("chat_messages").insert({
        conversation_id: `cust_${updatedBooking.customer_id}`,
        customer_id: updatedBooking.customer_id,
        booking_id: bookingId,
        sender_type: "customer",
        message_content: chatContent,
        is_read: false
      });
      if (chatError) {
        console.error("[finalize-booking] chat_messages insert failed:", chatError);
      } else {
        log("Verification skip chat message inserted.");
      }
    }
    // ----------------------------------------------------------------
    // Step 6: Insert equipment rental records
    // ----------------------------------------------------------------
    const addons = updatedBooking.addons ?? {};
    if (addons.equipment?.length > 0) {
      const hasDbIds = addons.equipment.every((item)=>item.dbId);
      let equipmentToInsert = [];
      if (hasDbIds) {
        equipmentToInsert = addons.equipment.map((item)=>({
            booking_id: bookingId,
            equipment_id: item.dbId,
            quantity: item.quantity
          })).filter((item)=>item.equipment_id);
      } else {
        const { data: equipmentList, error: equipmentListError } = await supabase.from("equipment").select("id, name");
        if (equipmentListError) {
          console.error("[finalize-booking] Could not fetch equipment list:", equipmentListError);
        } else {
          const equipmentMap = new Map((equipmentList ?? []).map((e)=>[
              e.name.toLowerCase().replace(/ /g, ""),
              e.id
            ]));
          equipmentToInsert = addons.equipment.map((item)=>{
            const key = item.id.toLowerCase().replace(/ /g, "");
            const equipmentId = equipmentMap.get(key);
            if (!equipmentId) {
              console.warn("[finalize-booking] No equipment match for:", item.id);
              return null;
            }
            return {
              booking_id: bookingId,
              equipment_id: equipmentId,
              quantity: item.quantity
            };
          }).filter(Boolean);
        }
      }
      if (equipmentToInsert.length > 0) {
        const { error: insertError } = await supabase.from("booking_equipment").insert(equipmentToInsert);
        if (insertError) {
          console.error("[finalize-booking] booking_equipment insert failed:", insertError);
        } else {
          log("Equipment records inserted", equipmentToInsert.length);
        }
      }
    }
    // ----------------------------------------------------------------
    // Step 7: Create customer account
    // ----------------------------------------------------------------
    log("Invoking handle-booking-account-creation…");
    const { error: accountError } = await supabase.functions.invoke("handle-booking-account-creation", {
      body: {
        customerId: updatedBooking.customer_id
      }
    });
    if (accountError) {
      console.error("[finalize-booking] handle-booking-account-creation failed:", accountError);
    } else {
      log("Account creation invoked successfully.");
    }
    // ----------------------------------------------------------------
    // Step 9: Send confirmation email
    // ----------------------------------------------------------------
    log("Sending booking email…");
    let emailSent = false;
    let emailError = null;
    let emailType = null;
    const emailResult = await sendBookingConfirmationEmail(updatedBooking.id, siteUrl);
    if (emailResult.sent) {
      emailSent = true;
      emailType = emailResult.emailType;
      log("Booking email sent successfully.", emailType);
    } else {
      emailError = emailResult.error;
    }
    // ----------------------------------------------------------------
    // Done
    // ----------------------------------------------------------------
    log("Finalization complete", {
      bookingId,
      finalStatus,
      emailSent
    });
    return new Response(JSON.stringify({
      success: true,
      status: finalStatus,
      emailSent,
      emailError,
      emailType,
      booking: updatedBooking,
      loyalty: loyaltyOutcome
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      },
      status: 200
    });
  } catch (error) {
    console.error("[finalize-booking] CRITICAL ERROR:", error);
    return new Response(JSON.stringify({
      success: false,
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


// ============================
// Function: generate-daily-pins
// ============================

// --- File: generate-daily-pins/cors.ts ---

export { getCorsHeaders } from '../_shared/cors.ts';


// --- File: generate-daily-pins/index.ts ---

/**
 * @deprecated Superseded by `reconcile-lock-pins`, which merges this
 * function's delete/create phases with ensure-lock-pin-ready's
 * confirm/escalate phase into a single 5-minute cron job. Left in place
 * (unscheduled) for manual invocation / rollback until reconcile-lock-pins
 * has been validated in production; see 20260826_consolidate_pin_reconciler_cron.sql.
 */ import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getCorsHeaders } from "./cors.ts";
import { addGraceHour, buildBookingDateUTC, formatAlgoPinStartIso, getPinActivationStart, getPinWindowSkipReason, isWithinPinGenerationWindow } from "../_shared/pinTiming.ts";
import { ensurePinOnLock } from "../_shared/lockPin.ts";
import { getOAuthToken, GENERATE_PIN_SCOPES } from "../_shared/iglooAuth.ts";
import { bookingNeedsYardLockPin, isDeliveryBooking } from "../_shared/deliveryBooking.ts";
const IGLOOHOME_API_BASE_URL = "https://api.igloodeveloper.co/igloohome";
function makeJsonResponse(corsHeaders) {
  return (body, status = 200)=>new Response(JSON.stringify(body), {
      status,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
}
async function readResponse(res) {
  const text = await res.text();
  try {
    return {
      text,
      json: text ? JSON.parse(text) : null
    };
  } catch  {
    return {
      text,
      json: null
    };
  }
}
function generateRandomPin() {
  return String(Math.floor(Math.random() * 900000) + 100000);
}
function sleep(ms) {
  return new Promise((resolve)=>setTimeout(resolve, ms));
}
/**
 * Parse a time slot string like "6:00 AM" or "11:00 PM" and convert MST -> UTC.
 * Returns an ISO string like "2026-05-06T12:00:00+00:00"
 *
 * MST is UTC-6, so we add 6 hours to convert local -> UTC.
 * If the UTC hour crosses midnight (>= 24), we roll to the next day.
 *
 * Falls back to the provided fallbackHourUTC if the slot cannot be parsed.
 */ function buildIgloohomeDate(date, timeSlot, fallbackHourUTC) {
  if (timeSlot && !timeSlot.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i)) {
    console.warn(`[generate-daily-pins] Could not parse time slot: "${timeSlot}" — using fallback`);
  }
  return buildBookingDateUTC(date, timeSlot, fallbackHourUTC);
}
async function maybeSendPinNotification(supabase, booking, pin, startTime, endTime) {
  if (isDeliveryBooking(booking)) {
    console.log(`[generate-daily-pins] Skipping notification for booking #${booking.id} — delivery`);
    return;
  }
  if (booking.pin_notification_sent_at) {
    console.log(`[generate-daily-pins] Skipping notification for booking #${booking.id} — already sent`);
    return;
  }
  const { error } = await supabase.functions.invoke("send-booking-confirmation", {
    body: {
      booking_id: booking.id,
      email_type: "pin_update",
      pin,
      start_time: startTime,
      end_time: endTime
    }
  });
  if (error) {
    console.error(`[generate-daily-pins] PIN notification failed for booking #${booking.id}:`, error.message);
    return;
  }
  const now = new Date().toISOString();
  await supabase.from("bookings").update({
    pin_notification_sent_at: now
  }).eq("id", booking.id);
  await supabase.from("rental_access_codes").update({
    notified_at: now
  }).eq("order_id", booking.id).eq("status", "active");
  console.log(`[generate-daily-pins] ✓ PIN notification sent for booking #${booking.id}`);
}
async function getOAuthTokenForPins(clientId, clientSecret) {
  const result = await getOAuthToken(clientId, clientSecret, GENERATE_PIN_SCOPES);
  console.log("[generate-daily-pins] OAuth:", result.token ? `ok (${result.scopesUsed})` : result.reason);
  return result.token;
}
async function isLockOnline(accessToken, lockId) {
  const res = await fetch(`${IGLOOHOME_API_BASE_URL}/devices`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json"
    }
  });
  const body = await readResponse(res);
  if (!res.ok || !body.json?.payload) return false;
  const lock = body.json.payload.find((d)=>d.deviceId === lockId);
  if (!lock) return false;
  const bridge = body.json.payload.find((d)=>d.type === "Bridge" && d.linkedDevices?.length > 0);
  const online = !!bridge;
  console.log(`[generate-daily-pins] Lock reachable via bridge: ${online}`);
  return online;
}
async function deletePinFromLock(accessToken, lockId, bridgeId, pin) {
  const res = await fetch(`${IGLOOHOME_API_BASE_URL}/devices/${lockId}/jobs/bridges/${bridgeId}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({
      jobType: 5,
      jobData: {
        pin
      }
    })
  });
  const body = await readResponse(res);
  console.log("[generate-daily-pins] Delete PIN response:", {
    status: res.status,
    body: body.json
  });
  if (!res.ok && res.status !== 201) {
    return {
      success: false,
      error: `Delete failed with status ${res.status}`
    };
  }
  return {
    success: true
  };
}
async function createBridgePin(accessToken, lockId, bridgeId, pin, startDate, endDate, accessName) {
  const url = `${IGLOOHOME_API_BASE_URL}/devices/${lockId}/jobs/bridges/${bridgeId}`;
  const payload = {
    jobType: 4,
    jobData: {
      accessName,
      pin,
      pinType: 4,
      startDate,
      endDate
    }
  };
  console.log("[generate-daily-pins] Creating bridge PIN:", {
    url,
    payload
  });
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify(payload)
  });
  const body = await readResponse(res);
  console.log("[generate-daily-pins] Bridge PIN response:", {
    status: res.status,
    body: body.json
  });
  if (!res.ok && res.status !== 201) {
    return {
      success: false,
      error: `Bridge PIN failed with status ${res.status}`
    };
  }
  return {
    success: true,
    pinId: body.json?.jobId || body.json?.pinId || body.json?.id || ""
  };
}
async function createAlgoPin(accessToken, lockId, dropOffDate, dropOffTimeSlot, pickupDate, orderId) {
  const startDateHourOnly = formatAlgoPinStartIso(buildBookingDateUTC(dropOffDate, dropOffTimeSlot, 12));
  const startUnix = new Date(startDateHourOnly).getTime() / 1000;
  const endUnix = new Date(pickupDate + "T23:59:59Z").getTime() / 1000;
  const variance = Math.min(5, Math.max(1, Math.ceil((endUnix - startUnix) / 86400)));
  const payload = {
    accessName: `Dump Trailer Rental - Order #${orderId} (AlgoPIN)`,
    startDate: startDateHourOnly,
    variance
  };
  console.log("[generate-daily-pins] Creating AlgoPIN:", {
    url: `${IGLOOHOME_API_BASE_URL}/devices/${lockId}/algopin/onetime`,
    payload
  });
  const res = await fetch(`${IGLOOHOME_API_BASE_URL}/devices/${lockId}/algopin/onetime`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify(payload)
  });
  const body = await readResponse(res);
  console.log("[generate-daily-pins] AlgoPIN response:", {
    status: res.status,
    body: body.json
  });
  if (!res.ok && res.status !== 201) {
    return {
      success: false,
      error: `AlgoPIN failed with status ${res.status}`
    };
  }
  const pin = body.json?.pin || body.json?.access_code || body.json?.code || body.json?.data?.pin || "";
  if (!pin) return {
    success: false,
    error: "AlgoPIN succeeded but no PIN value in response"
  };
  return {
    success: true,
    pin,
    pinId: body.json?.pinId || body.json?.id || ""
  };
}
async function generatePinWithFallback(accessToken, lockId, bridgeId, supabase, booking) {
  const orderId = booking.id;
  const startDate = getPinActivationStart(booking);
  // PIN stays valid 1 hour past scheduled return so late returns still open the lock
  const endDate = addGraceHour(buildIgloohomeDate(booking.pickup_date, booking.pickup_time_slot, 5));
  console.log("[generate-daily-pins] PIN window:", {
    startDate,
    endDate
  });
  const accessName = `Dump Trailer Rental - Order #${orderId}`;
  const bridgeResult = await ensurePinOnLock(supabase, accessToken, {
    orderId,
    lockId,
    bridgeId,
    startDate,
    endDate,
    accessName,
    clearBudgetMs: 40_000,
    createBudgetMs: 50_000
  });
  if (bridgeResult.lockConfirmed || bridgeResult.jobId) {
    console.log(`[generate-daily-pins] Bridge PIN for order #${orderId}: state=${bridgeResult.createState} confirmed=${bridgeResult.lockConfirmed}`);
    return {
      success: true,
      pin: bridgeResult.pin,
      pinId: bridgeResult.jobId,
      pinType: "bridge_proxied",
      startDate,
      endDate,
      lockConfirmed: bridgeResult.lockConfirmed
    };
  }
  console.warn(`[generate-daily-pins] Bridge failed for order #${orderId}, trying AlgoPIN. Error: ${bridgeResult.error}`);
  const algoResult = await createAlgoPin(accessToken, lockId, booking.drop_off_date, booking.drop_off_time_slot, booking.pickup_date, orderId);
  if (algoResult.success) {
    console.log(`[generate-daily-pins] ✓ AlgoPIN succeeded for order #${orderId}`);
    return {
      success: true,
      pin: algoResult.pin,
      pinId: algoResult.pinId,
      pinType: "algopin",
      startDate,
      endDate,
      lockConfirmed: true
    };
  }
  return {
    success: false,
    error: `Bridge: ${bridgeResult.error} | AlgoPIN: ${algoResult.error}`,
    startDate,
    endDate
  };
}
function isTrailerRental(booking) {
  return bookingNeedsYardLockPin(booking);
}
Deno.serve(async (req)=>{
  const corsHeaders = getCorsHeaders(req);
  const jsonResponse = makeJsonResponse(corsHeaders);
  if (req.method === "OPTIONS") return new Response(null, {
    headers: corsHeaders
  });
  try {
    console.log("[generate-daily-pins] Cron started:", new Date().toISOString());
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const clientId = Deno.env.get("IGLOOHOME_CLIENT_ID");
    const clientSecret = Deno.env.get("IGLOOHOME_CLIENT_SECRET");
    const lockId = Deno.env.get("IGLOOHOME_LOCK_ID") || Deno.env.get("IGLOOHOME_DEVICE_ID");
    const bridgeId = Deno.env.get("IGLOOHOME_BRIDGE_ID");
    if (!supabaseUrl || !serviceRoleKey || !clientId || !clientSecret || !lockId || !bridgeId) {
      return jsonResponse({
        success: false,
        error: "Missing required environment variables"
      }, 500);
    }
    // ----------------------------------------------------------------
    // Auth — verify the caller is passing the service role key.
    // The pg_cron job passes it as a Bearer token.
    // ----------------------------------------------------------------
    const authHeader = req.headers.get("Authorization");
    const incomingKey = authHeader?.replace("Bearer ", "").trim();
    if (!incomingKey || incomingKey !== serviceRoleKey) {
      console.warn("[generate-daily-pins] Unauthorized request — invalid or missing service role key");
      return jsonResponse({
        success: false,
        error: "Unauthorized"
      }, 401);
    }
    console.log("[generate-daily-pins] Auth verified ✓");
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
    const accessToken = await getOAuthTokenForPins(clientId, clientSecret);
    if (!accessToken) {
      return jsonResponse({
        success: false,
        error: "Failed to get OAuth token"
      }, 500);
    }
    const now = new Date().toISOString();
    const today = new Date().toISOString().split("T")[0];
    let jobIndex = 0;
    // ================================================================
    // PHASE 1: DELETE PINs for cancelled / pending_review bookings
    //
    // Two cases handled:
    //
    // Case A — active PINs on cancelled/pending_review bookings.
    //   delete-pin hasn't been called yet, or booking was cancelled
    //   before delete-pin existed.
    //
    // Case B — expired PINs where lock_deleted_at is null.
    //   delete-pin already expired the DB row but the bridge was
    //   offline. We retry the lock deletion here until it succeeds.
    // ================================================================
    console.log("[generate-daily-pins] === PHASE 1: DELETIONS ===");
    // Case A: active PINs on cancelled/pending_review bookings
    const { data: activePinsToDelete, error: activeQueryError } = await supabase.from("rental_access_codes").select("id, order_id, access_pin, pin_type, bookings!inner(id, status)").eq("status", "active").in("bookings.status", [
      "Cancelled",
      "pending_review"
    ]);
    if (activeQueryError) {
      console.error("[generate-daily-pins] Failed to query active PINs to delete:", activeQueryError.message);
    }
    // Case B: expired PINs where lock deletion was not confirmed
    // (bridge was offline when delete-pin was called)
    const { data: pendingLockDeletes, error: pendingQueryError } = await supabase.from("rental_access_codes").select("id, order_id, access_pin, pin_type, bookings!inner(id, status)").eq("status", "expired").is("lock_deleted_at", null).in("bookings.status", [
      "Cancelled",
      "pending_review"
    ]);
    if (pendingQueryError) {
      console.error("[generate-daily-pins] Failed to query pending lock deletes:", pendingQueryError.message);
    }
    // Combine both cases — deduplicate by id just in case
    const allPinsToProcess = [
      ...activePinsToDelete ?? [],
      ...pendingLockDeletes ?? []
    ].filter((pin, index, self)=>self.findIndex((p)=>p.id === pin.id) === index);
    console.log(`[generate-daily-pins] Found ${activePinsToDelete?.length ?? 0} active + ${pendingLockDeletes?.length ?? 0} pending lock deletes = ${allPinsToProcess.length} total`);
    const deleteResults = [];
    for (const record of allPinsToProcess){
      if (jobIndex > 0) {
        console.log("[generate-daily-pins] Waiting 15s...");
        await sleep(15000);
      }
      jobIndex++;
      // AlgoPINs cannot be deleted from the lock remotely —
      // just ensure the DB row is expired and mark lock_deleted_at
      // to a sentinel value so we stop retrying
      if (record.pin_type === "algopin") {
        console.log(`[generate-daily-pins] Skipping lock delete for algopin on booking #${record.order_id} — will expire naturally`);
        await supabase.from("rental_access_codes").update({
          status: "expired",
          lock_deleted_at: now,
          notified_at: now
        }).eq("id", record.id);
        deleteResults.push({
          bookingId: record.order_id,
          success: true,
          method: "algopin_natural_expiry"
        });
        continue;
      }
      console.log(`[generate-daily-pins] Deleting PIN from lock for booking #${record.order_id} (pin: ${record.access_pin})`);
      try {
        const result = await deletePinFromLock(accessToken, lockId, bridgeId, record.access_pin);
        if (!result.success) {
          console.error(`[generate-daily-pins] Lock delete failed for booking #${record.order_id}:`, result.error);
          // Ensure DB is expired even if lock delete failed
          await supabase.from("rental_access_codes").update({
            status: "expired",
            notified_at: now
          }).eq("id", record.id);
          deleteResults.push({
            bookingId: record.order_id,
            success: false,
            error: result.error
          });
          continue;
        }
        // Lock delete confirmed — update both status and lock_deleted_at
        await supabase.from("rental_access_codes").update({
          status: "expired",
          lock_deleted_at: now,
          notified_at: now
        }).eq("id", record.id);
        console.log(`[generate-daily-pins] ✓ PIN fully deleted for booking #${record.order_id}`);
        deleteResults.push({
          bookingId: record.order_id,
          success: true,
          method: "bridge_deleted"
        });
      } catch (err) {
        console.error(`[generate-daily-pins] Error deleting PIN for booking #${record.order_id}:`, err);
        deleteResults.push({
          bookingId: record.order_id,
          success: false,
          error: String(err)
        });
      }
    }
    if (allPinsToProcess.length === 0) console.log("[generate-daily-pins] No PINs to delete.");
    // ================================================================
    // PHASE 2: GENERATE PINs for confirmed bookings without a PIN
    // ================================================================
    console.log("[generate-daily-pins] === PHASE 2: GENERATION ===");
    const lockOnline = await isLockOnline(accessToken, lockId);
    if (!lockOnline) {
      console.warn("[generate-daily-pins] Lock offline — AlgoPIN fallback will apply.");
    }
    const { data: bookings, error: fetchError } = await supabase.from("bookings").select("*").eq("status", "Confirmed").is("pin_generated_at", null).gte("drop_off_date", today).order("drop_off_date", {
      ascending: true
    });
    if (fetchError) {
      console.error("[generate-daily-pins] Failed to fetch bookings:", fetchError);
      return jsonResponse({
        success: false,
        error: fetchError.message
      }, 500);
    }
    const trailerBookings = (bookings ?? []).filter(isTrailerRental);
    const eligibleBookings = [];
    const skippedBookings = [];
    for (const booking of trailerBookings){
      const skipReason = getPinWindowSkipReason(booking);
      if (skipReason) {
        skippedBookings.push({
          bookingId: booking.id,
          reason: skipReason
        });
        console.log(`[generate-daily-pins] Skipping booking #${booking.id} — ${skipReason}`);
        continue;
      }
      if (!isWithinPinGenerationWindow(booking)) continue;
      eligibleBookings.push(booking);
    }
    console.log(`[generate-daily-pins] Found ${trailerBookings.length} trailer bookings, ${eligibleBookings.length} within 12h window, ${skippedBookings.length} skipped`);
    const generateResults = [];
    for (const booking of eligibleBookings){
      // Skip only if an active PIN is already bridge-confirmed.
      const { data: existingPin } = await supabase.from("rental_access_codes").select("id, lock_confirmed_at").eq("order_id", booking.id).eq("status", "active").maybeSingle();
      if (existingPin?.lock_confirmed_at) {
        console.log(`[generate-daily-pins] Skipping booking #${booking.id} — confirmed PIN already exists`);
        continue;
      }
      if (jobIndex > 0) {
        console.log("[generate-daily-pins] Waiting 15s...");
        await sleep(15000);
      }
      jobIndex++;
      console.log(`[generate-daily-pins] Processing booking #${booking.id} | drop_off: ${booking.drop_off_date} ${booking.drop_off_time_slot} | pickup: ${booking.pickup_date} ${booking.pickup_time_slot}`);
      try {
        const pinResult = await generatePinWithFallback(accessToken, lockId, bridgeId, supabase, booking);
        if (!pinResult.success) {
          console.error(`[generate-daily-pins] PIN generation failed for booking #${booking.id}:`, pinResult.error);
          generateResults.push({
            bookingId: booking.id,
            success: false,
            error: pinResult.error
          });
          continue;
        }
        const startTimeUTC = pinResult.startDate;
        const endTimeUTC = pinResult.endDate;
        // Expire any previous active row for this order before insert.
        await supabase.from("rental_access_codes").update({
          status: "expired"
        }).eq("order_id", booking.id).eq("status", "active");
        const { error: insertError } = await supabase.from("rental_access_codes").insert({
          order_id: booking.id,
          customer_email: booking.email,
          customer_phone: booking.phone || "",
          access_pin: pinResult.pin,
          pin_id: pinResult.pinId || "",
          pin_type: pinResult.pinType,
          lock_id: lockId,
          start_time: startTimeUTC,
          end_time: endTimeUTC,
          status: "active",
          lock_deleted_at: null,
          lock_confirmed_at: pinResult.lockConfirmed ? now : null,
          confirm_attempts: pinResult.lockConfirmed ? 0 : 1
        });
        if (insertError) {
          console.error(`[generate-daily-pins] DB insert failed for booking #${booking.id}:`, insertError.message);
          generateResults.push({
            bookingId: booking.id,
            success: false,
            error: insertError.message
          });
          continue;
        }
        // Only mark generated after a successful insert so cron can retry on failure.
        const { error: bookingUpdateError } = await supabase.from("bookings").update({
          pin_generated_at: now
        }).eq("id", booking.id);
        if (bookingUpdateError) {
          console.error(`[generate-daily-pins] Failed to update booking #${booking.id}:`, bookingUpdateError.message);
        }
        if (pinResult.lockConfirmed) {
          await maybeSendPinNotification(supabase, booking, pinResult.pin, startTimeUTC, endTimeUTC);
        }
        console.log(`[generate-daily-pins] ✓ Booking #${booking.id} complete (${pinResult.pinType}) confirmed=${pinResult.lockConfirmed}`);
        generateResults.push({
          bookingId: booking.id,
          success: true,
          pinType: pinResult.pinType,
          lockConfirmed: !!pinResult.lockConfirmed
        });
      } catch (err) {
        console.error(`[generate-daily-pins] Unexpected error for booking #${booking.id}:`, err);
        generateResults.push({
          bookingId: booking.id,
          success: false,
          error: String(err)
        });
      }
    }
    const deletedCount = deleteResults.filter((r)=>r.success).length;
    const generatedCount = generateResults.filter((r)=>r.success).length;
    console.log(`[generate-daily-pins] Done. Deleted: ${deletedCount}/${allPinsToProcess.length} | Generated: ${generatedCount}/${eligibleBookings.length}`);
    return jsonResponse({
      success: true,
      lockOnline,
      deleted: {
        processed: allPinsToProcess.length,
        succeeded: deletedCount,
        results: deleteResults
      },
      generated: {
        processed: eligibleBookings.length,
        succeeded: generatedCount,
        skipped: skippedBookings,
        results: generateResults
      }
    });
  } catch (error) {
    console.error("[generate-daily-pins] Unhandled exception:", error);
    return jsonResponse({
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }, 500);
  }
});


// ============================
// Function: stripe-webhook
// ============================

// --- File: stripe-webhook/index.ts ---

// stripe-webhook Edge Function
// Assumes STRIPE_WEBHOOK_SECRET is set as an environment secret
const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";
function hexToUint8Array(hex) {
  if (hex.length % 2 !== 0) throw new Error("Invalid hex");
  const arr = new Uint8Array(hex.length / 2);
  for(let i = 0; i < hex.length; i += 2){
    arr[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return arr;
}
function safeCompare(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for(let i = 0; i < a.length; i++)diff |= a[i] ^ b[i];
  return diff === 0;
}
function parseStripeSignatureHeader(header) {
  const parts = header.split(",");
  const map = {};
  for (const p of parts){
    const [k, v] = p.split("=");
    if (k && v) map[k] = v;
  }
  return map;
}
async function computeHmacSha256(secret, payload) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), {
    name: "HMAC",
    hash: "SHA-256"
  }, false, [
    "sign"
  ]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  const bytes = new Uint8Array(sig);
  return Array.from(bytes).map((b)=>b.toString(16).padStart(2, "0")).join("");
}
Deno.serve(async (req)=>{
  try {
    if (req.method !== "POST") {
      return new Response("Method not allowed", {
        status: 405
      });
    }
    const body = await req.text();
    const sigHeader = req.headers.get("stripe-signature");
    if (!sigHeader) {
      return new Response("Missing stripe-signature header", {
        status: 400
      });
    }
    if (!STRIPE_WEBHOOK_SECRET) {
      console.error("STRIPE_WEBHOOK_SECRET not set");
      return new Response("Server misconfiguration", {
        status: 500
      });
    }
    const parsed = parseStripeSignatureHeader(sigHeader);
    const timestamp = parsed["t"];
    const v1 = parsed["v1"];
    if (!timestamp || !v1) {
      return new Response("Invalid stripe-signature header", {
        status: 400
      });
    }
    const signedPayload = `${timestamp}.${body}`;
    const expectedSigHex = await computeHmacSha256(STRIPE_WEBHOOK_SECRET, signedPayload);
    const expected = hexToUint8Array(expectedSigHex);
    const actual = hexToUint8Array(v1);
    if (!safeCompare(expected, actual)) {
      return new Response("Invalid signature", {
        status: 400
      });
    }
    const tolSeconds = 300;
    const now = Math.floor(Date.now() / 1000);
    const tsNum = parseInt(timestamp, 10);
    if (Math.abs(now - tsNum) > tolSeconds) {
      return new Response("Timestamp outside the tolerance zone", {
        status: 400
      });
    }
    const evt = JSON.parse(body);
    switch(evt.type){
      case "payment_intent.succeeded":
        {
          const pi = evt.data.object;
          console.log("PaymentIntent succeeded:", pi.id);
          break;
        }
      case "invoice.payment_failed":
        {
          const invoice = evt.data.object;
          console.log("Invoice payment failed:", invoice.id);
          break;
        }
      case "checkout.session.completed":
        {
          const session = evt.data.object;
          console.log("Checkout session completed:", session.id);
          break;
        }
      default:
        console.log("Unhandled event type:", evt.type);
    }
    return new Response(JSON.stringify({
      received: true
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/json"
      }
    });
  } catch (err) {
    console.error("Webhook handler error:", err);
    return new Response("Internal error", {
      status: 500
    });
  }
});


// ============================
// Function: generate-pin
// ============================

// --- File: generate-pin/cors.ts ---

export { getCorsHeaders } from '../_shared/cors.ts';


// --- File: generate-pin/index.ts ---

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getCorsHeaders } from "./cors.ts";
import { addGraceHour, buildBookingDateUTC, formatAlgoPinStartIso, getPinActivationStart, isBookingEnded, isWithinPinGenerationWindow } from "../_shared/pinTiming.ts";
import { ensurePinOnLock } from "../_shared/lockPin.ts";
import { getOAuthToken, GENERATE_PIN_SCOPES } from "../_shared/iglooAuth.ts";
import { getJwtAal } from "../_shared/jwtAal.ts";
import { isDeliveryBooking } from "../_shared/deliveryBooking.ts";
const IGLOOHOME_API_BASE_URL = "https://api.igloodeveloper.co/igloohome";
/** Statuses eligible for customer portal + daily pin jobs */ const ELIGIBLE_BOOKING_STATUSES = [
  "Confirmed",
  "confirmed",
  "Delivered",
  "delivered",
  "waiting_to_be_returned",
  "Rescheduled",
  "rescheduled",
  "pending_verification",
  "pending_review"
];
function makeJsonResponse(corsHeaders) {
  return (body, status = 200)=>new Response(JSON.stringify(body), {
      status,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
}
async function readResponse(res) {
  const text = await res.text();
  try {
    return {
      text,
      json: text ? JSON.parse(text) : null
    };
  } catch  {
    return {
      text,
      json: null
    };
  }
}
function generateRandomPin() {
  return String(Math.floor(Math.random() * 900000) + 100000);
}
/**
 * Parse a time slot string like "6:00 AM" or "11:00 PM" and convert MST -> UTC.
 * Returns an ISO string like "2026-05-06T12:00:00+00:00"
 *
 * MST is UTC-6, so we add 6 hours to convert local -> UTC.
 * If the UTC hour crosses midnight (>= 24), we roll to the next day.
 *
 * Falls back to the provided fallbackHourUTC if the slot cannot be parsed.
 */ function buildIgloohomeDate(date, timeSlot, fallbackHourUTC) {
  if (timeSlot && !timeSlot.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i)) {
    console.warn(`[generate-pin] Could not parse time slot: "${timeSlot}" — using fallback`);
  }
  return buildBookingDateUTC(date, timeSlot, fallbackHourUTC);
}
async function maybeSendPinNotification(supabase, booking, pin, startTime, endTime) {
  if (isDeliveryBooking(booking)) return;
  if (booking.pin_notification_sent_at) return;
  const { error } = await supabase.functions.invoke("send-booking-confirmation", {
    body: {
      booking_id: booking.id,
      email_type: "pin_update",
      pin,
      start_time: startTime,
      end_time: endTime
    }
  });
  if (error) {
    console.error(`[generate-pin] PIN notification failed for booking #${booking.id}:`, error.message);
    return;
  }
  const now = new Date().toISOString();
  await supabase.from("bookings").update({
    pin_notification_sent_at: now
  }).eq("id", booking.id);
  await supabase.from("rental_access_codes").update({
    notified_at: now
  }).eq("order_id", booking.id).eq("status", "active");
}
async function getOAuthTokenForPin(clientId, clientSecret) {
  const result = await getOAuthToken(clientId, clientSecret, GENERATE_PIN_SCOPES);
  console.log("[generate-pin] OAuth:", result.token ? `ok (${result.scopesUsed})` : result.reason);
  return result.token;
}
async function isLockOnline(accessToken, lockId) {
  const res = await fetch(`${IGLOOHOME_API_BASE_URL}/devices`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json"
    }
  });
  const body = await readResponse(res);
  if (!res.ok || !body.json?.payload) return false;
  const lock = body.json.payload.find((d)=>d.deviceId === lockId);
  if (!lock) return false;
  const bridge = body.json.payload.find((d)=>d.type === "Bridge" && d.linkedDevices?.length > 0);
  return !!bridge;
}
async function createBridgePin(accessToken, lockId, bridgeId, pin, startDate, endDate, accessName) {
  const url = `${IGLOOHOME_API_BASE_URL}/devices/${lockId}/jobs/bridges/${bridgeId}`;
  const payload = {
    jobType: 4,
    jobData: {
      accessName,
      pin,
      pinType: 4,
      startDate,
      endDate
    }
  };
  console.log("[generate-pin] Creating bridge PIN:", {
    url,
    payload
  });
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify(payload)
  });
  const body = await readResponse(res);
  console.log("[generate-pin] Bridge PIN response:", {
    status: res.status,
    body: body.json
  });
  if (!res.ok && res.status !== 201) {
    return {
      success: false,
      error: `Bridge PIN failed with status ${res.status}`
    };
  }
  return {
    success: true,
    pinId: body.json?.jobId || body.json?.pinId || body.json?.id || ""
  };
}
async function createAlgoPin(accessToken, lockId, dropOffDate, dropOffTimeSlot, pickupDate, orderId) {
  const startDateHourOnly = formatAlgoPinStartIso(buildBookingDateUTC(dropOffDate, dropOffTimeSlot, 12));
  const startUnix = new Date(startDateHourOnly).getTime() / 1000;
  const endUnix = new Date(pickupDate + "T23:59:59Z").getTime() / 1000;
  const variance = Math.min(5, Math.max(1, Math.ceil((endUnix - startUnix) / 86400)));
  const payload = {
    accessName: `Dump Trailer Rental - Order #${orderId} (AlgoPIN)`,
    startDate: startDateHourOnly,
    variance
  };
  console.log("[generate-daily-pins] Creating AlgoPIN:", {
    url: `${IGLOOHOME_API_BASE_URL}/devices/${lockId}/algopin/onetime`,
    payload
  });
  const res = await fetch(`${IGLOOHOME_API_BASE_URL}/devices/${lockId}/algopin/onetime`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify(payload)
  });
  const body = await readResponse(res);
  console.log("[generate-daily-pins] AlgoPIN response:", {
    status: res.status,
    body: body.json
  });
  if (!res.ok && res.status !== 201) {
    return {
      success: false,
      error: `AlgoPIN failed with status ${res.status}`,
      rawResponse: body.json
    };
  }
  const pin = body.json?.pin || body.json?.access_code || body.json?.code || body.json?.data?.pin || "";
  if (!pin) return {
    success: false,
    error: "AlgoPIN succeeded but no PIN value in response"
  };
  return {
    success: true,
    pin,
    pinId: body.json?.pinId || body.json?.id || ""
  };
}
async function generatePinWithFallback(accessToken, lockId, bridgeId, supabase, booking) {
  const orderId = booking.id;
  const startDate = getPinActivationStart(booking);
  // PIN stays valid 1 hour past scheduled return so late returns still open the lock
  const endDate = addGraceHour(buildIgloohomeDate(booking.pickup_date, booking.pickup_time_slot, 5));
  console.log("[generate-pin] PIN window:", {
    startDate,
    endDate
  });
  const accessName = `Dump Trailer Rental - Order #${orderId}`;
  const bridgeResult = await ensurePinOnLock(supabase, accessToken, {
    orderId,
    lockId,
    bridgeId,
    startDate,
    endDate,
    accessName,
    clearBudgetMs: 50_000,
    createBudgetMs: 60_000
  });
  if (bridgeResult.lockConfirmed || bridgeResult.jobId) {
    console.log(`[generate-pin] Bridge PIN for order #${orderId}: state=${bridgeResult.createState} confirmed=${bridgeResult.lockConfirmed}`);
    return {
      success: true,
      pin: bridgeResult.pin,
      pinId: bridgeResult.jobId,
      pinType: "bridge_proxied",
      startDate,
      endDate,
      lockConfirmed: bridgeResult.lockConfirmed,
      createState: bridgeResult.createState,
      clear: bridgeResult.clear,
      error: bridgeResult.lockConfirmed ? undefined : bridgeResult.error
    };
  }
  console.warn(`[generate-pin] Bridge failed for order #${orderId}, trying AlgoPIN. Error: ${bridgeResult.error}`);
  const algoResult = await createAlgoPin(accessToken, lockId, booking.drop_off_date, booking.drop_off_time_slot, booking.pickup_date, orderId);
  if (algoResult.success) {
    console.log(`[generate-pin] ✓ AlgoPIN succeeded for order #${orderId}`);
    return {
      success: true,
      pin: algoResult.pin,
      pinId: algoResult.pinId,
      pinType: "algopin",
      startDate,
      endDate,
      lockConfirmed: true,
      createState: "completed"
    };
  }
  return {
    success: false,
    error: `Bridge: ${bridgeResult.error} | AlgoPIN: ${algoResult.error}`,
    startDate,
    endDate
  };
}
Deno.serve(async (req)=>{
  const corsHeaders = getCorsHeaders(req);
  const jsonResponse = makeJsonResponse(corsHeaders);
  if (req.method === "OPTIONS") return new Response(null, {
    headers: corsHeaders
  });
  if (req.method !== "POST") return jsonResponse({
    success: false,
    error: "Method not allowed"
  }, 405);
  try {
    console.log("[generate-pin] Started:", new Date().toISOString());
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const clientId = Deno.env.get("IGLOOHOME_CLIENT_ID");
    const clientSecret = Deno.env.get("IGLOOHOME_CLIENT_SECRET");
    const lockId = Deno.env.get("IGLOOHOME_LOCK_ID") || Deno.env.get("IGLOOHOME_DEVICE_ID");
    const bridgeId = Deno.env.get("IGLOOHOME_BRIDGE_ID");
    if (!supabaseUrl || !serviceRoleKey || !clientId || !clientSecret || !lockId || !bridgeId) {
      return jsonResponse({
        success: false,
        error: "Missing required environment variables"
      }, 500);
    }
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
    // ----------------------------------------------------------------
    // Parse body
    // ----------------------------------------------------------------
    let bookingId = null;
    let callerType = "admin";
    try {
      const body = await req.json();
      bookingId = body.bookingId ?? body.booking_id ?? null;
      callerType = body.callerType ?? "admin";
    } catch  {
      return jsonResponse({
        success: false,
        error: "Invalid or missing JSON body"
      }, 400);
    }
    if (!bookingId) {
      return jsonResponse({
        success: false,
        error: "bookingId is required"
      }, 400);
    }
    console.log("[generate-pin] Caller:", callerType, "BookingId:", bookingId);
    // ----------------------------------------------------------------
    // Auth check
    // ----------------------------------------------------------------
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({
        success: false,
        error: "Missing Authorization header"
      }, 401);
    }
    const token = authHeader.replace("Bearer ", "");
    const userSupabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY"), {
      global: {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    });
    const { data: { user }, error: authError } = await userSupabase.auth.getUser();
    if (authError || !user) {
      return jsonResponse({
        success: false,
        error: "Unauthorized"
      }, 401);
    }
    if (callerType === "admin") {
      if (user.app_metadata?.is_admin !== true) {
        return jsonResponse({
          success: false,
          error: "Admin access required"
        }, 403);
      }
      if (getJwtAal(token) !== "aal2") {
        return jsonResponse({
          success: false,
          error: "Admin MFA required"
        }, 403);
      }
    }
    if (callerType === "customer") {
      const metadataCustomerId = user.user_metadata?.customer_db_id;
      let customerId = null;
      if (metadataCustomerId != null && metadataCustomerId !== "") {
        const parsed = Number.parseInt(String(metadataCustomerId), 10);
        if (Number.isFinite(parsed)) customerId = parsed;
      }
      if (!customerId) {
        const { data: customer } = await supabase.from("customers").select("id").eq("user_id", user.id).maybeSingle();
        customerId = customer?.id ?? null;
      }
      if (!customerId) {
        return jsonResponse({
          success: false,
          error: "Customer not found"
        }, 403);
      }
      const { data: ownerCheck } = await supabase.from("bookings").select("id").eq("id", bookingId).eq("customer_id", customerId).maybeSingle();
      if (!ownerCheck) {
        return jsonResponse({
          success: false,
          error: "Booking does not belong to this customer"
        }, 403);
      }
    }
    // ----------------------------------------------------------------
    // Fetch and validate booking
    // ----------------------------------------------------------------
    const { data: booking, error: fetchError } = await supabase.from("bookings").select("*").eq("id", bookingId).in("status", ELIGIBLE_BOOKING_STATUSES).single();
    if (fetchError || !booking) {
      return jsonResponse({
        success: false,
        error: "Booking not found or not eligible for PIN generation"
      }, 404);
    }
    if (isDeliveryBooking(booking)) {
      return jsonResponse({
        success: false,
        skipped: true,
        skippedReason: "delivery",
        error: "Delivery bookings do not use a yard padlock PIN."
      }, 400);
    }
    if (callerType === "customer") {
      if (isBookingEnded(booking)) {
        return jsonResponse({
          success: false,
          error: "This rental period has ended."
        }, 403);
      }
      if (!isWithinPinGenerationWindow(booking)) {
        return jsonResponse({
          success: false,
          error: "Access PIN is not available yet. Codes are issued 12 hours before your scheduled pickup."
        }, 403);
      }
    }
    // Clear any prior PIN (verified) then create — regeneration is allowed.
    // ----------------------------------------------------------------
    // Generate PIN — bridge first (with verified clear), algopin fallback
    // ----------------------------------------------------------------
    const accessToken = await getOAuthTokenForPin(clientId, clientSecret);
    if (!accessToken) return jsonResponse({
      success: false,
      error: "Failed to get OAuth token"
    }, 500);
    const lockOnline = await isLockOnline(accessToken, lockId);
    console.log(`[generate-pin] Lock online: ${lockOnline}`);
    console.log(`[generate-pin] Booking #${bookingId} | drop_off: ${booking.drop_off_date} ${booking.drop_off_time_slot} | pickup: ${booking.pickup_date} ${booking.pickup_time_slot}`);
    const pinResult = await generatePinWithFallback(accessToken, lockId, bridgeId, supabase, booking);
    if (!pinResult.success) {
      return jsonResponse({
        success: false,
        error: `PIN generation failed: ${pinResult.error}`
      }, 500);
    }
    // ----------------------------------------------------------------
    // Persist — only mark pin_generated_at after a successful insert
    // ----------------------------------------------------------------
    const now = new Date().toISOString();
    const startTimeUTC = pinResult.startDate;
    const endTimeUTC = pinResult.endDate;
    await supabase.from("rental_access_codes").update({
      status: "expired"
    }).eq("order_id", booking.id).eq("status", "active");
    const { error: insertError } = await supabase.from("rental_access_codes").insert({
      order_id: booking.id,
      customer_email: booking.email,
      customer_phone: booking.phone || "",
      access_pin: pinResult.pin,
      pin_id: pinResult.pinId || "",
      pin_type: pinResult.pinType,
      lock_id: lockId,
      start_time: startTimeUTC,
      end_time: endTimeUTC,
      status: "active",
      lock_confirmed_at: pinResult.lockConfirmed ? now : null,
      confirm_attempts: pinResult.lockConfirmed ? 0 : 1
    });
    if (insertError) {
      console.error(`[generate-pin] DB insert failed for booking #${bookingId}:`, insertError.message);
      return jsonResponse({
        success: false,
        error: `PIN was created on the lock but failed to save: ${insertError.message}`
      }, 500);
    }
    await supabase.from("bookings").update({
      pin_generated_at: now
    }).eq("id", bookingId);
    if (pinResult.lockConfirmed) {
      await maybeSendPinNotification(supabase, booking, pinResult.pin, startTimeUTC, endTimeUTC);
    }
    console.log(`[generate-pin] ✓ PIN generated for booking #${bookingId} via ${pinResult.pinType} confirmed=${pinResult.lockConfirmed}`);
    return jsonResponse({
      success: true,
      bookingId,
      pin: pinResult.pin,
      pinType: pinResult.pinType,
      pinId: pinResult.pinId,
      lockConfirmed: !!pinResult.lockConfirmed,
      message: pinResult.lockConfirmed ? `PIN generated via ${pinResult.pinType}` : `PIN queued via ${pinResult.pinType} — waiting for bridge confirmation`
    });
  } catch (error) {
    console.error("[generate-pin] Unhandled exception:", error);
    return jsonResponse({
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }, 500);
  }
});


// ============================
// Function: cleanup-pins
// ============================

// --- File: cleanup-pins/cors.ts ---

export { getCorsHeaders } from '../_shared/cors.ts';


// --- File: cleanup-pins/index.ts ---

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getCorsHeaders } from "./cors.ts";
const IGLOOHOME_OAUTH_URL = "https://auth.igloohome.co/oauth2/token";
const IGLOOHOME_API_BASE_URL = "https://api.igloodeveloper.co/igloohome";
function makeJsonResponse(corsHeaders) {
  return (body, status = 200)=>new Response(JSON.stringify(body), {
      status,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
}
async function readResponse(res) {
  const text = await res.text();
  try {
    return {
      text,
      json: text ? JSON.parse(text) : null
    };
  } catch  {
    return {
      text,
      json: null
    };
  }
}
function sleep(ms) {
  return new Promise((resolve)=>setTimeout(resolve, ms));
}
async function getOAuthToken(clientId, clientSecret) {
  const credentials = btoa(`${clientId}:${clientSecret}`);
  const res = await fetch(IGLOOHOME_OAUTH_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json"
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: [
        "igloohomeapi/delete-pin-bridge-proxied-job",
        "igloohomeapi/get-devices",
        "igloohomeapi/get-job-status"
      ].join(" ")
    })
  });
  const body = await readResponse(res);
  console.log("[cleanup-pins] OAuth status:", res.status);
  if (!res.ok || !body.json?.access_token) {
    console.error("[cleanup-pins] OAuth failed:", body.text);
    return null;
  }
  return body.json.access_token;
}
async function deletePinFromLock(accessToken, lockId, bridgeId, pin) {
  const res = await fetch(`${IGLOOHOME_API_BASE_URL}/devices/${lockId}/jobs/bridges/${bridgeId}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({
      jobType: 5,
      jobData: {
        pin
      }
    })
  });
  const body = await readResponse(res);
  console.log("[cleanup-pins] Delete PIN response:", {
    status: res.status,
    body: body.json
  });
  if (!res.ok && res.status !== 201) {
    return {
      success: false,
      error: `Delete failed with status ${res.status}`
    };
  }
  return {
    success: true
  };
}
Deno.serve(async (req)=>{
  const corsHeaders = getCorsHeaders(req);
  const jsonResponse = makeJsonResponse(corsHeaders);
  if (req.method === "OPTIONS") return new Response(null, {
    headers: corsHeaders
  });
  try {
    console.log("[cleanup-pins] Started:", new Date().toISOString());
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const clientId = Deno.env.get("IGLOOHOME_CLIENT_ID");
    const clientSecret = Deno.env.get("IGLOOHOME_CLIENT_SECRET");
    const lockId = Deno.env.get("IGLOOHOME_LOCK_ID") || Deno.env.get("IGLOOHOME_DEVICE_ID");
    const bridgeId = Deno.env.get("IGLOOHOME_BRIDGE_ID");
    if (!supabaseUrl || !serviceRoleKey || !clientId || !clientSecret || !lockId || !bridgeId) {
      return jsonResponse({
        success: false,
        error: "Missing required environment variables"
      }, 500);
    }
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
    const accessToken = await getOAuthToken(clientId, clientSecret);
    if (!accessToken) return jsonResponse({
      success: false,
      error: "Failed to get OAuth token"
    }, 500);
    const now = new Date().toISOString();
    let jobIndex = 0;
    const results = [];
    // ================================================================
    // STEP 1: Find all active PINs ordered newest-first per order
    // Keep the newest, delete the rest from the lock and expire in DB
    // ================================================================
    console.log("[cleanup-pins] === STEP 1: DUPLICATE CLEANUP ===");
    const { data: allActivePins, error: activePinsError } = await supabase.from("rental_access_codes").select("id, order_id, access_pin, created_at").eq("status", "active").order("order_id", {
      ascending: true
    }).order("created_at", {
      ascending: false
    }); // newest first within each order
    if (activePinsError) {
      console.error("[cleanup-pins] Failed to query active PINs:", activePinsError.message);
      return jsonResponse({
        success: false,
        error: activePinsError.message
      }, 500);
    }
    // First entry per order_id is the newest — everything after is a duplicate
    const seenOrders = new Set();
    const duplicates = (allActivePins ?? []).filter((p)=>{
      if (seenOrders.has(p.order_id)) return true;
      seenOrders.add(p.order_id);
      return false;
    });
    console.log(`[cleanup-pins] Found ${duplicates.length} duplicate PIN(s) across ${allActivePins?.length ?? 0} active records`);
    for (const dup of duplicates){
      if (jobIndex > 0) {
        console.log("[cleanup-pins] Waiting 15s...");
        await sleep(15000);
      }
      jobIndex++;
      console.log(`[cleanup-pins] Deleting duplicate for order #${dup.order_id} (pin: ${dup.access_pin}, created: ${dup.created_at})`);
      try {
        const deleteResult = await deletePinFromLock(accessToken, lockId, bridgeId, dup.access_pin);
        if (!deleteResult.success) {
          // Lock deletion failed — PIN may already be gone from the device.
          // Still expire in DB so the portal never shows it.
          console.warn(`[cleanup-pins] Lock delete failed for order #${dup.order_id} (may already be removed): ${deleteResult.error}`);
        }
        // Always expire in DB regardless of lock result
        await supabase.from("rental_access_codes").update({
          status: "expired",
          notified_at: now
        }).eq("id", dup.id);
        console.log(`[cleanup-pins] ✓ Duplicate expired for order #${dup.order_id}`);
        results.push({
          orderId: dup.order_id,
          recordId: dup.id,
          lockDeleted: deleteResult.success,
          dbExpired: true
        });
      } catch (err) {
        console.error(`[cleanup-pins] Error processing duplicate for order #${dup.order_id}:`, err);
        results.push({
          orderId: dup.order_id,
          recordId: dup.id,
          lockDeleted: false,
          dbExpired: false,
          error: String(err)
        });
      }
    }
    // ================================================================
    // STEP 2: Expire any active PINs belonging to cancelled bookings
    // that the cron may have missed
    // ================================================================
    console.log("[cleanup-pins] === STEP 2: CANCELLED BOOKING CLEANUP ===");
    const { data: cancelledPins, error: cancelledError } = await supabase.from("rental_access_codes").select("id, order_id, access_pin, bookings!inner(id, status)").eq("status", "active").in("bookings.status", [
      "Cancelled",
      "pending_review"
    ]);
    if (cancelledError) {
      console.error("[cleanup-pins] Failed to query cancelled PINs:", cancelledError.message);
    }
    const cancelResults = [];
    for (const record of cancelledPins ?? []){
      if (jobIndex > 0) {
        console.log("[cleanup-pins] Waiting 15s...");
        await sleep(15000);
      }
      jobIndex++;
      console.log(`[cleanup-pins] Deleting cancelled PIN for order #${record.order_id} (pin: ${record.access_pin})`);
      try {
        const deleteResult = await deletePinFromLock(accessToken, lockId, bridgeId, record.access_pin);
        if (!deleteResult.success) {
          console.warn(`[cleanup-pins] Lock delete failed for cancelled order #${record.order_id}: ${deleteResult.error}`);
        }
        await supabase.from("rental_access_codes").update({
          status: "expired",
          notified_at: now
        }).eq("id", record.id);
        console.log(`[cleanup-pins] ✓ Cancelled PIN expired for order #${record.order_id}`);
        cancelResults.push({
          orderId: record.order_id,
          lockDeleted: deleteResult.success,
          dbExpired: true
        });
      } catch (err) {
        console.error(`[cleanup-pins] Error processing cancelled PIN for order #${record.order_id}:`, err);
        cancelResults.push({
          orderId: record.order_id,
          lockDeleted: false,
          dbExpired: false,
          error: String(err)
        });
      }
    }
    const dupSucceeded = results.filter((r)=>r.dbExpired).length;
    const cancelSucceeded = cancelResults.filter((r)=>r.dbExpired).length;
    console.log(`[cleanup-pins] Done. Duplicates: ${dupSucceeded}/${duplicates.length} | Cancelled: ${cancelSucceeded}/${(cancelledPins ?? []).length}`);
    return jsonResponse({
      success: true,
      duplicates: {
        processed: duplicates.length,
        succeeded: dupSucceeded,
        results
      },
      cancelled: {
        processed: (cancelledPins ?? []).length,
        succeeded: cancelSucceeded,
        results: cancelResults
      }
    });
  } catch (error) {
    console.error("[cleanup-pins] Unhandled exception:", error);
    return jsonResponse({
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }, 500);
  }
});


// ============================
// Function: delete-pin
// ============================

// --- File: delete-pin/cors.ts ---

export { getCorsHeaders } from '../_shared/cors.ts';


// --- File: delete-pin/index.ts ---

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getCorsHeaders } from "./cors.ts";
import { getJwtAal } from "../_shared/jwtAal.ts";
const IGLOOHOME_OAUTH_URL = "https://auth.igloohome.co/oauth2/token";
const IGLOOHOME_API_BASE_URL = "https://api.igloodeveloper.co/igloohome";
function makeJsonResponse(corsHeaders) {
  return (body, status = 200)=>new Response(JSON.stringify(body), {
      status,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
}
async function readResponse(res) {
  const text = await res.text();
  try {
    return {
      text,
      json: text ? JSON.parse(text) : null
    };
  } catch  {
    return {
      text,
      json: null
    };
  }
}
async function getOAuthToken(clientId, clientSecret) {
  const credentials = btoa(`${clientId}:${clientSecret}`);
  const res = await fetch(IGLOOHOME_OAUTH_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json"
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: [
        "igloohomeapi/delete-pin-bridge-proxied-job",
        "igloohomeapi/get-devices",
        "igloohomeapi/get-job-status"
      ].join(" ")
    })
  });
  const body = await readResponse(res);
  console.log("[delete-pin] OAuth status:", res.status);
  if (!res.ok || !body.json?.access_token) {
    console.error("[delete-pin] OAuth failed:", body.text);
    return null;
  }
  return body.json.access_token;
}
async function deletePinFromLock(accessToken, lockId, bridgeId, pin) {
  const url = `${IGLOOHOME_API_BASE_URL}/devices/${lockId}/jobs/bridges/${bridgeId}`;
  const payload = {
    jobType: 5,
    jobData: {
      pin
    }
  };
  console.log("[delete-pin] Sending delete job to lock:", {
    url,
    pin
  });
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify(payload)
  });
  const body = await readResponse(res);
  console.log("[delete-pin] Lock delete response:", {
    status: res.status,
    body: body.json
  });
  if (!res.ok && res.status !== 201) {
    return {
      success: false,
      error: `Lock delete failed with status ${res.status}: ${body.json?.error ?? body.text}`
    };
  }
  return {
    success: true
  };
}
Deno.serve(async (req)=>{
  const corsHeaders = getCorsHeaders(req);
  const jsonResponse = makeJsonResponse(corsHeaders);
  if (req.method === "OPTIONS") return new Response(null, {
    headers: corsHeaders
  });
  if (req.method !== "POST") return jsonResponse({
    success: false,
    error: "Method not allowed"
  }, 405);
  try {
    console.log("[delete-pin] Started:", new Date().toISOString());
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const clientId = Deno.env.get("IGLOOHOME_CLIENT_ID");
    const clientSecret = Deno.env.get("IGLOOHOME_CLIENT_SECRET");
    const lockId = Deno.env.get("IGLOOHOME_LOCK_ID") || Deno.env.get("IGLOOHOME_DEVICE_ID");
    const bridgeId = Deno.env.get("IGLOOHOME_BRIDGE_ID");
    if (!supabaseUrl || !serviceRoleKey || !clientId || !clientSecret || !lockId || !bridgeId) {
      return jsonResponse({
        success: false,
        error: "Missing required environment variables"
      }, 500);
    }
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
    // ----------------------------------------------------------------
    // Parse body
    // ----------------------------------------------------------------
    let bookingId = null;
    let callerType = "admin";
    try {
      const body = await req.json();
      bookingId = body.bookingId ?? body.booking_id ?? null;
      callerType = body.callerType ?? "admin";
    } catch  {
      return jsonResponse({
        success: false,
        error: "Invalid or missing JSON body"
      }, 400);
    }
    if (!bookingId) {
      return jsonResponse({
        success: false,
        error: "bookingId is required"
      }, 400);
    }
    console.log("[delete-pin] Caller:", callerType, "BookingId:", bookingId);
    // ----------------------------------------------------------------
    // Auth check
    // ----------------------------------------------------------------
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({
        success: false,
        error: "Missing Authorization header"
      }, 401);
    }
    const token = authHeader.replace("Bearer ", "");
    const userSupabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY"), {
      global: {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    });
    const { data: { user }, error: authError } = await userSupabase.auth.getUser();
    if (authError || !user) {
      return jsonResponse({
        success: false,
        error: "Unauthorized"
      }, 401);
    }
    if (callerType === "admin") {
      if (user.app_metadata?.is_admin !== true) {
        return jsonResponse({
          success: false,
          error: "Admin access required"
        }, 403);
      }
      if (getJwtAal(token) !== "aal2") {
        return jsonResponse({
          success: false,
          error: "Admin MFA required"
        }, 403);
      }
    }
    if (callerType === "customer") {
      const { data: customer } = await supabase.from("customers").select("id").eq("user_id", user.id).single();
      if (!customer) {
        return jsonResponse({
          success: false,
          error: "Customer not found"
        }, 403);
      }
      // Verify booking belongs to this customer
      const { data: ownerCheck } = await supabase.from("bookings").select("id").eq("id", bookingId).eq("customer_id", customer.id).single();
      if (!ownerCheck) {
        return jsonResponse({
          success: false,
          error: "Booking does not belong to this customer"
        }, 403);
      }
    }
    // ----------------------------------------------------------------
    // Find active PIN for this booking
    // ----------------------------------------------------------------
    const { data: activePin, error: pinFetchError } = await supabase.from("rental_access_codes").select("id, access_pin, pin_type").eq("order_id", bookingId).eq("status", "active").single();
    if (pinFetchError || !activePin) {
      console.log(`[delete-pin] No active PIN found for booking #${bookingId}`);
      return jsonResponse({
        success: true,
        message: "No active PIN found for this booking — nothing to delete",
        lockDeleted: false,
        dbExpired: false
      });
    }
    const now = new Date().toISOString();
    // ----------------------------------------------------------------
    // Step 1: Expire in DB immediately regardless of bridge status.
    // Customer portal loses access right away.
    // ----------------------------------------------------------------
    const { error: expireError } = await supabase.from("rental_access_codes").update({
      status: "expired",
      notified_at: now,
      lock_deleted_at: null
    }).eq("id", activePin.id);
    if (expireError) {
      console.error(`[delete-pin] Failed to expire PIN in DB for booking #${bookingId}:`, expireError.message);
      return jsonResponse({
        success: false,
        error: "Failed to expire PIN in database"
      }, 500);
    }
    console.log(`[delete-pin] ✓ PIN expired in DB for booking #${bookingId} — portal access revoked`);
    // ----------------------------------------------------------------
    // Step 2: Try to delete from lock via bridge.
    // Non-fatal if bridge is offline — cron Phase 1 will retry.
    // AlgoPINs cannot be deleted via bridge, so skip the lock call.
    // ----------------------------------------------------------------
    if (activePin.pin_type === "algopin") {
      console.log(`[delete-pin] PIN is algopin type — cannot delete from lock, will expire naturally`);
      return jsonResponse({
        success: true,
        bookingId,
        lockDeleted: false,
        dbExpired: true,
        message: "AlgoPIN expired in DB. It cannot be remotely deleted — it will expire naturally at its scheduled end time."
      });
    }
    const accessToken = await getOAuthToken(clientId, clientSecret);
    if (!accessToken) {
      console.error("[delete-pin] Failed to get OAuth token — DB already expired, lock will retry via cron");
      return jsonResponse({
        success: true,
        bookingId,
        lockDeleted: false,
        dbExpired: true,
        message: "PIN expired in DB. Lock deletion will be retried on the next cron run."
      });
    }
    const lockResult = await deletePinFromLock(accessToken, lockId, bridgeId, activePin.access_pin);
    if (lockResult.success) {
      // Mark lock deletion confirmed
      await supabase.from("rental_access_codes").update({
        lock_deleted_at: now
      }).eq("id", activePin.id);
      console.log(`[delete-pin] ✓ PIN deleted from lock for booking #${bookingId}`);
      return jsonResponse({
        success: true,
        bookingId,
        lockDeleted: true,
        dbExpired: true,
        message: "PIN fully deleted — portal access revoked and lock cleared."
      });
    }
    // Bridge offline — DB is already expired, cron will retry lock deletion
    console.warn(`[delete-pin] Bridge offline for booking #${bookingId} — lock deletion will retry via cron. Error: ${lockResult.error}`);
    return jsonResponse({
      success: true,
      bookingId,
      lockDeleted: false,
      dbExpired: true,
      message: "PIN expired in DB — portal access revoked. Lock deletion will be retried on the next cron run."
    });
  } catch (error) {
    console.error("[delete-pin] Unhandled exception:", error);
    return jsonResponse({
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }, 500);
  }
});


// ============================
// Function: get-returning-customer-rewards
// ============================

// --- File: get-returning-customer-rewards/cors.ts ---

export { getCorsHeaders } from '../_shared/cors.ts';


// --- File: get-returning-customer-rewards/index.ts ---

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { getCorsHeaders } from './cors.ts';
Deno.serve(async (req)=>{
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
  }
  try {
    const { email } = await req.json();
    const normalizedEmail = String(email || '').trim().toLowerCase();
    if (!normalizedEmail || !normalizedEmail.includes('@')) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Valid email is required'
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    if (!supabaseUrl || !serviceRoleKey) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Server configuration error'
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const { data: verification, error: verificationError } = await supabase.from('email_verifications').select('email, is_verified, code_expires_at').eq('email', normalizedEmail).maybeSingle();
    if (verificationError) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Failed to validate verification'
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    const isVerified = Boolean(verification?.is_verified);
    const expiresAt = verification?.code_expires_at ? new Date(verification.code_expires_at) : null;
    const isExpired = expiresAt ? new Date() > expiresAt : true;
    if (!isVerified || isExpired) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Email verification is required before loading rewards'
      }), {
        status: 403,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    const { data: customer, error: customerError } = await supabase.from('customers').select('id, first_name, last_name, email, phone, street, city, state, zip').eq('email', normalizedEmail).maybeSingle();
    if (customerError) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Failed to load customer profile'
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    let pointsBalance = 0;
    let referralPendingBalance = 0;
    let referralAvailableBalance = 0;
    if (customer?.id) {
      const { data: pointsRow, error: pointsError } = await supabase.from('loyalty_points').select('points_balance').eq('customer_id', customer.id).maybeSingle();
      if (!pointsError && pointsRow?.points_balance) {
        pointsBalance = Number(pointsRow.points_balance || 0);
      }
      const { data: walletRow, error: walletError } = await supabase.from('customer_referral_wallets').select('pending_balance, available_balance').eq('customer_id', customer.id).maybeSingle();
      if (!walletError && walletRow) {
        referralPendingBalance = Number(walletRow.pending_balance || 0);
        referralAvailableBalance = Number(walletRow.available_balance || 0);
      }
    }
    const { data: settings } = await supabase.from('loyalty_settings').select('points_per_dollar, points_to_dollar, referral_bonus_dollars').maybeSingle();
    return new Response(JSON.stringify({
      success: true,
      customer,
      customerId: customer?.id || null,
      pointsBalance,
      referralWallet: {
        pendingBalance: referralPendingBalance,
        availableBalance: referralAvailableBalance
      },
      conversionRates: {
        pointsPerDollar: Number(settings?.points_per_dollar || 10),
        pointsToDollar: Number(settings?.points_to_dollar || 100),
        referralBonusDollars: Number(settings?.referral_bonus_dollars || 25)
      }
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to load rewards'
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
});


// ============================
// Function: loyalty-points
// ============================

// --- File: loyalty-points/cors.ts ---

export { getCorsHeaders } from '../_shared/cors.ts';


// --- File: loyalty-points/index.ts ---

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { getCorsHeaders } from "./cors.ts";
Deno.serve(async (req)=>{
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
  }
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const authHeader = req.headers.get('Authorization');
    if (!supabaseUrl || !serviceRoleKey || !anonKey) {
      return new Response(JSON.stringify({
        error: 'Supabase configuration missing'
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response(JSON.stringify({
        error: 'Authentication required'
      }), {
        status: 401,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    const token = authHeader.replace('Bearer ', '').trim();
    const authClient = createClient(supabaseUrl, anonKey, {
      global: {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    });
    const { data: userData, error: userError } = await authClient.auth.getUser();
    if (userError || !userData?.user) {
      return new Response(JSON.stringify({
        error: 'Invalid session'
      }), {
        status: 401,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const { action, customerId, points, bookingId, notes } = await req.json();
    if (!action || !customerId) {
      return new Response(JSON.stringify({
        error: 'action and customerId are required'
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    const parsedCustomerId = Number(customerId);
    if (!Number.isFinite(parsedCustomerId)) {
      return new Response(JSON.stringify({
        error: 'Invalid customerId'
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    if (action === 'award') {
      return new Response(JSON.stringify({
        error: 'Award action is server-only'
      }), {
        status: 403,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    if (action === 'redeem') {
      const pointsToRedeem = Number(points);
      const parsedBookingId = bookingId ? Number(bookingId) : null;
      if (!pointsToRedeem || pointsToRedeem <= 0) {
        return new Response(JSON.stringify({
          error: 'Invalid points amount'
        }), {
          status: 400,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
      }
      const { data: customerData, error: customerError } = await supabase.from('customers').select('id').eq('user_id', userData.user.id).maybeSingle();
      if (customerError || !customerData?.id) {
        return new Response(JSON.stringify({
          error: 'Customer account not linked'
        }), {
          status: 403,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
      }
      if (customerData.id !== parsedCustomerId) {
        return new Response(JSON.stringify({
          error: 'Cannot redeem points for another account'
        }), {
          status: 403,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
      }
      const { data: rpcData, error: rpcError } = await supabase.rpc('adjust_loyalty_points', {
        p_customer_id: parsedCustomerId,
        p_points: pointsToRedeem,
        p_transaction_type: 'redeemed',
        p_booking_id: parsedBookingId,
        p_referral_id: null,
        p_notes: notes ?? null
      });
      if (rpcError) {
        const message = rpcError.message?.toLowerCase().includes('insufficient') ? 'Insufficient points' : 'Unable to redeem points';
        return new Response(JSON.stringify({
          error: message
        }), {
          status: message === 'Insufficient points' ? 400 : 500,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
      }
      const result = Array.isArray(rpcData) ? rpcData[0] : rpcData;
      const newBalance = Number(result?.new_balance ?? 0);
      const { data: settings } = await supabase.from('loyalty_settings').select('points_to_dollar').maybeSingle();
      const pointsToDollar = settings?.points_to_dollar ?? 100;
      const discountAmount = Number((pointsToRedeem / pointsToDollar).toFixed(2));
      return new Response(JSON.stringify({
        success: true,
        newBalance,
        discountAmount
      }), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    return new Response(JSON.stringify({
      error: 'Unknown action'
    }), {
      status: 400,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (err) {
    console.error('[loyalty-points]', err);
    return new Response(JSON.stringify({
      error: err.message ?? 'Internal error'
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
});


// ============================
// Function: lookup-tax-rate
// ============================

// --- File: lookup-tax-rate/cors.ts ---

export { getCorsHeaders } from '../_shared/cors.ts';


// --- File: lookup-tax-rate/index.ts ---

/**
 * lookup-tax-rate Edge Function
 *
 * Returns the combined sales tax rate for a given ZIP code using TaxJar.
 * Results are cached in the tax_rate_cache table (TTL = 30 days).
 *
 * Required env vars:
 *   TAXJAR_API_KEY  – TaxJar API token (app.taxjar.com -> Account -> API Access)
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY – auto-provided by Edge Runtime
 *
 * Request:  POST { zip_code: string, delivery_type?: string }
 * Response: { rate: number, source: "taxjar"|"cache"|"fallback", jurisdiction?: string }
 */ import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getCorsHeaders } from "./cors.ts";
const CACHE_TTL_DAYS = 30;
const FALLBACK_RATE = 7.45; // Saratoga Springs, UT combined rate
Deno.serve(async (req)=>{
  const corsHeaders1 = getCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders1
    });
  }
  try {
    const body = await req.json();
    const zip_code = body.zip_code;
    if (!zip_code) {
      return jsonResponse({
        rate: FALLBACK_RATE,
        source: 'fallback',
        error: 'zip_code required'
      }, 400);
    }
    const cleanZip = String(zip_code).trim().substring(0, 5);
    const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
    // 1. Check cache
    const { data: cached } = await supabase.from('tax_rate_cache').select('rate, jurisdiction, fetched_at').eq('zip_code', cleanZip).maybeSingle();
    if (cached) {
      const ageMs = Date.now() - new Date(cached.fetched_at).getTime();
      const ageDays = ageMs / (1000 * 60 * 60 * 24);
      if (ageDays < CACHE_TTL_DAYS) {
        return jsonResponse({
          rate: Number(cached.rate),
          source: 'cache',
          jurisdiction: cached.jurisdiction
        });
      }
    }
    // 2. TaxJar API lookup
    const taxjarKey = Deno.env.get('TAXJAR_API_KEY');
    if (!taxjarKey) {
      console.warn('[lookup-tax-rate] TAXJAR_API_KEY not set; using fallback rate');
      return jsonResponse({
        rate: FALLBACK_RATE,
        source: 'fallback'
      });
    }
    const taxjarRes = await fetch(`https://api.taxjar.com/v2/rates/${encodeURIComponent(cleanZip)}?country=US`, {
      headers: {
        Authorization: `Token token="${taxjarKey}"`,
        'Content-Type': 'application/json'
      }
    });
    if (!taxjarRes.ok) {
      const errText = await taxjarRes.text();
      console.error(`[lookup-tax-rate] TaxJar error ${taxjarRes.status}:`, errText);
      return jsonResponse({
        rate: FALLBACK_RATE,
        source: 'fallback'
      });
    }
    const taxjarData = await taxjarRes.json();
    const r = taxjarData.rate;
    // TaxJar returns rates as decimals (e.g. 0.0745); convert to percentage
    const combinedRate = Math.round(parseFloat(r.combined_rate) * 10000) / 100;
    const jurisdiction = `${r.city}, ${r.state} ${cleanZip}`;
    // 3. Upsert cache
    await supabase.from('tax_rate_cache').upsert({
      zip_code: cleanZip,
      rate: combinedRate,
      jurisdiction,
      state_rate: r.state_rate ? Math.round(parseFloat(r.state_rate) * 10000) / 100 : null,
      county_rate: r.county_rate ? Math.round(parseFloat(r.county_rate) * 10000) / 100 : null,
      city_rate: r.city_rate ? Math.round(parseFloat(r.city_rate) * 10000) / 100 : null,
      fetched_at: new Date().toISOString()
    }, {
      onConflict: 'zip_code'
    });
    return jsonResponse({
      rate: combinedRate,
      source: 'taxjar',
      jurisdiction
    });
  } catch (err) {
    console.error('[lookup-tax-rate] Unexpected error:', err);
    return jsonResponse({
      rate: FALLBACK_RATE,
      source: 'fallback',
      error: err.message
    }, 500);
  }
});
function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json'
    }
  });
}


// ============================
// Function: create-admin
// ============================

// --- File: create-admin/cors.ts ---

export { getCorsHeaders } from '../_shared/cors.ts';


// --- File: create-admin/index.ts ---

import { getCorsHeaders } from "./cors.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { isAdminWithMfa } from "../_shared/jwtAal.ts";
const ALLOWED_BODY_KEYS = new Set([
  "email",
  "full_name"
]);
function jsonResponse(body, status, corsHeaders) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
}
function normalizeEmail(email) {
  return email.trim().toLowerCase();
}
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
/** listUsers({ email }) is not honored by @supabase/supabase-js — paginate and match manually. */ async function findAuthUserByEmail(supabaseAdmin, email) {
  const perPage = 1000;
  let page = 1;
  while(true){
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({
      page,
      perPage
    });
    if (error) throw error;
    const users = data?.users ?? [];
    const match = users.find((user)=>user.email && normalizeEmail(user.email) === email);
    if (match) return match;
    if (users.length < perPage) return null;
    page += 1;
  }
}
Deno.serve(async (req)=>{
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    if (!supabaseUrl || !serviceRoleKey || !anonKey) {
      return jsonResponse({
        error: "Supabase configuration missing"
      }, 500, corsHeaders);
    }
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResponse({
        error: "Authentication required"
      }, 401, corsHeaders);
    }
    const token = authHeader.replace("Bearer ", "").trim();
    const authClient = createClient(supabaseUrl, anonKey, {
      global: {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    });
    const { data: userData, error: userError } = await authClient.auth.getUser();
    if (userError || !userData?.user) {
      return jsonResponse({
        error: "Invalid session"
      }, 401, corsHeaders);
    }
    const caller = userData.user;
    if (!isAdminWithMfa(caller, token)) {
      return jsonResponse({
        error: "Admin privileges and authenticator MFA are required"
      }, 403, corsHeaders);
    }
    let body;
    try {
      body = await req.json();
    } catch  {
      return jsonResponse({
        error: "Invalid JSON body"
      }, 400, corsHeaders);
    }
    const extraKeys = Object.keys(body).filter((k)=>!ALLOWED_BODY_KEYS.has(k));
    if (extraKeys.length > 0) {
      return jsonResponse({
        error: `Unexpected fields: ${extraKeys.join(", ")}`
      }, 400, corsHeaders);
    }
    const rawEmail = body.email;
    if (typeof rawEmail !== "string" || !rawEmail.trim()) {
      return jsonResponse({
        error: "Email is required"
      }, 400, corsHeaders);
    }
    const email = normalizeEmail(rawEmail);
    if (!isValidEmail(email)) {
      return jsonResponse({
        error: "Invalid email address"
      }, 400, corsHeaders);
    }
    const callerEmail = caller.email ? normalizeEmail(caller.email) : null;
    if (callerEmail && email === callerEmail) {
      return jsonResponse({
        error: "Cannot create or modify your own admin account via this endpoint"
      }, 403, corsHeaders);
    }
    const fullName = typeof body.full_name === "string" && body.full_name.trim() ? body.full_name.trim() : "Site Administrator";
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
    const existingUser = await findAuthUserByEmail(supabaseAdmin, email);
    if (existingUser) {
      return jsonResponse({
        error: "Account already exists; cannot grant admin via this endpoint. Use Supabase Dashboard to manage existing users."
      }, 409, corsHeaders);
    }
    const temporaryPassword = crypto.randomUUID();
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: temporaryPassword,
      email_confirm: true,
      app_metadata: {
        is_admin: true
      },
      user_metadata: {
        full_name: fullName
      }
    });
    if (error) {
      if (error.message.includes("already registered")) {
        return jsonResponse({
          error: "Account already exists; cannot grant admin via this endpoint."
        }, 409, corsHeaders);
      }
      throw error;
    }
    return jsonResponse({
      message: "Admin user created successfully.",
      email,
      temporary_password: temporaryPassword,
      user: {
        id: data.user.id,
        email: data.user.email
      }
    }, 200, corsHeaders);
  } catch (error) {
    console.error("[create-admin]", error);
    const message = error instanceof Error ? error.message : "Internal error";
    return jsonResponse({
      error: message
    }, 500, corsHeaders);
  }
});


// ============================
// Function: sign-checkout-verification-urls
// ============================

// --- File: sign-checkout-verification-urls/cors.ts ---

const ALLOWED_HEADERS = 'authorization, x-client-info, apikey, content-type';
const ALLOWED_METHODS = 'GET, POST, PUT, PATCH, DELETE, OPTIONS';
function parseAllowedOrigins() {
  const raw = Deno.env.get('ALLOWED_ORIGINS') ?? '';
  return new Set(raw.split(',').map((origin)=>origin.trim()).filter(Boolean));
}
let cachedOrigins = null;
function getAllowedOrigins() {
  if (!cachedOrigins) {
    cachedOrigins = parseAllowedOrigins();
  }
  return cachedOrigins;
}
/** Origin-aware CORS headers. Set ALLOWED_ORIGINS (comma-separated) in env. */ export function getCorsHeaders(req) {
  const headers = {
    'Access-Control-Allow-Headers': ALLOWED_HEADERS,
    'Access-Control-Allow-Methods': ALLOWED_METHODS
  };
  const origin = req.headers.get('Origin');
  if (origin && getAllowedOrigins().has(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Vary'] = 'Origin';
  }
  return headers;
}


// --- File: sign-checkout-verification-urls/index.ts ---

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { getCorsHeaders } from './cors.ts';
const SIGNED_URL_TTL_SECONDS = 3600;
const LOCAL_HOST_PATTERN = /^(127\.0\.0\.1|localhost|\[::1\])$/i;
const DOCKER_INTERNAL_HOST_PATTERN = /^(kong|storage|rest|meta|auth)$/i;
function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}
function isLocalOrDockerHost(hostname) {
  return LOCAL_HOST_PATTERN.test(hostname) || DOCKER_INTERNAL_HOST_PATTERN.test(hostname) || hostname.startsWith('supabase_') || hostname.includes('_network');
}
function rewriteSignedUrlForSite(url, siteUrl) {
  if (!url || !siteUrl) return url;
  try {
    const signed = new URL(url);
    const site = new URL(siteUrl);
    // Local edge runtime signs with http://kong:8000 — rewrite to the browser/Vite origin.
    if (isLocalOrDockerHost(signed.hostname) && LOCAL_HOST_PATTERN.test(site.hostname) && signed.origin !== site.origin) {
      return `${site.origin}${signed.pathname}${signed.search}`;
    }
  } catch  {
  // ignore invalid URLs
  }
  return url;
}
async function customerMatchesEmail(supabase, customerId, email) {
  const { data, error } = await supabase.from('customers').select('id, email').eq('id', customerId).maybeSingle();
  if (error || !data) return false;
  return normalizeEmail(data.email) === normalizeEmail(email);
}
Deno.serve(async (req)=>{
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
  }
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    if (!supabaseUrl || !serviceRoleKey) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Server configuration error'
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const body = await req.json();
    const customerId = Number(body.customer_id);
    const email = normalizeEmail(body.email);
    const paths = Array.isArray(body.paths) ? body.paths.map((path)=>String(path || '').trim()).filter(Boolean) : [];
    const siteUrl = body.site_url ? String(body.site_url).trim() : null;
    if (!customerId || !email.includes('@')) {
      return new Response(JSON.stringify({
        success: false,
        error: 'customer_id and email are required'
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    if (!await customerMatchesEmail(supabase, customerId, email)) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Customer email does not match'
      }), {
        status: 403,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    if (paths.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        signed_urls: {}
      }), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    const signedUrls = {};
    for (const path of paths){
      const { error: downloadError } = await supabase.storage.from('verification-documents').download(path);
      if (downloadError) {
        console.warn('[sign-checkout-verification-urls] object missing, skipping:', path, downloadError.message);
        continue;
      }
      const { data, error } = await supabase.storage.from('verification-documents').createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
      if (error) {
        console.error('[sign-checkout-verification-urls] sign failed:', path, error);
        continue;
      }
      if (data?.signedUrl) {
        signedUrls[path] = rewriteSignedUrlForSite(data.signedUrl, siteUrl);
      }
    }
    return new Response(JSON.stringify({
      success: true,
      signed_urls: signedUrls
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('[sign-checkout-verification-urls] error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return new Response(JSON.stringify({
      success: false,
      error: message
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
});


// ============================
// Function: save-checkout-verification-docs
// ============================

// --- File: save-checkout-verification-docs/cors.ts ---

const ALLOWED_HEADERS = 'authorization, x-client-info, apikey, content-type';
const ALLOWED_METHODS = 'GET, POST, PUT, PATCH, DELETE, OPTIONS';
function parseAllowedOrigins() {
  const raw = Deno.env.get('ALLOWED_ORIGINS') ?? '';
  return new Set(raw.split(',').map((origin)=>origin.trim()).filter(Boolean));
}
let cachedOrigins = null;
function getAllowedOrigins() {
  if (!cachedOrigins) {
    cachedOrigins = parseAllowedOrigins();
  }
  return cachedOrigins;
}
/** Origin-aware CORS headers. Set ALLOWED_ORIGINS (comma-separated) in env. */ export function getCorsHeaders(req) {
  const headers = {
    'Access-Control-Allow-Headers': ALLOWED_HEADERS,
    'Access-Control-Allow-Methods': ALLOWED_METHODS
  };
  const origin = req.headers.get('Origin');
  if (origin && getAllowedOrigins().has(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Vary'] = 'Origin';
  }
  return headers;
}


// --- File: save-checkout-verification-docs/index.ts ---

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { getCorsHeaders } from './cors.ts';
function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}
async function customerMatchesEmail(supabase, customerId, email) {
  const { data, error } = await supabase.from('customers').select('id, email').eq('id', customerId).maybeSingle();
  if (error || !data) return false;
  return normalizeEmail(data.email) === normalizeEmail(email);
}
async function isCheckoutAuthorized(supabase, customerId, email, pendingToken) {
  if (!await customerMatchesEmail(supabase, customerId, email)) {
    return {
      ok: false,
      error: 'Customer email does not match'
    };
  }
  const normalizedEmail = normalizeEmail(email);
  const { data: verification } = await supabase.from('email_verifications').select('is_verified').eq('email', normalizedEmail).maybeSingle();
  if (verification?.is_verified) {
    return {
      ok: true
    };
  }
  if (pendingToken) {
    const { data: pending } = await supabase.from('pending_customers').select('email, is_verified').eq('id', pendingToken).maybeSingle();
    if (pending && normalizeEmail(pending.email) === normalizedEmail && pending.is_verified) {
      return {
        ok: true
      };
    }
  }
  return {
    ok: false,
    error: 'Email must be verified before saving documents'
  };
}
const SIGNED_URL_TTL_SECONDS = 3600;
const LOCAL_HOST_PATTERN = /^(127\.0\.0\.1|localhost|\[::1\])$/i;
const DOCKER_INTERNAL_HOST_PATTERN = /^(kong|storage|rest|meta|auth)$/i;
function isLocalOrDockerHost(hostname) {
  return LOCAL_HOST_PATTERN.test(hostname) || DOCKER_INTERNAL_HOST_PATTERN.test(hostname) || hostname.startsWith('supabase_') || hostname.includes('_network');
}
function rewriteSignedUrlForSite(url, siteUrl) {
  if (!url || !siteUrl) return url;
  try {
    const signed = new URL(url);
    const site = new URL(siteUrl);
    if (isLocalOrDockerHost(signed.hostname) && LOCAL_HOST_PATTERN.test(site.hostname) && signed.origin !== site.origin) {
      return `${site.origin}${signed.pathname}${signed.search}`;
    }
  } catch  {
  // ignore
  }
  return url;
}
async function uploadFile(supabase, customerId, imageType, file) {
  const fileExt = file.name.split('.').pop() || 'bin';
  const filePath = `customers/${customerId}/verification/${imageType}_${Date.now()}.${fileExt}`;
  const { error: uploadError } = await supabase.storage.from('verification-documents').upload(filePath, file, {
    contentType: file.type || 'application/octet-stream',
    upsert: false
  });
  if (uploadError) {
    throw uploadError;
  }
  const { data: publicUrlData } = supabase.storage.from('verification-documents').getPublicUrl(filePath);
  return {
    url: publicUrlData.publicUrl,
    path: filePath
  };
}
async function signDocumentPaths(supabase, fields, siteUrl = null) {
  const paths = [
    fields.license_front_storage_path,
    fields.license_back_storage_path,
    fields.insurance_storage_path
  ].filter(Boolean);
  const signedByPath = {};
  for (const path of paths){
    const { data, error } = await supabase.storage.from('verification-documents').createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
    if (!error && data?.signedUrl) {
      signedByPath[path] = rewriteSignedUrlForSite(data.signedUrl, siteUrl);
    }
  }
  return {
    license_front_url: fields.license_front_storage_path ? signedByPath[fields.license_front_storage_path] || fields.license_front_url : fields.license_front_url,
    license_front_storage_path: fields.license_front_storage_path,
    license_back_url: fields.license_back_storage_path ? signedByPath[fields.license_back_storage_path] || fields.license_back_url : fields.license_back_url,
    license_back_storage_path: fields.license_back_storage_path,
    insurance_url: fields.insurance_storage_path ? signedByPath[fields.insurance_storage_path] || fields.insurance_url : fields.insurance_url,
    insurance_storage_path: fields.insurance_storage_path
  };
}
async function upsertVerificationDocuments(supabase, customerId, fields, licensePlate) {
  const { data: existing } = await supabase.from('driver_verification_documents').select('*').eq('customer_id', customerId).maybeSingle();
  const merged = {
    license_front_url: fields.license_front_url ?? existing?.license_front_url ?? null,
    license_front_storage_path: fields.license_front_storage_path ?? existing?.license_front_storage_path ?? null,
    license_back_url: fields.license_back_url ?? existing?.license_back_url ?? null,
    license_back_storage_path: fields.license_back_storage_path ?? existing?.license_back_storage_path ?? null,
    insurance_url: fields.insurance_url ?? existing?.insurance_url ?? null,
    insurance_storage_path: fields.insurance_storage_path ?? existing?.insurance_storage_path ?? null
  };
  let effectivePlate = licensePlate;
  if (!effectivePlate) {
    const { data: customerRow } = await supabase.from('customers').select('license_plate').eq('id', customerId).maybeSingle();
    effectivePlate = customerRow?.license_plate ? String(customerRow.license_plate).toUpperCase() : null;
  }
  const hasFront = Boolean(merged.license_front_url || merged.license_front_storage_path);
  const hasBack = Boolean(merged.license_back_url || merged.license_back_storage_path);
  const hasInsurance = Boolean(merged.insurance_url || merged.insurance_storage_path);
  const docsComplete = hasFront && hasBack && hasInsurance && Boolean(effectivePlate);
  const payload = {
    customer_id: customerId,
    ...merged,
    uploaded_at: new Date().toISOString(),
    verification_status: docsComplete ? 'approved' : 'pending'
  };
  const { data, error } = await supabase.from('driver_verification_documents').upsert(payload, {
    onConflict: 'customer_id'
  }).select().maybeSingle();
  if (error) {
    throw error;
  }
  if (licensePlate || docsComplete) {
    const customerUpdate = {
      has_incomplete_verification: false
    };
    if (licensePlate) {
      customerUpdate.license_plate = licensePlate;
    }
    const { error: customerError } = await supabase.from('customers').update(customerUpdate).eq('id', customerId);
    if (customerError) {
      throw customerError;
    }
  }
  return data;
}
Deno.serve(async (req)=>{
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
  }
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    if (!supabaseUrl || !serviceRoleKey) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Server configuration error'
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const contentType = req.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const body = await req.json();
      const action = String(body.action || 'attach');
      const email = normalizeEmail(body.email);
      const pendingToken = body.pending_token ? String(body.pending_token) : null;
      const licensePlate = body.license_plate ? String(body.license_plate).toUpperCase() : null;
      if (!email.includes('@')) {
        return new Response(JSON.stringify({
          success: false,
          error: 'email is required'
        }), {
          status: 400,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
      }
      let customerId = Number(body.customer_id);
      if (!customerId) {
        const { data: customerRow } = await supabase.from('customers').select('id').ilike('email', email).maybeSingle();
        customerId = customerRow?.id ? Number(customerRow.id) : 0;
      }
      if (!customerId) {
        return new Response(JSON.stringify({
          success: true,
          skipped: true,
          reason: 'no_customer'
        }), {
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
      }
      const auth = await isCheckoutAuthorized(supabase, customerId, email, pendingToken);
      if (!auth.ok) {
        return new Response(JSON.stringify({
          success: false,
          error: auth.error
        }), {
          status: 403,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
      }
      const fields = {
        license_front_url: body.license_front_url ?? null,
        license_front_storage_path: body.license_front_storage_path ?? null,
        license_back_url: body.license_back_url ?? null,
        license_back_storage_path: body.license_back_storage_path ?? null,
        insurance_url: body.insurance_url ?? null,
        insurance_storage_path: body.insurance_storage_path ?? null
      };
      const data = await upsertVerificationDocuments(supabase, customerId, fields, licensePlate);
      return new Response(JSON.stringify({
        success: true,
        data,
        action
      }), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    const form = await req.formData();
    const customerId = Number(form.get('customer_id'));
    const email = normalizeEmail(String(form.get('email') || ''));
    const pendingToken = form.get('pending_token') ? String(form.get('pending_token')) : null;
    const licensePlate = form.get('license_plate') ? String(form.get('license_plate')).toUpperCase() : null;
    const siteUrl = form.get('site_url') ? String(form.get('site_url')).trim() : null;
    if (!customerId || !email.includes('@')) {
      return new Response(JSON.stringify({
        success: false,
        error: 'customer_id and email are required'
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    const auth = await isCheckoutAuthorized(supabase, customerId, email, pendingToken);
    if (!auth.ok) {
      return new Response(JSON.stringify({
        success: false,
        error: auth.error
      }), {
        status: 403,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    const frontFile = form.get('license_front');
    const backFile = form.get('license_back');
    const insuranceFile = form.get('insurance_document');
    const fields = {
      license_front_url: form.get('license_front_url') ? String(form.get('license_front_url')) : null,
      license_front_storage_path: form.get('license_front_storage_path') ? String(form.get('license_front_storage_path')) : null,
      license_back_url: form.get('license_back_url') ? String(form.get('license_back_url')) : null,
      license_back_storage_path: form.get('license_back_storage_path') ? String(form.get('license_back_storage_path')) : null,
      insurance_url: form.get('insurance_url') ? String(form.get('insurance_url')) : null,
      insurance_storage_path: form.get('insurance_storage_path') ? String(form.get('insurance_storage_path')) : null
    };
    if (frontFile instanceof File && frontFile.size > 0) {
      const uploaded = await uploadFile(supabase, customerId, 'license_front', frontFile);
      fields.license_front_url = uploaded.url;
      fields.license_front_storage_path = uploaded.path;
    }
    if (backFile instanceof File && backFile.size > 0) {
      const uploaded = await uploadFile(supabase, customerId, 'license_back', backFile);
      fields.license_back_url = uploaded.url;
      fields.license_back_storage_path = uploaded.path;
    }
    if (insuranceFile instanceof File && insuranceFile.size > 0) {
      const uploaded = await uploadFile(supabase, customerId, 'insurance_document', insuranceFile);
      fields.insurance_url = uploaded.url;
      fields.insurance_storage_path = uploaded.path;
    }
    const data = await upsertVerificationDocuments(supabase, customerId, fields, licensePlate);
    const documents = await signDocumentPaths(supabase, fields, siteUrl);
    return new Response(JSON.stringify({
      success: true,
      data,
      documents
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('[save-checkout-verification-docs] error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return new Response(JSON.stringify({
      success: false,
      error: message
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
});


// ============================
// Function: check-returning-customer
// ============================

// --- File: check-returning-customer/index.ts ---

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { getCorsHeaders } from '../_shared/cors.ts';
const QUALIFYING_STATUSES = new Set([
  'completed',
  'returned',
  'flagged'
]);
function isQualifyingBooking(booking) {
  if (!booking) return false;
  if (booking.returned_at) return true;
  const status = String(booking.status || '').trim().toLowerCase();
  return status.length > 0 && QUALIFYING_STATUSES.has(status);
}
Deno.serve(async (req)=>{
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
  }
  try {
    const { email } = await req.json();
    const normalizedEmail = String(email || '').trim().toLowerCase();
    if (!normalizedEmail || !normalizedEmail.includes('@')) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Valid email is required'
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    if (!supabaseUrl || !serviceRoleKey) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Server configuration error'
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    const supabase = createClient(supabaseUrl, serviceRoleKey);
    // Historic data can hold more than one row per email (differing case), so
    // read them all and treat them as the same person rather than erroring.
    const { data: customerMatches, error: customerError } = await supabase.from('customers').select('id, email, first_name, last_name').ilike('email', normalizedEmail).order('id', {
      ascending: true
    });
    if (customerError) {
      console.error('[check-returning-customer] customer lookup error:', customerError);
      return new Response(JSON.stringify({
        success: false,
        error: 'Failed to check customer'
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    const customer = customerMatches?.[0] ?? null;
    const customerIds = (customerMatches || []).map((row)=>row.id);
    if (!customer) {
      return new Response(JSON.stringify({
        success: true,
        isReturning: false,
        pastBookingsCount: 0,
        customer: null
      }), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    const { data: bookings, error: bookingsError } = await supabase.from('bookings').select('id, created_at, status, returned_at').in('customer_id', customerIds).order('created_at', {
      ascending: false
    });
    if (bookingsError) {
      console.error('[check-returning-customer] bookings lookup error:', bookingsError);
      return new Response(JSON.stringify({
        success: false,
        error: 'Failed to check bookings'
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    const qualifying = (bookings || []).filter(isQualifyingBooking);
    const isReturning = qualifying.length > 0;
    return new Response(JSON.stringify({
      success: true,
      isReturning,
      pastBookingsCount: qualifying.length,
      customer: isReturning ? {
        id: customer.id,
        email: customer.email,
        first_name: customer.first_name,
        last_name: customer.last_name
      } : null
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('[check-returning-customer] unexpected error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: 'Internal server error'
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
});


// ============================
// Function: refund-booking-difference
// ============================

// --- File: refund-booking-difference/cors.ts ---

export { getCorsHeaders } from '../_shared/cors.ts';


// --- File: refund-booking-difference/index.ts ---

import { getCorsHeaders } from "./cors.ts";
import { Stripe } from "npm:stripe@15.8.0";
import { createClient } from "npm:@supabase/supabase-js@2";
const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "", {
  apiVersion: "2024-06-20"
});
const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
/**
 * Partial refund for a reschedule price decrease.
 * Does NOT cancel the booking or reverse loyalty points.
 */ Deno.serve(async (req)=>{
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
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
      const { data: paymentInfo, error: payErr } = await supabase.from("stripe_payment_info").select("stripe_charge_id").eq("booking_id", bookingId).order("created_at", {
        ascending: false
      }).limit(1).maybeSingle();
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
        type: "reschedule_difference"
      }
    });
    const { data: bookingData, error: loadErr } = await supabase.from("bookings").select("fees").eq("id", bookingId).single();
    if (loadErr) throw new Error(`DB error loading booking: ${loadErr.message}`);
    const existingFees = bookingData?.fees && typeof bookingData.fees === "object" ? bookingData.fees : {};
    const newFees = {
      ...existingFees,
      reschedule_difference_refund: {
        amount,
        description: reason,
        refund_id: refund.id,
        charge_id: chargeId,
        status: refund.status,
        created_at: new Date().toISOString()
      }
    };
    const { error: updErr } = await supabase.from("bookings").update({
      fees: newFees
    }).eq("id", bookingId);
    if (updErr) {
      throw new Error(`Stripe refund succeeded, but failed to update booking fees: ${updErr.message}`);
    }
    return new Response(JSON.stringify({
      success: true,
      message: `Refund of $${amount.toFixed(2)} processed successfully.`,
      refundId: refund.id,
      refund,
      chargeId
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      },
      status: 200
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[refund-booking-difference] Error:", message);
    return new Response(JSON.stringify({
      success: false,
      error: message
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      },
      status: 500
    });
  }
});


// ============================
// Function: send-rental-started
// ============================

// --- File: send-rental-started/index.ts ---

REMAINING_FILES_INCOMPLETE;


// ============================
// Function: sync-lock-activity
// ============================

// --- File: sync-lock-activity/cors.ts ---

export { getCorsHeaders } from "../_shared/cors.ts";


// --- File: sync-lock-activity/index.ts ---

/**
 * sync-lock-activity
 *
 * Polls the Igloohome bridge for lock activity logs (jobType 15), matches PINs
 * to bookings, writes rental_tracking_logs, and advances the rented/returned
 * state machine.
 *
 * Probe mode: POST { "probe": true } or ?probe=1 — returns raw job response
 * without applying state changes (use once to confirm payload shape).
 */ import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getCorsHeaders } from "./cors.ts";
import { parseActivityLogsFromPayload } from "../_shared/iglooActivity.ts";
import { applyLockEvent, resolveOrderIdByPin, sweepGraceHourReturns } from "../_shared/lockEventState.ts";
const IGLOOHOME_OAUTH_URL = "https://auth.igloohome.co/oauth2/token";
const IGLOOHOME_API_BASE_URL = "https://api.igloodeveloper.co/igloohome";
function makeJsonResponse(corsHeaders) {
  return (body, status = 200)=>new Response(JSON.stringify(body), {
      status,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
}
async function readResponse(res) {
  const text = await res.text();
  try {
    return {
      text,
      json: text ? JSON.parse(text) : null
    };
  } catch  {
    return {
      text,
      json: null
    };
  }
}
function sleep(ms) {
  return new Promise((r)=>setTimeout(r, ms));
}
const OAUTH_SCOPES = [
  "igloohomeapi/create-pin-bridge-proxied-job",
  "igloohomeapi/create-bridge-proxied-job",
  "igloohomeapi/get-devices",
  "igloohomeapi/get-job-status",
  "igloohomeapi/algopin-onetime",
  "igloohomeapi/store-device-activity"
];
/**
 * Cognito rejects the whole exchange (400 invalid_request) if any single requested
 * scope is unauthorized for the app client, so these are dropped on a retry.
 */ const OPTIONAL_OAUTH_SCOPES = [
  "igloohomeapi/create-bridge-proxied-job",
  "igloohomeapi/algopin-onetime"
];
async function requestOAuthToken(clientId, clientSecret, scopes) {
  const credentials = btoa(`${clientId}:${clientSecret}`);
  const form = new URLSearchParams({
    grant_type: "client_credentials"
  });
  if (scopes.length) form.set("scope", scopes.join(" "));
  const res = await fetch(IGLOOHOME_OAUTH_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json"
    },
    body: form
  });
  const body = await readResponse(res);
  if (!res.ok || !body.json?.access_token) {
    console.error(`[sync-lock-activity] OAuth HTTP ${res.status} for scopes [${scopes.join(" ")}]:`, body.text);
    return null;
  }
  return body.json.access_token;
}
async function getOAuthToken(clientId, clientSecret) {
  const token = await requestOAuthToken(clientId, clientSecret, OAUTH_SCOPES);
  if (token) return token;
  const reduced = OAUTH_SCOPES.filter((s)=>!OPTIONAL_OAUTH_SCOPES.includes(s));
  const retry = await requestOAuthToken(clientId, clientSecret, reduced);
  if (retry) return retry;
  // Omitting scope entirely makes Cognito grant every scope the app client owns.
  return await requestOAuthToken(clientId, clientSecret, []);
}
async function createActivityLogJob(accessToken, lockId, bridgeId) {
  const url = `${IGLOOHOME_API_BASE_URL}/devices/${lockId}/jobs/bridges/${bridgeId}`;
  const payload = {
    jobType: 15,
    jobData: {
      lockTime: new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00")
    }
  };
  console.log("[sync-lock-activity] Creating activity-log job:", payload);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify(payload)
  });
  const body = await readResponse(res);
  if (!res.ok && res.status !== 201) {
    return {
      success: false,
      error: body.text,
      raw: body.json
    };
  }
  const jobId = body.json?.jobId || body.json?.id || null;
  if (!jobId) {
    return {
      success: false,
      error: "No jobId in response",
      raw: body.json
    };
  }
  return {
    success: true,
    jobId: String(jobId),
    raw: body.json
  };
}
async function pollJobStatus(accessToken, jobId, maxAttempts = 24, intervalMs = 2500) {
  let last = null;
  for(let i = 0; i < maxAttempts; i++){
    const res = await fetch(`${IGLOOHOME_API_BASE_URL}/jobs/${jobId}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json"
      }
    });
    const body = await readResponse(res);
    last = body.json;
    if (!res.ok) {
      console.warn(`[sync-lock-activity] Job poll ${i + 1} status ${res.status}:`, body.text);
      await sleep(intervalMs);
      continue;
    }
    if (body.json?.completed === true || body.json?.jobResponse?.jobStatus === 0) {
      return {
        completed: true,
        raw: body.json
      };
    }
    if (body.json?.jobResponse?.jobStatus === 2) {
      return {
        completed: false,
        expired: true,
        raw: body.json
      };
    }
    await sleep(intervalMs);
  }
  return {
    completed: false,
    timedOut: true,
    raw: last
  };
}
Deno.serve(async (req)=>{
  const corsHeaders = getCorsHeaders(req);
  const jsonResponse = makeJsonResponse(corsHeaders);
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  try {
    const url = new URL(req.url);
    let probe = url.searchParams.get("probe") === "1";
    if (req.method === "POST") {
      try {
        const body = await req.json();
        if (body?.probe === true || body?.probe === 1 || body?.probe === "1") {
          probe = true;
        }
      } catch  {
      // empty body is fine (cron)
      }
    }
    const clientId = Deno.env.get("IGLOOHOME_CLIENT_ID");
    const clientSecret = Deno.env.get("IGLOOHOME_CLIENT_SECRET");
    const lockId = Deno.env.get("IGLOOHOME_LOCK_ID") || Deno.env.get("IGLOOHOME_DEVICE_ID");
    const bridgeId = Deno.env.get("IGLOOHOME_BRIDGE_ID");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!clientId || !clientSecret || !lockId || !bridgeId) {
      return jsonResponse({
        success: false,
        error: "Missing IGLOOHOME_CLIENT_ID / SECRET / LOCK_ID / BRIDGE_ID"
      }, 500);
    }
    if (!supabaseUrl || !serviceKey) {
      return jsonResponse({
        success: false,
        error: "Missing Supabase env"
      }, 500);
    }
    const accessToken = await getOAuthToken(clientId, clientSecret);
    if (!accessToken) {
      return jsonResponse({
        success: false,
        error: "OAuth failed"
      }, 502);
    }
    const jobCreate = await createActivityLogJob(accessToken, lockId, bridgeId);
    if (!jobCreate.success) {
      return jsonResponse({
        success: false,
        error: `Activity log job failed: ${jobCreate.error}`,
        raw: jobCreate.raw,
        probe
      }, 502);
    }
    const jobResult = await pollJobStatus(accessToken, jobCreate.jobId);
    if (probe) {
      return jsonResponse({
        success: true,
        probe: true,
        jobId: jobCreate.jobId,
        jobCreate: jobCreate.raw,
        jobResult: jobResult.raw,
        parsedEvents: parseActivityLogsFromPayload(jobResult.raw),
        message: "Probe complete — inspect jobResult / parsedEvents to confirm field mapping"
      });
    }
    if (!jobResult.completed) {
      return jsonResponse({
        success: false,
        error: jobResult.expired ? "Job expired" : "Job timed out",
        jobId: jobCreate.jobId,
        raw: jobResult.raw
      }, 504);
    }
    const events = parseActivityLogsFromPayload(jobResult.raw);
    console.log(`[sync-lock-activity] Parsed ${events.length} events from job ${jobCreate.jobId}`);
    const supabase = createClient(supabaseUrl, serviceKey);
    const actions = [];
    for (const event of events){
      const orderId = await resolveOrderIdByPin(supabase, event.pinCode, event.eventTimestamp);
      if (!orderId) {
        actions.push({
          pin: event.pinCode,
          orderId: null,
          action: "unmatched_pin"
        });
        continue;
      }
      const action = await applyLockEvent(supabase, {
        orderId,
        eventType: event.eventType,
        eventTimestamp: event.eventTimestamp,
        notes: `${event.eventType} via sync-lock-activity job ${jobCreate.jobId}`
      });
      actions.push({
        pin: event.pinCode,
        orderId,
        action
      });
    }
    const swept = await sweepGraceHourReturns(supabase);
    return jsonResponse({
      success: true,
      jobId: jobCreate.jobId,
      eventsParsed: events.length,
      actions,
      graceHourClosed: swept
    });
  } catch (error) {
    console.error("[sync-lock-activity] Unhandled:", error);
    return jsonResponse({
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }, 500);
  }
});


// ============================
// Function: igloohome-webhook
// ============================

// --- File: igloohome-webhook/cors.ts ---

export { getCorsHeaders } from "../_shared/cors.ts";


// --- File: igloohome-webhook/index.ts ---

/**
 * igloohome-webhook
 *
 * Public endpoint for igloohome webhook deliveries. Routes on the event type
 * in `payload.payload.event.type`:
 *
 *   3  Job Complete           — result of a command we issued (lock_jobs)
 *   5  Activity Log Received  — real activity at the lock (the primary event)
 *   10 Bridge Connection      — bridge network connectivity heartbeat
 *
 * Register in the igloohome portal:
 *   https://<project>.supabase.co/functions/v1/igloohome-webhook
 *
 * Requires `verify_jwt = false` (see supabase/config.toml) because igloohome
 * authenticates with the x-igloocompany-sha256 signature, not a JWT.
 */ import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getCorsHeaders } from "./cors.ts";
import { parseActivityLogEntry, redactPins } from "../_shared/iglooActivity.ts";
import { applyLockEvent, sweepGraceHourReturns } from "../_shared/lockEventState.ts";
import { defaultBridgeId, defaultDeviceId, recordDeviceEvents } from "../_shared/lockDeviceState.ts";
import { verifyIglooWebhook } from "../_shared/iglooWebhookAuth.ts";
import { alertBreakInAttempt, alertBridgeOfflineWhileUnlocked } from "../_shared/lockAlerts.ts";
import { notifyPinReady } from "../_shared/pinNotify.ts";
const EVENT_JOB_COMPLETE = 3;
const EVENT_ACTIVITY_LOG = 5;
const EVENT_BRIDGE_CONNECTION = 10;
function makeJsonResponse(corsHeaders) {
  return (body, status = 200)=>new Response(JSON.stringify(body), {
      status,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
}
function asRecord(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value;
  }
  return null;
}
function pickString(obj, keys) {
  if (!obj) return null;
  for (const key of keys){
    const val = obj[key];
    if (typeof val === "string" && val.trim()) return val.trim();
    if (typeof val === "number") return String(val);
  }
  return null;
}
/** Igloohome nests as `{ payload: { event: {...} } }`; tolerate a flatter shape too. */ function extractEvent(body) {
  const root = asRecord(body);
  if (!root) return null;
  return asRecord(asRecord(root.payload)?.event) || asRecord(root.event) || asRecord(root.payload) || root;
}
function eventTypeOf(event) {
  if (!event) return null;
  const val = event.type ?? event.eventType;
  if (typeof val === "number") return val;
  if (typeof val === "string" && /^\d+$/.test(val.trim())) return Number(val.trim());
  return null;
}
const JOB_TYPE_CREATE_PIN = 4;
const JOB_TYPE_DELETE_PIN = 5;
/** Igloohome job statuses: 0 = completed, 2 = failed (matches _shared/lockPin.ts pollJob). */ function isJobCompleted(jobStatus, completedFlag) {
  return completedFlag === true || jobStatus === 0;
}
/**
 * Job Complete tells us the *result* of a create/delete we issued. Use it to
 * flip rental_access_codes.lock_confirmed_at / lock_deleted_at immediately
 * instead of waiting for the next reconciler sweep to poll the job.
 */ async function reconcilePinFromJob(supabase, jobId, jobType, jobStatus, completedFlag) {
  if (!isJobCompleted(jobStatus, completedFlag)) return null;
  if (jobType !== JOB_TYPE_CREATE_PIN && jobType !== JOB_TYPE_DELETE_PIN) return null;
  const { data: pinRow } = await supabase.from("rental_access_codes").select("id, order_id, access_pin, pin_type, start_time, end_time, lock_confirmed_at, lock_deleted_at").eq("pin_id", jobId).eq("pin_type", "bridge_proxied").maybeSingle();
  if (!pinRow) return null;
  const nowIso = new Date().toISOString();
  if (jobType === JOB_TYPE_CREATE_PIN && !pinRow.lock_confirmed_at) {
    await supabase.from("rental_access_codes").update({
      lock_confirmed_at: nowIso
    }).eq("id", pinRow.id);
    console.log(`[igloohome-webhook] Job ${jobId}: create confirmed for order #${pinRow.order_id}`);
    const { data: booking } = await supabase.from("bookings").select("*").eq("id", pinRow.order_id).maybeSingle();
    if (booking) return {
      orderId: pinRow.order_id,
      booking
    };
    return null;
  }
  if (jobType === JOB_TYPE_DELETE_PIN && !pinRow.lock_deleted_at) {
    await supabase.from("rental_access_codes").update({
      status: "expired",
      lock_deleted_at: nowIso
    }).eq("id", pinRow.id);
    console.log(`[igloohome-webhook] Job ${jobId}: delete confirmed for order #${pinRow.order_id}`);
  }
  return null;
}
async function handleJobComplete(supabase, event) {
  const data = asRecord(event.data) || event;
  const jobId = pickString(data, [
    "jobId",
    "job_id",
    "id"
  ]);
  if (!jobId) return {
    result: {
      handled: false,
      reason: "missing jobId"
    },
    pinConfirmed: null
  };
  const jobStatusRaw = data.jobStatus ?? data.job_status ?? asRecord(data.jobResponse)?.jobStatus;
  const jobTypeRaw = data.jobType ?? data.job_type;
  const jobType = typeof jobTypeRaw === "number" ? jobTypeRaw : null;
  const deviceId = pickString(data, [
    "deviceId",
    "device_id",
    "lockId"
  ]) || defaultDeviceId();
  const { error } = await supabase.from("lock_jobs").upsert({
    job_id: jobId,
    device_id: deviceId,
    job_type: jobType,
    job_status: typeof jobStatusRaw === "number" ? jobStatusRaw : null,
    raw: redactPins(event),
    updated_at: new Date().toISOString()
  }, {
    onConflict: "job_id"
  });
  if (error) console.error("[igloohome-webhook] lock_jobs upsert failed:", error.message);
  let pinConfirmed = null;
  try {
    pinConfirmed = await reconcilePinFromJob(supabase, jobId, jobType, jobStatusRaw, data.completed);
  } catch (err) {
    console.error("[igloohome-webhook] reconcilePinFromJob failed:", err);
  }
  return {
    result: {
      handled: !error,
      jobId,
      jobStatus: jobStatusRaw ?? null
    },
    pinConfirmed
  };
}
/**
 * Fire-and-forget call into the reconciler so a bridge reconnect flushes any
 * PIN create/delete that got stuck while it was offline, instead of waiting
 * up to 5 minutes for the next cron sweep.
 */ async function triggerReconciler(reason) {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) return;
    const res = await fetch(`${supabaseUrl}/functions/v1/reconcile-lock-pins`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        apikey: serviceKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        reason
      })
    });
    console.log(`[igloohome-webhook] Reconciler flush (${reason}) -> HTTP ${res.status}`);
  } catch (err) {
    console.error(`[igloohome-webhook] Reconciler flush (${reason}) failed:`, err);
  }
}
async function handleBridgeConnection(supabase, event) {
  const data = asRecord(event.data) || event;
  const bridgeId = pickString(data, [
    "bridgeId",
    "bridge_id",
    "deviceId",
    "id"
  ]) || defaultBridgeId();
  if (!bridgeId) return {
    result: {
      handled: false,
      reason: "missing bridgeId"
    },
    alerts: []
  };
  const rawOnline = data.isOnline ?? data.online ?? data.connected ?? data.connectionStatus ?? data.status;
  let isOnline = null;
  if (typeof rawOnline === "boolean") isOnline = rawOnline;
  else if (typeof rawOnline === "number") isOnline = rawOnline === 1;
  else if (typeof rawOnline === "string") {
    isOnline = /^(1|true|online|connected)$/i.test(rawOnline.trim());
  }
  const now = new Date().toISOString();
  const { data: previous } = await supabase.from("lock_bridges").select("bridge_id, is_online").eq("bridge_id", bridgeId).maybeSingle();
  const changed = previous?.is_online !== isOnline;
  const { error } = await supabase.from("lock_bridges").upsert({
    bridge_id: bridgeId,
    is_online: isOnline,
    last_event_at: now,
    ...changed ? {
      last_changed_at: now
    } : {}
  }, {
    onConflict: "bridge_id"
  });
  if (error) console.error("[igloohome-webhook] lock_bridges upsert failed:", error.message);
  const alerts = [];
  // Bridge just came back — flush any PIN create/delete that got stuck
  // while it was unreachable instead of waiting for the next cron sweep.
  if (isOnline === true && changed) {
    alerts.push(()=>triggerReconciler("bridge_reconnect"));
  }
  // Losing connectivity while a lock is still open is the worst case: the
  // equipment is accessible and we will not hear about further activity.
  if (isOnline === false && changed) {
    const { data: openDevices } = await supabase.from("lock_devices").select("device_id, label, state_changed_at").eq("bridge_id", bridgeId).eq("current_state", "unlocked").eq("is_active", true);
    for (const device of openDevices ?? []){
      alerts.push(()=>alertBridgeOfflineWhileUnlocked({
          bridgeId,
          deviceId: device.device_id,
          label: device.label,
          lastStateChangedAt: device.state_changed_at
        }));
    }
  }
  return {
    result: {
      handled: !error,
      bridgeId,
      isOnline,
      changed
    },
    alerts
  };
}
async function handleActivityLogs(supabase, event) {
  const data = asRecord(event.data) || event;
  const logs = Array.isArray(data.activityLogs) ? data.activityLogs : Array.isArray(data.activity_logs) ? data.activity_logs : Array.isArray(data.logs) ? data.logs : [];
  const parsedEvents = [];
  for (const entry of logs){
    const parsed = parseActivityLogEntry(entry);
    if (parsed) parsedEvents.push(parsed);
  }
  const { recorded, stored } = await recordDeviceEvents(supabase, parsedEvents, {
    deviceId: pickString(data, [
      "deviceId",
      "device_id",
      "lockId",
      "productId"
    ]),
    bridgeId: pickString(data, [
      "bridgeId",
      "bridge_id"
    ])
  });
  return {
    recorded,
    parsed: parsedEvents.length,
    stored
  };
}
/**
 * Booking state changes and notifications run after the 200 so igloohome never
 * retries because an email provider was slow.
 */ async function processDeferred(supabase, recorded, bridgeAlerts, pinConfirmed) {
  try {
    if (pinConfirmed) {
      const { data: pinRow } = await supabase.from("rental_access_codes").select("access_pin, start_time, end_time").eq("order_id", pinConfirmed.orderId).eq("status", "active").order("created_at", {
        ascending: false
      }).limit(1).maybeSingle();
      if (pinRow?.access_pin) {
        await notifyPinReady(supabase, pinConfirmed.booking, String(pinRow.access_pin), String(pinRow.start_time || ""), String(pinRow.end_time || ""));
      }
    }
    for (const { event, deviceId, orderId } of recorded){
      if (event.eventType === "breakin") {
        const { data: device } = await supabase.from("lock_devices").select("label").eq("device_id", deviceId).maybeSingle();
        await alertBreakInAttempt({
          deviceId,
          label: device?.label ?? null,
          occurredAt: event.eventTimestamp,
          orderId
        });
      }
      if (!orderId) continue;
      const action = await applyLockEvent(supabase, {
        orderId,
        eventType: event.eventType,
        eventTimestamp: event.eventTimestamp,
        notes: `${event.eventType} via igloohome-webhook (logType ${event.logType ?? "n/a"})`
      });
      console.log(`[igloohome-webhook] Booking #${orderId}: ${action}`);
    }
    for (const alert of bridgeAlerts)await alert();
    if (recorded.length > 0) {
      await sweepGraceHourReturns(supabase);
    }
  } catch (err) {
    console.error("[igloohome-webhook] Deferred processing failed:", err);
  }
}
function runDeferred(work) {
  // deno-lint-ignore no-explicit-any
  const runtime = globalThis.EdgeRuntime;
  if (runtime && typeof runtime.waitUntil === "function") {
    runtime.waitUntil(work);
    return;
  }
  work.catch((err)=>console.error("[igloohome-webhook] Deferred work rejected:", err));
}
Deno.serve(async (req)=>{
  const corsHeaders = getCorsHeaders(req);
  const jsonResponse = makeJsonResponse(corsHeaders);
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  if (req.method !== "POST") {
    return jsonResponse({
      success: false,
      error: "Method not allowed"
    }, 405);
  }
  try {
    const rawBody = await req.text();
    const verification = await verifyIglooWebhook(req, rawBody);
    if (!verification.valid) {
      console.warn(`[igloohome-webhook] Signature rejected (${verification.method}): ${verification.reason}`);
      return jsonResponse({
        success: false,
        error: "Invalid signature"
      }, 401);
    }
    let body = null;
    try {
      body = rawBody ? JSON.parse(rawBody) : null;
    } catch  {
      return jsonResponse({
        success: false,
        error: "Invalid JSON"
      }, 400);
    }
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) {
      return jsonResponse({
        success: false,
        error: "Missing Supabase env"
      }, 500);
    }
    const supabase = createClient(supabaseUrl, serviceKey);
    const event = extractEvent(body);
    const type = eventTypeOf(event);
    console.log("[igloohome-webhook] Verified event", JSON.stringify({
      verifiedBy: verification.method,
      eventType: type,
      payload: redactPins(body)
    }));
    if (type === EVENT_JOB_COMPLETE) {
      const { result, pinConfirmed } = await handleJobComplete(supabase, event);
      if (pinConfirmed) runDeferred(processDeferred(supabase, [], [], pinConfirmed));
      return jsonResponse({
        success: true,
        eventType: type,
        ...result
      });
    }
    if (type === EVENT_BRIDGE_CONNECTION) {
      const { result, alerts } = await handleBridgeConnection(supabase, event);
      if (alerts.length > 0) runDeferred(processDeferred(supabase, [], alerts));
      return jsonResponse({
        success: true,
        eventType: type,
        ...result
      });
    }
    if (type === EVENT_ACTIVITY_LOG) {
      const { recorded, parsed, stored } = await handleActivityLogs(supabase, event);
      runDeferred(processDeferred(supabase, recorded, [], null));
      return jsonResponse({
        success: true,
        eventType: type,
        eventsParsed: parsed,
        eventsStored: stored,
        verifiedBy: verification.method
      });
    }
    console.log(`[igloohome-webhook] Unhandled event type: ${type}`);
    return jsonResponse({
      success: true,
      eventType: type,
      handled: false
    });
  } catch (error) {
    console.error("[igloohome-webhook] Unhandled:", error);
    return jsonResponse({
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }, 500);
  }
});


// ============================
// Function: test-lock-lifecycle
// ============================

// --- File: test-lock-lifecycle/cors.ts ---

export { getCorsHeaders } from "../_shared/cors.ts";


// --- File: test-lock-lifecycle/index.ts ---

/**
 * test-lock-lifecycle (admin only)
 *
 * Compress a booking into a short live window and exercise the lock rental flow
 * without waiting days.
 *
 * Actions:
 *   status            — booking + active PIN + recent tracking logs + stale PIN counts
 *   setup             — shift booking to NOW…NOW+N min, clear verified, create confirmed PIN
 *   clear_lock_pins   — delete every known PIN for this booking from the lock (verified)
 *   confirm_pin       — short poll of pending bridge job (call repeatedly from UI)
 *   restore           — restore original booking dates from snapshot
 *   simulate_unlock   — inject unlock event → mark Rented + notify
 *   simulate_lock     — inject lock at/after scheduled end → mark Returned + notify
 *   simulate_webhook  — run the type-5 activity path in-process (kind: unlock|lock|breakin)
 *                       without HTTP self-fetch (avoids edge-runtime deadlock)
 *   sync              — pull real activity logs from the Wi-Fi bridge
 *   probe             — raw jobType 15 response (payload discovery)
 *   algopin           — offline one-time AlgoPIN (no bridge)
 */ import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getCorsHeaders } from "./cors.ts";
import { applyLockEvent, sweepGraceHourReturns } from "../_shared/lockEventState.ts";
import { recordDeviceEvents } from "../_shared/lockDeviceState.ts";
import { alertBreakInAttempt } from "../_shared/lockAlerts.ts";
import { getBookingWindow, clampIgloohomeStart } from "../_shared/pinTiming.ts";
import { fetchDeviceActivityRows, mergeActivityEvents, isEmptyActivityLogPayload, parseFailedPinAttempt, parseActivityLogEntry } from "../_shared/iglooActivity.ts";
import { ensurePinOnLock, clearKnownPins } from "../_shared/lockPin.ts";
import { isAdminWithMfa } from "../_shared/jwtAal.ts";
import { getOAuthToken, diagnoseOAuth, bridgeOfflineHint, GENERATE_PIN_SCOPES, getActivitySyncToken, getDeviceActivityToken, getRemoteLockJobToken, tokenScopes, ACTIVITY_SYNC_SCOPE_HINT, DEVICE_ACTIVITY_SCOPE_HINT } from "../_shared/iglooAuth.ts";
const IGLOOHOME_API_BASE_URL = "https://api.igloodeveloper.co/igloohome";
function makeJsonResponse(corsHeaders) {
  return (body, status = 200)=>new Response(JSON.stringify(body), {
      status,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
}
async function readResponse(res) {
  const text = await res.text();
  try {
    return {
      text,
      json: text ? JSON.parse(text) : null
    };
  } catch  {
    return {
      text,
      json: null
    };
  }
}
function sleep(ms) {
  return new Promise((r)=>setTimeout(r, ms));
}
/** Format a Date as MST calendar date + "h:mm AM/PM" slot (matches booking storage). */ function toMstDateAndSlot(d) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Denver",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  }).formatToParts(d);
  const get = (type)=>parts.find((p)=>p.type === type)?.value || "";
  const month = get("month");
  const day = get("day");
  const year = get("year");
  const hour = get("hour");
  const minute = get("minute");
  const dayPeriod = get("dayPeriod");
  return {
    date: `${year}-${month}-${day}`,
    timeSlot: `${hour}:${minute} ${dayPeriod}`
  };
}
function isoPlusMinutes(minutes, from = new Date()) {
  return new Date(from.getTime() + minutes * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, "+00:00");
}
/**
 * Backdate slightly so a freshly created PIN is immediately usable, then clamp
 * to Igloohome's current-hour rule via the shared helper.
 */ function pinStartIso(backdateMinutes = 2) {
  return clampIgloohomeStart(isoPlusMinutes(-backdateMinutes));
}
async function requireAdmin(req) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return {
    error: "Missing Authorization",
    status: 401
  };
  const token = authHeader.replace("Bearer ", "");
  const anon = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
    global: {
      headers: {
        Authorization: `Bearer ${token}`
      }
    }
  });
  const { data: { user }, error } = await anon.auth.getUser();
  if (error || !user) return {
    error: "Unauthorized",
    status: 401
  };
  if (!isAdminWithMfa(user, token)) {
    return {
      error: "Admin access and authenticator MFA required (app_metadata.is_admin must be true and the session must be AAL2)",
      status: 403
    };
  }
  return {
    user
  };
}
async function deleteBridgePin(accessToken, lockId, bridgeId, pin) {
  const url = `${IGLOOHOME_API_BASE_URL}/devices/${lockId}/jobs/bridges/${bridgeId}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({
      jobType: 5,
      jobData: {
        pin
      }
    })
  });
  const body = await readResponse(res);
  const ok = res.ok || res.status === 201;
  const jobId = String(body.json?.jobId || body.json?.pinId || body.json?.id || "");
  return {
    ok,
    jobId
  };
}
async function createBridgeDurationPin(accessToken, lockId, bridgeId, pin, startDate, endDate, accessName) {
  const url = `${IGLOOHOME_API_BASE_URL}/devices/${lockId}/jobs/bridges/${bridgeId}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({
      jobType: 4,
      jobData: {
        accessName,
        pin,
        pinType: 4,
        startDate,
        endDate
      }
    })
  });
  const body = await readResponse(res);
  if (!res.ok && res.status !== 201) {
    return {
      success: false,
      error: body.text,
      raw: body.json
    };
  }
  return {
    success: true,
    pinId: String(body.json?.jobId || body.json?.pinId || body.json?.id || ""),
    raw: body.json
  };
}
/**
 * Bridge jobs are queued, so a 201 only means Igloohome accepted the request.
 * The PIN is not usable until the job completes (lock awake + in bridge range).
 * Keep each edge invoke short — Kong/Vite returns HTTP 504 around ~150s.
 */ async function waitForJobCompletion(accessToken, jobId, attempts = 3, delayMs = 2500) {
  let raw = null;
  const polls = [];
  for(let i = 0; i < attempts; i++){
    await sleep(delayMs);
    const res = await fetch(`${IGLOOHOME_API_BASE_URL}/jobs/${jobId}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json"
      }
    });
    const body = await readResponse(res);
    raw = body.json ?? body.text;
    const jobResponse = body.json?.jobResponse;
    const jobStatus = jobResponse?.jobStatus;
    const completed = body.json?.completed;
    const pollRow = {
      attempt: i + 1,
      httpStatus: res.status,
      completed: completed ?? null,
      jobStatus: jobStatus ?? null,
      hasPayload: !!body.json,
      topKeys: body.json && typeof body.json === "object" ? Object.keys(body.json).slice(0, 12) : [],
      jobResponseKeys: jobResponse && typeof jobResponse === "object" ? Object.keys(jobResponse).slice(0, 12) : [],
      jobResponseSnippet: jobResponse && typeof jobResponse === "object" ? JSON.stringify(jobResponse).slice(0, 240) : null
    };
    polls.push(pollRow);
    if (body.json?.completed === true || body.json?.jobResponse?.jobStatus === 0) {
      return {
        state: "completed",
        raw,
        polls
      };
    }
    if (body.json?.jobResponse?.jobStatus === 2) return {
      state: "failed",
      raw,
      polls
    };
  }
  return {
    state: "pending",
    raw,
    polls
  };
}
async function fetchDevicesSummary(accessToken, lockId, bridgeId) {
  const res = await fetch(`${IGLOOHOME_API_BASE_URL}/devices`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json"
    }
  });
  const body = await readResponse(res);
  const payload = Array.isArray(body.json?.payload) ? body.json.payload : Array.isArray(body.json) ? body.json : [];
  const lock = payload.find((d)=>d.deviceId === lockId) || null;
  const bridge = payload.find((d)=>d.deviceId === bridgeId) || payload.find((d)=>d.type === "Bridge") || null;
  const bridgeLinks = Array.isArray(bridge?.linkedDevices) ? bridge.linkedDevices : [];
  return {
    httpStatus: res.status,
    deviceCount: payload.length,
    lockFound: !!lock,
    bridgeFound: !!bridge,
    lockType: lock?.type ?? null,
    bridgeType: bridge?.type ?? null,
    lockBatteryLevel: lock?.batteryLevel ?? null,
    bridgeLinkedDevices: bridgeLinks.length,
    bridgeLinksLock: bridgeLinks.some((d)=>typeof d === "string" ? d === lockId : d?.deviceId === lockId),
    bridgeLinkSnippet: JSON.stringify(bridgeLinks).slice(0, 200),
    lockKeys: lock && typeof lock === "object" ? Object.keys(lock).slice(0, 16) : [],
    bridgeKeys: bridge && typeof bridge === "object" ? Object.keys(bridge).slice(0, 16) : []
  };
}
/**
 * AlgoPIN codes are computed by the lock itself, so they work with no bridge and
 * no connectivity at the padlock. startDate must be hour-aligned.
 */ async function createOneTimeAlgoPin(accessToken, lockId, startDate, variance, accessName) {
  const res = await fetch(`${IGLOOHOME_API_BASE_URL}/devices/${lockId}/algopin/onetime`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({
      variance,
      startDate,
      accessName
    })
  });
  const body = await readResponse(res);
  if (!res.ok && res.status !== 201) {
    return {
      success: false,
      error: `AlgoPIN failed (HTTP ${res.status})`,
      raw: body.json ?? body.text
    };
  }
  const pin = String(body.json?.pin || body.json?.access_code || body.json?.code || "");
  if (!pin) {
    return {
      success: false,
      error: "AlgoPIN succeeded but no PIN in response",
      raw: body.json
    };
  }
  return {
    success: true,
    pin,
    pinId: String(body.json?.pinId || body.json?.id || ""),
    raw: body.json
  };
}
/** Floor an ISO timestamp to the top of its UTC hour (AlgoPIN requires zeroed minutes). */ function floorToHourIso(d = new Date()) {
  const f = new Date(d.getTime());
  f.setUTCMinutes(0, 0, 0);
  return f.toISOString().replace(/\.\d{3}Z$/, "+00:00");
}
async function activateConfirmedPin(supabase, booking, pending) {
  const now = new Date().toISOString();
  const bookingId = Number(booking.id);
  await supabase.from("rental_access_codes").insert({
    order_id: bookingId,
    customer_email: booking.email,
    customer_phone: booking.phone || "",
    access_pin: pending.pin,
    pin_id: pending.jobId,
    pin_type: "bridge_proxied",
    lock_id: pending.lockId,
    start_time: pending.startIso,
    end_time: pending.endIso,
    status: "active",
    lock_confirmed_at: now,
    confirm_attempts: 0
  });
  const archive = {
    ...booking.archive_details || {}
  };
  delete archive.test_lock_pending_pin;
  await supabase.from("bookings").update({
    pin_generated_at: now,
    archive_details: archive
  }).eq("id", bookingId);
  await supabase.from("rental_tracking_logs").insert({
    order_id: bookingId,
    event_type: "admin_override",
    event_timestamp: now,
    notes: `TEST setup: ${pending.durationMinutes}min window, PIN ${pending.pin} ` + `valid ${pending.startIso} → ${pending.endIso}`
  });
}
async function fetchBookingStatus(supabase, bookingId) {
  const { data: booking, error } = await supabase.from("bookings").select("id, name, email, phone, status, plan, addons, drop_off_date, drop_off_time_slot, pickup_date, pickup_time_slot, rented_out_at, returned_at, rental_started_notified_at, return_notified_at, pin_generated_at, archive_details").eq("id", bookingId).single();
  if (error || !booking) return {
    error: error?.message || "Booking not found"
  };
  const { data: pin } = await supabase.from("rental_access_codes").select("*").eq("order_id", bookingId).eq("status", "active").order("created_at", {
    ascending: false
  }).limit(1).maybeSingle();
  const { data: logs } = await supabase.from("rental_tracking_logs").select("*").eq("order_id", bookingId).order("event_timestamp", {
    ascending: false
  }).limit(20);
  const { data: stalePins } = await supabase.from("rental_access_codes").select("id, access_pin, status, lock_deleted_at, lock_confirmed_at, pin_type, created_at").eq("order_id", bookingId).is("lock_deleted_at", null).order("created_at", {
    ascending: false
  }).limit(10);
  const window = getBookingWindow(booking);
  const pendingPin = booking.archive_details?.test_lock_pending_pin;
  return {
    booking,
    pin,
    logs: logs || [],
    stalePins: stalePins || [],
    stalePinCount: (stalePins || []).filter((p)=>!p.lock_deleted_at && !(p.status === "active" && p.lock_confirmed_at)).length,
    window: {
      startIso: window.startIso,
      endIso: window.endIso,
      graceEndIso: window.graceEndIso,
      pinEligibleFromMs: window.pinEligibleFromMs
    },
    snapshot: booking.archive_details?.test_lock_snapshot || null,
    needsConfirm: !!(pendingPin?.jobId && !pin?.lock_confirmed_at),
    lockJobState: pendingPin?.jobId && !pin ? "pending" : pin?.lock_confirmed_at ? "completed" : undefined,
    lockJobDiagnostics: pendingPin?.jobId ? {
      jobId: pendingPin.jobId
    } : undefined,
    // Surface queued PIN so the UI can show it before confirm activates the row
    ...pendingPin?.pin && !pin ? {
      pin: pendingPin.pin
    } : {}
  };
}
Deno.serve(async (req)=>{
  const corsHeaders = getCorsHeaders(req);
  const jsonResponse = makeJsonResponse(corsHeaders);
  if (req.method === "OPTIONS") return new Response(null, {
    headers: corsHeaders
  });
  if (req.method !== "POST") {
    return jsonResponse({
      success: false,
      error: "Method not allowed"
    }, 405);
  }
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const clientId = Deno.env.get("IGLOOHOME_CLIENT_ID") ?? "";
    const clientSecret = Deno.env.get("IGLOOHOME_CLIENT_SECRET") ?? "";
    const lockId = Deno.env.get("IGLOOHOME_LOCK_ID") || Deno.env.get("IGLOOHOME_DEVICE_ID") || "";
    const bridgeId = Deno.env.get("IGLOOHOME_BRIDGE_ID") || "";
    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
    const admin = await requireAdmin(req);
    if ("error" in admin && admin.error) {
      return jsonResponse({
        success: false,
        error: admin.error
      }, admin.status);
    }
    const body = await req.json();
    const action = String(body.action || "status");
    // -------- oauth_diagnose (no booking needed) --------
    if (action === "oauth_diagnose") {
      if (!clientId || !clientSecret) {
        return jsonResponse({
          success: false,
          error: "Missing IGLOOHOME_CLIENT_ID / IGLOOHOME_CLIENT_SECRET"
        }, 500);
      }
      return jsonResponse({
        success: true,
        action,
        credentials: {
          clientIdLength: clientId.length,
          clientSecretLength: clientSecret.length,
          lockIdPresent: !!lockId,
          bridgeIdPresent: !!bridgeId
        },
        interpretation: [
          "Green = Cognito accepted that exact scope list.",
          "Red on a multi-scope set usually means ONE scope in the list is not authorized — Cognito rejects the whole request.",
          "Per-job scopes are preferred (create-pin / get-activity-logs). Legacy create-bridge-proxied-job is often unauthorized and is dropped for PIN flows.",
          "If Setup fails with HTTP 406 / bridge offline, that is hardware connectivity — not OAuth. Use AlgoPIN until the Bridge is back online."
        ],
        results: await diagnoseOAuth(clientId, clientSecret)
      });
    }
    // -------- remote_lock / remote_unlock (no booking needed) --------
    if (action === "remote_lock" || action === "remote_unlock") {
      if (!clientId || !clientSecret || !lockId || !bridgeId) {
        return jsonResponse({
          success: false,
          error: "Missing IGLOOHOME_CLIENT_ID / SECRET / LOCK_ID / BRIDGE_ID"
        }, 500);
      }
      const operation = action === "remote_lock" ? "lock" : "unlock";
      const jobType = operation === "lock" ? 1 : 2;
      const oauth = await getRemoteLockJobToken(clientId, clientSecret, operation);
      if (!oauth.token) {
        return jsonResponse({
          success: false,
          action,
          error: oauth.reason,
          scopesRequested: oauth.scopesUsed
        }, 502);
      }
      const grantedScopes = tokenScopes(oauth.token);
      const createRes = await fetch(`${IGLOOHOME_API_BASE_URL}/devices/${lockId}/jobs/bridges/${bridgeId}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${oauth.token}`,
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify({
          jobType,
          jobData: {}
        })
      });
      const createBody = await readResponse(createRes);
      const jobId = createBody.json?.jobId || createBody.json?.id;
      if (!createRes.ok || !jobId) {
        return jsonResponse({
          success: false,
          action,
          jobType,
          httpStatus: createRes.status,
          grantedScopes,
          error: createBody.json || createBody.text || "Bridge job request failed"
        }, 502);
      }
      const outcome = await waitForJobCompletion(oauth.token, jobId, 8, 2500);
      return jsonResponse({
        success: outcome.state === "completed",
        action,
        jobType,
        jobId,
        jobState: outcome.state,
        grantedScopes,
        polls: outcome.polls,
        raw: outcome.raw,
        webhookExpected: "Signed event.type 3 (Job Complete)"
      }, outcome.state === "failed" ? 502 : 200);
    }
    const bookingId = Number(body.bookingId ?? body.booking_id ?? body.order_id);
    if (!bookingId || Number.isNaN(bookingId)) {
      return jsonResponse({
        success: false,
        error: "bookingId is required"
      }, 400);
    }
    // -------- status --------
    if (action === "status") {
      const status = await fetchBookingStatus(supabase, bookingId);
      if (status.error) return jsonResponse({
        success: false,
        error: status.error
      }, 404);
      return jsonResponse({
        success: true,
        action: "status",
        ...status
      });
    }
    // -------- clear_lock_pins --------
    if (action === "clear_lock_pins") {
      if (!clientId || !clientSecret || !lockId || !bridgeId) {
        return jsonResponse({
          success: false,
          error: "Missing IGLOOHOME_CLIENT_ID / SECRET / LOCK_ID / BRIDGE_ID"
        }, 500);
      }
      const oauth = await getOAuthToken(clientId, clientSecret);
      if (!oauth.token) return jsonResponse({
        success: false,
        error: oauth.reason
      }, 502);
      const cleared = await clearKnownPins(supabase, oauth.token, bookingId, {
        lockId,
        bridgeId,
        budgetMs: 90_000,
        settleMs: 15_000
      });
      const status = await fetchBookingStatus(supabase, bookingId);
      return jsonResponse({
        ...status,
        success: cleared.pending === 0 && cleared.failed === 0,
        action: "clear_lock_pins",
        cleared,
        error: cleared.pending > 0 || cleared.failed > 0 ? `Cleared ${cleared.confirmed}/${cleared.attempted}; ${cleared.pending} still pending, ${cleared.failed} failed. Wait and retry Clear.` : undefined
      }, cleared.pending === 0 && cleared.failed === 0 ? 200 : 502);
    }
    // -------- restore --------
    if (action === "restore") {
      const { data: booking } = await supabase.from("bookings").select("id, archive_details").eq("id", bookingId).single();
      const snap = booking?.archive_details?.test_lock_snapshot;
      if (!snap) {
        return jsonResponse({
          success: false,
          error: "No test_lock_snapshot found on this booking — nothing to restore"
        }, 400);
      }
      const archive = {
        ...booking.archive_details || {}
      };
      delete archive.test_lock_snapshot;
      await supabase.from("bookings").update({
        drop_off_date: snap.drop_off_date,
        drop_off_time_slot: snap.drop_off_time_slot,
        pickup_date: snap.pickup_date,
        pickup_time_slot: snap.pickup_time_slot,
        status: snap.status || "Confirmed",
        rented_out_at: snap.rented_out_at ?? null,
        returned_at: snap.returned_at ?? null,
        rental_started_notified_at: snap.rental_started_notified_at ?? null,
        return_notified_at: snap.return_notified_at ?? null,
        pin_generated_at: snap.pin_generated_at ?? null,
        archive_details: archive
      }).eq("id", bookingId);
      // Expire test PINs in DB (best-effort delete from lock)
      const { data: activePins } = await supabase.from("rental_access_codes").select("id, access_pin, pin_type").eq("order_id", bookingId).eq("status", "active");
      if (activePins?.length && clientId && clientSecret && lockId && bridgeId) {
        const { token } = await getOAuthToken(clientId, clientSecret);
        if (token) {
          for (const row of activePins){
            if (row.pin_type === "bridge_proxied" && row.access_pin) {
              await deleteBridgePin(token, lockId, bridgeId, row.access_pin);
            }
          }
        }
      }
      await supabase.from("rental_access_codes").update({
        status: "expired",
        lock_deleted_at: new Date().toISOString()
      }).eq("order_id", bookingId).eq("status", "active");
      const status = await fetchBookingStatus(supabase, bookingId);
      return jsonResponse({
        success: true,
        restored: true,
        ...status
      });
    }
    // -------- setup --------
    if (action === "setup") {
      const durationMinutes = Math.min(180, Math.max(5, Number(body.durationMinutes) || 30));
      const { data: booking, error } = await supabase.from("bookings").select("*").eq("id", bookingId).single();
      if (error || !booking) {
        return jsonResponse({
          success: false,
          error: "Booking not found"
        }, 404);
      }
      if (!clientId || !clientSecret || !lockId || !bridgeId) {
        return jsonResponse({
          success: false,
          error: "Missing IGLOOHOME_CLIENT_ID / SECRET / LOCK_ID / BRIDGE_ID"
        }, 500);
      }
      const existingSnap = booking.archive_details?.test_lock_snapshot;
      const snapshot = existingSnap || {
        drop_off_date: booking.drop_off_date,
        drop_off_time_slot: booking.drop_off_time_slot,
        pickup_date: booking.pickup_date,
        pickup_time_slot: booking.pickup_time_slot,
        status: booking.status,
        rented_out_at: booking.rented_out_at,
        returned_at: booking.returned_at,
        rental_started_notified_at: booking.rental_started_notified_at,
        return_notified_at: booking.return_notified_at,
        pin_generated_at: booking.pin_generated_at,
        saved_at: new Date().toISOString()
      };
      const startLocal = new Date(Date.now() - 2 * 60 * 1000);
      const endLocal = new Date(Date.now() + durationMinutes * 60 * 1000);
      const startMst = toMstDateAndSlot(startLocal);
      const endMst = toMstDateAndSlot(endLocal);
      const oauth = await getOAuthToken(clientId, clientSecret);
      if (!oauth.token) {
        return jsonResponse({
          success: false,
          error: oauth.reason
        }, 502);
      }
      const accessToken = oauth.token;
      const devices = await fetchDevicesSummary(accessToken, lockId, bridgeId);
      const startIso = pinStartIso();
      const endIso = isoPlusMinutes(durationMinutes);
      await supabase.from("bookings").update({
        drop_off_date: startMst.date,
        drop_off_time_slot: startMst.timeSlot,
        pickup_date: endMst.date,
        pickup_time_slot: endMst.timeSlot,
        status: "Confirmed",
        rented_out_at: null,
        returned_at: null,
        rental_started_notified_at: null,
        return_notified_at: null,
        pin_generated_at: null,
        pin_notification_sent_at: null,
        archive_details: {
          ...booking.archive_details || {},
          test_lock_snapshot: snapshot
        }
      }).eq("id", bookingId);
      // Verified clear + create — fails loudly if the bridge does not confirm.
      const ensured = await ensurePinOnLock(supabase, accessToken, {
        orderId: bookingId,
        lockId,
        bridgeId,
        startDate: startIso,
        endDate: endIso,
        accessName: `TEST Lock Lifecycle - Order #${bookingId}`,
        clearBudgetMs: 45_000,
        createBudgetMs: 75_000,
        settleMs: 12_000
      });
      // Job accepted but still in the bridge queue — keep the PIN and let the UI poll.
      if (!ensured.lockConfirmed && ensured.createState === "pending" && ensured.jobId) {
        const pendingPayload = {
          pin: ensured.pin,
          jobId: ensured.jobId,
          startIso,
          endIso,
          durationMinutes,
          lockId,
          queuedAt: new Date().toISOString()
        };
        await supabase.from("bookings").update({
          archive_details: {
            ...booking.archive_details || {},
            test_lock_snapshot: snapshot,
            test_lock_pending_pin: pendingPayload
          }
        }).eq("id", bookingId);
        const status = await fetchBookingStatus(supabase, bookingId);
        return jsonResponse({
          ...status,
          success: true,
          action: "setup",
          pin: ensured.pin,
          durationMinutes,
          needsConfirm: true,
          lockJobState: "pending",
          devices,
          lockJobDiagnostics: {
            jobId: ensured.jobId,
            deleteAttempts: ensured.clear.attempted,
            deleteConfirmed: ensured.clear.confirmed,
            deletePending: ensured.clear.pending,
            polls: ensured.polls,
            devices,
            clear: ensured.clear
          },
          instructions: [
            `PIN ${ensured.pin} is queued on the Bridge (job ${ensured.jobId}).`,
            "Do not try it on the padlock yet — wait for confirmation.",
            "Keep the padlock awake near the Bridge, then click Check Bridge Delivery (auto-retries).",
            "Or use Setup + AlgoPIN if you need a code immediately."
          ]
        });
      }
      if (!ensured.lockConfirmed) {
        const hint = bridgeOfflineHint(ensured.error);
        return jsonResponse({
          success: false,
          error: hint ? `${ensured.error}. ${hint}` : ensured.error || "Bridge did not confirm the PIN. Use Clear PINs From Lock, wake the padlock, then Setup again — or use AlgoPIN.",
          hint: hint || undefined,
          pin: ensured.pin || undefined,
          lockJobState: ensured.createState,
          devices,
          lockJobDiagnostics: {
            jobId: ensured.jobId || null,
            deleteAttempts: ensured.clear.attempted,
            deleteConfirmed: ensured.clear.confirmed,
            deletePending: ensured.clear.pending,
            polls: ensured.polls,
            devices,
            clear: ensured.clear
          }
        }, 502);
      }
      await activateConfirmedPin(supabase, booking, {
        pin: ensured.pin,
        jobId: ensured.jobId,
        startIso,
        endIso,
        durationMinutes,
        lockId
      });
      const status = await fetchBookingStatus(supabase, bookingId);
      return jsonResponse({
        ...status,
        success: true,
        action: "setup",
        pin: ensured.pin,
        durationMinutes,
        needsConfirm: false,
        lockJobState: "completed",
        devices,
        lockJobDiagnostics: {
          jobId: ensured.jobId || null,
          deleteAttempts: ensured.clear.attempted,
          deleteConfirmed: ensured.clear.confirmed,
          startIso,
          endIso,
          polls: ensured.polls,
          devices,
          clear: ensured.clear
        },
        instructions: [
          `PIN ${ensured.pin} is confirmed on the lock for ~${durationMinutes} minutes.`,
          "Walk to the lock, enter the PIN, and unlock.",
          "Then Sync Lock Activity — or Simulate Unlock / Simulate Lock.",
          "Click Restore Dates when finished."
        ]
      });
    }
    // -------- confirm_pin (short poll; call repeatedly from the browser) --------
    if (action === "confirm_pin") {
      const status = await fetchBookingStatus(supabase, bookingId);
      if (status.error) return jsonResponse({
        success: false,
        error: status.error
      }, 404);
      const bookingRow = status.booking;
      const pending = bookingRow.archive_details?.test_lock_pending_pin;
      const jobId = String(body.jobId || pending?.jobId || "");
      if (!jobId) {
        return jsonResponse({
          success: false,
          error: "No pending bridge job to confirm. Run Setup first."
        }, 400);
      }
      if (!clientId || !clientSecret) {
        return jsonResponse({
          success: false,
          error: "Missing Igloohome credentials"
        }, 500);
      }
      const oauth = await getOAuthToken(clientId, clientSecret);
      if (!oauth.token) return jsonResponse({
        success: false,
        error: oauth.reason
      }, 502);
      const jobOutcome = await waitForJobCompletion(oauth.token, jobId, 2, 2000);
      if (jobOutcome.state === "completed" && pending?.pin && pending.startIso && pending.endIso) {
        await activateConfirmedPin(supabase, bookingRow, {
          pin: pending.pin,
          jobId,
          startIso: pending.startIso,
          endIso: pending.endIso,
          durationMinutes: Number(pending.durationMinutes || 20),
          lockId: String(pending.lockId || lockId)
        });
      }
      const after = await fetchBookingStatus(supabase, bookingId);
      return jsonResponse({
        ...after,
        success: jobOutcome.state !== "failed",
        action: "confirm_pin",
        pin: pending?.pin || after.pin?.access_pin || null,
        durationMinutes: Number(pending?.durationMinutes || 20),
        needsConfirm: jobOutcome.state === "pending",
        lockJobState: jobOutcome.state,
        lockJobRaw: jobOutcome.raw,
        lockJobDiagnostics: {
          jobId,
          polls: jobOutcome.polls
        },
        instructions: jobOutcome.state === "completed" ? [
          `PIN ${pending?.pin} is confirmed on the lock.`,
          "Walk to the lock, enter the PIN, and unlock.",
          "Then Sync Lock Activity — or Simulate Unlock / Simulate Lock."
        ] : jobOutcome.state === "pending" ? [
          "Still waiting on the Bridge. Wake the padlock and try Check Bridge Delivery again."
        ] : undefined,
        error: jobOutcome.state === "failed" ? "Bridge job failed. Wake the lock and run Setup again." : undefined
      }, jobOutcome.state === "failed" ? 502 : 200);
    }
    // -------- algopin (bridge-free offline PIN) --------
    if (action === "algopin") {
      const durationMinutes = Math.min(Math.max(Number(body.durationMinutes ?? 20), 5), 180);
      const { data: booking, error } = await supabase.from("bookings").select("*").eq("id", bookingId).single();
      if (error || !booking) {
        return jsonResponse({
          success: false,
          error: "Booking not found"
        }, 404);
      }
      if (!clientId || !clientSecret || !lockId) {
        return jsonResponse({
          success: false,
          error: "Missing IGLOOHOME_CLIENT_ID / SECRET / LOCK_ID"
        }, 500);
      }
      const oauth = await getOAuthToken(clientId, clientSecret, GENERATE_PIN_SCOPES);
      if (!oauth.token) return jsonResponse({
        success: false,
        error: oauth.reason
      }, 502);
      const existingSnap = booking.archive_details?.test_lock_snapshot;
      const snapshot = existingSnap || {
        drop_off_date: booking.drop_off_date,
        drop_off_time_slot: booking.drop_off_time_slot,
        pickup_date: booking.pickup_date,
        pickup_time_slot: booking.pickup_time_slot,
        status: booking.status,
        rented_out_at: booking.rented_out_at,
        returned_at: booking.returned_at,
        rental_started_notified_at: booking.rental_started_notified_at,
        return_notified_at: booking.return_notified_at,
        pin_generated_at: booking.pin_generated_at,
        saved_at: new Date().toISOString()
      };
      const startLocal = new Date(Date.now() - 2 * 60 * 1000);
      const endLocal = new Date(Date.now() + durationMinutes * 60 * 1000);
      const startMst = toMstDateAndSlot(startLocal);
      const endMst = toMstDateAndSlot(endLocal);
      await supabase.from("rental_access_codes").update({
        status: "expired",
        lock_deleted_at: new Date().toISOString()
      }).eq("order_id", bookingId).eq("status", "active");
      const startIso = floorToHourIso();
      const endIso = isoPlusMinutes(durationMinutes);
      const variance = Math.min(24, Math.max(1, Math.ceil(durationMinutes / 60)));
      const algo = await createOneTimeAlgoPin(oauth.token, lockId, startIso, variance, `TEST AlgoPIN - Order #${bookingId}`);
      if (!algo.success) {
        return jsonResponse({
          success: false,
          error: algo.error,
          raw: algo.raw
        }, 502);
      }
      const now = new Date().toISOString();
      await supabase.from("bookings").update({
        drop_off_date: startMst.date,
        drop_off_time_slot: startMst.timeSlot,
        pickup_date: endMst.date,
        pickup_time_slot: endMst.timeSlot,
        status: "Confirmed",
        rented_out_at: null,
        returned_at: null,
        rental_started_notified_at: null,
        return_notified_at: null,
        pin_generated_at: now,
        pin_notification_sent_at: null,
        archive_details: {
          ...booking.archive_details || {},
          test_lock_snapshot: snapshot
        }
      }).eq("id", bookingId);
      await supabase.from("rental_access_codes").insert({
        order_id: bookingId,
        customer_email: booking.email,
        customer_phone: booking.phone || "",
        access_pin: algo.pin,
        pin_id: algo.pinId,
        pin_type: "algopin",
        lock_id: lockId,
        start_time: startIso,
        end_time: endIso,
        status: "active",
        lock_confirmed_at: now,
        confirm_attempts: 0
      });
      await supabase.from("rental_tracking_logs").insert({
        order_id: bookingId,
        event_type: "admin_override",
        event_timestamp: now,
        notes: `TEST algopin: one-time AlgoPIN ${algo.pin} (no bridge), ` + `${durationMinutes}min window from ${startIso}`
      });
      const after = await fetchBookingStatus(supabase, bookingId);
      return jsonResponse({
        ...after,
        success: true,
        action: "algopin",
        pin: algo.pin,
        durationMinutes,
        lockJobState: "completed",
        needsConfirm: false,
        instructions: [
          `One-time AlgoPIN ${algo.pin} works offline — no bridge needed.`,
          "Enter it on the padlock followed by the unlock key to open.",
          "It is single-use: after unlocking, use Simulate Lock (or lock physically + Sync) to finish.",
          "Click Restore Dates when finished."
        ]
      });
    }
    // -------- simulate_unlock --------
    if (action === "simulate_unlock") {
      const status = await fetchBookingStatus(supabase, bookingId);
      if (status.error) return jsonResponse({
        success: false,
        error: status.error
      }, 404);
      const ts = body.eventTimestamp || new Date().toISOString();
      const result = await applyLockEvent(supabase, {
        orderId: bookingId,
        eventType: "unlock",
        eventTimestamp: ts,
        notes: "TEST simulate_unlock"
      });
      const after = await fetchBookingStatus(supabase, bookingId);
      return jsonResponse({
        success: true,
        action: "simulate_unlock",
        result,
        ...after
      });
    }
    // -------- simulate_lock --------
    if (action === "simulate_lock") {
      const status = await fetchBookingStatus(supabase, bookingId);
      if (status.error) return jsonResponse({
        success: false,
        error: status.error
      }, 404);
      const window = getBookingWindow(status.booking);
      // Use max(now, scheduled end) so the return rule always fires
      const nowMs = Date.now();
      const eventMs = Math.max(nowMs, window.endMs);
      const ts = body.eventTimestamp || new Date(eventMs).toISOString();
      const result = await applyLockEvent(supabase, {
        orderId: bookingId,
        eventType: "lock",
        eventTimestamp: ts,
        notes: "TEST simulate_lock (timestamp forced to at/after scheduled end)"
      });
      const swept = await sweepGraceHourReturns(supabase);
      const after = await fetchBookingStatus(supabase, bookingId);
      return jsonResponse({
        success: true,
        action: "simulate_lock",
        result,
        graceHourClosed: swept,
        ...after
      });
    }
    // -------- simulate_webhook --------
    // Runs the same device + booking path as igloohome-webhook in-process.
    // Do NOT HTTP-call the webhook from here: from inside the edge runtime that
    // self-fetch deadlocks until wall-clock kill, and the UI then shows a
    // misleading "Function not found (404)" toast.
    if (action === "simulate_webhook") {
      const status = await fetchBookingStatus(supabase, bookingId);
      if (status.error) {
        return jsonResponse({
          success: false,
          error: status.error
        }, 400);
      }
      const kind = String(body.kind || "unlock");
      const logTypeByKind = {
        unlock: 50,
        lock: 49,
        breakin: 53
      };
      const logType = Number(body.logType) || logTypeByKind[kind];
      if (!logType) {
        return jsonResponse({
          success: false,
          error: `Unknown kind "${kind}" — use unlock, lock or breakin, or pass logType.`
        }, 400);
      }
      // Returns only register at/after the scheduled end, same as simulate_lock.
      const window = getBookingWindow(status.booking);
      const eventMs = kind === "lock" ? Math.max(Date.now(), window.endMs) : Date.now();
      const entryDate = Math.floor(eventMs / 1000);
      const pin = status.pin?.access_pin || null;
      const rawEntry = {
        logType,
        entryDate,
        ...pin && kind !== "breakin" ? {
          pin
        } : {},
        keyId: `test-${bookingId}`,
        operationId: `test-${entryDate}-${kind}`,
        deviceId: lockId || undefined
      };
      const parsed = parseActivityLogEntry(rawEntry);
      if (!parsed) {
        return jsonResponse({
          success: false,
          error: `Could not parse synthetic activity entry for logType ${logType}`,
          rawEntry
        }, 400);
      }
      const events = [
        parsed
      ];
      const deviceTracking = await recordDeviceEvents(supabase, events, {
        deviceId: lockId || null,
        bridgeId: bridgeId || null
      });
      const bookingActions = [];
      for (const recorded of deviceTracking.recorded){
        if (recorded.event.eventType === "breakin") {
          await alertBreakInAttempt({
            deviceId: recorded.deviceId,
            occurredAt: recorded.event.eventTimestamp,
            orderId: recorded.orderId ?? bookingId
          });
          bookingActions.push("alerted_breakin");
        }
        // Prefer the PIN-resolved booking; fall back to the test booking id so
        // Setup-less runs still exercise the state machine against this order.
        const orderId = recorded.orderId ?? bookingId;
        const actionResult = await applyLockEvent(supabase, {
          orderId,
          eventType: recorded.event.eventType,
          eventTimestamp: recorded.event.eventTimestamp,
          notes: `${recorded.event.eventType} via simulate_webhook (logType ${logType})`
        });
        bookingActions.push(actionResult);
      }
      const swept = await sweepGraceHourReturns(supabase);
      const after = await fetchBookingStatus(supabase, bookingId);
      const { data: deviceState } = await supabase.from("lock_device_presence").select("*").eq("device_id", lockId || "").maybeSingle();
      return jsonResponse({
        success: true,
        action: "simulate_webhook",
        kind,
        logType,
        pinUsed: pin ? "active booking PIN" : "none — matched to this booking id as fallback",
        mode: "in_process",
        deviceEventsStored: deviceTracking.stored,
        bookingActions,
        graceHourClosed: swept,
        deviceState,
        hint: !pin ? "No active PIN on this booking. Event still applied to this booking id. Run Setup for real PIN matching." : "Synthetic type-5 path ran in-process (same code as the webhook). Portal deliveries still hit /igloohome-webhook over HTTP.",
        ...after
      });
    }
    // -------- sync / probe (bridge activity logs) --------
    if (action === "sync" || action === "probe") {
      if (!clientId || !clientSecret || !lockId || !bridgeId) {
        return jsonResponse({
          success: false,
          error: "Missing Igloohome env"
        }, 500);
      }
      const oauth = await getActivitySyncToken(clientId, clientSecret);
      if (!oauth.token) {
        return jsonResponse({
          success: false,
          error: oauth.reason || ACTIVITY_SYNC_SCOPE_HINT,
          hint: ACTIVITY_SYNC_SCOPE_HINT
        }, 502);
      }
      const accessToken = oauth.token;
      const createRes = await fetch(`${IGLOOHOME_API_BASE_URL}/devices/${lockId}/jobs/bridges/${bridgeId}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify({
          jobType: 15,
          jobData: {
            lockTime: new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00")
          }
        })
      });
      const createBody = await readResponse(createRes);
      const jobId = createBody.json?.jobId || createBody.json?.id;
      if (!createRes.ok && createRes.status !== 201 || !jobId) {
        const detail = createBody.json?.message || createBody.json?.error || createBody.text || "(empty response)";
        const hint = createRes.status === 401 || createRes.status === 403 ? ` ${ACTIVITY_SYNC_SCOPE_HINT}` : "";
        return jsonResponse({
          success: false,
          error: `Activity log job failed: HTTP ${createRes.status}: ${String(detail).slice(0, 300)}.${hint}`,
          hint: createRes.status === 401 || createRes.status === 403 ? ACTIVITY_SYNC_SCOPE_HINT : undefined,
          raw: createBody.json || createBody.text
        }, 502);
      }
      let jobRaw = null;
      let completed = false;
      for(let i = 0; i < 24; i++){
        await sleep(2500);
        const poll = await fetch(`${IGLOOHOME_API_BASE_URL}/jobs/${jobId}`, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/json"
          }
        });
        const pollBody = await readResponse(poll);
        jobRaw = pollBody.json;
        if (pollBody.json?.completed === true || pollBody.json?.jobResponse?.jobStatus === 0) {
          completed = true;
          break;
        }
        if (pollBody.json?.jobResponse?.jobStatus === 2) break;
      }
      // Bridge job body usually has no log array. Read cloud activity next.
      const activityOauth = await getDeviceActivityToken(clientId, clientSecret);
      let activityRows = [];
      let activityError;
      if (!activityOauth.token) {
        activityError = activityOauth.reason || DEVICE_ACTIVITY_SCOPE_HINT;
      } else {
        const fetched = await fetchDeviceActivityRows(activityOauth.token, lockId, {
          maxPages: 8,
          pageSize: 50
        });
        activityRows = fetched.rows;
        if (fetched.error) activityError = fetched.error;
      }
      const events = mergeActivityEvents(jobRaw, activityRows);
      const emptyBridgePayload = isEmptyActivityLogPayload(jobRaw);
      const failedAttempts = (activityRows || []).map(parseFailedPinAttempt).filter(Boolean);
      if (action === "probe") {
        return jsonResponse({
          success: true,
          probe: true,
          jobId,
          jobResult: jobRaw,
          emptyBridgePayload,
          activityRowsFetched: activityRows.length,
          activityError,
          activitySample: activityRows.slice(0, 3),
          parsedEvents: events
        });
      }
      if (!completed) {
        return jsonResponse({
          success: false,
          error: "Activity log job did not complete — is the lock in bridge range?",
          jobId,
          raw: jobRaw
        }, 504);
      }
      if (activityError && events.length === 0) {
        return jsonResponse({
          success: false,
          error: activityError,
          hint: DEVICE_ACTIVITY_SCOPE_HINT,
          jobId,
          emptyBridgePayload
        }, 502);
      }
      // Match unlocks to this booking's PIN validity windows (not only the
      // compressed test schedule label). Pin-less AUTO_RELOCKs from months ago
      // must not count as "applied".
      const { data: pinRows } = await supabase.from("rental_access_codes").select("access_pin, start_time, end_time, status").eq("order_id", bookingId).in("status", [
        "active",
        "expired",
        "used"
      ]).order("created_at", {
        ascending: false
      }).limit(20);
      const bookingStatus = await fetchBookingStatus(supabase, bookingId);
      if ("error" in bookingStatus && bookingStatus.error && !bookingStatus.booking) {
        return jsonResponse({
          success: false,
          error: bookingStatus.error
        }, 404);
      }
      const window = getBookingWindow(bookingStatus.booking || {});
      const pinSet = new Set((pinRows || []).map((r)=>String(r.access_pin || "")).filter(Boolean));
      const activePinRow = (pinRows || []).find((r)=>r.status === "active") || (pinRows || [])[0];
      const activePin = String(activePinRow?.access_pin || "");
      // Prefer each PIN's own validity; also allow booking window ±1h.
      const pinWindows = (pinRows || []).map((r)=>({
          pin: String(r.access_pin || ""),
          lo: new Date(r.start_time || 0).getTime() - 60 * 60 * 1000,
          hi: new Date(r.end_time || 0).getTime() + 2 * 60 * 60 * 1000
        })).filter((w)=>w.pin && !Number.isNaN(w.lo) && !Number.isNaN(w.hi));
      const windowLo = Math.min(window.startMs - 60 * 60 * 1000, ...pinWindows.map((w)=>w.lo));
      const windowHi = Math.max(window.graceEndMs + 60 * 60 * 1000, ...pinWindows.map((w)=>w.hi));
      function eventMatchesBooking(event) {
        const eventMs = new Date(event.eventTimestamp).getTime();
        if (Number.isNaN(eventMs)) return "outside";
        if (event.pinCode) {
          if (pinSet.size > 0 && !pinSet.has(event.pinCode)) return "pin_mismatch";
          const forPin = pinWindows.filter((w)=>w.pin === event.pinCode);
          if (forPin.length > 0) {
            if (forPin.some((w)=>eventMs >= w.lo && eventMs <= w.hi)) {
              return "ok";
            }
            return "outside";
          }
          if (eventMs >= windowLo && eventMs <= windowHi) return "ok";
          return "outside";
        }
        if (event.eventType === "unlock") return "no_pin";
        // AUTO_RELOCK has no PIN — only after an unlock for this booking
        const alreadyRented = !!bookingStatus.booking?.rented_out_at;
        const unlockInBatch = events.some((e)=>e.eventType === "unlock" && e.pinCode && pinSet.has(e.pinCode) && eventMatchesBooking(e) === "ok" && new Date(e.eventTimestamp).getTime() <= eventMs);
        if (!alreadyRented && !unlockInBatch) return "no_pin";
        if (eventMs < windowLo || eventMs > windowHi) return "outside";
        return "ok";
      }
      const actions = [];
      let skippedOutsideWindow = 0;
      let skippedPinMismatch = 0;
      let skippedNoPin = 0;
      for (const event of events){
        const match = eventMatchesBooking(event);
        if (match === "outside") {
          skippedOutsideWindow += 1;
          continue;
        }
        if (match === "pin_mismatch") {
          skippedPinMismatch += 1;
          continue;
        }
        if (match === "no_pin") {
          skippedNoPin += 1;
          continue;
        }
        const result = await applyLockEvent(supabase, {
          orderId: bookingId,
          eventType: event.eventType,
          eventTimestamp: event.eventTimestamp,
          notes: `TEST sync job ${jobId}`
        });
        actions.push(`${event.eventType}@${event.eventTimestamp}:${result}`);
      }
      // Raw cloud activity in the active PIN window (for diagnostics).
      const activeLo = activePinRow ? new Date(activePinRow.start_time).getTime() - 60 * 60 * 1000 : windowLo;
      const activeHi = activePinRow ? new Date(activePinRow.end_time).getTime() + 2 * 60 * 60 * 1000 : windowHi;
      let bridgeContactAt = null;
      let unlocksForActivePin = 0;
      for (const row of activityRows){
        const rec = row;
        const ts = String(rec.localActionAt || rec.activityTimeAt || "");
        const ms = new Date(ts).getTime();
        if (Number.isNaN(ms) || ms < activeLo || ms > activeHi) continue;
        const type = String(rec.activityType || "");
        if (/SET_TIME|GENERATE_PIN/i.test(type) && (!bridgeContactAt || ts > bridgeContactAt)) {
          bridgeContactAt = ts;
        }
        if (/UNLOCK/i.test(type) && !/FAIL/i.test(type) && String(rec.pin || "") === activePin) {
          unlocksForActivePin += 1;
        }
      }
      const swept = await sweepGraceHourReturns(supabase);
      const after = await fetchBookingStatus(supabase, bookingId);
      const stateChanging = actions.filter((a)=>a.includes(":marked_rented") || a.includes(":marked_returned"));
      const failedInWindow = failedAttempts.filter((f)=>{
        const ms = new Date(f.eventTimestamp).getTime();
        return ms >= activeLo && ms <= activeHi;
      });
      let bridgeHint;
      if (stateChanging.length > 0) {
        bridgeHint = undefined;
      } else if (failedInWindow.length > 0) {
        const last = failedInWindow.sort((a, b)=>a.eventTimestamp < b.eventTimestamp ? 1 : -1)[0];
        const tried = last.pinCode ? `…${last.pinCode.slice(-2)}` : "unknown";
        const expect = activePin ? `…${activePin.slice(-2)}` : "the Setup PIN";
        bridgeHint = `Igloohome recorded PIN_UNLOCK_FAILED at ${last.eventTimestamp} (tried PIN ending ${tried}). ` + `Active booking PIN ends with ${expect}. Use the exact PIN from Setup, unlock near the Bridge, wait ~30–60s, Sync again.`;
      } else if (activePin && unlocksForActivePin === 0) {
        bridgeHint = bridgeContactAt ? `Bridge reached the padlock (${bridgeContactAt}) but Igloohome has no unlock for PIN …${activePin.slice(-2)}. ` + `Stand within a few feet of the Bridge, unlock with ${activePin}, wait for the lock LED to finish, then Sync again. ` + `If it still fails: open the Igloo Home app → this lock → Logs → Sync (phone Bluetooth against the lock), then Sync here. ` + `Or use Simulate Unlock to advance admin without waiting on Igloohome logs.` : `Igloohome has no unlock for PIN …${activePin.slice(-2)} yet. Unlock with that PIN while the padlock is next to the Bridge, wait ~30–60s, Sync again. ` + `Or use Simulate Unlock.`;
      } else if (events.length === 0) {
        bridgeHint = activityRows.length === 0 ? "Bridge pull finished, but Igloohome cloud has no activity rows yet." : `Fetched ${activityRows.length} activity row(s), but none were unlock/lock events.`;
      } else {
        bridgeHint = `No rented/returned update (skipped: ${skippedOutsideWindow} outside PIN window, ${skippedPinMismatch} other PIN, ${skippedNoPin} no PIN).`;
      }
      return jsonResponse({
        success: true,
        action: "sync",
        jobId,
        eventsParsed: events.length,
        eventsRelevant: actions.length,
        stateChanging: stateChanging.length,
        activityRowsFetched: activityRows.length,
        actions,
        skipped: {
          outsideWindow: skippedOutsideWindow,
          pinMismatch: skippedPinMismatch,
          noPin: skippedNoPin
        },
        diagnostics: {
          activePinSuffix: activePin ? activePin.slice(-2) : null,
          unlocksForActivePin,
          bridgeContactAt
        },
        failedUnlockAttemptsInWindow: failedInWindow.map((f)=>({
            eventTimestamp: f.eventTimestamp,
            pinSuffix: f.pinCode ? f.pinCode.slice(-2) : null,
            activityType: f.activityType
          })),
        emptyBridgePayload,
        bridgeHint,
        graceHourClosed: swept,
        ...after
      });
    }
    return jsonResponse({
      success: false,
      error: `Unknown action: ${action}. Use status|setup|restore|simulate_unlock|simulate_lock|sync|probe|remote_lock|remote_unlock`
    }, 400);
  } catch (error) {
    console.error("[test-lock-lifecycle] Unhandled:", error);
    return jsonResponse({
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }, 500);
  }
});


// ============================
// Function: ensure-lock-pin-ready
// ============================

// --- File: ensure-lock-pin-ready/index.ts ---

/**
 * ensure-lock-pin-ready (thin orchestrator)
 *
 * @deprecated Superseded by `reconcile-lock-pins`, which merges this
 * function's confirm/escalate phase with generate-daily-pins' delete/create
 * phases into a single 5-minute cron job (also triggered on demand by
 * igloohome-webhook when the bridge reconnects). Left in place (unscheduled)
 * for manual invocation / rollback until reconcile-lock-pins has been
 * validated in production; see 20260826_consolidate_pin_reconciler_cron.sql.
 *
 * Runs every 5 minutes. Creates PINs by invoking generate-daily-pins (service role),
 * then confirms pending bridge jobs, notifies customers, escalates AlgoPIN via a
 * second generate-daily-pins-friendly path, and posts urgent admin chat on failure.
 *
 * Kept small so it can be deployed reliably via Management API.
 */ import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { bookingNeedsYardLockPin, isDeliveryBooking } from "../_shared/deliveryBooking.ts";
const IGLOO_API = "https://api.igloodeveloper.co/igloohome";
const PIN_LEAD_MS = 12 * 60 * 60 * 1000;
const RETRY_BUDGET_MS = 15 * 60 * 1000;
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const ALERT_ATTEMPTS = 3;
function cors(req) {
  const h = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Content-Type": "application/json"
  };
  const origin = req.headers.get("Origin");
  const allowed = (Deno.env.get("ALLOWED_ORIGINS") || "").split(",").map((s)=>s.trim()).filter(Boolean);
  if (origin && allowed.includes(origin)) {
    h["Access-Control-Allow-Origin"] = origin;
    h["Vary"] = "Origin";
  }
  return h;
}
function json(headers, body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers
  });
}
async function oauth(clientId, clientSecret) {
  const credentials = btoa(`${clientId}:${clientSecret}`);
  const tryScopes = [
    "igloohomeapi/create-pin-bridge-proxied-job igloohomeapi/get-devices igloohomeapi/get-job-status igloohomeapi/algopin-onetime igloohomeapi/store-device-activity",
    ""
  ];
  for (const scope of tryScopes){
    const form = new URLSearchParams({
      grant_type: "client_credentials"
    });
    if (scope) form.set("scope", scope);
    const res = await fetch("https://auth.igloohome.co/oauth2/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json"
      },
      body: form
    });
    const body = await res.json().catch(()=>null);
    if (res.ok && body?.access_token) return body.access_token;
  }
  return null;
}
async function pollJob(token, jobId, budgetMs = 20000) {
  const deadline = Date.now() + budgetMs;
  while(Date.now() < deadline){
    await new Promise((r)=>setTimeout(r, 2500));
    const res = await fetch(`${IGLOO_API}/jobs/${jobId}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json"
      }
    });
    const body = await res.json().catch(()=>null);
    if (body?.completed === true || body?.jobResponse?.jobStatus === 0) return "completed";
    if (body?.jobResponse?.jobStatus === 2) return "failed";
  }
  return "pending";
}
async function createAlgoPin(token, lockId, booking) {
  const drop = String(booking.drop_off_date || "");
  const startDate = `${drop}T12:00:00+00:00`.replace(/T(\d{2}):\d{2}:00/, "T$1:00:00");
  const pickup = String(booking.pickup_date || drop);
  const variance = 1;
  const res = await fetch(`${IGLOO_API}/devices/${lockId}/algopin/onetime`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({
      accessName: `Dump Trailer Rental - Order #${booking.id} (AlgoPIN fallback)`,
      startDate,
      variance
    })
  });
  const body = await res.json().catch(()=>null);
  const pin = String(body?.pin || body?.access_code || body?.code || "");
  if (!res.ok && res.status !== 201 || !pin) {
    return {
      success: false,
      error: `AlgoPIN failed HTTP ${res.status}`
    };
  }
  return {
    success: true,
    pin,
    pinId: String(body?.pinId || body?.id || ""),
    startDate
  };
}
async function notifyPinReady(// deno-lint-ignore no-explicit-any
supabase, booking, pin, startTime, endTime) {
  if (isDeliveryBooking(booking)) return;
  if (booking.pin_notification_sent_at) return;
  await supabase.functions.invoke("send-booking-confirmation", {
    body: {
      booking_id: booking.id,
      email_type: "pin_update",
      pin,
      start_time: startTime,
      end_time: endTime
    }
  });
  try {
    const { data: customer } = await supabase.from("customers").select("phone, sms_opt_in").eq("id", booking.customer_id).maybeSingle();
    const phone = customer?.phone || booking.phone || "";
    if (customer?.sms_opt_in === false || !phone) return;
    const digits = String(phone).replace(/\D/g, "");
    const to = digits.length === 10 ? `+1${digits}` : digits.length === 11 && digits.startsWith("1") ? `+${digits}` : null;
    if (!to) return;
    const site = (Deno.env.get("SITE_URL") || "https://u-filldumpsters.com").replace(/\/$/, "");
    const content = `U-Fill Dumpsters: Your access PIN for Order #${booking.id} is ${pin}. View: ${site}/customer-portal?tab=access-codes`;
    const key = Deno.env.get("BREVO_API_KEY");
    if (!key) return;
    await fetch("https://api.brevo.com/v3/transactionalSMS/sms", {
      method: "POST",
      headers: {
        "api-key": key,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify({
        sender: (Deno.env.get("BREVO_SMS_SENDER") || "UFillDump").slice(0, 11),
        recipient: to,
        content,
        type: "transactional"
      })
    });
  } catch  {
  // non-fatal
  }
}
Deno.serve(async (req)=>{
  const headers = cors(req);
  if (req.method === "OPTIONS") return new Response(null, {
    headers
  });
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const clientId = Deno.env.get("IGLOOHOME_CLIENT_ID") ?? "";
    const clientSecret = Deno.env.get("IGLOOHOME_CLIENT_SECRET") ?? "";
    const lockId = Deno.env.get("IGLOOHOME_LOCK_ID") || Deno.env.get("IGLOOHOME_DEVICE_ID") || "";
    const incoming = req.headers.get("Authorization")?.replace("Bearer ", "").trim();
    if (!incoming || incoming !== serviceRoleKey) {
      return json(headers, {
        success: false,
        error: "Unauthorized"
      }, 401);
    }
    if (!supabaseUrl || !serviceRoleKey || !clientId || !clientSecret || !lockId) {
      return json(headers, {
        success: false,
        error: "Missing env"
      }, 500);
    }
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
    // 1) Coarse create/retry via existing daily generator (service-role auth).
    const genRes = await fetch(`${supabaseUrl}/functions/v1/generate-daily-pins`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json"
      },
      body: "{}"
    });
    const genBody = await genRes.json().catch(()=>({
        ok: false
      }));
    const accessToken = await oauth(clientId, clientSecret);
    if (!accessToken) {
      return json(headers, {
        success: false,
        error: "OAuth failed",
        generateDailyPins: genBody
      }, 502);
    }
    const now = new Date();
    const nowMs = now.getTime();
    const today = now.toISOString().slice(0, 10);
    const horizon = new Date(nowMs + PIN_LEAD_MS).toISOString().slice(0, 10);
    const { data: bookings } = await supabase.from("bookings").select("*").eq("status", "Confirmed").gte("drop_off_date", today).lte("drop_off_date", horizon);
    const results = [];
    for (const booking of bookings || []){
      if (!bookingNeedsYardLockPin(booking)) continue;
      const orderId = Number(booking.id);
      const { data: activePin } = await supabase.from("rental_access_codes").select("*").eq("order_id", orderId).eq("status", "active").order("created_at", {
        ascending: false
      }).limit(1).maybeSingle();
      if (activePin?.lock_confirmed_at && activePin.access_pin) {
        if (!booking.pin_notification_sent_at) {
          await notifyPinReady(supabase, booking, String(activePin.access_pin), String(activePin.start_time || ""), String(activePin.end_time || ""));
        }
        results.push({
          orderId,
          action: "skip_confirmed"
        });
        continue;
      }
      if (activePin?.pin_id && activePin.pin_type === "bridge_proxied") {
        const state = await pollJob(accessToken, activePin.pin_id);
        if (state === "completed") {
          const nowIso = new Date().toISOString();
          await supabase.from("rental_access_codes").update({
            lock_confirmed_at: nowIso
          }).eq("id", activePin.id);
          await notifyPinReady(supabase, booking, String(activePin.access_pin), String(activePin.start_time || ""), String(activePin.end_time || ""));
          results.push({
            orderId,
            action: "confirmed_existing"
          });
          continue;
        }
      }
      const attempts = Number(activePin?.confirm_attempts || 0) + 1;
      const ageMs = activePin?.created_at ? nowMs - new Date(activePin.created_at).getTime() : 0;
      const dropOff = booking.drop_off_date ? new Date(`${booking.drop_off_date}T12:00:00Z`).getTime() : nowMs;
      const msToPickup = dropOff - nowMs;
      const needAlgo = !!activePin && !activePin.lock_confirmed_at && (attempts >= ALERT_ATTEMPTS || ageMs >= RETRY_BUDGET_MS || msToPickup <= TWO_HOURS_MS);
      if (needAlgo) {
        const algo = await createAlgoPin(accessToken, lockId, booking);
        if (algo.success) {
          const nowIso = new Date().toISOString();
          await supabase.from("rental_access_codes").update({
            status: "expired"
          }).eq("order_id", orderId).eq("status", "active");
          const endDate = `${booking.pickup_date || booking.drop_off_date}T23:59:59+00:00`;
          const { error: insertError } = await supabase.from("rental_access_codes").insert({
            order_id: orderId,
            customer_email: booking.email,
            customer_phone: booking.phone || "",
            access_pin: algo.pin,
            pin_id: algo.pinId,
            pin_type: "algopin",
            lock_id: lockId,
            start_time: algo.startDate,
            end_time: endDate,
            status: "active",
            lock_confirmed_at: nowIso,
            confirm_attempts: attempts
          });
          if (!insertError) {
            await supabase.from("bookings").update({
              pin_generated_at: nowIso
            }).eq("id", orderId);
            await notifyPinReady(supabase, booking, algo.pin, algo.startDate, endDate);
            results.push({
              orderId,
              action: "algopin_fallback",
              pin: algo.pin
            });
            continue;
          }
        }
        const failMsg = `URGENT: Access PIN has NOT been generated for Order #${orderId}. ` + `Bridge confirmation failed and AlgoPIN fallback did not succeed. ` + `Pickup: ${booking.drop_off_date} ${booking.drop_off_time_slot || ""}. ` + `Generate a PIN manually before the customer arrives.`;
        if (booking.customer_id) {
          await supabase.from("chat_messages").insert({
            conversation_id: `cust_${booking.customer_id}`,
            customer_id: booking.customer_id,
            booking_id: orderId,
            sender_type: "admin",
            message_content: failMsg,
            is_read: false,
            message_severity: "urgent",
            message_context: {
              action: "pin_failed",
              order_id: orderId,
              source: "ensure-lock-pin-ready"
            }
          });
        }
        await supabase.from("rental_tracking_logs").insert({
          order_id: orderId,
          event_type: "sync_error",
          event_timestamp: new Date().toISOString(),
          notes: failMsg
        });
        results.push({
          orderId,
          action: "failed_alerted"
        });
        continue;
      }
      if (activePin && !activePin.lock_confirmed_at) {
        await supabase.from("rental_access_codes").update({
          confirm_attempts: attempts
        }).eq("id", activePin.id);
        results.push({
          orderId,
          action: "awaiting_confirmation",
          attempts
        });
      } else if (!activePin) {
        results.push({
          orderId,
          action: "awaiting_generate_daily_pins"
        });
      }
    }
    return json(headers, {
      success: true,
      generateDailyPins: genBody,
      processed: results.length,
      results
    });
  } catch (error) {
    return json(headers, {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }, 500);
  }
});


// ============================
// Function: send-early-leave-feedback
// ============================

// --- File: send-early-leave-feedback/cors.ts ---

export { getCorsHeaders } from "../_shared/cors.ts";


// --- File: send-early-leave-feedback/index.ts ---

/**
 * send-early-leave-feedback
 *
 * Called after a customer leaves checkout early. Creates a feedback token,
 * marks the customer as feedback_lead, and emails a sorry-to-see-you-go
 * message with a link to /how-can-we-do-better?token=...
 */ import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getCorsHeaders } from "./cors.ts";
import { sendEmail } from "../_shared/notify.ts";
import { buildUnsubscribeUrl, normalizeSiteUrl } from "../_shared/normalizeSiteUrl.ts";
import { buildEarlyLeaveEmailHtml, EARLY_LEAVE_EMAIL_SUBJECT } from "../_shared/earlyLeaveEmail.ts";
function jsonResponse(corsHeaders, body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
}
Deno.serve(async (req)=>{
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }
  const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
  try {
    const body = await req.json().catch(()=>({}));
    const bookingId = Number(body?.bookingId ?? body?.booking_id);
    if (!Number.isFinite(bookingId) || bookingId <= 0) {
      return jsonResponse(corsHeaders, {
        ok: false,
        error: "bookingId required"
      }, 400);
    }
    const { data: tokenRows, error: tokenError } = await supabase.rpc("create_early_leave_feedback_token", {
      p_booking_id: bookingId
    });
    if (tokenError) {
      console.error("[send-early-leave-feedback] token RPC failed:", tokenError);
      return jsonResponse(corsHeaders, {
        ok: false,
        error: tokenError.message
      }, 400);
    }
    const row = Array.isArray(tokenRows) ? tokenRows[0] : tokenRows;
    if (!row?.token || !row?.email) {
      return jsonResponse(corsHeaders, {
        ok: false,
        error: "Could not create feedback token"
      }, 400);
    }
    // CRM lead for Did Not Finalize — do this even if email fails later
    const { data: abandonedId, error: leadError } = await supabase.rpc("upsert_abandoned_checkout_from_booking", {
      p_booking_id: bookingId,
      p_status: "left_early",
      p_set_reminder_sent: false
    });
    if (leadError) {
      console.error("[send-early-leave-feedback] abandoned_checkouts upsert failed:", leadError);
    }
    const { data: unsubToken, error: unsubError } = await supabase.rpc("create_unsubscribe_token", {
      p_abandoned_checkout_id: abandonedId ?? null,
      p_booking_id: bookingId,
      p_customer_id: row.customer_id ?? null,
      p_email: row.email
    });
    if (unsubError) {
      console.error("[send-early-leave-feedback] unsubscribe token failed:", unsubError);
    }
    const siteUrl = normalizeSiteUrl(body?.siteUrl);
    const feedbackUrl = `${siteUrl}${row.site_path}`;
    const contactUrl = `${siteUrl}/contact`;
    const unsubscribeUrl = buildUnsubscribeUrl(unsubToken, siteUrl) || contactUrl;
    const firstName = String(row.first_name || "there");
    const html = buildEarlyLeaveEmailHtml({
      firstName,
      feedbackUrl,
      contactUrl,
      unsubscribeUrl
    });
    const emailResult = await sendEmail(String(row.email), EARLY_LEAVE_EMAIL_SUBJECT, html);
    if (!emailResult.success) {
      console.error("[send-early-leave-feedback] email failed:", emailResult.error);
      return jsonResponse(corsHeaders, {
        ok: false,
        error: emailResult.error || "Email send failed",
        token: row.token,
        customer_id: row.customer_id
      }, 502);
    }
    await supabase.from("feedback_tokens").update({
      email_sent_at: new Date().toISOString(),
      email_message_id: emailResult.messageId || null
    }).eq("token", row.token);
    console.log(`[send-early-leave-feedback] sent booking=${bookingId} customer=${row.customer_id} messageId=${emailResult.messageId || "unknown"}`);
    return jsonResponse(corsHeaders, {
      ok: true,
      booking_id: bookingId,
      customer_id: row.customer_id,
      messageId: emailResult.messageId || null,
      provider: emailResult.provider
    });
  } catch (err) {
    console.error("[send-early-leave-feedback] CRITICAL:", err);
    return jsonResponse(corsHeaders, {
      ok: false,
      error: err instanceof Error ? err.message : String(err)
    }, 500);
  }
});


// ============================
// Function: send-abandoned-checkout-reminder
// ============================

// --- File: send-abandoned-checkout-reminder/cors.ts ---

export { getCorsHeaders } from "../_shared/cors.ts";


// --- File: send-abandoned-checkout-reminder/index.ts ---

/**
 * send-abandoned-checkout-reminder
 *
 * Finds pending_payment bookings between 1h and 2h old that have not been
 * reminded yet, sends a professional finish-your-order email, stamps
 * addons.abandoned_reminder_sent_at, and upserts abandoned_checkouts.
 */ import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getCorsHeaders } from "./cors.ts";
import { sendEmail } from "../_shared/notify.ts";
import { normalizeSiteUrl } from "../_shared/normalizeSiteUrl.ts";
import { formatCustomerFacingPlanName } from "../_shared/displayPlanName.ts";
import { formatBookingTime, parseBookingTimeToDate } from "../_shared/formatBookingTime.ts";
function jsonResponse(corsHeaders, body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
}
function formatDate(value) {
  if (!value) return "N/A";
  try {
    const d = new Date(`${value}T12:00:00`);
    return d.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric"
    });
  } catch  {
    return String(value);
  }
}
function formatTimeSlot(raw) {
  if (!raw) return "N/A";
  const s = String(raw);
  if (s.includes("|")) {
    const [start, end] = s.split("|").map((t)=>t.trim());
    const a = parseBookingTimeToDate(start);
    const b = parseBookingTimeToDate(end);
    if (a && b) {
      const fmt = (d)=>d.toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
          hour12: true
        });
      return `${fmt(a)} - ${fmt(b)}`;
    }
  }
  return formatBookingTime(s);
}
function money(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return "$0.00";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD"
  }).format(n);
}
function benefitCopy(serviceName, plan, addons) {
  const name = (serviceName || "").toLowerCase();
  const isDelivery = Boolean(addons?.isDelivery || addons?.deliveryService || name.includes("delivery"));
  const planId = Number(plan?.id);
  if (planId === 2 || name.includes("dump trailer") || name.includes("dumpster")) {
    if (isDelivery) {
      return "Your Dump Trailer with Delivery is reserved in our system—convenient drop-off and pickup so you can focus on the job, not the logistics.";
    }
    return "Your dump trailer rental is almost ready. Finish checkout to lock in your dates and get clear pickup instructions.";
  }
  if (planId === 1 || name.includes("compact") || name.includes("equipment")) {
    return "The compact equipment you selected is still available on your hold. Complete payment to secure it for your project timeline.";
  }
  if (name.includes("rock") || name.includes("mulch") || name.includes("gravel") || name.includes("material")) {
    return "Your material delivery selection is saved. Finish checkout so we can schedule delivery for the dates you chose.";
  }
  return "Your rental details are saved and waiting. Completing checkout takes just a minute and keeps your preferred schedule.";
}
function equipmentListHtml(addons) {
  const equipment = Array.isArray(addons?.equipment) ? addons.equipment : [];
  if (equipment.length === 0) return "";
  const items = equipment.map((item)=>{
    const label = String(item.name || item.label || item.id || "Equipment");
    const qty = Number(item.quantity || 1);
    return `<li style="padding:6px 0;border-bottom:1px solid #e5e7eb;">${label} × ${qty}</li>`;
  }).join("");
  return `
    <div style="margin-top:18px;">
      <h3 style="margin:0 0 8px;color:#1e3a8a;font-size:16px;">Selected add-ons</h3>
      <ul style="list-style:none;padding:0;margin:0;">${items}</ul>
    </div>`;
}
function protectionListHtml(addons, plan) {
  const bits = [];
  if (addons?.insurance === "accept") bits.push("Rental Insurance");
  if (Number(plan?.id) === 1 && addons?.drivewayProtection === "accept") bits.push("Driveway Protection");
  if (bits.length === 0) return "";
  return `<p style="margin:12px 0 0;color:#374151;font-size:14px;"><strong>Protection:</strong> ${bits.join(" · ")}</p>`;
}
function buildReminderHtml(booking, siteUrl) {
  const plan = booking.plan || {};
  const addons = booking.addons || {};
  const serviceName = formatCustomerFacingPlanName(plan.name || "Your rental");
  const firstName = String(booking.first_name || "").trim() || String(booking.name || "there").trim().split(/\s+/)[0] || "there";
  const total = money(booking.total_price);
  const dropOff = `${formatDate(String(booking.drop_off_date || ""))} · ${formatTimeSlot(String(booking.drop_off_time_slot || ""))}`;
  const pickUp = `${formatDate(String(booking.pickup_date || ""))} · ${formatTimeSlot(String(booking.pickup_time_slot || ""))}`;
  const ctaUrl = `${siteUrl}/`;
  const benefit = benefitCopy(serviceName, plan, addons);
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /></head>
<body style="margin:0;padding:0;background:#0f172a;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:640px;margin:0 auto;padding:24px 16px;">
    <div style="background:#111827;border:1px solid #334155;border-radius:16px;overflow:hidden;">
      <div style="background:linear-gradient(135deg,#1e3a8a,#0f172a);padding:28px 24px;text-align:center;">
        <p style="margin:0;color:#fbbf24;font-size:12px;letter-spacing:1.5px;text-transform:uppercase;font-weight:700;">U-Fill Dumpsters</p>
        <h1 style="margin:10px 0 0;color:#ffffff;font-size:24px;line-height:1.3;">Your rental is waiting</h1>
      </div>
      <div style="padding:28px 24px;background:#ffffff;color:#111827;">
        <p style="margin:0 0 14px;font-size:16px;">Hi ${firstName},</p>
        <p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:#374151;">
          You started a booking with us and left before payment was completed. We saved your details so you can finish whenever you are ready.
        </p>
        <p style="margin:0 0 18px;font-size:15px;line-height:1.55;color:#374151;">${benefit}</p>

        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:16px 18px;">
          <p style="margin:0 0 8px;color:#1e3a8a;font-weight:700;font-size:15px;">${serviceName}</p>
          <p style="margin:0;color:#475569;font-size:14px;line-height:1.5;"><strong>Start:</strong> ${dropOff}</p>
          <p style="margin:6px 0 0;color:#475569;font-size:14px;line-height:1.5;"><strong>End:</strong> ${pickUp}</p>
          <p style="margin:12px 0 0;color:#0f172a;font-size:18px;font-weight:700;">Total: ${total}</p>
          ${protectionListHtml(addons, plan)}
          ${equipmentListHtml(addons)}
        </div>

        <div style="text-align:center;margin:28px 0 10px;">
          <a href="${ctaUrl}" style="display:inline-block;background:#eab308;color:#111827;text-decoration:none;font-weight:700;padding:14px 28px;border-radius:10px;font-size:15px;">
            Finish your booking
          </a>
        </div>
        <p style="margin:0;font-size:13px;line-height:1.5;color:#64748b;text-align:center;">
          Prefer to start fresh? Visit our site, choose the same service, and we will help you get scheduled.
        </p>
      </div>
      <div style="padding:18px 24px;background:#0f172a;text-align:center;">
        <p style="margin:0;color:#94a3b8;font-size:12px;line-height:1.5;">
          You fill it, we dump it — convenience brought to you.<br/>
          Questions? Reply to this email or visit <a href="${siteUrl}" style="color:#fbbf24;text-decoration:none;">u-filldumpsters.com</a>
        </p>
      </div>
    </div>
  </div>
</body>
</html>`;
}
Deno.serve(async (req)=>{
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }
  const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
  try {
    const siteUrl = normalizeSiteUrl();
    const now = Date.now();
    const oneHourAgo = new Date(now - 60 * 60 * 1000).toISOString();
    const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString();
    const { data: bookings, error } = await supabase.from("bookings").select("id, email, phone, name, first_name, last_name, status, plan, addons, total_price, drop_off_date, pickup_date, drop_off_time_slot, pickup_time_slot, contact_address, delivery_address, created_at").eq("status", "pending_payment").lt("created_at", oneHourAgo).gte("created_at", twoHoursAgo).order("created_at", {
      ascending: true
    }).limit(100);
    if (error) throw error;
    const candidates = (bookings || []).filter((b)=>{
      const addons = b.addons || {};
      return !addons.abandoned_reminder_sent_at;
    });
    let sent = 0;
    let skipped = 0;
    const errors = [];
    for (const booking of candidates){
      const email = String(booking.email || "").trim();
      if (!email) {
        skipped += 1;
        continue;
      }
      // Skip if already filed as intentional leave-early (cancelled + CRM lead)
      const { data: existingLead } = await supabase.from("abandoned_checkouts").select("id, status").eq("booking_id", booking.id).maybeSingle();
      if (existingLead?.status === "left_early") {
        skipped += 1;
        continue;
      }
      const plan = booking.plan || {};
      const serviceName = formatCustomerFacingPlanName(plan.name || "your rental");
      const html = buildReminderHtml(booking, siteUrl);
      const subject = `Still interested? Finish your ${serviceName} booking`;
      const emailResult = await sendEmail(email, subject, html);
      if (!emailResult.success) {
        errors.push({
          bookingId: booking.id,
          error: emailResult.error || "send failed"
        });
        continue;
      }
      const nextAddons = {
        ...booking.addons || {},
        abandoned_reminder_sent_at: new Date().toISOString()
      };
      const { error: stampError } = await supabase.from("bookings").update({
        addons: nextAddons
      }).eq("id", booking.id).eq("status", "pending_payment");
      if (stampError) {
        errors.push({
          bookingId: booking.id,
          error: stampError.message
        });
      }
      const { error: upsertError } = await supabase.rpc("upsert_abandoned_checkout_from_booking", {
        p_booking_id: booking.id,
        p_status: "reminded",
        p_set_reminder_sent: true
      });
      if (upsertError) {
        console.error("[send-abandoned-checkout-reminder] upsert failed:", upsertError);
        errors.push({
          bookingId: booking.id,
          error: upsertError.message
        });
      }
      sent += 1;
    }
    return jsonResponse(corsHeaders, {
      ok: true,
      scanned: bookings?.length || 0,
      candidates: candidates.length,
      sent,
      skipped,
      errors
    });
  } catch (err) {
    console.error("[send-abandoned-checkout-reminder] CRITICAL:", err);
    return jsonResponse(corsHeaders, {
      ok: false,
      error: err instanceof Error ? err.message : String(err)
    }, 500);
  }
});


// ============================
// Function: reconcile-lock-pins
// ============================

// --- File: reconcile-lock-pins/cors.ts ---

export { getCorsHeaders } from '../_shared/cors.ts';


// --- File: reconcile-lock-pins/index.ts ---

/**
 * reconcile-lock-pins
 *
 * Overnight (reason=cron, 12:00–5:00 AM America/Denver): write/delete/confirm
 * PINs on the padlock while equipment is on site. Does not email customers.
 * Create window: drop-off today or tomorrow (Denver calendar).
 *
 * Hourly notify (reason=notify): first PIN email/SMS 12h before drop-off,
 * then a 1h-before reminder. No Igloohome calls.
 *
 * Also invoked by igloohome-webhook on bridge reconnect (lock work only).
 */ import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getCorsHeaders } from "./cors.ts";
import { addCalendarDays, addGraceHour, buildBookingDateUTC, denverCalendarDate, formatAlgoPinStartIso, getPinActivationStart, isBookingEnded, isDropOffTodayOrTomorrow, isDueForFirstPinNotify, isDueForPinReminder } from "../_shared/pinTiming.ts";
import { ensurePinOnLock, pollJob } from "../_shared/lockPin.ts";
import { getOAuthToken, GENERATE_PIN_SCOPES } from "../_shared/iglooAuth.ts";
import { notifyPinReady, notifyPinReminder } from "../_shared/pinNotify.ts";
import { bookingNeedsYardLockPin } from "../_shared/deliveryBooking.ts";
import { BUSINESS_TIME_ZONE } from "../_shared/parseBookingTimeSlot.ts";
const IGLOOHOME_API_BASE_URL = "https://api.igloodeveloper.co/igloohome";
const RETRY_BUDGET_MS = 15 * 60 * 1000;
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const ALERT_ATTEMPTS = 3;
const LOG = "[reconcile-lock-pins]";
const DENVER_CRON_HOURS = {
  start: 0,
  end: 5
};
function denverHour(now = new Date()) {
  const hourPart = new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TIME_ZONE,
    hour: "numeric",
    hourCycle: "h23"
  }).formatToParts(now).find((part)=>part.type === "hour");
  return Number(hourPart?.value ?? "0") % 24;
}
function makeJsonResponse(corsHeaders) {
  return (body, status = 200)=>new Response(JSON.stringify(body), {
      status,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
}
async function readResponse(res) {
  const text = await res.text();
  try {
    return {
      text,
      json: text ? JSON.parse(text) : null
    };
  } catch  {
    return {
      text,
      json: null
    };
  }
}
function sleep(ms) {
  return new Promise((resolve)=>setTimeout(resolve, ms));
}
function isTrailerRental(booking) {
  return bookingNeedsYardLockPin(booking);
}
async function runPinNotifyPass(supabase, focusOrderId) {
  let query = supabase.from("bookings").select("*").eq("status", "Confirmed").not("pin_generated_at", "is", null);
  if (focusOrderId) query = query.eq("id", focusOrderId);
  const { data: bookings, error } = await query;
  if (error) {
    return {
      success: false,
      error: error.message
    };
  }
  const first = [];
  const reminders = [];
  for (const booking of bookings ?? []){
    if (!isTrailerRental(booking)) continue;
    const { data: activePin } = await supabase.from("rental_access_codes").select("access_pin, start_time, end_time, lock_confirmed_at").eq("order_id", booking.id).eq("status", "active").order("created_at", {
      ascending: false
    }).limit(1).maybeSingle();
    if (!activePin?.lock_confirmed_at || !activePin.access_pin) continue;
    const pin = String(activePin.access_pin);
    const startTime = String(activePin.start_time || "");
    const endTime = String(activePin.end_time || "");
    if (isDueForFirstPinNotify(booking) && !booking.pin_notification_sent_at) {
      await notifyPinReady(supabase, booking, pin, startTime, endTime);
      first.push({
        bookingId: booking.id
      });
    }
    if (isDueForPinReminder(booking)) {
      await notifyPinReminder(supabase, booking, pin, startTime, endTime);
      reminders.push({
        bookingId: booking.id
      });
    }
  }
  return {
    success: true,
    first,
    reminders
  };
}
async function isLockOnline(accessToken, lockId) {
  const res = await fetch(`${IGLOOHOME_API_BASE_URL}/devices`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json"
    }
  });
  const body = await readResponse(res);
  if (!res.ok || !body.json?.payload) return false;
  const bridge = body.json.payload.find((d)=>d.type === "Bridge" && d.linkedDevices?.length > 0);
  return !!bridge;
}
async function deletePinFromLock(accessToken, lockId, bridgeId, pin) {
  const res = await fetch(`${IGLOOHOME_API_BASE_URL}/devices/${lockId}/jobs/bridges/${bridgeId}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({
      jobType: 5,
      jobData: {
        pin
      }
    })
  });
  const body = await readResponse(res);
  if (!res.ok && res.status !== 201) {
    return {
      success: false,
      error: `Delete failed with status ${res.status}`
    };
  }
  return {
    success: true
  };
}
async function tryBridgeDurationPin(accessToken, lockId, bridgeId, supabase, booking, opts) {
  const orderId = booking.id;
  const startDate = getPinActivationStart(booking);
  const endDate = addGraceHour(buildBookingDateUTC(String(booking.pickup_date ?? ""), booking.pickup_time_slot, 5));
  return ensurePinOnLock(supabase, accessToken, {
    orderId,
    lockId,
    bridgeId,
    startDate,
    endDate,
    accessName: `Dump Trailer Rental - Order #${orderId}`,
    clearBudgetMs: 40_000,
    createBudgetMs: 50_000,
    skipClear: opts?.skipClear
  });
}
async function createAlgoPin(accessToken, lockId, dropOffDate, dropOffTimeSlot, pickupDate, orderId, labelSuffix = "") {
  const startDateHourOnly = formatAlgoPinStartIso(buildBookingDateUTC(dropOffDate, dropOffTimeSlot, 12));
  const startUnix = new Date(startDateHourOnly).getTime() / 1000;
  const endUnix = new Date(pickupDate + "T23:59:59Z").getTime() / 1000;
  const variance = Math.min(5, Math.max(1, Math.ceil((endUnix - startUnix) / 86400)));
  const payload = {
    accessName: `Dump Trailer Rental - Order #${orderId}${labelSuffix}`,
    startDate: startDateHourOnly,
    variance
  };
  console.log(`${LOG} Creating AlgoPIN for order #${orderId}:`, payload);
  const res = await fetch(`${IGLOOHOME_API_BASE_URL}/devices/${lockId}/algopin/onetime`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify(payload)
  });
  const body = await readResponse(res);
  if (!res.ok && res.status !== 201) {
    const detail = body.json?.message || body.json?.error || body.json?.errorMessage || body.text;
    console.warn(`${LOG} AlgoPIN HTTP ${res.status} for order #${orderId}:`, typeof detail === "string" ? detail.slice(0, 400) : detail);
    return {
      success: false,
      error: `AlgoPIN failed with status ${res.status}${detail ? `: ${String(detail).slice(0, 200)}` : ""}`
    };
  }
  const pin = body.json?.pin || body.json?.access_code || body.json?.code || body.json?.data?.pin || "";
  if (!pin) {
    console.warn(`${LOG} AlgoPIN OK but no pin field for order #${orderId}:`, body.json ?? body.text);
    return {
      success: false,
      error: "AlgoPIN succeeded but no PIN value in response"
    };
  }
  return {
    success: true,
    pin,
    pinId: body.json?.pinId || body.json?.id || "",
    startDate: startDateHourOnly
  };
}
async function generatePinWithFallback(accessToken, lockId, bridgeId, supabase, booking) {
  const orderId = booking.id;
  const startDate = getPinActivationStart(booking);
  const endDate = addGraceHour(buildBookingDateUTC(String(booking.pickup_date ?? ""), booking.pickup_time_slot, 5));
  const accessName = `Dump Trailer Rental - Order #${orderId}`;
  const bridgeResult = await tryBridgeDurationPin(accessToken, lockId, bridgeId, supabase, booking);
  if (bridgeResult.lockConfirmed || bridgeResult.jobId) {
    return {
      success: true,
      pin: bridgeResult.pin,
      pinId: bridgeResult.jobId,
      pinType: "bridge_proxied",
      startDate,
      endDate,
      lockConfirmed: bridgeResult.lockConfirmed
    };
  }
  console.warn(`${LOG} Bridge failed for order #${orderId}, trying AlgoPIN. Error: ${bridgeResult.error}`);
  const algoResult = await createAlgoPin(accessToken, lockId, String(booking.drop_off_date ?? ""), booking.drop_off_time_slot, String(booking.pickup_date ?? ""), orderId);
  if (algoResult.success) {
    return {
      success: true,
      pin: algoResult.pin,
      pinId: algoResult.pinId,
      pinType: "algopin",
      startDate,
      endDate,
      lockConfirmed: true
    };
  }
  return {
    success: false,
    error: `Bridge: ${bridgeResult.error} | AlgoPIN: ${algoResult.error}`,
    startDate,
    endDate
  };
}
Deno.serve(async (req)=>{
  const corsHeaders = getCorsHeaders(req);
  const jsonResponse = makeJsonResponse(corsHeaders);
  if (req.method === "OPTIONS") return new Response(null, {
    headers: corsHeaders
  });
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse({
        success: false,
        error: "Missing required environment variables"
      }, 500);
    }
    const authHeader = req.headers.get("Authorization");
    const incomingKey = authHeader?.replace("Bearer ", "").trim();
    if (!incomingKey || incomingKey !== serviceRoleKey) {
      console.warn(`${LOG} Unauthorized request — invalid or missing service role key`);
      return jsonResponse({
        success: false,
        error: "Unauthorized"
      }, 401);
    }
    let requestBody = {};
    try {
      const text = await req.text();
      if (text) requestBody = JSON.parse(text);
    } catch  {
    // ignore malformed/empty body — full sweep
    }
    const focusOrderId = requestBody.focusOrderId ? Number(requestBody.focusOrderId) : null;
    const reason = typeof requestBody.reason === "string" ? requestBody.reason : "manual";
    const hour = denverHour();
    const isNotify = reason === "notify";
    const isCron = reason === "cron";
    if (isCron && (hour < DENVER_CRON_HOURS.start || hour > DENVER_CRON_HOURS.end)) {
      console.log(`${LOG} Skipping lock cron tick outside Denver 12am–5am (hour=${hour})`);
      return jsonResponse({
        success: true,
        skipped: true,
        skipReason: "outside_denver_window",
        reason,
        denverHour: hour
      });
    }
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
    if (isNotify) {
      console.log(`${LOG} Notify pass (focusOrderId=${focusOrderId ?? "none"})`);
      const notifyResult = await runPinNotifyPass(supabase, focusOrderId);
      if (!notifyResult.success) {
        return jsonResponse({
          success: false,
          error: notifyResult.error
        }, 500);
      }
      return jsonResponse({
        success: true,
        reason,
        notify: {
          first: notifyResult.first,
          reminders: notifyResult.reminders
        }
      });
    }
    const clientId = Deno.env.get("IGLOOHOME_CLIENT_ID");
    const clientSecret = Deno.env.get("IGLOOHOME_CLIENT_SECRET");
    const lockId = Deno.env.get("IGLOOHOME_LOCK_ID") || Deno.env.get("IGLOOHOME_DEVICE_ID");
    const bridgeId = Deno.env.get("IGLOOHOME_BRIDGE_ID");
    if (!clientId || !clientSecret || !lockId || !bridgeId) {
      return jsonResponse({
        success: false,
        error: "Missing required environment variables"
      }, 500);
    }
    console.log(`${LOG} Started lock reconcile (reason=${reason}, focusOrderId=${focusOrderId ?? "none"}, denverHour=${hour})`);
    const oauthResult = await getOAuthToken(clientId, clientSecret, GENERATE_PIN_SCOPES);
    const accessToken = oauthResult.token;
    if (!accessToken) {
      return jsonResponse({
        success: false,
        error: `Failed to get OAuth token: ${oauthResult.reason}`
      }, 500);
    }
    const now = new Date().toISOString();
    const nowMs = Date.now();
    const today = denverCalendarDate();
    const tomorrow = addCalendarDays(today, 1);
    let jobIndex = 0;
    const pace = async ()=>{
      if (jobIndex > 0) {
        console.log(`${LOG} Waiting 15s before next bridge job...`);
        await sleep(15000);
      }
      jobIndex++;
    };
    // ================================================================
    // PHASE 1: DELETE PINs for cancelled / pending_review bookings
    // ================================================================
    console.log(`${LOG} === PHASE 1: DELETIONS ===`);
    let deleteQuery = supabase.from("rental_access_codes").select("id, order_id, access_pin, pin_type, bookings!inner(id, status)").eq("status", "active").in("bookings.status", [
      "Cancelled",
      "pending_review"
    ]);
    if (focusOrderId) deleteQuery = deleteQuery.eq("order_id", focusOrderId);
    const { data: activePinsToDelete } = await deleteQuery;
    let pendingQuery = supabase.from("rental_access_codes").select("id, order_id, access_pin, pin_type, bookings!inner(id, status)").eq("status", "expired").is("lock_deleted_at", null).in("bookings.status", [
      "Cancelled",
      "pending_review"
    ]);
    if (focusOrderId) pendingQuery = pendingQuery.eq("order_id", focusOrderId);
    const { data: pendingLockDeletes } = await pendingQuery;
    const allPinsToProcess = [
      ...activePinsToDelete ?? [],
      ...pendingLockDeletes ?? []
    ].filter((pin, index, self)=>self.findIndex((p)=>p.id === pin.id) === index);
    const deleteResults = [];
    for (const record of allPinsToProcess){
      if (record.pin_type === "algopin") {
        await supabase.from("rental_access_codes").update({
          status: "expired",
          lock_deleted_at: now,
          notified_at: now
        }).eq("id", record.id);
        deleteResults.push({
          bookingId: record.order_id,
          success: true,
          method: "algopin_natural_expiry"
        });
        continue;
      }
      await pace();
      try {
        const result = await deletePinFromLock(accessToken, lockId, bridgeId, record.access_pin);
        if (!result.success) {
          await supabase.from("rental_access_codes").update({
            status: "expired",
            notified_at: now
          }).eq("id", record.id);
          deleteResults.push({
            bookingId: record.order_id,
            success: false,
            error: result.error
          });
          continue;
        }
        await supabase.from("rental_access_codes").update({
          status: "expired",
          lock_deleted_at: now,
          notified_at: now
        }).eq("id", record.id);
        deleteResults.push({
          bookingId: record.order_id,
          success: true,
          method: "bridge_deleted"
        });
      } catch (err) {
        deleteResults.push({
          bookingId: record.order_id,
          success: false,
          error: String(err)
        });
      }
    }
    // ================================================================
    // PHASE 2: CREATE PINs for confirmed bookings without one yet
    // ================================================================
    console.log(`${LOG} === PHASE 2: GENERATION ===`);
    const lockOnline = await isLockOnline(accessToken, lockId);
    if (!lockOnline) console.warn(`${LOG} Lock offline — AlgoPIN fallback will apply.`);
    let bookingsQuery = supabase.from("bookings").select("*").eq("status", "Confirmed").is("pin_generated_at", null).gte("drop_off_date", today).lte("drop_off_date", tomorrow);
    if (focusOrderId) bookingsQuery = bookingsQuery.eq("id", focusOrderId);
    const { data: bookings, error: fetchError } = await bookingsQuery;
    if (fetchError) {
      return jsonResponse({
        success: false,
        error: fetchError.message
      }, 500);
    }
    const trailerBookings = (bookings ?? []).filter(isTrailerRental);
    const eligibleBookings = [];
    const skippedBookings = [];
    for (const booking of trailerBookings){
      if (isBookingEnded(booking)) {
        skippedBookings.push({
          bookingId: booking.id,
          reason: "ended"
        });
        continue;
      }
      if (!isDropOffTodayOrTomorrow(booking)) {
        skippedBookings.push({
          bookingId: booking.id,
          reason: "not_today_or_tomorrow"
        });
        continue;
      }
      eligibleBookings.push(booking);
    }
    const generateResults = [];
    for (const booking of eligibleBookings){
      const { data: existingPin } = await supabase.from("rental_access_codes").select("id, lock_confirmed_at").eq("order_id", booking.id).eq("status", "active").maybeSingle();
      if (existingPin?.lock_confirmed_at) continue;
      await pace();
      try {
        const pinResult = await generatePinWithFallback(accessToken, lockId, bridgeId, supabase, booking);
        if (!pinResult.success) {
          console.warn(`${LOG} Generate failed for order #${booking.id}: ${pinResult.error}`);
          generateResults.push({
            bookingId: booking.id,
            success: false,
            error: pinResult.error
          });
          continue;
        }
        const startTimeUTC = pinResult.startDate;
        const endTimeUTC = pinResult.endDate;
        await supabase.from("rental_access_codes").update({
          status: "expired"
        }).eq("order_id", booking.id).eq("status", "active");
        const { error: insertError } = await supabase.from("rental_access_codes").insert({
          order_id: booking.id,
          customer_email: booking.email,
          customer_phone: booking.phone || "",
          access_pin: pinResult.pin,
          pin_id: pinResult.pinId || "",
          pin_type: pinResult.pinType,
          lock_id: lockId,
          start_time: startTimeUTC,
          end_time: endTimeUTC,
          status: "active",
          lock_deleted_at: null,
          lock_confirmed_at: pinResult.lockConfirmed ? now : null,
          confirm_attempts: pinResult.lockConfirmed ? 0 : 1
        });
        if (insertError) {
          generateResults.push({
            bookingId: booking.id,
            success: false,
            error: insertError.message
          });
          continue;
        }
        await supabase.from("bookings").update({
          pin_generated_at: now
        }).eq("id", booking.id);
        generateResults.push({
          bookingId: booking.id,
          success: true,
          pinType: pinResult.pinType,
          lockConfirmed: !!pinResult.lockConfirmed
        });
      } catch (err) {
        generateResults.push({
          bookingId: booking.id,
          success: false,
          error: String(err)
        });
      }
    }
    // ================================================================
    // PHASE 3: CONFIRM pending bridge jobs / escalate stuck ones
    // ================================================================
    console.log(`${LOG} === PHASE 3: CONFIRM / ESCALATE ===`);
    let unconfirmedQuery = supabase.from("bookings").select("*").eq("status", "Confirmed").gte("drop_off_date", today).lte("drop_off_date", tomorrow).not("pin_generated_at", "is", null);
    if (focusOrderId) unconfirmedQuery = unconfirmedQuery.eq("id", focusOrderId);
    const { data: activeBookings } = await unconfirmedQuery;
    const confirmResults = [];
    for (const booking of activeBookings ?? []){
      if (!isTrailerRental(booking)) continue;
      const orderId = Number(booking.id);
      const { data: activePin } = await supabase.from("rental_access_codes").select("*").eq("order_id", orderId).eq("status", "active").order("created_at", {
        ascending: false
      }).limit(1).maybeSingle();
      if (!activePin) {
        if (isDropOffTodayOrTomorrow(booking) && !isBookingEnded(booking)) {
          await pace();
          const pinResult = await generatePinWithFallback(accessToken, lockId, bridgeId, supabase, booking);
          if (pinResult.success) {
            const startTimeUTC = pinResult.startDate;
            const endTimeUTC = pinResult.endDate;
            const { error: insertError } = await supabase.from("rental_access_codes").insert({
              order_id: orderId,
              customer_email: booking.email,
              customer_phone: booking.phone || "",
              access_pin: pinResult.pin,
              pin_id: pinResult.pinId || "",
              pin_type: pinResult.pinType,
              lock_id: lockId,
              start_time: startTimeUTC,
              end_time: endTimeUTC,
              status: "active",
              lock_deleted_at: null,
              lock_confirmed_at: pinResult.lockConfirmed ? now : null,
              confirm_attempts: pinResult.lockConfirmed ? 0 : 1
            });
            if (!insertError) {
              confirmResults.push({
                orderId,
                action: "regenerated_missing_active",
                pinType: pinResult.pinType
              });
            } else {
              confirmResults.push({
                orderId,
                action: "regenerate_failed",
                error: insertError.message
              });
            }
          } else {
            confirmResults.push({
              orderId,
              action: "regenerate_failed",
              error: pinResult.error
            });
          }
        }
        continue;
      }
      // AlgoPIN is working but bridge may be back — prefer a custom duration PIN.
      if (activePin.pin_type === "algopin" && activePin.lock_confirmed_at && lockOnline && isDropOffTodayOrTomorrow(booking) && !isBookingEnded(booking)) {
        await pace();
        const bridgeUpgrade = await tryBridgeDurationPin(accessToken, lockId, bridgeId, supabase, booking, {
          skipClear: true
        });
        let confirmed = bridgeUpgrade.lockConfirmed;
        if (!confirmed && bridgeUpgrade.jobId) {
          const poll = await pollJob(accessToken, bridgeUpgrade.jobId, 20_000);
          confirmed = poll.state === "completed";
        }
        if (confirmed && bridgeUpgrade.pin) {
          const startTimeUTC = getPinActivationStart(booking);
          const endTimeUTC = addGraceHour(buildBookingDateUTC(String(booking.pickup_date ?? ""), booking.pickup_time_slot, 5));
          const { error: insertError } = await supabase.from("rental_access_codes").insert({
            order_id: orderId,
            customer_email: booking.email,
            customer_phone: booking.phone || "",
            access_pin: bridgeUpgrade.pin,
            pin_id: bridgeUpgrade.jobId || "",
            pin_type: "bridge_proxied",
            lock_id: lockId,
            start_time: startTimeUTC,
            end_time: endTimeUTC,
            status: "active",
            lock_deleted_at: null,
            lock_confirmed_at: now,
            confirm_attempts: 0
          });
          if (!insertError) {
            await supabase.from("rental_access_codes").update({
              status: "expired",
              lock_deleted_at: now,
              notified_at: now
            }).eq("id", activePin.id);
            console.log(`${LOG} Upgraded order #${orderId} from AlgoPIN to bridge duration PIN`);
            confirmResults.push({
              orderId,
              action: "upgraded_algopin_to_bridge"
            });
            continue;
          }
          confirmResults.push({
            orderId,
            action: "upgrade_insert_failed",
            error: insertError.message
          });
        } else if (bridgeUpgrade.jobId && !confirmed) {
          confirmResults.push({
            orderId,
            action: "bridge_upgrade_pending",
            error: bridgeUpgrade.error
          });
        } else if (!bridgeUpgrade.jobId) {
          confirmResults.push({
            orderId,
            action: "bridge_upgrade_failed",
            error: bridgeUpgrade.error
          });
        }
        continue;
      }
      if (activePin.lock_confirmed_at) {
        confirmResults.push({
          orderId,
          action: "already_confirmed"
        });
        continue;
      }
      if (activePin.pin_id && activePin.pin_type === "bridge_proxied") {
        const poll = await pollJob(accessToken, activePin.pin_id, 20_000);
        if (poll.state === "completed") {
          const nowIso = new Date().toISOString();
          await supabase.from("rental_access_codes").update({
            lock_confirmed_at: nowIso
          }).eq("id", activePin.id);
          confirmResults.push({
            orderId,
            action: "confirmed_existing"
          });
          continue;
        }
      }
      const attempts = Number(activePin.confirm_attempts || 0) + 1;
      const ageMs = activePin.created_at ? nowMs - new Date(activePin.created_at).getTime() : 0;
      const dropOff = booking.drop_off_date ? new Date(`${booking.drop_off_date}T12:00:00Z`).getTime() : nowMs;
      const msToPickup = dropOff - nowMs;
      const needAlgo = attempts >= ALERT_ATTEMPTS || ageMs >= RETRY_BUDGET_MS || msToPickup <= TWO_HOURS_MS;
      if (needAlgo) {
        const algo = await createAlgoPin(accessToken, lockId, String(booking.drop_off_date ?? ""), booking.drop_off_time_slot, String(booking.pickup_date ?? booking.drop_off_date ?? ""), orderId, " (AlgoPIN fallback)");
        if (algo.success) {
          const nowIso = new Date().toISOString();
          await supabase.from("rental_access_codes").update({
            status: "expired"
          }).eq("order_id", orderId).eq("status", "active");
          const endDate = `${booking.pickup_date || booking.drop_off_date}T23:59:59+00:00`;
          const { error: insertError } = await supabase.from("rental_access_codes").insert({
            order_id: orderId,
            customer_email: booking.email,
            customer_phone: booking.phone || "",
            access_pin: algo.pin,
            pin_id: algo.pinId,
            pin_type: "algopin",
            lock_id: lockId,
            start_time: algo.startDate,
            end_time: endDate,
            status: "active",
            lock_confirmed_at: nowIso,
            confirm_attempts: attempts
          });
          if (!insertError) {
            confirmResults.push({
              orderId,
              action: "algopin_fallback",
              pin: algo.pin
            });
            continue;
          }
        }
        const failMsg = `URGENT: Access PIN has NOT been generated for Order #${orderId}. ` + `Bridge confirmation failed and AlgoPIN fallback did not succeed. ` + `Pickup: ${booking.drop_off_date} ${booking.drop_off_time_slot || ""}. ` + `Generate a PIN manually before the customer arrives.`;
        if (booking.customer_id) {
          await supabase.from("chat_messages").insert({
            conversation_id: `cust_${booking.customer_id}`,
            customer_id: booking.customer_id,
            booking_id: orderId,
            sender_type: "admin",
            message_content: failMsg,
            is_read: false,
            message_severity: "urgent",
            message_context: {
              action: "pin_failed",
              order_id: orderId,
              source: "reconcile-lock-pins"
            }
          });
        }
        await supabase.from("rental_tracking_logs").insert({
          order_id: orderId,
          event_type: "sync_error",
          event_timestamp: new Date().toISOString(),
          notes: failMsg
        });
        confirmResults.push({
          orderId,
          action: "failed_alerted"
        });
        continue;
      }
      await supabase.from("rental_access_codes").update({
        confirm_attempts: attempts
      }).eq("id", activePin.id);
      confirmResults.push({
        orderId,
        action: "awaiting_confirmation",
        attempts
      });
    }
    const deletedCount = deleteResults.filter((r)=>r.success).length;
    const generatedCount = generateResults.filter((r)=>r.success).length;
    console.log(`${LOG} Done. Deleted: ${deletedCount}/${allPinsToProcess.length} | Generated: ${generatedCount}/${eligibleBookings.length} | Confirm phase: ${confirmResults.length}`);
    return jsonResponse({
      success: true,
      reason,
      denverHour: hour,
      focusOrderId,
      lockOnline,
      deleted: {
        processed: allPinsToProcess.length,
        succeeded: deletedCount,
        results: deleteResults
      },
      generated: {
        processed: eligibleBookings.length,
        succeeded: generatedCount,
        skipped: skippedBookings,
        results: generateResults
      },
      confirmed: {
        processed: confirmResults.length,
        results: confirmResults
      }
    });
  } catch (error) {
    console.error(`${LOG} Unhandled exception:`, error);
    return jsonResponse({
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }, 500);
  }
});


// ============================
// Function: end-unfinished-checkout
// ============================

// --- File: end-unfinished-checkout/index.ts ---

/**
 * end-unfinished-checkout
 *
 * Teardown unpaid / unfinished checkout:
 * - restock equipment + free reserved dates (via finalize_unfinished_checkout)
 * - promote pending_customers → booking_not_finished when needed
 * - upsert Did Not Finalize CRM (left_early | reminded | expired)
 * - send sorry-to-see-you-go survey email with unsubscribe link
 *
 * verify_jwt = false so pagehide keepalive beacons can reach it with the anon key.
 */ import { getCorsHeaders } from "../_shared/cors.ts";
function jsonResponse(corsHeaders, body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
}
const ALLOWED_REASONS = new Set([
  "left_early",
  "reminded",
  "expired"
]);
async function ensureBookingCustomer(supabase, bookingId) {
  const { data: booking, error } = await supabase.from("bookings").select("id, email, first_name, last_name, name, phone, street, city, state, zip, customer_id").eq("id", bookingId).maybeSingle();
  if (error || !booking) {
    console.error("[end-unfinished-checkout] ensureBookingCustomer load failed:", error);
    return null;
  }
  const email = String(booking.email || "").trim().toLowerCase();
  if (!email) return null;
  // truncated intentionally for size - USE FULL FROM DISK
  return null;
}
Deno.serve(async (req)=>{
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }
  return jsonResponse(corsHeaders, {
    ok: false,
    error: "INCOMPLETE_DEPLOY_DO_NOT_USE"
  }, 500);
});


// ============================
// Function: sweep-unfinished-checkouts
// ============================

// --- File: sweep-unfinished-checkouts/index.ts ---

/**
 * sweep-unfinished-checkouts
 *
 * pg_cron backstop (every minute): find stale unpaid checkouts / pending
 * drafts with no recent heartbeat and run the same teardown + survey email
 * path as end-unfinished-checkout (reason = expired).
 */ import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getCorsHeaders } from "../_shared/cors.ts";
import { sendEmail } from "../_shared/notify.ts";
import { buildUnsubscribeUrl, normalizeSiteUrl } from "../_shared/normalizeSiteUrl.ts";
import { buildEarlyLeaveEmailHtml, EARLY_LEAVE_EMAIL_SUBJECT } from "../_shared/earlyLeaveEmail.ts";
function jsonResponse(corsHeaders, body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
}
async function teardownAndEmail(supabase, bookingId, siteUrl) {
  const { data: finalizeResult, error: finalizeError } = await supabase.rpc("finalize_unfinished_checkout", {
    p_booking_id: bookingId,
    p_reason: "expired"
  });
  if (finalizeError) {
    return {
      booking_id: bookingId,
      ok: false,
      email_sent: false,
      error: finalizeError.message
    };
  }
  if (finalizeResult?.ok === false && finalizeResult?.error === "not_pending_payment") {
    return {
      booking_id: bookingId,
      ok: true,
      email_sent: false,
      error: "skipped"
    };
  }
  if (finalizeResult?.ok === false) {
    return {
      booking_id: bookingId,
      ok: false,
      email_sent: false,
      error: String(finalizeResult?.error || "finalize failed")
    };
  }
  if (finalizeResult?.skip_email || finalizeResult?.skipped || finalizeResult?.skipped_reason === "already_converted") {
    return {
      booking_id: bookingId,
      ok: true,
      email_sent: false,
      error: "already_converted"
    };
  }
  // Prefer unsent token retry; skip only when already emailed
  const { data: existingTokens } = await supabase.from("feedback_tokens").select("id, token, customer_id, email_sent_at").eq("booking_id", bookingId).order("created_at", {
    ascending: false
  }).limit(5);
  const tokens = Array.isArray(existingTokens) ? existingTokens : [];
  if (tokens.some((t)=>t.email_sent_at)) {
    return {
      booking_id: bookingId,
      ok: true,
      email_sent: false,
      error: "email_already_sent"
    };
  }
  let row = null;
  const unsent = tokens.find((t)=>t?.token && !t.email_sent_at);
  if (unsent?.token) {
    const { data: booking } = await supabase.from("bookings").select("email, first_name, name, customer_id").eq("id", bookingId).maybeSingle();
    const email = String(booking?.email || "").trim();
    if (!email) {
      return {
        booking_id: bookingId,
        ok: true,
        email_sent: false,
        error: "no_email"
      };
    }
    row = {
      token: String(unsent.token),
      customer_id: unsent.customer_id != null ? Number(unsent.customer_id) : booking?.customer_id != null ? Number(booking.customer_id) : null,
      email,
      first_name: String(booking?.first_name || String(booking?.name || "there").split(" ")[0] || "there"),
      site_path: `/how-can-we-do-better?token=${unsent.token}`
    };
  } else {
    const { data: tokenRows, error: tokenError } = await supabase.rpc("create_early_leave_feedback_token", {
      p_booking_id: bookingId
    });
    if (tokenError) {
      return {
        booking_id: bookingId,
        ok: true,
        email_sent: false,
        error: tokenError.message
      };
    }
    const created = Array.isArray(tokenRows) ? tokenRows[0] : tokenRows;
    if (!created?.token || !created?.email) {
      return {
        booking_id: bookingId,
        ok: true,
        email_sent: false,
        error: "no_token"
      };
    }
    row = {
      token: String(created.token),
      customer_id: created.customer_id != null ? Number(created.customer_id) : null,
      email: String(created.email),
      first_name: String(created.first_name || "there"),
      site_path: String(created.site_path || `/how-can-we-do-better?token=${created.token}`)
    };
  }
  const abandonedCheckoutId = finalizeResult?.abandoned_checkout_id ?? null;
  const { data: unsubToken } = await supabase.rpc("create_unsubscribe_token", {
    p_abandoned_checkout_id: abandonedCheckoutId,
    p_booking_id: bookingId,
    p_customer_id: row.customer_id ?? null,
    p_email: row.email
  });
  const feedbackUrl = `${siteUrl}${row.site_path}`;
  const contactUrl = `${siteUrl}/contact`;
  const unsubscribeUrl = buildUnsubscribeUrl(unsubToken, siteUrl) || contactUrl;
  const html = buildEarlyLeaveEmailHtml({
    firstName: String(row.first_name || "there"),
    feedbackUrl,
    contactUrl,
    unsubscribeUrl
  });
  const emailResult = await sendEmail(String(row.email), EARLY_LEAVE_EMAIL_SUBJECT, html);
  if (emailResult.success) {
    await supabase.from("feedback_tokens").update({
      email_sent_at: new Date().toISOString(),
      email_message_id: emailResult.messageId || null
    }).eq("token", row.token);
  }
  return {
    booking_id: bookingId,
    ok: true,
    email_sent: Boolean(emailResult.success),
    error: emailResult.success ? undefined : emailResult.error
  };
}
Deno.serve(async (req)=>{
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }
  const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
  try {
    const siteUrl = normalizeSiteUrl(null);
    const { data: candidates, error } = await supabase.rpc("find_stale_unfinished_checkouts", {
      p_stale_after: "31 minutes"
    });
    if (error) {
      console.error("[sweep-unfinished-checkouts] find failed:", error);
      return jsonResponse(corsHeaders, {
        ok: false,
        error: error.message
      }, 500);
    }
    const rows = Array.isArray(candidates) ? candidates : [];
    const results = [];
    for (const row of rows.slice(0, 50)){
      let bookingId = Number(row.booking_id);
      const pendingId = row.pending_id;
      if (pendingId) {
        const { data: completion } = await supabase.rpc("get_checkout_completion_status", {
          p_pending_id: pendingId
        });
        if (completion?.completed) {
          results.push({
            pending_id: pendingId,
            ok: true,
            skipped: true,
            skipped_reason: "already_converted",
            booking_id: completion.booking_id ?? null
          });
          continue;
        }
      }
      if ((!Number.isFinite(bookingId) || bookingId <= 0) && pendingId) {
        const { data: promoted, error: promoteError } = await supabase.rpc("create_unfinished_booking_from_pending", {
          p_pending_id: pendingId
        });
        if (promoteError) {
          results.push({
            pending_id: pendingId,
            ok: false,
            error: promoteError.message
          });
          continue;
        }
        if (promoted?.skipped || promoted?.reason === "already_converted") {
          results.push({
            pending_id: pendingId,
            ok: true,
            skipped: true,
            skipped_reason: "already_converted",
            booking_id: promoted?.converted_booking_id || promoted?.booking_id || null
          });
          continue;
        }
        bookingId = Number(promoted?.booking_id);
      }
      if (!Number.isFinite(bookingId) || bookingId <= 0) {
        results.push({
          ok: false,
          error: "missing_booking_id",
          row
        });
        continue;
      }
      const outcome = await teardownAndEmail(supabase, bookingId, siteUrl);
      results.push(outcome);
    }
    console.log(`[sweep-unfinished-checkouts] processed=${results.length}`);
    return jsonResponse(corsHeaders, {
      ok: true,
      processed: results.length,
      results
    });
  } catch (err) {
    console.error("[sweep-unfinished-checkouts] CRITICAL:", err);
    return jsonResponse(corsHeaders, {
      ok: false,
      error: err instanceof Error ? err.message : String(err)
    }, 500);
  }
});


// ============================
// Function: unsubscribe
// ============================

// --- File: unsubscribe/index.ts ---

/**
 * unsubscribe
 *
 * Public page: validates unsubscribe token and purges unfinished-checkout
 * admin data while preserving paid customer history.
 */ import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getCorsHeaders } from "../_shared/cors.ts";
import { normalizeSiteUrl } from "../_shared/normalizeSiteUrl.ts";
function htmlPage(title, body) {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    body { margin:0; font-family: Arial, Helvetica, sans-serif; background:#0f172a; color:#e2e8f0; }
    .wrap { max-width:520px; margin:64px auto; padding:24px; }
    .card { background:#111827; border:1px solid #334155; border-radius:16px; padding:28px 24px; }
    h1 { margin:0 0 12px; font-size:22px; color:#fbbf24; }
    p { margin:0 0 12px; line-height:1.55; color:#cbd5e1; font-size:15px; }
    a { color:#fbbf24; }
  </style>
</head>
<body>
  <div class="wrap"><div class="card">${body}</div></div>
</body>
</html>`;
  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8"
    }
  });
}
Deno.serve(async (req)=>{
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }
  const siteUrl = normalizeSiteUrl(null);
  const contactUrl = `${siteUrl}/contact`;
  const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
  try {
    const url = new URL(req.url);
    let token = url.searchParams.get("token") || "";
    if (!token && req.method === "POST") {
      const body = await req.json().catch(()=>({}));
      token = String(body?.token || "");
    }
    if (!token) {
      return htmlPage("Unsubscribe", `<h1>Missing link</h1><p>This unsubscribe link is incomplete. If you need help, visit our <a href="${contactUrl}">Contact page</a>.</p>`);
    }
    const { data, error } = await supabase.rpc("process_unsubscribe", {
      p_token: token
    });
    if (error) {
      console.error("[unsubscribe] RPC failed:", error);
      return htmlPage("Unsubscribe", `<h1>Something went wrong</h1><p>We could not process your request right now. Please try again later or <a href="${contactUrl}">contact us</a>.</p>`);
    }
    if (data?.ok === false) {
      const msg = data.error === "expired_token" ? "This unsubscribe link has expired." : "This unsubscribe link is invalid.";
      return htmlPage("Unsubscribe", `<h1>Unable to unsubscribe</h1><p>${msg}</p>`);
    }
    return htmlPage("Unsubscribed", `<h1>You are unsubscribed</h1>
       <p>You will no longer receive future correspondence from us about unfinished bookings.</p>
       <p>If this was a mistake, please <a href="${contactUrl}">contact us</a> and we will help.</p>`);
  } catch (err) {
    console.error("[unsubscribe] CRITICAL:", err);
    return htmlPage("Unsubscribe", `<h1>Something went wrong</h1><p>Please try again later or <a href="${contactUrl}">contact us</a>.</p>`);
  }
});


// ============================
// Function: notify-feedback-chat-reply
// ============================

// --- File: notify-feedback-chat-reply/cors.ts ---

export { getCorsHeaders } from "../_shared/cors.ts";


// --- File: notify-feedback-chat-reply/index.ts ---

/**
 * notify-feedback-chat-reply
 *
 * Invoked by DB trigger when an admin posts to chat for a customer with an
 * active How-can-we-do-better public reply token. Emails the lead a short
 * "we replied" notice with the same survey token link.
 *
 * verify_jwt = false — authorized via service_role bearer from vault/pg_net.
 */ import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getCorsHeaders } from "./cors.ts";
import { sendEmail } from "../_shared/notify.ts";
import { normalizeSiteUrl } from "../_shared/normalizeSiteUrl.ts";
function jsonResponse(corsHeaders, body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
}
function buildReplyEmailHtml(opts) {
  const { firstName, chatUrl, contactUrl } = opts;
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /></head>
<body style="margin:0;padding:0;background:#0f172a;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:640px;margin:0 auto;padding:24px 16px;">
    <div style="background:#111827;border:1px solid #334155;border-radius:16px;overflow:hidden;">
      <div style="background:linear-gradient(135deg,#1e3a8a,#0f172a);padding:28px 24px;text-align:center;">
        <p style="margin:0;color:#fbbf24;font-size:12px;letter-spacing:1.5px;text-transform:uppercase;font-weight:700;">U-Fill Dumpsters</p>
        <h1 style="margin:10px 0 0;color:#ffffff;font-size:22px;line-height:1.3;">We replied to your feedback</h1>
      </div>
      <div style="padding:28px 24px;background:#ffffff;color:#111827;">
        <p style="margin:0 0 14px;font-size:16px;">Hi ${firstName},</p>
        <p style="margin:0 0 18px;font-size:15px;line-height:1.55;color:#374151;">
          Our team sent a reply to the feedback conversation you started. Open the link below to read it and continue the conversation — no account or customer number needed.
        </p>
        <div style="text-align:center;margin:28px 0 10px;">
          <a href="${chatUrl}" style="display:inline-block;background:#eab308;color:#111827;text-decoration:none;font-weight:700;padding:14px 28px;border-radius:10px;font-size:15px;">
            View reply
          </a>
        </div>
        <p style="margin:18px 0 0;font-size:14px;line-height:1.55;color:#475569;text-align:center;">
          Prefer a phone call?
          <a href="${contactUrl}" style="color:#1e3a8a;font-weight:700;text-decoration:none;">Contact us</a>
        </p>
      </div>
    </div>
  </div>
</body>
</html>`;
}
Deno.serve(async (req)=>{
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }
  const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
  try {
    const body = await req.json().catch(()=>({}));
    const tokenId = Number(body?.token_id ?? body?.tokenId ?? 0);
    if (!Number.isFinite(tokenId) || tokenId <= 0) {
      return jsonResponse(corsHeaders, {
        ok: false,
        error: "token_id required"
      }, 400);
    }
    const { data: tokenRow, error: tokenError } = await supabase.from("feedback_tokens").select("id, token, customer_id, chat_expires_at, chat_closed_at, used_at").eq("id", tokenId).maybeSingle();
    if (tokenError || !tokenRow?.token) {
      console.error("[notify-feedback-chat-reply] token load failed:", tokenError);
      return jsonResponse(corsHeaders, {
        ok: false,
        error: "token not found"
      }, 404);
    }
    if (!tokenRow.used_at || tokenRow.chat_closed_at) {
      return jsonResponse(corsHeaders, {
        ok: true,
        skipped: true,
        reason: "chat_inactive"
      });
    }
    if (tokenRow.chat_expires_at && new Date(tokenRow.chat_expires_at).getTime() < Date.now()) {
      return jsonResponse(corsHeaders, {
        ok: true,
        skipped: true,
        reason: "chat_expired"
      });
    }
    const { data: customer, error: customerError } = await supabase.from("customers").select("id, email, first_name, name").eq("id", tokenRow.customer_id).maybeSingle();
    if (customerError || !customer?.email) {
      console.error("[notify-feedback-chat-reply] customer load failed:", customerError);
      return jsonResponse(corsHeaders, {
        ok: false,
        error: "customer email missing"
      }, 400);
    }
    const siteUrl = normalizeSiteUrl(Deno.env.get("SITE_URL"));
    const chatUrl = `${siteUrl}/how-can-we-do-better?token=${encodeURIComponent(tokenRow.token)}`;
    const contactUrl = `${siteUrl}/contact`;
    const firstName = String(customer.first_name || String(customer.name || "there").split(" ")[0] || "there");
    const html = buildReplyEmailHtml({
      firstName,
      chatUrl,
      contactUrl
    });
    const emailResult = await sendEmail(String(customer.email), "We replied to your feedback — U-Fill Dumpsters", html);
    if (!emailResult.success) {
      console.error("[notify-feedback-chat-reply] email failed:", emailResult.error);
      return jsonResponse(corsHeaders, {
        ok: false,
        error: emailResult.error || "email failed"
      }, 500);
    }
    console.log(`[notify-feedback-chat-reply] sent token=${tokenId} customer=${customer.id} messageId=${emailResult.messageId || "unknown"}`);
    return jsonResponse(corsHeaders, {
      ok: true,
      email_sent: true,
      messageId: emailResult.messageId || null
    });
  } catch (err) {
    console.error("[notify-feedback-chat-reply] CRITICAL:", err);
    return jsonResponse(corsHeaders, {
      ok: false,
      error: err instanceof Error ? err.message : String(err)
    }, 500);
  }
});

