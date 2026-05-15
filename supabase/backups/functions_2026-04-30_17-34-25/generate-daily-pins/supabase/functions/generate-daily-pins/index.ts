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
/**
 * Build the startDate for Igloohome.
 * - If drop_off_date is today: use current time + 5 min buffer (can't send past times)
 * - If drop_off_date is in the future: use midnight of that day
 */ function buildStartDate(dropOffDate) {
  const today = new Date().toISOString().split("T")[0];
  const pad = (n)=>String(n).padStart(2, "0");
  if (dropOffDate === today) {
    // Use now + 5 minutes so the time is never in the past by the time Igloohome validates it
    const now = new Date(Date.now() + 5 * 60 * 1000);
    const datePart = now.toISOString().split("T")[0];
    const hour = now.getUTCHours();
    const minute = now.getUTCMinutes();
    return `${datePart}T${pad(hour)}:${pad(minute)}:00+00:00`;
  } else {
    // Future date — midnight is fine
    return `${dropOffDate}T00:00:00+00:00`;
  }
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
  const bridge = body.json.payload.find((d)=>d.type === "Bridge" && d.linkedDevices?.length > 0);
  const online = !!bridge;
  console.log(`[generate-daily-pins] Lock reachable via bridge: ${online}`);
  return online;
}
/** Create a duration PIN on the lock via bridge */ async function createBridgeProxiedPin(accessToken, lockId, bridgeId, pin, startDate, endDate, accessName) {
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
  console.log("[generate-daily-pins] Creating bridge proxied PIN:", {
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
  console.log("[generate-daily-pins] Create PIN response:", {
    status: res.status,
    body: body.json
  });
  if (!res.ok && res.status !== 201) {
    return {
      success: false,
      error: `Create PIN failed with status ${res.status}`,
      rawResponse: body.json
    };
  }
  const pinId = body.json?.jobId || body.json?.pinId || body.json?.id || body.json?.data?.jobId || "";
  return {
    success: true,
    pinId
  };
}
/** Delete a PIN from the lock via bridge */ async function deleteBridgeProxiedPin(accessToken, lockId, bridgeId, pin) {
  const url = `${IGLOOHOME_API_BASE_URL}/devices/${lockId}/jobs/bridges/${bridgeId}`;
  const payload = {
    jobType: 5,
    jobData: {
      pin
    }
  };
  console.log("[generate-daily-pins] Deleting PIN from lock:", {
    url,
    pin
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
  console.log("[generate-daily-pins] Delete PIN response:", {
    status: res.status,
    body: body.json
  });
  if (!res.ok && res.status !== 201) {
    return {
      success: false,
      error: `Delete PIN failed with status ${res.status}`,
      rawResponse: body.json
    };
  }
  return {
    success: true
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
    // Get OAuth token once — reuse for all operations
    // ----------------------------------------------------------------
    const accessToken = await getOAuthToken(clientId, clientSecret);
    if (!accessToken) {
      return jsonResponse({
        success: false,
        error: "Failed to get OAuth token"
      }, 500);
    }
    // ----------------------------------------------------------------
    // Check lock is reachable via bridge before doing anything
    // ----------------------------------------------------------------
    const lockOnline = await isLockOnline(accessToken, lockId);
    if (!lockOnline) {
      console.warn("[generate-daily-pins] Lock not reachable via bridge — will retry next hourly run.");
      return jsonResponse({
        success: false,
        lockOnline: false,
        message: "Lock is not reachable via bridge. Will retry on next hourly run when lock is back in range."
      });
    }
    const now = new Date().toISOString();
    const today = new Date().toISOString().split("T")[0];
    let jobIndex = 0; // global counter for 15s throttle across both delete and generate
    // ================================================================
    // PHASE 1: DELETE PINs for cancelled / pending_review bookings
    // ================================================================
    console.log("[generate-daily-pins] === PHASE 1: PIN DELETIONS ===");
    // Find active PINs in rental_access_codes for bookings that are
    // now cancelled or pending_review
    const { data: pinsToDelete, error: deleteQueryError } = await supabase.from("rental_access_codes").select("id, order_id, access_pin, bookings!inner(id, status)").eq("status", "active").in("bookings.status", [
      "Cancelled",
      "pending_review"
    ]);
    if (deleteQueryError) {
      console.error("[generate-daily-pins] Failed to query PINs to delete:", deleteQueryError.message);
    }
    const deleteResults = [];
    if (pinsToDelete && pinsToDelete.length > 0) {
      console.log(`[generate-daily-pins] Found ${pinsToDelete.length} PINs to delete`);
      for (const record of pinsToDelete){
        // Throttle — 15s between all bridge jobs (shared with generation below)
        if (jobIndex > 0) {
          console.log("[generate-daily-pins] Waiting 15s before next bridge job...");
          await sleep(15000);
        }
        jobIndex++;
        const bookingId = record.order_id;
        const pin = record.access_pin;
        console.log(`[generate-daily-pins] Deleting PIN for booking #${bookingId} (pin: ${pin})`);
        try {
          const deleteResult = await deleteBridgeProxiedPin(accessToken, lockId, bridgeId, pin);
          if (!deleteResult.success) {
            console.error(`[generate-daily-pins] PIN deletion failed for booking #${bookingId}:`, deleteResult.error);
            deleteResults.push({
              bookingId,
              success: false,
              error: deleteResult.error,
              rawResponse: deleteResult.rawResponse
            });
            continue;
          }
          // Mark PIN as expired in rental_access_codes
          const { error: expireError } = await supabase.from("rental_access_codes").update({
            status: "expired",
            notified_at: now
          }).eq("id", record.id);
          if (expireError) {
            console.error(`[generate-daily-pins] Failed to expire PIN record for booking #${bookingId}:`, expireError.message);
          }
          console.log(`[generate-daily-pins] ✓ PIN deleted for booking #${bookingId}`);
          deleteResults.push({
            bookingId,
            success: true
          });
        } catch (err) {
          console.error(`[generate-daily-pins] Unexpected error deleting PIN for booking #${bookingId}:`, err);
          deleteResults.push({
            bookingId,
            success: false,
            error: String(err)
          });
        }
      }
    } else {
      console.log("[generate-daily-pins] No PINs to delete.");
    }
    // ================================================================
    // PHASE 2: GENERATE PINs for confirmed bookings without a PIN
    // ================================================================
    console.log("[generate-daily-pins] === PHASE 2: PIN GENERATION ===");
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
    const trailerBookings = (bookings ?? []).filter(isTrailerRental);
    console.log(`[generate-daily-pins] Found ${trailerBookings.length} trailer bookings needing PINs`);
    const generateResults = [];
    for (const booking of trailerBookings){
      // Throttle — shared counter with deletions above
      if (jobIndex > 0) {
        console.log("[generate-daily-pins] Waiting 15s before next bridge job...");
        await sleep(15000);
      }
      jobIndex++;
      console.log(`[generate-daily-pins] Processing booking #${booking.id}`);
      try {
        const pin = generateRandomPin();
        const startDate = buildStartDate(booking.drop_off_date);
        const endDate = `${booking.pickup_date}T23:59:00+00:00`;
        const accessName = `Dump Loader Rental - Order #${booking.id}`;
        const pinResult = await createBridgeProxiedPin(accessToken, lockId, bridgeId, pin, startDate, endDate, accessName);
        if (!pinResult.success) {
          console.error(`[generate-daily-pins] PIN generation failed for booking #${booking.id}:`, pinResult.error);
          generateResults.push({
            bookingId: booking.id,
            success: false,
            error: pinResult.error,
            rawResponse: pinResult.rawResponse
          });
          continue;
        }
        // Mark booking as having a PIN generated
        const { error: bookingUpdateError } = await supabase.from("bookings").update({
          pin_generated_at: now
        }).eq("id", booking.id);
        if (bookingUpdateError) {
          console.error(`[generate-daily-pins] Failed to update booking #${booking.id}:`, bookingUpdateError.message);
          generateResults.push({
            bookingId: booking.id,
            success: false,
            error: bookingUpdateError.message
          });
          continue;
        }
        // Insert into rental_access_codes — single source of truth for PIN
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
          console.error(`[generate-daily-pins] rental_access_codes insert failed for booking #${booking.id}:`, insertError.message);
        }
        // ----------------------------------------------------------------
        // EMAIL DISABLED — TEST MODE
        // To enable: uncomment the block below and remove the two test logs
        // ----------------------------------------------------------------
        console.log(`[generate-daily-pins] *** TEST MODE — email suppressed ***`);
        console.log(`[generate-daily-pins] Would send PIN email:`, {
          to: booking.email,
          bookingId: booking.id,
          pin,
          pinId: pinResult.pinId,
          dropOffDate: booking.drop_off_date,
          pickupDate: booking.pickup_date,
          startDate,
          endDate
        });
        // const { error: emailError } = await supabase.functions.invoke(
        //   "send-pin-notification",
        //   {
        //     body: {
        //       bookingId: booking.id,
        //       pin,
        //       dropOffDate: booking.drop_off_date,
        //       pickupDate: booking.pickup_date,
        //     },
        //   },
        // );
        // if (emailError) {
        //   console.error(
        //     `[generate-daily-pins] PIN notification failed for booking #${booking.id}:`,
        //     emailError,
        //   );
        // } else {
        //   await supabase
        //     .from("bookings")
        //     .update({ pin_notification_sent_at: now })
        //     .eq("id", booking.id);
        //   console.log(`[generate-daily-pins] ✓ PIN notification sent for booking #${booking.id}`);
        // }
        console.log(`[generate-daily-pins] ✓ Booking #${booking.id} complete`);
        generateResults.push({
          bookingId: booking.id,
          success: true,
          pin,
          pinId: pinResult.pinId
        });
      } catch (err) {
        console.error(`[generate-daily-pins] Unexpected error for booking #${booking.id}:`, err);
        generateResults.push({
          bookingId: booking.id,
          success: false,
          error: String(err)
        });
      }
    }
    // ================================================================
    // Summary
    // ================================================================
    const deleteSuccessCount = deleteResults.filter((r)=>r.success).length;
    const generateSuccessCount = generateResults.filter((r)=>r.success).length;
    console.log(`[generate-daily-pins] Done. Deletions: ${deleteSuccessCount}/${deleteResults.length} | Generations: ${generateSuccessCount}/${trailerBookings.length}`);
    return jsonResponse({
      success: true,
      lockOnline: true,
      testMode: true,
      deletions: {
        processed: deleteResults.length,
        succeeded: deleteSuccessCount,
        failed: deleteResults.length - deleteSuccessCount,
        results: deleteResults
      },
      generations: {
        processed: trailerBookings.length,
        succeeded: generateSuccessCount,
        failed: trailerBookings.length - generateSuccessCount,
        results: generateResults
      }
    });
  } catch (error) {
    console.error("[generate-daily-pins] Unhandled exception:", error);
    return jsonResponse({
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }, 500);
  }
});
