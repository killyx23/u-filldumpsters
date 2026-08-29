import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getCorsHeaders } from "./cors.ts";
import {
  addGraceHour,
  buildBookingDateUTC,
  getPinActivationStart,
  getPinWindowSkipReason,
  isWithinPinGenerationWindow,
} from "./pinTiming.ts";
import { ensurePinOnLock } from "./lockPin.ts";
import { getOAuthToken, GENERATE_PIN_SCOPES } from "./iglooAuth.ts";
const IGLOOHOME_API_BASE_URL = "https://api.igloodeveloper.co/igloohome";
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
function sleep(ms) {
  return new Promise((resolve)=>setTimeout(resolve, ms));
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
    console.warn(`[generate-daily-pins] Could not parse time slot: "${timeSlot}" — using fallback`);
  }
  return buildBookingDateUTC(date, timeSlot, fallbackHourUTC);
}

async function maybeSendPinNotification(supabase, booking, pin, startTime, endTime) {
  if (booking.pin_notification_sent_at) {
    console.log(`[generate-daily-pins] Skipping notification for booking #${booking.id} — already sent`);
    return;
  }
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
    console.error(`[generate-daily-pins] PIN notification failed for booking #${booking.id}:`, error.message);
    return;
  }
  const now = new Date().toISOString();
  await supabase.from("bookings").update({ pin_notification_sent_at: now }).eq("id", booking.id);
  await supabase.from("rental_access_codes").update({ notified_at: now }).eq("order_id", booking.id).eq("status", "active");
  console.log(`[generate-daily-pins] ✓ PIN notification sent for booking #${booking.id}`);
}
async function getOAuthTokenForPins(clientId, clientSecret) {
  const result = await getOAuthToken(clientId, clientSecret, GENERATE_PIN_SCOPES);
  console.log("[generate-daily-pins] OAuth:", result.token ? `ok (${result.scopesUsed})` : result.reason);
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
async function generatePinWithFallback(accessToken, lockId, bridgeId, supabase, booking) {
  const orderId = booking.id;
  const startDate = getPinActivationStart(booking);
  // PIN stays valid 1 hour past scheduled return so late returns still open the lock
  const endDate = addGraceHour(buildIgloohomeDate(booking.pickup_date, booking.pickup_time_slot, 5));
  console.log("[generate-daily-pins] PIN window:", { startDate, endDate });
  const accessName = `Dump Loader Rental - Order #${orderId}`;

  const bridgeResult = await ensurePinOnLock(supabase, accessToken, {
    orderId,
    lockId,
    bridgeId,
    startDate,
    endDate,
    accessName,
    clearBudgetMs: 40_000,
    createBudgetMs: 50_000,
  });

  if (bridgeResult.lockConfirmed || bridgeResult.jobId) {
    console.log(
      `[generate-daily-pins] Bridge PIN for order #${orderId}: state=${bridgeResult.createState} confirmed=${bridgeResult.lockConfirmed}`,
    );
    return {
      success: true,
      pin: bridgeResult.pin,
      pinId: bridgeResult.jobId,
      pinType: "bridge_proxied",
      startDate,
      endDate,
      lockConfirmed: bridgeResult.lockConfirmed,
    };
  }

  console.warn(`[generate-daily-pins] Bridge failed for order #${orderId}, trying AlgoPIN. Error: ${bridgeResult.error}`);
  const algoResult = await createAlgoPin(
    accessToken,
    lockId,
    booking.drop_off_date,
    booking.drop_off_time_slot,
    booking.pickup_date,
    orderId,
  );
  if (algoResult.success) {
    console.log(`[generate-daily-pins] ✓ AlgoPIN succeeded for order #${orderId}`);
    return {
      success: true,
      pin: algoResult.pin,
      pinId: algoResult.pinId,
      pinType: "algopin",
      startDate,
      endDate,
      lockConfirmed: true,
    };
  }
  return {
    success: false,
    error: `Bridge: ${bridgeResult.error} | AlgoPIN: ${algoResult.error}`,
    startDate,
    endDate,
  };
}
function isTrailerRental(booking) {
  const planName = booking.plan?.name ?? booking.service_name ?? "";
  const serviceType = booking.plan?.service_type ?? booking.service_type ?? "";
  return serviceType === "trailer_rental" || planName.toLowerCase().includes("dump loader") || planName.toLowerCase().includes("trailer");
}
Deno.serve(async (req)=>{
  const corsHeaders = getCorsHeaders(req);
  const jsonResponse = makeJsonResponse(corsHeaders);
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
    // ----------------------------------------------------------------
    // Auth — verify the caller is passing the service role key.
    // The pg_cron job passes it as a Bearer token.
    // ----------------------------------------------------------------
    const authHeader = req.headers.get("Authorization");
    const incomingKey = authHeader?.replace("Bearer ", "").trim();
    if (!incomingKey || incomingKey !== serviceRoleKey) {
      console.warn("[generate-daily-pins] Unauthorized request — invalid or missing service role key");
      return jsonResponse({
        success: false,
        error: "Unauthorized"
      }, 401);
    }
    console.log("[generate-daily-pins] Auth verified ✓");
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
    const accessToken = await getOAuthTokenForPins(clientId, clientSecret);
    if (!accessToken) {
      return jsonResponse({
        success: false,
        error: "Failed to get OAuth token"
      }, 500);
    }
    const now = new Date().toISOString();
    const today = new Date().toISOString().split("T")[0];
    let jobIndex = 0;
    // ================================================================
    // PHASE 1: DELETE PINs for cancelled / pending_review bookings
    //
    // Two cases handled:
    //
    // Case A — active PINs on cancelled/pending_review bookings.
    //   delete-pin hasn't been called yet, or booking was cancelled
    //   before delete-pin existed.
    //
    // Case B — expired PINs where lock_deleted_at is null.
    //   delete-pin already expired the DB row but the bridge was
    //   offline. We retry the lock deletion here until it succeeds.
    // ================================================================
    console.log("[generate-daily-pins] === PHASE 1: DELETIONS ===");
    // Case A: active PINs on cancelled/pending_review bookings
    const { data: activePinsToDelete, error: activeQueryError } = await supabase.from("rental_access_codes").select("id, order_id, access_pin, pin_type, bookings!inner(id, status)").eq("status", "active").in("bookings.status", [
      "Cancelled",
      "pending_review"
    ]);
    if (activeQueryError) {
      console.error("[generate-daily-pins] Failed to query active PINs to delete:", activeQueryError.message);
    }
    // Case B: expired PINs where lock deletion was not confirmed
    // (bridge was offline when delete-pin was called)
    const { data: pendingLockDeletes, error: pendingQueryError } = await supabase.from("rental_access_codes").select("id, order_id, access_pin, pin_type, bookings!inner(id, status)").eq("status", "expired").is("lock_deleted_at", null).in("bookings.status", [
      "Cancelled",
      "pending_review"
    ]);
    if (pendingQueryError) {
      console.error("[generate-daily-pins] Failed to query pending lock deletes:", pendingQueryError.message);
    }
    // Combine both cases — deduplicate by id just in case
    const allPinsToProcess = [
      ...activePinsToDelete ?? [],
      ...pendingLockDeletes ?? []
    ].filter((pin, index, self)=>self.findIndex((p)=>p.id === pin.id) === index);
    console.log(`[generate-daily-pins] Found ${activePinsToDelete?.length ?? 0} active + ${pendingLockDeletes?.length ?? 0} pending lock deletes = ${allPinsToProcess.length} total`);
    const deleteResults = [];
    for (const record of allPinsToProcess){
      if (jobIndex > 0) {
        console.log("[generate-daily-pins] Waiting 15s...");
        await sleep(15000);
      }
      jobIndex++;
      // AlgoPINs cannot be deleted from the lock remotely —
      // just ensure the DB row is expired and mark lock_deleted_at
      // to a sentinel value so we stop retrying
      if (record.pin_type === "algopin") {
        console.log(`[generate-daily-pins] Skipping lock delete for algopin on booking #${record.order_id} — will expire naturally`);
        await supabase.from("rental_access_codes").update({
          status: "expired",
          lock_deleted_at: now,
          notified_at: now
        }).eq("id", record.id);
        deleteResults.push({
          bookingId: record.order_id,
          success: true,
          method: "algopin_natural_expiry"
        });
        continue;
      }
      console.log(`[generate-daily-pins] Deleting PIN from lock for booking #${record.order_id} (pin: ${record.access_pin})`);
      try {
        const result = await deletePinFromLock(accessToken, lockId, bridgeId, record.access_pin);
        if (!result.success) {
          console.error(`[generate-daily-pins] Lock delete failed for booking #${record.order_id}:`, result.error);
          // Ensure DB is expired even if lock delete failed
          await supabase.from("rental_access_codes").update({
            status: "expired",
            notified_at: now
          }).eq("id", record.id);
          deleteResults.push({
            bookingId: record.order_id,
            success: false,
            error: result.error
          });
          continue;
        }
        // Lock delete confirmed — update both status and lock_deleted_at
        await supabase.from("rental_access_codes").update({
          status: "expired",
          lock_deleted_at: now,
          notified_at: now
        }).eq("id", record.id);
        console.log(`[generate-daily-pins] ✓ PIN fully deleted for booking #${record.order_id}`);
        deleteResults.push({
          bookingId: record.order_id,
          success: true,
          method: "bridge_deleted"
        });
      } catch (err) {
        console.error(`[generate-daily-pins] Error deleting PIN for booking #${record.order_id}:`, err);
        deleteResults.push({
          bookingId: record.order_id,
          success: false,
          error: String(err)
        });
      }
    }
    if (allPinsToProcess.length === 0) console.log("[generate-daily-pins] No PINs to delete.");
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
    const eligibleBookings = [];
    const skippedBookings = [];
    for (const booking of trailerBookings) {
      const skipReason = getPinWindowSkipReason(booking);
      if (skipReason) {
        skippedBookings.push({ bookingId: booking.id, reason: skipReason });
        console.log(`[generate-daily-pins] Skipping booking #${booking.id} — ${skipReason}`);
        continue;
      }
      if (!isWithinPinGenerationWindow(booking)) continue;
      eligibleBookings.push(booking);
    }
    console.log(`[generate-daily-pins] Found ${trailerBookings.length} trailer bookings, ${eligibleBookings.length} within 12h window, ${skippedBookings.length} skipped`);
    const generateResults = [];
    for (const booking of eligibleBookings){
      // Skip only if an active PIN is already bridge-confirmed.
      const { data: existingPin } = await supabase
        .from("rental_access_codes")
        .select("id, lock_confirmed_at")
        .eq("order_id", booking.id)
        .eq("status", "active")
        .maybeSingle();
      if (existingPin?.lock_confirmed_at) {
        console.log(`[generate-daily-pins] Skipping booking #${booking.id} — confirmed PIN already exists`);
        continue;
      }
      if (jobIndex > 0) {
        console.log("[generate-daily-pins] Waiting 15s...");
        await sleep(15000);
      }
      jobIndex++;
      console.log(`[generate-daily-pins] Processing booking #${booking.id} | drop_off: ${booking.drop_off_date} ${booking.drop_off_time_slot} | pickup: ${booking.pickup_date} ${booking.pickup_time_slot}`);
      try {
        const pinResult = await generatePinWithFallback(accessToken, lockId, bridgeId, supabase, booking);
        if (!pinResult.success) {
          console.error(`[generate-daily-pins] PIN generation failed for booking #${booking.id}:`, pinResult.error);
          generateResults.push({
            bookingId: booking.id,
            success: false,
            error: pinResult.error
          });
          continue;
        }
        const startTimeUTC = pinResult.startDate;
        const endTimeUTC = pinResult.endDate;
        // Expire any previous active row for this order before insert.
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
          lock_deleted_at: null,
          lock_confirmed_at: pinResult.lockConfirmed ? now : null,
          confirm_attempts: pinResult.lockConfirmed ? 0 : 1,
        });
        if (insertError) {
          console.error(`[generate-daily-pins] DB insert failed for booking #${booking.id}:`, insertError.message);
          generateResults.push({
            bookingId: booking.id,
            success: false,
            error: insertError.message,
          });
          continue;
        }
        // Only mark generated after a successful insert so cron can retry on failure.
        const { error: bookingUpdateError } = await supabase.from("bookings").update({
          pin_generated_at: now
        }).eq("id", booking.id);
        if (bookingUpdateError) {
          console.error(`[generate-daily-pins] Failed to update booking #${booking.id}:`, bookingUpdateError.message);
        }
        if (pinResult.lockConfirmed) {
          await maybeSendPinNotification(supabase, booking, pinResult.pin, startTimeUTC, endTimeUTC);
        }
        console.log(`[generate-daily-pins] ✓ Booking #${booking.id} complete (${pinResult.pinType}) confirmed=${pinResult.lockConfirmed}`);
        generateResults.push({
          bookingId: booking.id,
          success: true,
          pinType: pinResult.pinType,
          lockConfirmed: !!pinResult.lockConfirmed,
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
    console.log(`[generate-daily-pins] Done. Deleted: ${deletedCount}/${allPinsToProcess.length} | Generated: ${generatedCount}/${eligibleBookings.length}`);
    return jsonResponse({
      success: true,
      lockOnline,
      deleted: {
        processed: allPinsToProcess.length,
        succeeded: deletedCount,
        results: deleteResults
      },
      generated: {
        processed: eligibleBookings.length,
        succeeded: generatedCount,
        skipped: skippedBookings,
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
