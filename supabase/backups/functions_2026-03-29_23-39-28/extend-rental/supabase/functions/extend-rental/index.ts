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
