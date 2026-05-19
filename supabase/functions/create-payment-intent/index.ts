import { corsHeaders } from "./cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import Stripe from "https://esm.sh/stripe@14.14.0?target=deno";
import { calculateTaxFromLineItems, type TaxLineItem } from "../_shared/bookingTax.ts";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
  apiVersion: "2023-10-16",
  httpClient: Stripe.createFetchHttpClient(),
});

type BookingRow = {
  id: number;
  total_price: number;
  subtotal_before_tax?: number | null;
  tax_amount?: number | null;
  tax_rate_used?: number | null;
  status?: string | null;
  plan?: { id?: number; price?: number; base_price?: number } | null;
  addons?: Record<string, unknown> | null;
};

/**
 * Rebuild line items from stored booking snapshot when present.
 */
function lineItemsFromAddonsSnapshot(addons: Record<string, unknown>): TaxLineItem[] | null {
  const snapshot = addons.taxLineItemsSnapshot;
  if (!Array.isArray(snapshot) || snapshot.length === 0) return null;
  return snapshot.map((row: Record<string, unknown>) => ({
    key: String(row.key ?? "line"),
    label: String(row.label ?? "Charge"),
    amount: Number(row.amount ?? row.amountAfterDiscount ?? 0),
    is_taxable: row.is_taxable === true,
  }));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [create-payment-intent] Function invoked.`);

  try {
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch (parseError) {
      console.error(`[${timestamp}] [create-payment-intent] Failed to parse request JSON:`, parseError);
      throw new Error("Invalid request format. Expected JSON.");
    }

    console.log(`[${timestamp}] [create-payment-intent] Received request body:`, JSON.stringify(body));

    const booking_id = body.booking_id ?? body.bookingId;
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
      .select("id, total_price, subtotal_before_tax, tax_amount, tax_rate_used, status, plan, addons")
      .eq("id", booking_id)
      .single();

    if (fetchError || !booking) {
      return new Response(JSON.stringify({ error: `Booking not found. ID: ${booking_id}` }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const b = booking as BookingRow;
    console.log(`[${timestamp}] [create-payment-intent] Retrieved booking:`, JSON.stringify(b));

    let taxableSubtotal = Number((b.addons as Record<string, unknown>)?.taxableSubtotal ?? 0);
    let nonTaxableSubtotal = Number((b.addons as Record<string, unknown>)?.nonTaxableSubtotal ?? 0);

    const addons = (b.addons ?? {}) as Record<string, unknown>;
    const snapshotLines = lineItemsFromAddonsSnapshot(addons);
    if (snapshotLines && (taxableSubtotal === 0 && nonTaxableSubtotal === 0)) {
      taxableSubtotal = snapshotLines
        .filter((l) => l.is_taxable)
        .reduce((s, l) => s + l.amount, 0);
      nonTaxableSubtotal = snapshotLines
        .filter((l) => !l.is_taxable)
        .reduce((s, l) => s + l.amount, 0);
    }

    const subtotalBeforeTax = Number(b.subtotal_before_tax ?? 0);
    const taxAmount = Number(b.tax_amount ?? 0);
    const taxRateUsed = Number(b.tax_rate_used ?? 0);

    if ((!subtotalBeforeTax || !taxAmount) && snapshotLines?.length) {
      const taxRate = taxRateUsed || 7.45;
      const recalc = calculateTaxFromLineItems(snapshotLines, taxRate, 0);
      if (!taxableSubtotal) taxableSubtotal = recalc.taxableSubtotal;
      if (!nonTaxableSubtotal) nonTaxableSubtotal = recalc.nonTaxableSubtotal;
    }

    const amountInCents = Math.round(Number(b.total_price) * 100);
    const expectedTotalCents = Math.round(
      (subtotalBeforeTax + taxAmount) * 100
    );

    if (subtotalBeforeTax > 0 && taxAmount >= 0 && Math.abs(amountInCents - expectedTotalCents) > 1) {
      console.warn(
        `[${timestamp}] [create-payment-intent] total_price (${b.total_price}) differs from subtotal+tax (${subtotalBeforeTax + taxAmount})`
      );
    }

    const metadata: Record<string, string> = {
      booking_id: String(booking_id),
      total_price: String(b.total_price ?? 0),
      subtotal_before_tax: String(subtotalBeforeTax),
      tax_amount: String(taxAmount),
      tax_rate_used: String(taxRateUsed),
      taxable_subtotal: String(taxableSubtotal),
      non_taxable_subtotal: String(nonTaxableSubtotal),
    };

    console.log(`[${timestamp}] [create-payment-intent] Stripe metadata:`, metadata);

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountInCents,
      currency: "usd",
      metadata,
    });

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

    return new Response(
      JSON.stringify({
        success: true,
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error(`[${timestamp}] [create-payment-intent] CRITICAL ERROR:`, error);
    const message = error instanceof Error ? error.message : "An unexpected server error occurred.";
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
