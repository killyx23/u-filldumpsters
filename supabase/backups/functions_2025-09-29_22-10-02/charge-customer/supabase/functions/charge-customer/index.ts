import { corsHeaders } from "./cors.ts";
import { Stripe } from "npm:stripe@15.8.0";
import { createClient } from 'npm:@supabase/supabase-js@2';
const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY"), {
  apiVersion: "2024-06-20"
});
const supabase = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
const handleCharge = async ({ customerId, amount, description, bookingId, feeType })=>{
  const { data: customer } = await supabase.from('customers').select('stripe_customer_id, email, name').eq('id', customerId).single();
  if (!customer) throw new Error(`Customer with ID ${customerId} not found.`);
  let stripeCustomerId = customer.stripe_customer_id;
  if (!stripeCustomerId) {
    const existingStripeCustomers = await stripe.customers.list({
      email: customer.email,
      limit: 1
    });
    if (existingStripeCustomers.data.length > 0) {
      stripeCustomerId = existingStripeCustomers.data[0].id;
    } else {
      const newStripeCustomer = await stripe.customers.create({
        email: customer.email,
        name: customer.name
      });
      stripeCustomerId = newStripeCustomer.id;
    }
    await supabase.from('customers').update({
      stripe_customer_id: stripeCustomerId
    }).eq('id', customerId);
  }
  const invoiceItem = await stripe.invoiceItems.create({
    customer: stripeCustomerId,
    amount: Math.round(amount * 100),
    currency: "usd",
    description
  });
  const invoice = await stripe.invoices.create({
    customer: stripeCustomerId,
    collection_method: 'charge_automatically',
    auto_advance: true,
    description: `Additional charges for booking #${bookingId}`,
    metadata: {
      booking_id: bookingId,
      database_customer_id: customerId
    }
  });
  const finalizedInvoice = await stripe.invoices.finalizeInvoice(invoice.id);
  const paidInvoice = await stripe.invoices.pay(finalizedInvoice.id, {
    paid_out_of_band: true
  });
  if (paidInvoice.status === 'paid') {
    const { data: bookingData } = await supabase.from('bookings').select('fees').eq('id', bookingId).single();
    const existingFees = bookingData.fees || {};
    const newFees = {
      ...existingFees,
      [feeType]: {
        amount,
        description,
        charge_id: paidInvoice.charge,
        created_at: new Date().toISOString()
      }
    };
    await supabase.from('bookings').update({
      fees: newFees
    }).eq('id', bookingId);
    return {
      success: true,
      message: "Customer charged successfully.",
      invoiceId: paidInvoice.id
    };
  } else {
    throw new Error(`Failed to charge customer. Invoice status: ${paidInvoice.status}`);
  }
};
const handleRefund = async ({ bookingId, amount, reason, paymentIntentId })=>{
  const refundAmount = Math.round(amount * 100);
  const refund = await stripe.refunds.create({
    payment_intent: paymentIntentId,
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
  await supabase.from('bookings').update({
    status: 'Cancelled',
    refund_details: refundDetails
  }).eq('id', bookingId);
  return {
    success: true,
    message: `Refund of $${amount.toFixed(2)} processed successfully.`,
    refund
  };
};
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }
  try {
    const body = await req.json();
    let response;
    if (body.action === 'refund') {
      const { bookingId, amount, reason, paymentIntentId } = body;
      if (!bookingId || amount === undefined || !reason || !paymentIntentId) {
        throw new Error("Missing parameters for refund action.");
      }
      response = await handleRefund({
        bookingId,
        amount,
        reason,
        paymentIntentId
      });
    } else {
      const { customerId, amount, description, bookingId, feeType } = body;
      if (!customerId || !amount || !description || !bookingId || !feeType) {
        throw new Error("Missing required parameters for charge action.");
      }
      response = await handleCharge({
        customerId,
        amount,
        description,
        bookingId,
        feeType
      });
    }
    return new Response(JSON.stringify(response), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      },
      status: 200
    });
  } catch (error) {
    console.error("Charge/Refund customer error:", error);
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
