import { getCorsHeaders } from "./cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import Stripe from "https://esm.sh/stripe@14.14.0?target=deno";

function getStripeClient() {
  const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY")?.trim();
  if (!stripeSecretKey) {
    throw new Error(
      "Stripe is not configured on the server. Set STRIPE_SECRET_KEY in Supabase Edge Function secrets (production) or supabase/functions/.env (local).",
    );
  }

  return new Stripe(stripeSecretKey, {
    apiVersion: "2023-10-16",
    httpClient: Stripe.createFetchHttpClient(),
  });
}

const updatablePiStatuses = new Set([
  "requires_payment_method",
  "requires_confirmation",
  "requires_action",
]);

function resolveBookingGrandTotal(booking: {
  total_price?: number | null;
  subtotal_before_tax?: number | null;
  tax_amount?: number | null;
}) {
  const subtotal = Number(booking.subtotal_before_tax ?? 0);
  const tax = Number(booking.tax_amount ?? 0);
  const stored = Number(booking.total_price ?? 0);
  const computed = Math.round((subtotal + tax) * 100) / 100;
  if (subtotal > 0 && tax > 0 && Math.abs(stored - subtotal) < 0.02) return computed;
  return stored > 0 ? stored : computed;
}

function lineItemsFromAddonsSnapshot(addons: Record<string, unknown> | null | undefined) {
  const snapshot = addons?.taxLineItemsSnapshot;
  if (!Array.isArray(snapshot) || snapshot.length === 0) return null;
  return snapshot.map((row: Record<string, unknown>) => ({
    amount: Number(row.amount ?? row.amountAfterDiscount ?? 0),
    is_taxable: row.is_taxable === true,
  }));
}

function buildPaymentMetadata(
  booking: Record<string, unknown>,
  bookingId: string | number,
  grandTotal: number
) {
  const addons = (booking.addons ?? {}) as Record<string, unknown>;
  let taxableSubtotal = Number(addons.taxableSubtotal ?? 0);
  let nonTaxableSubtotal = Number(addons.nonTaxableSubtotal ?? 0);
  const subtotalBeforeTax = Number(booking.subtotal_before_tax ?? 0);
  const taxAmount = Number(booking.tax_amount ?? 0);
  const taxRateUsed = Number(booking.tax_rate_used ?? 0);
  const snapshotLines = lineItemsFromAddonsSnapshot(addons);

  if (snapshotLines && taxableSubtotal === 0 && nonTaxableSubtotal === 0) {
    taxableSubtotal = snapshotLines.filter((l) => l.is_taxable).reduce((s, l) => s + l.amount, 0);
    nonTaxableSubtotal = snapshotLines.filter((l) => !l.is_taxable).reduce((s, l) => s + l.amount, 0);
  }

  return {
    booking_id: String(bookingId),
    total_price: String(grandTotal),
    subtotal_before_tax: String(subtotalBeforeTax),
    tax_amount: String(taxAmount),
    tax_rate_used: String(taxRateUsed),
    taxable_subtotal: String(taxableSubtotal),
    non_taxable_subtotal: String(nonTaxableSubtotal),
  };
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [create-payment-intent] Function invoked.`);

  try {
    const stripe = getStripeClient();

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch (parseError) {
      console.error(`[${timestamp}] [create-payment-intent] Failed to parse request JSON:`, parseError);
      throw new Error("Invalid request format. Expected JSON.");
    }

    const booking_id = body.booking_id || body.bookingId;
    const sync_amount_only = body.sync_amount_only === true;

    if (!booking_id) {
      return new Response(JSON.stringify({ error: "Missing booking_id in request payload" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error("Server misconfiguration: Database connection details missing.");
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { data: booking, error: fetchError } = await supabase
      .from("bookings")
      .select("id, total_price, subtotal_before_tax, tax_amount, tax_rate_used, status, payment_intent, client_secret, addons")
      .eq("id", booking_id)
      .single();

    if (fetchError || !booking) {
      return new Response(JSON.stringify({ error: `Booking not found. ID: ${booking_id}` }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const grandTotal = resolveBookingGrandTotal(booking);
    const subtotalBeforeTax = Number(booking.subtotal_before_tax ?? 0);
    const taxAmount = Number(booking.tax_amount ?? 0);

    if (grandTotal <= 0 && subtotalBeforeTax <= 0 && taxAmount <= 0) {
      throw new Error("Booking has no valid pricing. Cannot create payment intent.");
    }

    const amountInCents = Math.max(50, Math.round(grandTotal * 100));
    const metadata = buildPaymentMetadata(booking, booking_id as string | number, grandTotal);
    console.log(`[${timestamp}] [create-payment-intent] amount=${amountInCents}c metadata=`, metadata);

    if (sync_amount_only && booking.payment_intent) {
      const pi = await stripe.paymentIntents.retrieve(booking.payment_intent);
      if (updatablePiStatuses.has(pi.status)) {
        await stripe.paymentIntents.update(booking.payment_intent, {
          amount: amountInCents,
          metadata,
          automatic_payment_methods: { enabled: true },
        });
      }
      return new Response(JSON.stringify({
        success: true,
        clientSecret: pi.client_secret ?? booking.client_secret,
        paymentIntentId: pi.id,
        synced: true,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const paymentIntentCreateParams = {
      amount: amountInCents,
      currency: "usd",
      metadata,
      automatic_payment_methods: { enabled: true },
    };
    const paymentIntentUpdateParams = {
      amount: amountInCents,
      metadata,
      automatic_payment_methods: { enabled: true },
    };

    // Reuse an existing open PaymentIntent when possible (page refresh / retries).
    if (booking.payment_intent) {
      try {
        const existing = await stripe.paymentIntents.retrieve(booking.payment_intent);
        if (updatablePiStatuses.has(existing.status)) {
          const updated = await stripe.paymentIntents.update(
            booking.payment_intent,
            paymentIntentUpdateParams
          );
          return new Response(JSON.stringify({
            success: true,
            clientSecret: updated.client_secret ?? booking.client_secret,
            paymentIntentId: updated.id,
            reused: true,
          }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      } catch (retrieveError) {
        console.warn(
          `[${timestamp}] [create-payment-intent] Could not reuse PI ${booking.payment_intent}:`,
          retrieveError
        );
      }
    }

    const paymentIntent = await stripe.paymentIntents.create(paymentIntentCreateParams);

    const { error: dbError } = await supabase
      .from("bookings")
      .update({
        payment_intent: paymentIntent.id,
        client_secret: paymentIntent.client_secret,
      })
      .eq("id", booking_id);

    if (dbError) {
      throw new Error(`Failed to save payment details to booking: ${dbError.message}`);
    }

    return new Response(JSON.stringify({
      success: true,
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error(`[${timestamp}] [create-payment-intent] CRITICAL ERROR:`, error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : "An unexpected server error occurred.",
    }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
