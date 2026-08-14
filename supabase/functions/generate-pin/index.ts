import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getCorsHeaders } from "./cors.ts";
import {
  addGraceHour,
  buildBookingDateUTC,
  getPinActivationStart,
  isBookingEnded,
  isWithinPinGenerationWindow,
} from "../_shared/pinTiming.ts";
import { ensurePinOnLock } from "../_shared/lockPin.ts";
import { getOAuthToken, GENERATE_PIN_SCOPES } from "../_shared/iglooAuth.ts";
const IGLOOHOME_API_BASE_URL = "https://api.igloodeveloper.co/igloohome";

/** Statuses eligible for customer portal + daily pin jobs */
const ELIGIBLE_BOOKING_STATUSES = [
  "Confirmed",
  "confirmed",
  "Delivered",
  "delivered",
  "waiting_to_be_returned",
  "Rescheduled",
  "rescheduled",
  "pending_verification",
  "pending_review",
];
function makeJsonResponse(corsHeaders) {
  return (body, status = 200) => new Response(JSON.stringify(body), {
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
  if (booking.pin_notification_sent_at) return;
  const { error } = await supabase.functions.invoke("send-booking-confirmation", {
    body: {
      booking_id: booking.id,
      email_type: "pin_update",
      pin,
      start_time: startTime,
      end_time: endTime,
    },
  });
  if (error) {
    console.error(`[generate-pin] PIN notification failed for booking #${booking.id}:`, error.message);
    return;
  }
  const now = new Date().toISOString();
  await supabase.from("bookings").update({ pin_notification_sent_at: now }).eq("id", booking.id);
  await supabase.from("rental_access_codes").update({ notified_at: now }).eq("order_id", booking.id).eq("status", "active");
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
  const startDate = buildIgloohomeDate(dropOffDate, dropOffTimeSlot, 12);
  // AlgoPIN requires zeroed minutes format: YYYY-MM-DDTHH:00:00+hh:mm
  // Round down to nearest whole hour so e.g. 05:10 becomes 05:00
  // This means the PIN activates slightly early rather than failing entirely
  const startDateHourOnly = startDate.replace(/T(\d{2}):\d{2}:00/, "T$1:00:00");
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
  console.log("[generate-pin] PIN window:", { startDate, endDate });
  const accessName = `Dump Trailer Rental - Order #${orderId}`;

  const bridgeResult = await ensurePinOnLock(supabase, accessToken, {
    orderId,
    lockId,
    bridgeId,
    startDate,
    endDate,
    accessName,
    clearBudgetMs: 50_000,
    createBudgetMs: 60_000,
  });

  if (bridgeResult.lockConfirmed || bridgeResult.jobId) {
    console.log(
      `[generate-pin] Bridge PIN for order #${orderId}: state=${bridgeResult.createState} confirmed=${bridgeResult.lockConfirmed}`,
    );
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
      error: bridgeResult.lockConfirmed ? undefined : bridgeResult.error,
    };
  }

  console.warn(`[generate-pin] Bridge failed for order #${orderId}, trying AlgoPIN. Error: ${bridgeResult.error}`);
  const algoResult = await createAlgoPin(
    accessToken,
    lockId,
    booking.drop_off_date,
    booking.drop_off_time_slot,
    booking.pickup_date,
    orderId,
  );
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
      createState: "completed",
    };
  }
  return {
    success: false,
    error: `Bridge: ${bridgeResult.error} | AlgoPIN: ${algoResult.error}`,
    startDate,
    endDate,
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
    }
    if (callerType === "customer") {
      const metadataCustomerId = user.user_metadata?.customer_db_id;
      let customerId = null;

      if (metadataCustomerId != null && metadataCustomerId !== "") {
        const parsed = Number.parseInt(String(metadataCustomerId), 10);
        if (Number.isFinite(parsed)) customerId = parsed;
      }

      if (!customerId) {
        const { data: customer } = await supabase
          .from("customers")
          .select("id")
          .eq("user_id", user.id)
          .maybeSingle();
        customerId = customer?.id ?? null;
      }

      if (!customerId) {
        return jsonResponse({
          success: false,
          error: "Customer not found"
        }, 403);
      }

      const { data: ownerCheck } = await supabase
        .from("bookings")
        .select("id")
        .eq("id", bookingId)
        .eq("customer_id", customerId)
        .maybeSingle();

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
    const { data: booking, error: fetchError } = await supabase
      .from("bookings")
      .select("*")
      .eq("id", bookingId)
      .in("status", ELIGIBLE_BOOKING_STATUSES)
      .single();

    if (fetchError || !booking) {
      return jsonResponse({
        success: false,
        error: "Booking not found or not eligible for PIN generation"
      }, 404);
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
    await supabase
      .from("rental_access_codes")
      .update({ status: "expired" })
      .eq("order_id", booking.id)
      .eq("status", "active");
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
      confirm_attempts: pinResult.lockConfirmed ? 0 : 1,
    });
    if (insertError) {
      console.error(`[generate-pin] DB insert failed for booking #${bookingId}:`, insertError.message);
      return jsonResponse({
        success: false,
        error: `PIN was created on the lock but failed to save: ${insertError.message}`,
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
      message: pinResult.lockConfirmed
        ? `PIN generated via ${pinResult.pinType}`
        : `PIN queued via ${pinResult.pinType} — waiting for bridge confirmation`,
    });
  } catch (error) {
    console.error("[generate-pin] Unhandled exception:", error);
    return jsonResponse({
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }, 500);
  }
});
