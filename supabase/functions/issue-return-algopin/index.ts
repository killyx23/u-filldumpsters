import { getCorsHeaders } from "./cors.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getJwtAal } from "../_shared/jwtAal.ts";
import { bookingNeedsYardLockPin } from "../_shared/deliveryBooking.ts";
import { issueExtensionReturnPin } from "../_shared/extensionReturnPin.ts";
import { getBookingWindow, isBookingEnded } from "../_shared/pinTiming.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

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
    const callerType = body.callerType === "customer" ? "customer" : "admin";
    if (!bookingId) return fail(400, "bookingId is required");

    if (callerType === "admin") {
      if (user.app_metadata?.is_admin !== true) return fail(403, "Admin access required");
      if (getJwtAal(token) !== "aal2") return fail(403, "Admin MFA required");
    }

    const { data: booking, error: bookingError } = await supabaseAdmin
      .from("bookings")
      .select("*, customers(id, email, phone, sms_opt_in, name)")
      .eq("id", bookingId)
      .single();
    if (bookingError || !booking) return fail(404, "Booking not found");

    if (callerType === "customer") {
      const metadataId = Number(user.user_metadata?.customer_db_id);
      let customerId = Number.isFinite(metadataId) && metadataId > 0 ? metadataId : null;
      if (!customerId) {
        const { data: customer } = await supabaseAdmin
          .from("customers")
          .select("id")
          .eq("user_id", user.id)
          .maybeSingle();
        customerId = customer?.id ?? null;
      }
      if (!customerId || Number(booking.customer_id) !== customerId) {
        return fail(403, "This rental is not on your account");
      }
    }

    if (!bookingNeedsYardLockPin(booking)) {
      return fail(400, "This rental does not use the yard padlock.");
    }
    const started = Boolean(booking.rented_out_at) || getBookingWindow(booking).startMs <= Date.now();
    if (!started) return fail(400, "A backup code is available after the rental starts.");
    if (isBookingEnded(booking)) return fail(400, "This rental has already ended.");

    const pickupDate = String(booking.pickup_date || "").slice(0, 10);
    const pin = await issueExtensionReturnPin(supabaseAdmin, booking, pickupDate);
    if (!pin.ok || !pin.pin) {
      return fail(409, pin.error || "Could not create a backup return code.");
    }

    await supabaseAdmin.functions.invoke("send-booking-confirmation", {
      body: {
        bookingId,
        email_type: "extension_pin",
        backup: true,
        email: booking.email || booking.customers?.email,
        extensionPin: pin.pin,
        originalPin: pin.originalPin,
        originalEnd: pin.originalEnd,
        extensionStart: pin.start,
        extensionEnd: pin.end,
        activationRequired: pin.activationRequired,
        newReturn: pickupDate,
      },
    });

    return new Response(JSON.stringify({ success: true, pin: pin.pin, start: pin.start, end: pin.end, activationRequired: pin.activationRequired }), {
      status: 200,
      headers,
    });
  } catch (error) {
    return fail(500, error?.message || "Could not create a backup return code.");
  }
});
