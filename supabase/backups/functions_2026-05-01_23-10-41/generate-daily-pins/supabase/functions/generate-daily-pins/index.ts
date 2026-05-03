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
 * - If drop_off_date is today: use current time + 5 min buffer
 * - If drop_off_date is in the future: use midnight of that day
 */ function buildStartDate(dropOffDate) {
  const today = new Date().toISOString().split("T")[0];
  const pad = (n)=>String(n).padStart(2, "0");
  if (dropOffDate === today) {
    const now = new Date(Date.now() + 5 * 60 * 1000);
    const datePart = now.toISOString().split("T")[0];
    const hour = now.getUTCHours();
    const minute = now.getUTCMinutes();
    return `${datePart}T${pad(hour)}:${pad(minute)}:00+00:00`;
  } else {
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
      // Scopes cover both bridge proxied jobs and algopin fallback
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
/** Create a duration PIN on the lock via bridge (primary method) */ async function createBridgeProxiedPin(accessToken, lockId, bridgeId, pin, startDate, endDate, accessName) {
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
  console.log("[generate-daily-pins] Bridge proxied PIN response:", {
    status: res.status,
    body: body.json
  });
  if (!res.ok && res.status !== 201) {
    return {
      success: false,
      error: `Bridge proxied PIN failed with status ${res.status}`,
      rawResponse: body.json
    };
  }
  const pinId = body.json?.jobId || body.json?.pinId || body.json?.id || body.json?.data?.jobId || "";
  return {
    success: true,
    pinId
  };
}
/**
 * AlgoPIN fallback — used when bridge is offline or bridge proxied PIN fails.
 * AlgoPINs are computed by the lock itself so they work without internet.
 * Deterministic: same device + same startDate hour + same variance = same PIN.
 * Use this as a last resort — the customer gets a working PIN but it may
 * not be unique if another booking shares the same start hour.
 */ async function createAlgoPin(accessToken, lockId, dropOffDate, pickupDate, orderId) {
  const url = `${IGLOOHOME_API_BASE_URL}/devices/${lockId}/algopin/onetime`;
  // startDate must be now or slightly in the future
  const startDate = buildStartDate(dropOffDate);
  // variance = number of days the PIN is valid (1–5, clamped)
  const startUnix = new Date(dropOffDate + "T00:00:00Z").getTime() / 1000;
  const endUnix = new Date(pickupDate + "T23:59:59Z").getTime() / 1000;
  const durationDays = Math.ceil((endUnix - startUnix) / 86400);
  const variance = Math.min(5, Math.max(1, durationDays));
  const payload = {
    accessName: `Dump Loader Rental - Order #${orderId} (AlgoPIN)`,
    startDate,
    variance
  };
  console.log("[generate-daily-pins] Creating AlgoPIN fallback:", {
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
  const pinId = body.json?.pinId || body.json?.id || body.json?.data?.pinId || "";
  if (!pin) {
    return {
      success: false,
      error: "AlgoPIN succeeded but no PIN value in response",
      rawResponse: body.json
    };
  }
  return {
    success: true,
    pin,
    pinId
  };
}
/**
 * Try bridge proxied PIN first.
 * If that fails, fall back to algopin.
 * Returns the PIN value and which method succeeded.
 */ async function generatePinWithFallback(accessToken, lockId, bridgeId, dropOffDate, pickupDate, orderId) {
  const startDate = buildStartDate(dropOffDate);
  const endDate = `${pickupDate}T23:59:00+00:00`;
  const accessName = `Dump Loader Rental - Order #${orderId}`;
  // --- Attempt 1: Bridge proxied custom PIN ---
  const randomPin = generateRandomPin();
  const bridgeResult = await createBridgeProxiedPin(accessToken, lockId, bridgeId, randomPin, startDate, endDate, accessName);
  if (bridgeResult.success) {
    console.log(`[generate-daily-pins] ✓ Bridge proxied PIN succeeded for order #${orderId}`);
    return {
      success: true,
      pin: randomPin,
      pinId: bridgeResult.pinId,
      pinType: "bridge_proxied"
    };
  }
  // --- Attempt 2: AlgoPIN fallback ---
  console.warn(`[generate-daily-pins] Bridge proxied PIN failed for order #${orderId} — trying AlgoPIN fallback. Error: ${bridgeResult.error}`);
  const algoResult = await createAlgoPin(accessToken, lockId, dropOffDate, pickupDate, orderId);
  if (algoResult.success) {
    console.log(`[generate-daily-pins] ✓ AlgoPIN fallback succeeded for order #${orderId}`);
    return {
      success: true,
      pin: algoResult.pin,
      pinId: algoResult.pinId,
      pinType: "algopin"
    };
  }
  // Both failed
  console.error(`[generate-daily-pins] Both PIN methods failed for order #${orderId}. Bridge: ${bridgeResult.error} | AlgoPIN: ${algoResult.error}`);
  return {
    success: false,
    error: `Bridge: ${bridgeResult.error} | AlgoPIN: ${algoResult.error}`
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
    console.log("[generate-daily-pins] Started:", new Date().toISOString());
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
    // Service role client — bypasses RLS, used for all DB operations
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
    // ----------------------------------------------------------------
    // Parse request body
    // ----------------------------------------------------------------
    let bookingId = null;
    let callerType = "cron";
    try {
      const body = await req.json();
      bookingId = body.bookingId ?? body.booking_id ?? null;
      callerType = body.callerType ?? "cron";
    } catch  {
    // Empty body is fine for cron calls
    }
    console.log("[generate-daily-pins] Caller:", callerType, "BookingId:", bookingId ?? "batch");
    // ----------------------------------------------------------------
    // Auth check for non-cron callers
    // ----------------------------------------------------------------
    if (callerType === "admin" || callerType === "customer") {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader) {
        return jsonResponse({
          success: false,
          error: "Missing Authorization header"
        }, 401);
      }
      const token = authHeader.replace("Bearer ", "");
      // Create a user-scoped client to verify the JWT
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
        // TODO: Replace with your actual admin check
        // e.g. check an admin_users table or user metadata role
        const { data: adminCheck } = await supabase.from("admin_users").select("id").eq("user_id", user.id).single();
        if (!adminCheck) {
          return jsonResponse({
            success: false,
            error: "Admin access required"
          }, 403);
        }
      }
      if (callerType === "customer") {
        if (!bookingId) {
          return jsonResponse({
            success: false,
            error: "bookingId is required for customer requests"
          }, 400);
        }
        // TODO: Replace with how your app links auth users to customers
        // If customers table has a supabase_user_id or auth_user_id column, use that
        // Example assumes customers.supabase_user_id = auth user UUID
        const { data: customer } = await supabase.from("customers").select("id").eq("supabase_user_id", user.id) // ← TODO: confirm column name
        .single();
        if (!customer) {
          return jsonResponse({
            success: false,
            error: "Customer not found"
          }, 403);
        }
        // Verify the booking belongs to this customer
        const { data: ownerCheck } = await supabase.from("bookings").select("id").eq("id", bookingId).eq("customer_id", customer.id).eq("status", "Confirmed").is("pin_generated_at", null).single();
        if (!ownerCheck) {
          return jsonResponse({
            success: false,
            error: "Booking not found, not confirmed, already has a PIN, or does not belong to you"
          }, 403);
        }
      }
    }
    // ----------------------------------------------------------------
    // Get OAuth token
    // ----------------------------------------------------------------
    const accessToken = await getOAuthToken(clientId, clientSecret);
    if (!accessToken) {
      return jsonResponse({
        success: false,
        error: "Failed to get OAuth token"
      }, 500);
    }
    const now = new Date().toISOString();
    const today = new Date().toISOString().split("T")[0];
    // ================================================================
    // ON-DEMAND MODE — single bookingId provided
    // ================================================================
    if (bookingId) {
      console.log(`[generate-daily-pins] On-demand mode for booking #${bookingId}`);
      const { data: booking, error: fetchError } = await supabase.from("bookings").select("*").eq("id", bookingId).single();
      if (fetchError || !booking) {
        return jsonResponse({
          success: false,
          error: "Booking not found"
        }, 404);
      }
      if (booking.status !== "Confirmed") {
        return jsonResponse({
          success: false,
          error: "Booking is not confirmed"
        }, 400);
      }
      if (booking.pin_generated_at) {
        return jsonResponse({
          success: false,
          error: "PIN already generated for this booking"
        }, 400);
      }
      if (!isTrailerRental(booking)) {
        return jsonResponse({
          success: false,
          error: "Booking is not a trailer rental"
        }, 400);
      }
      // Check lock online — but don't block for on-demand: algopin fallback works offline
      const lockOnline = await isLockOnline(accessToken, lockId);
      console.log(`[generate-daily-pins] Lock online: ${lockOnline} — will try bridge first, algopin if needed`);
      const pinResult = await generatePinWithFallback(accessToken, lockId, bridgeId, booking.drop_off_date, booking.pickup_date, booking.id);
      if (!pinResult.success) {
        return jsonResponse({
          success: false,
          error: `PIN generation failed: ${pinResult.error}`,
          bookingId
        }, 500);
      }
      // Update booking
      await supabase.from("bookings").update({
        pin_generated_at: now
      }).eq("id", bookingId);
      // Insert into rental_access_codes
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
      // Send PIN notification email
      const { error: emailError } = await supabase.functions.invoke("send-pin-notification", {
        body: {
          bookingId: booking.id,
          pin: pinResult.pin,
          dropOffDate: booking.drop_off_date,
          pickupDate: booking.pickup_date
        }
      });
      if (!emailError) {
        await supabase.from("bookings").update({
          pin_notification_sent_at: now
        }).eq("id", bookingId);
      }
      return jsonResponse({
        success: true,
        bookingId,
        pin: pinResult.pin,
        pinType: pinResult.pinType,
        pinId: pinResult.pinId,
        emailSent: !emailError,
        message: `PIN generated via ${pinResult.pinType}`
      });
    }
    // ================================================================
    // BATCH/CRON MODE — no bookingId, process all qualifying bookings
    // ================================================================
    console.log("[generate-daily-pins] Batch mode");
    // Check lock online for batch mode — if offline skip generation phase
    const lockOnline = await isLockOnline(accessToken, lockId);
    let jobIndex = 0;
    // ================================================================
    // PHASE 1: DELETE PINs for cancelled / pending_review bookings
    // ================================================================
    console.log("[generate-daily-pins] === PHASE 1: PIN DELETIONS ===");
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
        if (jobIndex > 0) {
          console.log("[generate-daily-pins] Waiting 15s before next bridge job...");
          await sleep(15000);
        }
        jobIndex++;
        const bookingIdForDelete = record.order_id;
        const pin = record.access_pin;
        console.log(`[generate-daily-pins] Deleting PIN for booking #${bookingIdForDelete} (pin: ${pin})`);
        try {
          const deleteResult = await deleteBridgeProxiedPin(accessToken, lockId, bridgeId, pin);
          if (!deleteResult.success) {
            console.error(`[generate-daily-pins] PIN deletion failed for booking #${bookingIdForDelete}:`, deleteResult.error);
            deleteResults.push({
              bookingId: bookingIdForDelete,
              success: false,
              error: deleteResult.error
            });
            continue;
          }
          await supabase.from("rental_access_codes").update({
            status: "expired",
            notified_at: now
          }).eq("id", record.id);
          console.log(`[generate-daily-pins] ✓ PIN deleted for booking #${bookingIdForDelete}`);
          deleteResults.push({
            bookingId: bookingIdForDelete,
            success: true
          });
        } catch (err) {
          console.error(`[generate-daily-pins] Error deleting PIN for booking #${bookingIdForDelete}:`, err);
          deleteResults.push({
            bookingId: bookingIdForDelete,
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
    if (!lockOnline) {
      console.warn("[generate-daily-pins] Lock not reachable via bridge — will use algopin fallback for generation.");
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
    console.log(`[generate-daily-pins] Found ${trailerBookings.length} trailer bookings needing PINs`);
    const generateResults = [];
    for (const booking of trailerBookings){
      if (jobIndex > 0) {
        console.log("[generate-daily-pins] Waiting 15s before next bridge job...");
        await sleep(15000);
      }
      jobIndex++;
      console.log(`[generate-daily-pins] Processing booking #${booking.id}`);
      try {
        const pinResult = await generatePinWithFallback(accessToken, lockId, bridgeId, booking.drop_off_date, booking.pickup_date, booking.id);
        if (!pinResult.success) {
          console.error(`[generate-daily-pins] Both PIN methods failed for booking #${booking.id}:`, pinResult.error);
          generateResults.push({
            bookingId: booking.id,
            success: false,
            error: pinResult.error
          });
          continue;
        }
        // Update booking
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
        // Insert into rental_access_codes
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
          console.error(`[generate-daily-pins] rental_access_codes insert failed for booking #${booking.id}:`, insertError.message);
        }
        // Send PIN notification email
        const { error: emailError } = await supabase.functions.invoke("send-pin-notification", {
          body: {
            bookingId: booking.id,
            pin: pinResult.pin,
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
    // ================================================================
    // Summary
    // ================================================================
    const deleteSuccessCount = deleteResults.filter((r)=>r.success).length;
    const generateSuccessCount = generateResults.filter((r)=>r.success).length;
    console.log(`[generate-daily-pins] Done. Deletions: ${deleteSuccessCount}/${deleteResults.length} | Generations: ${generateSuccessCount}/${trailerBookings.length}`);
    return jsonResponse({
      success: true,
      lockOnline,
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
