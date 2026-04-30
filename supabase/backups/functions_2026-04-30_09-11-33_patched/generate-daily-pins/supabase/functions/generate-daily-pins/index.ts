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
/** Generate a random 6-digit PIN */ function generateRandomPin() {
  return String(Math.floor(Math.random() * 900000) + 100000);
}
/** Wait ms milliseconds */ function sleep(ms) {
  return new Promise((resolve)=>setTimeout(resolve, ms));
}
/** Format a date as YYYY-MM-DDTHH:00:00+00:00 (Igloohome required format) */ function formatIgloohomeDate(isoString) {
  const date = new Date(isoString);
  const pad = (n)=>String(n).padStart(2, "0");
  const datePart = date.toISOString().split("T")[0];
  const hour = date.getUTCHours();
  return `${datePart}T${pad(hour)}:00:00+00:00`;
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
        "igloohomeapi/delete-pin-bridge-proxied-job",
        "igloohomeapi/get-devices",
        "igloohomeapi/get-job-status",
        "igloohomeapi/get-device-status-bridge-proxied-job"
      ].join(" ")
    })
  });
  const body = await readResponse(res);
  console.log("[generate-daily-pins] OAuth status:", res.status);
  if (!res.ok || !body.json?.access_token) {
    console.error("[generate-daily-pins] OAuth failed:", body.text);
    return null;
  }
  return body.json.access_token;
}
/** Check if the lock is reachable via the bridge */ async function isLockOnline(accessToken, lockId) {
  const res = await fetch(`${IGLOOHOME_API_BASE_URL}/devices`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json"
    }
  });
  const body = await readResponse(res);
  if (!res.ok || !body.json?.payload) {
    console.error("[generate-daily-pins] Failed to list devices:", body.text);
    return false;
  }
  const lock = body.json.payload.find((d)=>d.deviceId === lockId);
  if (!lock) {
    console.log(`[generate-daily-pins] Lock ${lockId} not found in device list`);
    return false;
  }
  // Bridge must exist and be paired to the lock (has linkedDevices)
  const bridge = body.json.payload.find((d)=>d.type === "Bridge" && d.linkedDevices?.length > 0);
  const online = !!bridge;
  console.log(`[generate-daily-pins] Lock reachable via bridge: ${online}`);
  return online;
}
async function createBridgeProxiedPin(accessToken, lockId, pin, startDate, endDate, accessName) {
  // Primary endpoint — igloodeveloper.co jobs API
  const primaryUrl = `${IGLOOHOME_API_BASE_URL}/devices/${lockId}/jobs`;
  const primaryPayload = {
    jobType: 4,
    jobData: {
      accessName,
      pin,
      pinType: 4,
      startDate,
      endDate
    }
  };
  // Fallback endpoint — v1 bridge proxied job API
  const fallbackUrl = `https://api.igloodeveloper.co/v1/locks/${lockId}/bridge/proxied-job`;
  const fallbackPayload = {
    jobType: "CREATE_PIN_DURATION",
    jobData: {
      accessName,
      pin,
      startDate,
      endDate
    }
  };
  // Try primary first
  console.log("[generate-daily-pins] Trying primary endpoint:", {
    url: primaryUrl,
    payload: primaryPayload
  });
  const primaryRes = await fetch(primaryUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify(primaryPayload)
  });
  const primaryBody = await readResponse(primaryRes);
  console.log("[generate-daily-pins] Primary endpoint response:", {
    status: primaryRes.status,
    body: primaryBody.json
  });
  if (primaryRes.ok || primaryRes.status === 201) {
    const pinId = primaryBody.json?.pinId || primaryBody.json?.jobId || primaryBody.json?.id || primaryBody.json?.data?.pinId || primaryBody.json?.data?.id || "";
    return {
      success: true,
      pinId
    };
  }
  // Primary failed — try fallback
  console.warn(`[generate-daily-pins] Primary endpoint failed (${primaryRes.status}), trying fallback...`);
  const fallbackRes = await fetch(fallbackUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify(fallbackPayload)
  });
  const fallbackBody = await readResponse(fallbackRes);
  console.log("[generate-daily-pins] Fallback endpoint response:", {
    status: fallbackRes.status,
    body: fallbackBody.json
  });
  if (!fallbackRes.ok && fallbackRes.status !== 201) {
    return {
      success: false,
      error: `Both endpoints failed. Primary: ${primaryRes.status}, Fallback: ${fallbackRes.status}`,
      rawResponse: {
        primary: primaryBody.json,
        fallback: fallbackBody.json
      }
    };
  }
  const pinId = fallbackBody.json?.pinId || fallbackBody.json?.jobId || fallbackBody.json?.id || fallbackBody.json?.data?.pinId || fallbackBody.json?.data?.id || "";
  return {
    success: true,
    pinId
  };
}
function isTrailerRental(booking) {
  const planName = booking.plan?.name ?? booking.service_name ?? "";
  const serviceType = booking.plan?.service_type ?? booking.service_type ?? "";
  return serviceType === "trailer_rental" || planName.toLowerCase().includes("dump loader") || planName.toLowerCase().includes("trailer");
}
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  try {
    console.log("[generate-daily-pins] Cron job started:", new Date().toISOString());
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const clientId = Deno.env.get("IGLOOHOME_CLIENT_ID");
    const clientSecret = Deno.env.get("IGLOOHOME_CLIENT_SECRET");
    const lockId = Deno.env.get("IGLOOHOME_LOCK_ID") || Deno.env.get("IGLOOHOME_DEVICE_ID");
    if (!supabaseUrl || !serviceRoleKey || !clientId || !clientSecret || !lockId) {
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
    // Find ALL confirmed trailer bookings from today onward
    // where pin_generated_at is null (PIN not yet generated)
    // ----------------------------------------------------------------
    const today = new Date().toISOString().split("T")[0];
    const { data: bookings, error: fetchError } = await supabase.from("bookings").select("*").eq("status", "Confirmed").is("pin_generated_at", null).gte("drop_off_date", today).order("drop_off_date", {
      ascending: true
    });
    if (fetchError) {
      console.error("[generate-daily-pins] Failed to fetch bookings:", fetchError);
      return jsonResponse({
        success: false,
        error: fetchError.message
      }, 500);
    }
    if (!bookings || bookings.length === 0) {
      console.log("[generate-daily-pins] No bookings need PIN generation.");
      return jsonResponse({
        success: true,
        message: "No bookings to process",
        processed: 0
      });
    }
    // Filter to trailer rentals only
    const trailerBookings = bookings.filter(isTrailerRental);
    console.log(`[generate-daily-pins] Found ${trailerBookings.length} trailer bookings needing PINs`);
    if (trailerBookings.length === 0) {
      return jsonResponse({
        success: true,
        message: "No trailer bookings to process",
        processed: 0
      });
    }
    // ----------------------------------------------------------------
    // Get OAuth token once — reuse for all bookings
    // ----------------------------------------------------------------
    const accessToken = await getOAuthToken(clientId, clientSecret);
    if (!accessToken) {
      return jsonResponse({
        success: false,
        error: "Failed to get OAuth token"
      }, 500);
    }
    // ----------------------------------------------------------------
    // Check lock is reachable via bridge before processing any bookings
    // ----------------------------------------------------------------
    const lockOnline = await isLockOnline(accessToken, lockId);
    if (!lockOnline) {
      console.warn("[generate-daily-pins] Lock not reachable via bridge — will retry next hourly run.");
      return jsonResponse({
        success: false,
        lockOnline: false,
        message: "Lock is not reachable via bridge. Will retry on next hourly run when lock is back in range.",
        pendingBookings: trailerBookings.map((b)=>b.id)
      });
    }
    // ----------------------------------------------------------------
    // Process each booking
    // Bridge handles ~2 jobs/minute — wait 15s between requests
    // ----------------------------------------------------------------
    const results = [];
    const now = new Date().toISOString();
    for(let i = 0; i < trailerBookings.length; i++){
      const booking = trailerBookings[i];
      // Throttle — wait 15s between PIN requests (not before the first)
      if (i > 0) {
        console.log("[generate-daily-pins] Waiting 15s before next PIN request...");
        await sleep(15000);
      }
      console.log(`[generate-daily-pins] Processing booking #${booking.id} (${i + 1}/${trailerBookings.length})`);
      try {
        const pin = generateRandomPin();
        const startDate = formatIgloohomeDate(`${booking.drop_off_date}T00:00:00Z`);
        const endDate = `${booking.pickup_date}T23:59:00+00:00`;
        const accessName = `Dump Loader Rental - Order #${booking.id}`;
        const pinResult = await createBridgeProxiedPin(accessToken, lockId, pin, startDate, endDate, accessName);
        if (!pinResult.success) {
          console.error(`[generate-daily-pins] PIN generation failed for booking #${booking.id}:`, pinResult.error);
          results.push({
            bookingId: booking.id,
            success: false,
            error: pinResult.error,
            rawResponse: pinResult.rawResponse
          });
          continue;
        }
        // ----------------------------------------------------------------
        // Update bookings — mark PIN as generated
        // PIN itself lives only in rental_access_codes
        // ----------------------------------------------------------------
        const { error: bookingUpdateError } = await supabase.from("bookings").update({
          pin_generated_at: now
        }).eq("id", booking.id);
        if (bookingUpdateError) {
          console.error(`[generate-daily-pins] Failed to update booking #${booking.id}:`, bookingUpdateError.message);
          results.push({
            bookingId: booking.id,
            success: false,
            error: bookingUpdateError.message
          });
          continue;
        }
        // ----------------------------------------------------------------
        // Insert into rental_access_codes — single source of truth for PIN
        // ----------------------------------------------------------------
        const { error: insertError } = await supabase.from("rental_access_codes").insert({
          order_id: booking.id,
          customer_email: booking.email,
          customer_phone: booking.phone || "",
          access_pin: pin,
          pin_id: pinResult.pinId || "",
          pin_type: "bridge_proxied",
          lock_id: lockId,
          start_time: `${booking.drop_off_date}T00:00:00Z`,
          end_time: `${booking.pickup_date}T23:59:59Z`,
          status: "active"
        });
        if (insertError) {
          // Non-fatal — PIN was already pushed to the lock
          console.error(`[generate-daily-pins] rental_access_codes insert failed for booking #${booking.id}:`, insertError.message);
        }
        // ----------------------------------------------------------------
        // Send PIN notification email to customer
        // ----------------------------------------------------------------
        const { error: emailError } = await supabase.functions.invoke("send-pin-notification", {
          body: {
            bookingId: booking.id,
            pin,
            dropOffDate: booking.drop_off_date,
            pickupDate: booking.pickup_date
          }
        });
        if (emailError) {
          console.error(`[generate-daily-pins] PIN notification failed for booking #${booking.id}:`, emailError);
        } else {
          await supabase.from("bookings").update({
            pin_notification_sent_at: now
          }).eq("id", booking.id);
          console.log(`[generate-daily-pins] ✓ PIN notification sent for booking #${booking.id}`);
        }
        console.log(`[generate-daily-pins] ✓ Booking #${booking.id} complete`);
        results.push({
          bookingId: booking.id,
          success: true
        });
      } catch (err) {
        console.error(`[generate-daily-pins] Unexpected error for booking #${booking.id}:`, err);
        results.push({
          bookingId: booking.id,
          success: false,
          error: String(err)
        });
      }
    }
    const successCount = results.filter((r)=>r.success).length;
    console.log(`[generate-daily-pins] Done. ${successCount}/${trailerBookings.length} processed successfully.`);
    return jsonResponse({
      success: true,
      lockOnline: true,
      processed: trailerBookings.length,
      succeeded: successCount,
      failed: trailerBookings.length - successCount,
      results
    });
  } catch (error) {
    console.error("[generate-daily-pins] Unhandled exception:", error);
    return jsonResponse({
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }, 500);
  }
});
