import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders } from "./cors.ts";
const IGLOOHOME_OAUTH_URL = "https://auth.igloohome.co/oauth2/token";
const IGLOOHOME_API_BASE_URL = "https://api.igloodeveloper.co/igloohome";
function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
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
function buildStartDate(dropOffDate) {
  const today = new Date().toISOString().split("T")[0];
  const pad = (n)=>String(n).padStart(2, "0");
  if (dropOffDate === today) {
    const now = new Date(Date.now() + 5 * 60 * 1000);
    const datePart = now.toISOString().split("T")[0];
    return `${datePart}T${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:00+00:00`;
  }
  return `${dropOffDate}T00:00:00+00:00`;
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
async function createAlgoPin(accessToken, lockId, dropOffDate, pickupDate, orderId) {
  const startDate = buildStartDate(dropOffDate);
  const startUnix = new Date(dropOffDate + "T00:00:00Z").getTime() / 1000;
  const endUnix = new Date(pickupDate + "T23:59:59Z").getTime() / 1000;
  const variance = Math.min(5, Math.max(1, Math.ceil((endUnix - startUnix) / 86400)));
  const payload = {
    accessName: `Dump Loader Rental - Order #${orderId} (AlgoPIN)`,
    startDate,
    variance
  };
  console.log("[generate-pin] Creating AlgoPIN:", payload);
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
  console.log("[generate-pin] AlgoPIN response:", {
    status: res.status,
    body: body.json
  });
  if (!res.ok && res.status !== 201) {
    return {
      success: false,
      error: `AlgoPIN failed with status ${res.status}`
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
async function generatePinWithFallback(accessToken, lockId, bridgeId, dropOffDate, pickupDate, orderId) {
  const randomPin = generateRandomPin();
  const startDate = buildStartDate(dropOffDate);
  const endDate = `${pickupDate}T23:59:00+00:00`;
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
  const algoResult = await createAlgoPin(accessToken, lockId, dropOffDate, pickupDate, orderId);
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
      // TODO: replace with your actual admin check
      const { data: adminCheck } = await supabase.from("admin_users").select("id").eq("user_id", user.id).single();
      if (!adminCheck) {
        return jsonResponse({
          success: false,
          error: "Admin access required"
        }, 403);
      }
    }
    if (callerType === "customer") {
      // TODO: confirm column name linking auth user to customer
      const { data: customer } = await supabase.from("customers").select("id").eq("user_id", user.id).single();
      if (!customer) {
        return jsonResponse({
          success: false,
          error: "Customer not found"
        }, 403);
      }
      // Verify booking belongs to this customer
      const { data: ownerCheck } = await supabase.from("bookings").select("id").eq("id", bookingId).eq("customer_id", customer.id).single();
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
    const { data: booking, error: fetchError } = await supabase.from("bookings").select("*").eq("id", bookingId).eq("status", "Confirmed").is("pin_generated_at", null).single();
    if (fetchError || !booking) {
      return jsonResponse({
        success: false,
        error: "Booking not found, not confirmed, or already has a PIN"
      }, 404);
    }
    // Guard: check rental_access_codes directly as a second layer
    const { data: existingPin } = await supabase.from("rental_access_codes").select("id, access_pin").eq("order_id", bookingId).eq("status", "active").single();
    if (existingPin) {
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
    const pinResult = await generatePinWithFallback(accessToken, lockId, bridgeId, booking.drop_off_date, booking.pickup_date, booking.id);
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
    await supabase.from("rental_access_codes").insert({
      order_id: booking.id,
      customer_email: booking.email,
      customer_phone: booking.phone || "",
      access_pin: pinResult.pin,
      pin_id: pinResult.pinId || "",
      pin_type: pinResult.pinType,
      lock_id: lockId,
      start_time: `${booking.drop_off_date}T00:00:00Z`,
      end_time: `${booking.pickup_date}T23:59:59Z`,
      status: "active"
    });
    // TODO: uncomment when send-pin-notification is deployed
    // const { error: emailError } = await supabase.functions.invoke("send-pin-notification", {
    //   body: { bookingId: booking.id, pin: pinResult.pin, dropOffDate: booking.drop_off_date, pickupDate: booking.pickup_date },
    // });
    // if (!emailError) {
    //   await supabase.from("bookings").update({ pin_notification_sent_at: now }).eq("id", bookingId);
    // }
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
