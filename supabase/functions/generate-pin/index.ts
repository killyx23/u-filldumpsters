import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getCorsHeaders } from "./cors.ts";
import {
  getBookingWindow,
  isBookingEnded,
  isWithinPinGenerationWindow,
} from "../_shared/pinTiming.ts";
const IGLOOHOME_OAUTH_URL = "https://auth.igloohome.co/oauth2/token";
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
 * The booking's rental window as UTC instants.
 *
 * Resolved from the typed drop_off_window_* / pickup_window_* columns, falling back to parsing
 * the legacy text slot. Previously this rebuilt the window from the text slot with a regex that
 * only matched the 12-hour format, so every booking stored as '06:00:00' or as a pipe window
 * silently fell back to fixed hours; the conversion also assumed a single UTC offset, which is
 * wrong for half the year in America/Denver.
 */
function bookingPinWindow(booking) {
  const { startIso, endIso } = getBookingWindow(booking);
  if (!startIso || !endIso) {
    console.warn(`[generate-pin] Could not resolve a rental window for booking #${booking?.id}`);
  }
  return { startIso, endIso };
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
async function getOAuthToken(clientId, clientSecret) {
  const credentials = btoa(`${clientId}:${clientSecret}`);
  const res = await fetch(IGLOOHOME_OAUTH_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json"
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: [
        "igloohomeapi/create-pin-bridge-proxied-job",
        "igloohomeapi/get-devices",
        "igloohomeapi/get-job-status",
        "igloohomeapi/algopin-onetime"
      ].join(" ")
    })
  });
  const body = await readResponse(res);
  console.log("[generate-pin] OAuth status:", res.status);
  if (!res.ok || !body.json?.access_token) {
    console.error("[generate-pin] OAuth failed:", body.text);
    return null;
  }
  return body.json.access_token;
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
async function createAlgoPin(accessToken, lockId, booking, orderId) {
  const { startIso } = bookingPinWindow(booking);
  // AlgoPIN requires zeroed minutes format: YYYY-MM-DDTHH:00:00+hh:mm
  // Round down to nearest whole hour so e.g. 05:10 becomes 05:00
  // This means the PIN activates slightly early rather than failing entirely
  const startDateHourOnly = startIso.replace(/T(\d{2}):\d{2}:\d{2}/, "T$1:00:00");
  const startUnix = new Date(startDateHourOnly).getTime() / 1000;
  const endUnix = new Date(booking.pickup_date + "T23:59:59Z").getTime() / 1000;
  const variance = Math.min(5, Math.max(1, Math.ceil((endUnix - startUnix) / 86400)));
  const payload = {
    accessName: `Dump Loader Rental - Order #${orderId} (AlgoPIN)`,
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
async function generatePinWithFallback(accessToken, lockId, bridgeId, booking, orderId) {
  const randomPin = generateRandomPin();
  const { startIso: startDate, endIso: endDate } = bookingPinWindow(booking);
  console.log("[generate-pin] PIN window:", {
    startDate,
    endDate
  });
  const accessName = `Dump Loader Rental - Order #${orderId}`;
  const bridgeResult = await createBridgePin(accessToken, lockId, bridgeId, randomPin, startDate, endDate, accessName);
  if (bridgeResult.success) {
    console.log(`[generate-pin] ✓ Bridge PIN succeeded for order #${orderId}`);
    return {
      success: true,
      pin: randomPin,
      pinId: bridgeResult.pinId,
      pinType: "bridge_proxied"
    };
  }
  console.warn(`[generate-pin] Bridge failed for order #${orderId}, trying AlgoPIN. Error: ${bridgeResult.error}`);
  const algoResult = await createAlgoPin(accessToken, lockId, booking, orderId);
  if (algoResult.success) {
    console.log(`[generate-pin] ✓ AlgoPIN succeeded for order #${orderId}`);
    return {
      success: true,
      pin: algoResult.pin,
      pinId: algoResult.pinId,
      pinType: "algopin"
    };
  }
  return {
    success: false,
    error: `Bridge: ${bridgeResult.error} | AlgoPIN: ${algoResult.error}`
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
      const { data: adminCheck } = await supabase.from("admin_users").select("id").eq("user_id", user.id).single();
      if (!adminCheck) {
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

    const { data: existingPin } = await supabase
      .from("rental_access_codes")
      .select("id, access_pin")
      .eq("order_id", bookingId)
      .eq("status", "active")
      .maybeSingle();

    if (existingPin?.access_pin) {
      return jsonResponse({
        success: false,
        error: "An active PIN already exists for this booking"
      }, 409);
    }
    // ----------------------------------------------------------------
    // Generate PIN — bridge first, algopin fallback
    // ----------------------------------------------------------------
    const accessToken = await getOAuthToken(clientId, clientSecret);
    if (!accessToken) return jsonResponse({
      success: false,
      error: "Failed to get OAuth token"
    }, 500);
    const lockOnline = await isLockOnline(accessToken, lockId);
    console.log(`[generate-pin] Lock online: ${lockOnline}`);
    console.log(`[generate-pin] Booking #${bookingId} | drop_off: ${booking.drop_off_date} ${booking.drop_off_time_slot} | pickup: ${booking.pickup_date} ${booking.pickup_time_slot}`);
    const pinResult = await generatePinWithFallback(accessToken, lockId, bridgeId, booking, booking.id);
    if (!pinResult.success) {
      return jsonResponse({
        success: false,
        error: `PIN generation failed: ${pinResult.error}`
      }, 500);
    }
    // ----------------------------------------------------------------
    // Persist
    // ----------------------------------------------------------------
    const now = new Date().toISOString();
    await supabase.from("bookings").update({
      pin_generated_at: now
    }).eq("id", bookingId);
    // Build the same UTC times for DB storage so portal displays correctly
    const { startIso: startTimeUTC, endIso: endTimeUTC } = bookingPinWindow(booking);
    await supabase.from("rental_access_codes").insert({
      order_id: booking.id,
      customer_email: booking.email,
      customer_phone: booking.phone || "",
      access_pin: pinResult.pin,
      pin_id: pinResult.pinId || "",
      pin_type: pinResult.pinType,
      lock_id: lockId,
      start_time: startTimeUTC,
      end_time: endTimeUTC,
      status: "active"
    });
    await maybeSendPinNotification(supabase, booking, pinResult.pin, startTimeUTC, endTimeUTC);
    console.log(`[generate-pin] ✓ PIN generated for booking #${bookingId} via ${pinResult.pinType}`);
    return jsonResponse({
      success: true,
      bookingId,
      pin: pinResult.pin,
      pinType: pinResult.pinType,
      pinId: pinResult.pinId,
      message: `PIN generated via ${pinResult.pinType}`
    });
  } catch (error) {
    console.error("[generate-pin] Unhandled exception:", error);
    return jsonResponse({
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }, 500);
  }
});
