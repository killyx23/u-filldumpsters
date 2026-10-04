import { getCorsHeaders } from "./cors.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { Stripe } from "npm:stripe@15.8.0";
import { businessWallTimeToUtc, parseClockTime } from "../_shared/parseBookingTimeSlot.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "", { apiVersion: "2024-06-20" });

const CLOSED_STATUSES = new Set([
  "Completed",
  "flagged",
  "Returned",
  "Cancelled",
  "cancellation_pending",
  "pending_payment",
  "pending_verification",
  "pending_review",
  "pending_checklist",
  "booking_not_finished",
]);

function round2(amount: unknown) {
  return Math.round((Number(amount) || 0) * 100) / 100;
}

function dateKey(value: unknown) {
  const match = String(value || "").match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : "";
}

function addDays(dateIso: string, days: number) {
  const [year, month, day] = dateIso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function eachDate(startIso: string, endIso: string) {
  const dates: string[] = [];
  let cursor = startIso;
  while (cursor <= endIso) {
    dates.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return dates;
}

function dayRateFromBooking(booking: { plan?: { base_price?: number; price?: number }; drop_off_date?: string; pickup_date?: string }) {
  const base = Number(booking.plan?.base_price);
  if (base > 0) return round2(base);
  const dropOff = dateKey(booking.drop_off_date);
  const pickup = dateKey(booking.pickup_date);
  const stayDays = dropOff && pickup ? Math.max(1, eachDate(dropOff, pickup).length) : 1;
  const price = Number(booking.plan?.price);
  if (price > 0) return round2(price / stayDays);
  return 0;
}

function returnDeadlinePassed(booking: { pickup_date?: string; pickup_time_slot?: string }) {
  const returnDate = dateKey(booking.pickup_date);
  const clock = parseClockTime(booking.pickup_time_slot || "23:00:00") || { hour: 23, minute: 0, second: 0 };
  const deadline = businessWallTimeToUtc(returnDate, clock);
  if (!deadline) return true;
  return Date.now() >= deadline.getTime();
}

function dayIsBlocked(availability: Record<string, { available?: boolean; inventoryAvailable?: boolean }>, date: string, returnDay: boolean) {
  const row = availability[date];
  if (!row) return true;
  if (row.inventoryAvailable === false) return true;
  if (returnDay && row.available !== true) return true;
  return false;
}

async function loadAvailability(serviceId: number, isDelivery: boolean, startDate: string, endDate: string) {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/get-availability`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ serviceId, isDelivery, startDate, endDate }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.error) {
    throw new Error(payload?.error || "Could not verify date availability.");
  }
  return payload.availability || {};
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function chargeCard(customerId: number, bookingId: number, amount: number, description: string) {
  const { data: customer, error: customerErr } = await supabaseAdmin
    .from("customers")
    .select("stripe_customer_id, email, name")
    .eq("id", customerId)
    .single();
  if (customerErr || !customer) throw new Error("Customer not found.");
  let stripeCustomerId = customer.stripe_customer_id;
  if (!stripeCustomerId) {
    const existing = await stripe.customers.list({ email: customer.email, limit: 1 });
    stripeCustomerId = existing.data[0]?.id || (await stripe.customers.create({
      email: customer.email,
      name: customer.name,
    })).id;
    await supabaseAdmin.from("customers").update({ stripe_customer_id: stripeCustomerId }).eq("id", customerId);
  }

  let invoiceId = "";
  try {
    await stripe.invoiceItems.create({
      customer: stripeCustomerId,
      amount: Math.round(amount * 100),
      currency: "usd",
      description,
    });
    const invoice = await stripe.invoices.create({
      customer: stripeCustomerId,
      collection_method: "charge_automatically",
      auto_advance: true,
      description: `Rental extension for booking #${bookingId}`,
      metadata: {
        booking_id: String(bookingId),
        database_customer_id: String(customerId),
        fee_type: "rental_extension",
      },
    });
    invoiceId = invoice.id;
    const finalized = await stripe.invoices.finalizeInvoice(invoice.id);
    await sleep(800);
    let post = await stripe.invoices.retrieve(finalized.id);
    if (post.status === "open" || post.status === "draft") {
      await sleep(800);
      post = await stripe.invoices.retrieve(finalized.id);
    }
    if (post.status !== "paid") {
      throw new Error(`Failed to charge the card on file. Invoice status: ${post.status}`);
    }
    const latestCharge = typeof post.latest_charge === "string" ? post.latest_charge : post.latest_charge?.id;
    const paymentIntentId = typeof post.payment_intent === "string" ? post.payment_intent : post.payment_intent?.id;
    return { invoiceId, latestCharge: latestCharge ?? null, paymentIntentId: paymentIntentId ?? null };
  } catch (error) {
    if (invoiceId) {
      try {
        const invoice = await stripe.invoices.retrieve(invoiceId);
        if (invoice.status !== "paid") await stripe.invoices.voidInvoice(invoiceId);
      } catch (_) { /* already paid or closed */ }
    }
    throw error;
  }
}

