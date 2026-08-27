/**
 * reconcile-lock-pins
 *
 * Single service-role reconciler that replaces the old pair
 * (generate-daily-pins + ensure-lock-pin-ready). Runs every 5 minutes via
 * pg_cron and can also be invoked immediately by the igloohome webhook when
 * the bridge comes back online, to flush anything that got stuck while it
 * was offline.
 *
 * Phases (in order, all bounded by time budgets so we stay under the ~150s
 * gateway limit):
 *   1. DELETE   — remove PINs for cancelled/pending_review bookings, and
 *                 retry any lock deletion that didn't confirm last time.
 *   2. CREATE   — issue PINs for confirmed bookings that don't have one yet
 *                 (bridge_proxied first, AlgoPIN fallback if the bridge
 *                 rejects it or is offline).
 *   3. CONFIRM  — for PINs sent to the bridge but not yet confirmed, poll
 *                 the job once; if it completed, stamp lock_confirmed_at and
 *                 notify the customer. If it has been stuck too long or
 *                 pickup is imminent, escalate to an AlgoPIN and alert an
 *                 admin.
 *
 * Optional request body `{ focusOrderId }` narrows every phase to a single
 * booking — used by the webhook's bridge-reconnect handler for a fast,
 * targeted flush instead of a full sweep.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getCorsHeaders } from "./cors.ts";
import {
  addGraceHour,
  buildBookingDateUTC,
  getPinActivationStart,
  getPinWindowSkipReason,
  isWithinPinGenerationWindow,
} from "../_shared/pinTiming.ts";
import { ensurePinOnLock, pollJob } from "../_shared/lockPin.ts";
import { getOAuthToken, GENERATE_PIN_SCOPES } from "../_shared/iglooAuth.ts";
import { notifyPinReady } from "../_shared/pinNotify.ts";

const IGLOOHOME_API_BASE_URL = "https://api.igloodeveloper.co/igloohome";
const RETRY_BUDGET_MS = 15 * 60 * 1000;
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const ALERT_ATTEMPTS = 3;
const LOG = "[reconcile-lock-pins]";

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

function makeJsonResponse(corsHeaders: Record<string, string>) {
  return (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
}

async function readResponse(res: Response) {
  const text = await res.text();
  try {
    return { text, json: text ? JSON.parse(text) : null };
  } catch {
    return { text, json: null };
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTrailerRental(booking: Record<string, unknown>): boolean {
  const plan = (booking.plan as Record<string, unknown>) || {};
  const planName = String(plan.name ?? booking.service_name ?? "");
  const serviceType = String(plan.service_type ?? booking.service_type ?? "");
  const name = planName.toLowerCase();
  return (
    serviceType === "trailer_rental" ||
    Number(plan.id) === 2 ||
    Number(plan.id) === 5 ||
    name.includes("dump loader") ||
    name.includes("dump trailer") ||
    name.includes("trailer") ||
    plan.customer_pickup === true
  );
}

async function isLockOnline(accessToken: string, lockId: string): Promise<boolean> {
  const res = await fetch(`${IGLOOHOME_API_BASE_URL}/devices`, {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  const body = await readResponse(res);
  if (!res.ok || !body.json?.payload) return false;
  const bridge = body.json.payload.find(
    (d: Record<string, unknown>) => d.type === "Bridge" && (d.linkedDevices as unknown[])?.length > 0,
  );
  return !!bridge;
}

async function deletePinFromLock(accessToken: string, lockId: string, bridgeId: string, pin: string) {
  const res = await fetch(`${IGLOOHOME_API_BASE_URL}/devices/${lockId}/jobs/bridges/${bridgeId}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ jobType: 5, jobData: { pin } }),
  });
  const body = await readResponse(res);
  if (!res.ok && res.status !== 201) {
    return { success: false, error: `Delete failed with status ${res.status}` };
  }
  return { success: true };
}

async function createAlgoPin(
  accessToken: string,
  lockId: string,
  dropOffDate: string,
  dropOffTimeSlot: string | null | undefined,
  pickupDate: string,
  orderId: number,
  labelSuffix = "",
) {
  const startDate = buildBookingDateUTC(dropOffDate, dropOffTimeSlot, 12);
  const startDateHourOnly = startDate.replace(/T(\d{2}):\d{2}:00/, "T$1:00:00");
  const startUnix = new Date(startDateHourOnly).getTime() / 1000;
  const endUnix = new Date(pickupDate + "T23:59:59Z").getTime() / 1000;
  const variance = Math.min(5, Math.max(1, Math.ceil((endUnix - startUnix) / 86400)));
  const res = await fetch(`${IGLOOHOME_API_BASE_URL}/devices/${lockId}/algopin/onetime`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      accessName: `Dump Trailer Rental - Order #${orderId}${labelSuffix}`,
      startDate: startDateHourOnly,
      variance,
    }),
  });
  const body = await readResponse(res);
  if (!res.ok && res.status !== 201) {
    return { success: false, error: `AlgoPIN failed with status ${res.status}` };
  }
  const pin = body.json?.pin || body.json?.access_code || body.json?.code || body.json?.data?.pin || "";
  if (!pin) return { success: false, error: "AlgoPIN succeeded but no PIN value in response" };
  return {
    success: true,
    pin,
    pinId: body.json?.pinId || body.json?.id || "",
    startDate: startDateHourOnly,
  };
}

async function generatePinWithFallback(
  accessToken: string,
  lockId: string,
  bridgeId: string,
  supabase: SupabaseClient,
  booking: Record<string, unknown>,
) {
  const orderId = booking.id as number;
  const startDate = getPinActivationStart(booking as never);
  const endDate = addGraceHour(
    buildBookingDateUTC(String(booking.pickup_date ?? ""), booking.pickup_time_slot as string | null, 5),
  );
  const accessName = `Dump Trailer Rental - Order #${orderId}`;

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
    return {
      success: true,
      pin: bridgeResult.pin,
      pinId: bridgeResult.jobId,
      pinType: "bridge_proxied" as const,
      startDate,
      endDate,
      lockConfirmed: bridgeResult.lockConfirmed,
    };
  }

  console.warn(`${LOG} Bridge failed for order #${orderId}, trying AlgoPIN. Error: ${bridgeResult.error}`);
  const algoResult = await createAlgoPin(
    accessToken,
    lockId,
    String(booking.drop_off_date ?? ""),
    booking.drop_off_time_slot as string | null,
    String(booking.pickup_date ?? ""),
    orderId,
  );
  if (algoResult.success) {
    return {
      success: true,
      pin: algoResult.pin,
      pinId: algoResult.pinId,
      pinType: "algopin" as const,
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

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  const jsonResponse = makeJsonResponse(corsHeaders);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const clientId = Deno.env.get("IGLOOHOME_CLIENT_ID");
    const clientSecret = Deno.env.get("IGLOOHOME_CLIENT_SECRET");
    const lockId = Deno.env.get("IGLOOHOME_LOCK_ID") || Deno.env.get("IGLOOHOME_DEVICE_ID");
    const bridgeId = Deno.env.get("IGLOOHOME_BRIDGE_ID");
    if (!supabaseUrl || !serviceRoleKey || !clientId || !clientSecret || !lockId || !bridgeId) {
      return jsonResponse({ success: false, error: "Missing required environment variables" }, 500);
    }

    const authHeader = req.headers.get("Authorization");
    const incomingKey = authHeader?.replace("Bearer ", "").trim();
    if (!incomingKey || incomingKey !== serviceRoleKey) {
      console.warn(`${LOG} Unauthorized request — invalid or missing service role key`);
      return jsonResponse({ success: false, error: "Unauthorized" }, 401);
    }

    let requestBody: Record<string, unknown> = {};
    try {
      const text = await req.text();
      if (text) requestBody = JSON.parse(text);
    } catch {
      // ignore malformed/empty body — full sweep
    }
    const focusOrderId = requestBody.focusOrderId ? Number(requestBody.focusOrderId) : null;
    const reason = typeof requestBody.reason === "string" ? requestBody.reason : "cron";
    console.log(`${LOG} Started (reason=${reason}, focusOrderId=${focusOrderId ?? "none"})`);

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const oauthResult = await getOAuthToken(clientId, clientSecret, GENERATE_PIN_SCOPES);
    const accessToken = oauthResult.token;
    if (!accessToken) {
      return jsonResponse({ success: false, error: `Failed to get OAuth token: ${oauthResult.reason}` }, 500);
    }

    const now = new Date().toISOString();
    const nowMs = Date.now();
    const today = new Date().toISOString().split("T")[0];
    let jobIndex = 0;
    const pace = async () => {
      if (jobIndex > 0) {
        console.log(`${LOG} Waiting 15s before next bridge job...`);
        await sleep(15000);
      }
      jobIndex++;
    };

    // ================================================================
    // PHASE 1: DELETE PINs for cancelled / pending_review bookings
    // ================================================================
    console.log(`${LOG} === PHASE 1: DELETIONS ===`);
    let deleteQuery = supabase
      .from("rental_access_codes")
      .select("id, order_id, access_pin, pin_type, bookings!inner(id, status)")
      .eq("status", "active")
      .in("bookings.status", ["Cancelled", "pending_review"]);
    if (focusOrderId) deleteQuery = deleteQuery.eq("order_id", focusOrderId);
    const { data: activePinsToDelete } = await deleteQuery;

    let pendingQuery = supabase
      .from("rental_access_codes")
      .select("id, order_id, access_pin, pin_type, bookings!inner(id, status)")
      .eq("status", "expired")
      .is("lock_deleted_at", null)
      .in("bookings.status", ["Cancelled", "pending_review"]);
    if (focusOrderId) pendingQuery = pendingQuery.eq("order_id", focusOrderId);
    const { data: pendingLockDeletes } = await pendingQuery;

    const allPinsToProcess = [...(activePinsToDelete ?? []), ...(pendingLockDeletes ?? [])].filter(
      (pin, index, self) => self.findIndex((p) => p.id === pin.id) === index,
    );
    const deleteResults: Array<Record<string, unknown>> = [];
    for (const record of allPinsToProcess) {
      if (record.pin_type === "algopin") {
        await supabase
          .from("rental_access_codes")
          .update({ status: "expired", lock_deleted_at: now, notified_at: now })
          .eq("id", record.id);
        deleteResults.push({ bookingId: record.order_id, success: true, method: "algopin_natural_expiry" });
        continue;
      }
      await pace();
      try {
        const result = await deletePinFromLock(accessToken, lockId, bridgeId, record.access_pin);
        if (!result.success) {
          await supabase.from("rental_access_codes").update({ status: "expired", notified_at: now }).eq(
            "id",
            record.id,
          );
          deleteResults.push({ bookingId: record.order_id, success: false, error: result.error });
          continue;
        }
        await supabase
          .from("rental_access_codes")
          .update({ status: "expired", lock_deleted_at: now, notified_at: now })
          .eq("id", record.id);
        deleteResults.push({ bookingId: record.order_id, success: true, method: "bridge_deleted" });
      } catch (err) {
        deleteResults.push({ bookingId: record.order_id, success: false, error: String(err) });
      }
    }

    // ================================================================
    // PHASE 2: CREATE PINs for confirmed bookings without one yet
    // ================================================================
    console.log(`${LOG} === PHASE 2: GENERATION ===`);
    const lockOnline = await isLockOnline(accessToken, lockId);
    if (!lockOnline) console.warn(`${LOG} Lock offline — AlgoPIN fallback will apply.`);

    let bookingsQuery = supabase
      .from("bookings")
      .select("*")
      .eq("status", "Confirmed")
      .is("pin_generated_at", null)
      .gte("drop_off_date", today)
      .order("drop_off_date", { ascending: true });
    if (focusOrderId) bookingsQuery = bookingsQuery.eq("id", focusOrderId);
    const { data: bookings, error: fetchError } = await bookingsQuery;
    if (fetchError) {
      return jsonResponse({ success: false, error: fetchError.message }, 500);
    }

    const trailerBookings = (bookings ?? []).filter(isTrailerRental);
    const eligibleBookings: Record<string, unknown>[] = [];
    const skippedBookings: Array<Record<string, unknown>> = [];
    for (const booking of trailerBookings) {
      const skipReason = getPinWindowSkipReason(booking as never);
      if (skipReason) {
        skippedBookings.push({ bookingId: booking.id, reason: skipReason });
        continue;
      }
      if (!isWithinPinGenerationWindow(booking as never)) continue;
      eligibleBookings.push(booking);
    }

    const generateResults: Array<Record<string, unknown>> = [];
    for (const booking of eligibleBookings) {
      const { data: existingPin } = await supabase
        .from("rental_access_codes")
        .select("id, lock_confirmed_at")
        .eq("order_id", booking.id)
        .eq("status", "active")
        .maybeSingle();
      if (existingPin?.lock_confirmed_at) continue;

      await pace();
      try {
        const pinResult = await generatePinWithFallback(accessToken, lockId, bridgeId, supabase, booking);
        if (!pinResult.success) {
          generateResults.push({ bookingId: booking.id, success: false, error: pinResult.error });
          continue;
        }
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
          lock_deleted_at: null,
          lock_confirmed_at: pinResult.lockConfirmed ? now : null,
          confirm_attempts: pinResult.lockConfirmed ? 0 : 1,
        });
        if (insertError) {
          generateResults.push({ bookingId: booking.id, success: false, error: insertError.message });
          continue;
        }
        await supabase.from("bookings").update({ pin_generated_at: now }).eq("id", booking.id);
        if (pinResult.lockConfirmed) {
          await notifyPinReady(supabase, booking, pinResult.pin, startTimeUTC, endTimeUTC);
        }
        generateResults.push({
          bookingId: booking.id,
          success: true,
          pinType: pinResult.pinType,
          lockConfirmed: !!pinResult.lockConfirmed,
        });
      } catch (err) {
        generateResults.push({ bookingId: booking.id, success: false, error: String(err) });
      }
    }

    // ================================================================
    // PHASE 3: CONFIRM pending bridge jobs / escalate stuck ones
    // ================================================================
    console.log(`${LOG} === PHASE 3: CONFIRM / ESCALATE ===`);
    let unconfirmedQuery = supabase
      .from("bookings")
      .select("*")
      .eq("status", "Confirmed")
      .gte("drop_off_date", today)
      .not("pin_generated_at", "is", null);
    if (focusOrderId) unconfirmedQuery = unconfirmedQuery.eq("id", focusOrderId);
    const { data: activeBookings } = await unconfirmedQuery;

    const confirmResults: Array<Record<string, unknown>> = [];
    for (const booking of activeBookings ?? []) {
      if (!isTrailerRental(booking)) continue;
      const orderId = Number(booking.id);
      const { data: activePin } = await supabase
        .from("rental_access_codes")
        .select("*")
        .eq("order_id", orderId)
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!activePin) continue;

      if (activePin.lock_confirmed_at) {
        if (!booking.pin_notification_sent_at) {
          await notifyPinReady(
            supabase,
            booking,
            String(activePin.access_pin),
            String(activePin.start_time || ""),
            String(activePin.end_time || ""),
          );
        }
        continue;
      }

      if (activePin.pin_id && activePin.pin_type === "bridge_proxied") {
        const poll = await pollJob(accessToken, activePin.pin_id, 20_000);
        if (poll.state === "completed") {
          const nowIso = new Date().toISOString();
          await supabase.from("rental_access_codes").update({ lock_confirmed_at: nowIso }).eq("id", activePin.id);
          await notifyPinReady(
            supabase,
            booking,
            String(activePin.access_pin),
            String(activePin.start_time || ""),
            String(activePin.end_time || ""),
          );
          confirmResults.push({ orderId, action: "confirmed_existing" });
          continue;
        }
      }

      const attempts = Number(activePin.confirm_attempts || 0) + 1;
      const ageMs = activePin.created_at ? nowMs - new Date(activePin.created_at).getTime() : 0;
      const dropOff = booking.drop_off_date ? new Date(`${booking.drop_off_date}T12:00:00Z`).getTime() : nowMs;
      const msToPickup = dropOff - nowMs;
      const needAlgo = attempts >= ALERT_ATTEMPTS || ageMs >= RETRY_BUDGET_MS || msToPickup <= TWO_HOURS_MS;

      if (needAlgo) {
        const algo = await createAlgoPin(
          accessToken,
          lockId,
          String(booking.drop_off_date ?? ""),
          booking.drop_off_time_slot,
          String(booking.pickup_date ?? booking.drop_off_date ?? ""),
          orderId,
          " (AlgoPIN fallback)",
        );
        if (algo.success) {
          const nowIso = new Date().toISOString();
          await supabase
            .from("rental_access_codes")
            .update({ status: "expired" })
            .eq("order_id", orderId)
            .eq("status", "active");
          const endDate = `${booking.pickup_date || booking.drop_off_date}T23:59:59+00:00`;
          const { error: insertError } = await supabase.from("rental_access_codes").insert({
            order_id: orderId,
            customer_email: booking.email,
            customer_phone: booking.phone || "",
            access_pin: algo.pin,
            pin_id: algo.pinId,
            pin_type: "algopin",
            lock_id: lockId,
            start_time: algo.startDate,
            end_time: endDate,
            status: "active",
            lock_confirmed_at: nowIso,
            confirm_attempts: attempts,
          });
          if (!insertError) {
            await notifyPinReady(supabase, booking, algo.pin, String(algo.startDate), endDate);
            confirmResults.push({ orderId, action: "algopin_fallback", pin: algo.pin });
            continue;
          }
        }

        const failMsg =
          `URGENT: Access PIN has NOT been generated for Order #${orderId}. ` +
          `Bridge confirmation failed and AlgoPIN fallback did not succeed. ` +
          `Pickup: ${booking.drop_off_date} ${booking.drop_off_time_slot || ""}. ` +
          `Generate a PIN manually before the customer arrives.`;
        if (booking.customer_id) {
          await supabase.from("chat_messages").insert({
            conversation_id: `cust_${booking.customer_id}`,
            customer_id: booking.customer_id,
            booking_id: orderId,
            sender_type: "admin",
            message_content: failMsg,
            is_read: false,
            message_severity: "urgent",
            message_context: { action: "pin_failed", order_id: orderId, source: "reconcile-lock-pins" },
          });
        }
        await supabase.from("rental_tracking_logs").insert({
          order_id: orderId,
          event_type: "sync_error",
          event_timestamp: new Date().toISOString(),
          notes: failMsg,
        });
        confirmResults.push({ orderId, action: "failed_alerted" });
        continue;
      }

      await supabase.from("rental_access_codes").update({ confirm_attempts: attempts }).eq("id", activePin.id);
      confirmResults.push({ orderId, action: "awaiting_confirmation", attempts });
    }

    const deletedCount = deleteResults.filter((r) => r.success).length;
    const generatedCount = generateResults.filter((r) => r.success).length;
    console.log(
      `${LOG} Done. Deleted: ${deletedCount}/${allPinsToProcess.length} | Generated: ${generatedCount}/${eligibleBookings.length} | Confirm phase: ${confirmResults.length}`,
    );

    return jsonResponse({
      success: true,
      reason,
      focusOrderId,
      lockOnline,
      deleted: { processed: allPinsToProcess.length, succeeded: deletedCount, results: deleteResults },
      generated: {
        processed: eligibleBookings.length,
        succeeded: generatedCount,
        skipped: skippedBookings,
        results: generateResults,
      },
      confirmed: { processed: confirmResults.length, results: confirmResults },
    });
  } catch (error) {
    console.error(`${LOG} Unhandled exception:`, error);
    return jsonResponse({ success: false, error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
