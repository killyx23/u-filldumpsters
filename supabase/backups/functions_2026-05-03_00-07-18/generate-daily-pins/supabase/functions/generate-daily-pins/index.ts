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
function sleep(ms) {
  return new Promise((resolve)=>setTimeout(resolve, ms));
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
        "igloohomeapi/delete-pin-bridge-proxied-job",
        "igloohomeapi/get-devices",
        "igloohomeapi/get-job-status",
        "igloohomeapi/get-device-status-bridge-proxied-job",
        "igloohomeapi/algopin-onetime"
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
  const online = !!bridge;
  console.log(`[generate-daily-pins] Lock reachable via bridge: ${online}`);
  return online;
}
async function deletePinFromLock(accessToken, lockId, bridgeId, pin) {
  const res = await fetch(`${IGLOOHOME_API_BASE_URL}/devices/${lockId}/jobs/bridges/${bridgeId}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({
      jobType: 5,
      jobData: {
        pin
      }
    })
  });
  const body = await readResponse(res);
  console.log("[generate-daily-pins] Delete PIN response:", {
    status: res.status,
    body: body.json
  });
  if (!res.ok && res.status !== 201) {
    return {
      success: false,
      error: `Delete failed with status ${res.status}`
    };
  }
  return {
    success: true
  };
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
  console.log("[generate-daily-pins] Creating bridge PIN:", {
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
  console.log("[generate-daily-pins] Bridge PIN response:", {
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
    console.log(`[generate-daily-pins] ✓ Bridge PIN succeeded for order #${orderId}`);
    return {
      success: true,
      pin: randomPin,
      pinId: bridgeResult.pinId,
      pinType: "bridge_proxied"
    };
  }
  console.warn(`[generate-daily-pins] Bridge failed for order #${orderId}, trying AlgoPIN. Error: ${bridgeResult.error}`);
  const algoResult = await createAlgoPin(accessToken, lockId, dropOffDate, pickupDate, orderId);
  if (algoResult.success) {
    console.log(`[generate-daily-pins] ✓ AlgoPIN succeeded for order #${orderId}`);
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
function isTrailerRental(booking) {
  const planName = booking.plan?.name ?? booking.service_name ?? "";
  const serviceType = booking.plan?.service_type ?? booking.service_type ?? "";
  return serviceType === "trailer_rental" || planName.toLowerCase().includes("dump loader") || planName.toLowerCase().includes("trailer");
}
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") return new Response(null, {
    headers: corsHeaders
  });
  try {
    console.log("[generate-daily-pins] Cron started:", new Date().toISOString());
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
    const accessToken = await getOAuthToken(clientId, clientSecret);
    if (!accessToken) return jsonResponse({
      success: false,
      error: "Failed to get OAuth token"
    }, 500);
    const now = new Date().toISOString();
    const today = new Date().toISOString().split("T")[0];
    let jobIndex = 0;
    // ================================================================
    // PHASE 1: DELETE PINs for cancelled / pending_review bookings
    // ================================================================
    console.log("[generate-daily-pins] === PHASE 1: DELETIONS ===");
    const { data: pinsToDelete, error: deleteQueryError } = await supabase.from("rental_access_codes").select("id, order_id, access_pin, bookings!inner(id, status)").eq("status", "active").in("bookings.status", [
      "Cancelled",
      "pending_review"
    ]);
    if (deleteQueryError) {
      console.error("[generate-daily-pins] Failed to query PINs to delete:", deleteQueryError.message);
    }
    const deleteResults = [];
    for (const record of pinsToDelete ?? []){
      if (jobIndex > 0) {
        console.log("[generate-daily-pins] Waiting 15s...");
        await sleep(15000);
      }
      jobIndex++;
      try {
        const result = await deletePinFromLock(accessToken, lockId, bridgeId, record.access_pin);
        if (!result.success) {
          console.error(`[generate-daily-pins] Delete failed for booking #${record.order_id}:`, result.error);
          deleteResults.push({
            bookingId: record.order_id,
            success: false,
            error: result.error
          });
          continue;
        }
        await supabase.from("rental_access_codes").update({
          status: "expired",
          notified_at: now
        }).eq("id", record.id);
        console.log(`[generate-daily-pins] ✓ PIN deleted for booking #${record.order_id}`);
        deleteResults.push({
          bookingId: record.order_id,
          success: true
        });
      } catch (err) {
        deleteResults.push({
          bookingId: record.order_id,
          success: false,
          error: String(err)
        });
      }
    }
    if (deleteResults.length === 0) console.log("[generate-daily-pins] No PINs to delete.");
    // ================================================================
    // PHASE 2: GENERATE PINs for confirmed bookings without a PIN
    // ================================================================
    console.log("[generate-daily-pins] === PHASE 2: GENERATION ===");
    const lockOnline = await isLockOnline(accessToken, lockId);
    if (!lockOnline) {
      console.warn("[generate-daily-pins] Lock offline — AlgoPIN fallback will apply.");
    }
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
    console.log(`[generate-daily-pins] Found ${trailerBookings.length} bookings needing PINs`);
    const generateResults = [];
    for (const booking of trailerBookings){
      // Guard: skip if an active PIN already exists (belt-and-suspenders vs unique constraint)
      const { data: existingPin } = await supabase.from("rental_access_codes").select("id").eq("order_id", booking.id).eq("status", "active").single();
      if (existingPin) {
        console.log(`[generate-daily-pins] Skipping booking #${booking.id} — active PIN already exists`);
        continue;
      }
      if (jobIndex > 0) {
        console.log("[generate-daily-pins] Waiting 15s...");
        await sleep(15000);
      }
      jobIndex++;
      console.log(`[generate-daily-pins] Processing booking #${booking.id}`);
      try {
        const pinResult = await generatePinWithFallback(accessToken, lockId, bridgeId, booking.drop_off_date, booking.pickup_date, booking.id);
        if (!pinResult.success) {
          console.error(`[generate-daily-pins] PIN generation failed for booking #${booking.id}:`, pinResult.error);
          generateResults.push({
            bookingId: booking.id,
            success: false,
            error: pinResult.error
          });
          continue;
        }
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
        const { error: insertError } = await supabase.from("rental_access_codes").insert({
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
        if (insertError) {
          console.error(`[generate-daily-pins] DB insert failed for booking #${booking.id}:`, insertError.message);
        }
        // TODO: uncomment when send-pin-notification is deployed
        // const { error: emailError } = await supabase.functions.invoke("send-pin-notification", {
        //   body: { bookingId: booking.id, pin: pinResult.pin, dropOffDate: booking.drop_off_date, pickupDate: booking.pickup_date },
        // });
        // if (emailError) {
        //   console.error(`[generate-daily-pins] PIN notification failed for booking #${booking.id}:`, emailError);
        // } else {
        //   await supabase.from("bookings").update({ pin_notification_sent_at: now }).eq("id", booking.id);
        // }
        console.log(`[generate-daily-pins] ✓ Booking #${booking.id} complete (${pinResult.pinType})`);
        generateResults.push({
          bookingId: booking.id,
          success: true,
          pinType: pinResult.pinType
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
    const deletedCount = deleteResults.filter((r)=>r.success).length;
    const generatedCount = generateResults.filter((r)=>r.success).length;
    console.log(`[generate-daily-pins] Done. Deleted: ${deletedCount}/${deleteResults.length} | Generated: ${generatedCount}/${trailerBookings.length}`);
    return jsonResponse({
      success: true,
      lockOnline,
      deleted: {
        processed: deleteResults.length,
        succeeded: deletedCount,
        results: deleteResults
      },
      generated: {
        processed: trailerBookings.length,
        succeeded: generatedCount,
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