async function refundCharge(bookingId: number, amount: number, paymentIntentId: string | null, chargeId: string | null) {
  const payload: Record<string, unknown> = {
    amount: Math.round(amount * 100),
    metadata: { booking_id: String(bookingId), reason: "extension_date_rejected" },
  };
  if (paymentIntentId) payload.payment_intent = paymentIntentId;
  else if (chargeId) payload.charge = chargeId;
  else return;
  await stripe.refunds.create(payload as Stripe.RefundCreateParams);
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const headers = { ...corsHeaders, "Content-Type": "application/json" };
  const fail = (status: number, error: string) => new Response(JSON.stringify({ error }), { status, headers });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return fail(401, "Missing Authorization header");
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError || !user) return fail(401, "Unauthorized");

    const body = await req.json().catch(() => ({}));
    const bookingId = Number(body.bookingId ?? body.booking_id);
    const newPickupDate = dateKey(body.newPickupDate);
    const signature = String(body.agreementSignature || "").trim();
    const signatureDate = String(body.agreementSignatureDate || "").trim();
    if (!bookingId || !newPickupDate || !signature || !signatureDate) {
      return fail(400, "Choose a return date and sign the agreement.");
    }

    const { data: booking, error: bookingError } = await supabaseAdmin
      .from("bookings")
      .select("*, customers(id, stripe_customer_id, email, name)")
      .eq("id", bookingId)
      .single();
    if (bookingError || !booking) return fail(404, "Booking not found.");

    const customerDbId = user.user_metadata?.customer_db_id;
    if (customerDbId == null || Number(customerDbId) !== Number(booking.customer_id)) {
      return fail(403, "This booking belongs to another customer.");
    }
    if (booking.returned_at || CLOSED_STATUSES.has(booking.status) || returnDeadlinePassed(booking)) {
      return fail(400, "This rental can only be extended before the return time.");
    }

    const currentPickup = dateKey(booking.pickup_date);
    const firstExtraDay = addDays(currentPickup, 1);
    if (newPickupDate < firstExtraDay) return fail(400, "Choose a return date after the current return.");

    const serviceId = Number(booking.plan?.id);
    const isDelivery = Boolean(booking.addons?.isDelivery || booking.addons?.deliveryService);
    const availability = await loadAvailability(serviceId, isDelivery, firstExtraDay, newPickupDate);
    const dates = eachDate(firstExtraDay, newPickupDate);
    if (dayIsBlocked(availability, dates[0], dates.length === 1)) {
      return fail(409, "The next day is not open. Return the rental and start a new booking for later dates.");
    }
    for (let index = 0; index < dates.length; index += 1) {
      if (dayIsBlocked(availability, dates[index], index === dates.length - 1)) {
        return fail(409, "Those dates are not consecutive open days. Return the rental and start a new booking.");
      }
    }

    const dayRate = dayRateFromBooking(booking);
    if (!(dayRate > 0)) return fail(400, "This booking has no day rate to extend.");
    const taxRate = Number(booking.tax_rate_used ?? 7.45);
    const subtotal = round2(dayRate * dates.length);
    const tax = round2(subtotal * (taxRate / 100));
    const total = round2(subtotal + tax);
    const description = `Rental extension: ${dates.length} day(s) for booking #${bookingId}`;
    const charge = await chargeCard(booking.customer_id, bookingId, total, description);

    const approvedAt = new Date().toISOString();
    const history = Array.isArray(booking.receipt_status_history) ? booking.receipt_status_history : [];
    const entry = {
      action: "rental_extended",
      at: approvedAt,
      original_pickup_date: currentPickup,
      original_pickup_time: booking.pickup_time_slot,
      new_pickup_date: newPickupDate,
      new_pickup_time: booking.pickup_time_slot,
      days: dates.length,
      day_rate: dayRate,
      subtotal,
      tax,
      amount: total,
      stripe_type: "charge",
      stripe_transaction_id: charge.paymentIntentId || charge.latestCharge,
      agreement_signature: signature,
      agreement_signature_date: signatureDate,
    };
    const extensions = Array.isArray(booking.addons?.extensions) ? booking.addons.extensions : [];
    const fees = booking.fees && typeof booking.fees === "object" ? booking.fees : {};
    const feeHistory = Array.isArray(fees.rental_extension_history) ? fees.rental_extension_history : [];
    const feeRecord = {
      amount: total,
      description,
      charge_id: charge.latestCharge,
      payment_intent_id: charge.paymentIntentId,
      invoice_id: charge.invoiceId,
      created_at: approvedAt,
    };
    const nextPlan = {
      ...(booking.plan || {}),
      price: round2(Number(booking.plan?.price || 0) + subtotal),
    };
    const { data: updated, error: updateError } = await supabaseAdmin
      .from("bookings")
      .update({
        pickup_date: newPickupDate,
        plan: nextPlan,
        subtotal_before_tax: round2(Number(booking.subtotal_before_tax || 0) + subtotal),
        tax_amount: round2(Number(booking.tax_amount || 0) + tax),
        total_price: round2(Number(booking.total_price || 0) + total),
        receipt_status_history: [...history, entry],
        addons: { ...(booking.addons || {}), extensions: [...extensions, entry] },
        fees: {
          ...fees,
          rental_extension: feeRecord,
          rental_extension_history: [...feeHistory, feeRecord],
        },
      })
      .eq("id", bookingId)
      .select("*")
      .single();

    if (updateError || !updated) {
      await refundCharge(bookingId, total, charge.paymentIntentId, charge.latestCharge);
      const capacityText = `${updateError?.message || ""} ${updateError?.details || ""} ${updateError?.code || ""}`;
      const capacity = /booking_capacity_exceeded|capacity/i.test(capacityText);
      return fail(
        409,
        capacity
          ? "Those dates were just booked. The card was refunded. Return the rental and start a new booking."
          : "The return date could not be saved. The card was refunded.",
      );
    }

    const { data: emailData, error: emailError } = await supabaseAdmin.functions.invoke("send-booking-confirmation", {
      body: {
        bookingId,
        force: true,
        email: booking.email || booking.customers?.email,
      },
    });
    if (emailError || emailData?.error) {
      console.error("[extend-booking] confirmation email failed", emailError || emailData?.error);
    }

    return new Response(JSON.stringify({
      success: true,
      booking: updated,
      extension: entry,
      emailSent: !emailError && !emailData?.error,
    }), { status: 200, headers });
  } catch (error) {
    console.error("[extend-booking]", error);
    return fail(500, error?.message || "Could not extend this rental.");
  }
});
