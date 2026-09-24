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
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getCorsHeaders } from "../_shared/cors.ts";
import { sendEmail } from "../_shared/notify.ts";
import { buildUnsubscribeUrl, normalizeSiteUrl } from "../_shared/normalizeSiteUrl.ts";
import {
  buildEarlyLeaveEmailHtml,
  EARLY_LEAVE_EMAIL_SUBJECT,
} from "../_shared/earlyLeaveEmail.ts";

function jsonResponse(corsHeaders: Record<string, string>, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const ALLOWED_REASONS = new Set(["left_early", "reminded", "expired"]);

type SupabaseClient = any;

async function ensureBookingCustomer(
  supabase: SupabaseClient,
  bookingId: number,
): Promise<number | null> {
  const { data: booking, error } = await supabase
    .from("bookings")
    .select(
      "id, email, first_name, last_name, name, phone, street, city, state, zip, customer_id",
    )
    .eq("id", bookingId)
    .maybeSingle();

  if (error || !booking) {
    console.error("[end-unfinished-checkout] ensureBookingCustomer load failed:", error);
    return null;
  }

  if (booking.customer_id) {
    return Number(booking.customer_id);
  }

  const email = String(booking.email || "").trim().toLowerCase();
  if (!email) return null;

  const { data: existing } = await supabase
    .from("customers")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  let customerId = existing?.id ? Number(existing.id) : null;

  if (!customerId) {
    const cleanedPhone = String(booking.phone || "").replace(/\D/g, "");
    const { data: created, error: createError } = await supabase
      .from("customers")
      .insert({
        email,
        name: booking.name || `${booking.first_name || ""} ${booking.last_name || ""}`.trim(),
        first_name: booking.first_name,
        last_name: booking.last_name,
        phone: cleanedPhone || null,
        street: booking.street,
        city: booking.city,
        state: booking.state,
        zip: booking.zip,
        segment: "feedback_lead",
      })
