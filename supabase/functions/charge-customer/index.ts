import { getCorsHeaders } from "./cors.ts";
// charge-customer Edge Function
// Charges the customer's default card off-session and stores the Stripe charge id.
// A fee row is not saved unless Stripe returns a ch_ id.
import { Stripe } from "npm:stripe@15.8.0";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  attachPaymentMethodOnce,
  chargePaymentMethodOffSession,
  lookupSavedCardId,
  resolveInvoiceChargeId,
  resolvePaymentIntentChargeId,
} from "../_shared/cardCharge.ts";
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const stripe = new Stripe(STRIPE_SECRET_KEY ?? "", {
  apiVersion: "2024-06-20"
});
const supabase = createClient(SUPABASE_URL ?? "", SUPABASE_SERVICE_ROLE_KEY ?? "");
async function saveFeeCharge(bookingId, existingFees, feeType, fee) {
  const { error: updErr } = await supabase.from("bookings").update({
    fees: {
      ...existingFees,
      [feeType]: fee
    }
  }).eq("id", bookingId);
  if (updErr) throw new Error(`DB error updating booking fees: ${updErr.message}`);
}

async function reusablePaymentMethodId(bookingId, bookingPaymentIntent, stripeCustomerId) {
  const { data: paymentInfo } = await supabase
    .from("stripe_payment_info")
    .select("stripe_payment_method_id, stripe_payment_intent_id")
    .eq("booking_id", bookingId)
    .maybeSingle();
  const savedId = paymentInfo?.stripe_payment_method_id;
  if (typeof savedId === "string" && savedId.startsWith("pm_")) return savedId;

  const onCustomer = await lookupSavedCardId(stripe, stripeCustomerId);
  if (onCustomer) return onCustomer;

  const paymentIntentId = paymentInfo?.stripe_payment_intent_id || bookingPaymentIntent;
  if (!paymentIntentId) throw new Error("No card on file for this customer.");
  const pi = await stripe.paymentIntents.retrieve(paymentIntentId, { expand: ["payment_method"] });
  const method = pi.payment_method;
  const methodId = typeof method === "string" ? method : method?.id;
  if (!methodId) throw new Error("No card on file for this customer.");
  await attachPaymentMethodOnce(stripe, stripeCustomerId, methodId);
  await supabase.from("stripe_payment_info").update({
    stripe_payment_method_id: methodId,
    updated_at: new Date().toISOString()
  }).eq("booking_id", bookingId);
  return methodId;
}

async function bookingPaidWithLink(paymentIntentId) {
  if (!paymentIntentId || typeof paymentIntentId !== "string") return false;
  try {
    const pi = await stripe.paymentIntents.retrieve(paymentIntentId, {
      expand: ["payment_method"]
    });
    const method = pi.payment_method;
    return Boolean(method && typeof method === "object" && method.type === "link");
  } catch {
    return false;
  }
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

  const { data: bookingData, error: bookingErr } = await supabase.from("bookings").select("fees, payment_intent").eq("id", bookingId).single();
  if (bookingErr) throw new Error(`DB error loading booking: ${bookingErr.message}`);
  const existingFees = bookingData?.fees || {};
  const existing = existingFees[feeType];
  const prior = existing && typeof existing === "object" && !Array.isArray(existing) ? existing : null;

  if (prior?.charge_id && String(prior.charge_id).startsWith("ch_")) {
    return {
      success: true,
      message: "This fee was already charged.",
      latestCharge: prior.charge_id,
      paymentIntentId: prior.payment_intent_id ?? null,
      invoiceId: prior.invoice_id ?? null,
      alreadyCharged: true
    };
  }

  if (prior?.invoice_id) {
    const existingInvoice = await resolveInvoiceChargeId(stripe, prior.invoice_id);
    if (existingInvoice.chargeId) {
      await saveFeeCharge(bookingId, existingFees, feeType, {
        ...prior,
        charge_id: existingInvoice.chargeId,
        payment_intent_id: existingInvoice.paymentIntentId ?? prior.payment_intent_id ?? null
      });
      return {
        success: true,
        message: "Existing Stripe charge recorded.",
        latestCharge: existingInvoice.chargeId,
        paymentIntentId: existingInvoice.paymentIntentId,
        invoiceId: prior.invoice_id,
        alreadyCharged: true
      };
    }
    if (existingInvoice.status === "paid") {
      throw new Error("Stripe already marked this fee paid without a card charge. The card was not charged again.");
    }
  }

  if (prior?.payment_intent_id) {
    const existingChargeId = await resolvePaymentIntentChargeId(stripe, prior.payment_intent_id);
    if (existingChargeId) {
      await saveFeeCharge(bookingId, existingFees, feeType, {
        ...prior,
        charge_id: existingChargeId
      });
      return {
        success: true,
        message: "Existing Stripe charge recorded.",
        latestCharge: existingChargeId,
        paymentIntentId: prior.payment_intent_id,
        invoiceId: prior.invoice_id ?? null,
        alreadyCharged: true
      };
    }
  }

  const amountCents = Math.round(amount * 100);
  let paymentMethodId;
  try {
    paymentMethodId = await reusablePaymentMethodId(bookingId, bookingData?.payment_intent, stripeCustomerId);
  } catch (lookupErr) {
    const message = lookupErr instanceof Error ? lookupErr.message : String(lookupErr);
    if (!message.includes("No card on file") && !message.includes("previously used")) throw lookupErr;
    const paidWithLink = await bookingPaidWithLink(bookingData?.payment_intent);
    throw new Error(paidWithLink
      ? "No card on file. This booking was paid with Stripe Link, and Link did not save a card that can be charged again."
      : message);
  }
  let charged;
  try {
    charged = await chargePaymentMethodOffSession(
      stripe,
      stripeCustomerId,
      paymentMethodId,
      amountCents,
      description,
      {
        booking_id: String(bookingId),
        database_customer_id: String(customerId),
        fee_type: String(feeType)
      },
      `fee-${bookingId}-${feeType}-${amountCents}`,
    );
  } catch (chargeErr) {
    const message = chargeErr instanceof Error ? chargeErr.message : String(chargeErr);
    if (!message.includes("No card on file") && !message.includes("previously used")) throw chargeErr;
    const paidWithLink = await bookingPaidWithLink(bookingData?.payment_intent);
    throw new Error(paidWithLink
      ? "No card on file. This booking was paid with Stripe Link, and Link did not save a card that can be charged again."
      : message);
  }

  await saveFeeCharge(bookingId, existingFees, feeType, {
    amount,
    description,
    charge_id: charged.chargeId,
    payment_intent_id: charged.paymentIntentId,
    invoice_id: prior?.invoice_id ?? null,
    created_at: prior?.created_at || new Date().toISOString()
  });
  return {
    success: true,
    message: "Customer charged successfully.",
    invoiceId: prior?.invoice_id ?? null,
    latestCharge: charged.chargeId,
    paymentIntentId: charged.paymentIntentId
  };
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
