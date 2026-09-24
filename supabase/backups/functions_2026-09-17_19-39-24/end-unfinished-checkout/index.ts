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
