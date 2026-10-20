/**
 * reconcile-lock-pins
 *
 * Overnight (reason=cron, 12:00–5:00 AM America/Denver): send each reserved
 * custom PIN to the padlock. Future drop-offs are retried once an hour.
 * Pickup day uses a tighter schedule and, at 5:00 AM, replaces an
 * unconfirmed custom PIN with one AlgoPIN. That email says the code was
 * updated. A code already sent to the customer is never replaced.
 *
 * Hourly notify (reason=notify): reserve a custom PIN for newly confirmed
 * yard pickups (no Igloohome call), then email/SMS only a lock-confirmed
 * code. A 1h-before reminder follows. AlgoPIN is not created on this pass.
 *
 * Also invoked by igloohome-webhook on bridge reconnect (lock work only).
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getCorsHeaders } from "./cors.ts";
import {
  addGraceHour,
  buildBookingDateUTC,
  denverCalendarDate,
  getAlgoFailsafeWindow,
  getPinActivationStart,
  isBookingEnded,
  isDueForFirstPinNotify,
  isDueForPinReminder,
  PIN_REVOKE_STATUSES,
} from "../_shared/pinTiming.ts";
import { ensurePinOnLock, pollJob, deletePinVerified, pushReservedPin } from "../_shared/lockPin.ts";
import { reserveMissingYardPins, reserveYardPinForBooking } from "../_shared/reserveYardPin.ts";
import { createAlgoPinWithVariance } from "../_shared/algoPin.ts";
import { getOAuthToken, GENERATE_PIN_SCOPES } from "../_shared/iglooAuth.ts";
import { notifyPinReady, notifyPinReminder } from "../_shared/pinNotify.ts";
import { bookingNeedsYardLockPin } from "../_shared/deliveryBooking.ts";
import { BUSINESS_TIME_ZONE } from "../_shared/parseBookingTimeSlot.ts";

const IGLOOHOME_API_BASE_URL = "https://api.igloodeveloper.co/igloohome";
const PUSH_PHASE_BUDGET_MS = 90_000;
const LOG = "[reconcile-lock-pins]";
const DENVER_CRON_HOURS = { start: 0, end: 5 } as const;

function denverClock(now: Date = new Date()): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TIME_ZONE,
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  }).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0") % 24;
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");
  return { hour, minute };
}

/** Pickup-morning minutes that retry today's unconfirmed custom PIN. */
function pickupMorningMinutes(hour: number): number[] {
  if (hour === 0) return [0];
  if (hour === 1) return [0, 30];
  if (hour === 2) return [0, 15, 30, 45];
  if (hour === 3) return [0, 8, 16, 24, 32, 40, 48];
  if (hour === 4) return Array.from({ length: 15 }, (_, index) => index * 4);
  return [];
}

function isNightTick(hour: number, minute: number): boolean {
  if (hour < DENVER_CRON_HOURS.start || hour > DENVER_CRON_HOURS.end) return false;
  if (minute === 0) return true;
  return pickupMorningMinutes(hour).includes(minute);
}

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
  return bookingNeedsYardLockPin(booking);
}

/**
 * Last resort, only inside the 12-hour customer notice window, and only
 * before any PIN email has been sent. Called at 5:00 AM Denver on pickup
 * day only. A code already given to the customer is left alone.
 */
async function issueAlgoLastResort(
  supabase: SupabaseClient,
  focusOrderId: number | null,
): Promise<{ issued: Array<Record<string, unknown>>; skipped?: string }> {
  const clientId = Deno.env.get("IGLOOHOME_CLIENT_ID");
  const clientSecret = Deno.env.get("IGLOOHOME_CLIENT_SECRET");
  const lockId = Deno.env.get("IGLOOHOME_LOCK_ID") || Deno.env.get("IGLOOHOME_DEVICE_ID");
  if (!clientId || !clientSecret || !lockId) return { issued: [], skipped: "missing_igloo_env" };

  const today = denverCalendarDate();
  let query = supabase
    .from("bookings")
    .select("*")
    .eq("status", "Confirmed")
    .eq("drop_off_date", today)
    .is("pin_notification_sent_at", null)
    .is("pin_failsafe_at", null);
  if (focusOrderId) query = query.eq("id", focusOrderId);
  const { data: bookings, error } = await query;
  if (error) return { issued: [], skipped: error.message };

  const due = (bookings ?? []).filter((booking: Record<string, unknown>) =>
    isTrailerRental(booking) && !isBookingEnded(booking as never)
  );
  if (due.length === 0) return { issued: [] };

  const oauthResult = await getOAuthToken(clientId, clientSecret, GENERATE_PIN_SCOPES);
  if (!oauthResult.token) return { issued: [], skipped: oauthResult.reason || "oauth_failed" };

  const issued: Array<Record<string, unknown>> = [];
  for (const booking of due) {
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
    if (activePin.lock_confirmed_at) continue;
    if (activePin.pin_type !== "bridge_proxied") continue;

    const algoWindow = getAlgoFailsafeWindow(booking as never);
    const algo = await createAlgoPinWithVariance({
      supabase,
      accessToken: oauthResult.token,
      lockId,
      startDate: algoWindow.startDate,
      endDate: algoWindow.endDate,
      accessName: `Dump Trailer Rental - Order #${orderId} (AlgoPIN fallback)`,
      insertRow: {
        order_id: orderId,
        customer_email: booking.email,
        customer_phone: booking.phone || "",
        status: "active",
        lock_confirmed_at: new Date().toISOString(),
        confirm_attempts: Number(activePin.confirm_attempts || 0),
      },
    });
    if (!algo.success) {
      console.warn(`${LOG} AlgoPIN last resort failed for order #${orderId}: ${algo.error}`);
      const { data: prior } = await supabase
        .from("rental_tracking_logs")
        .select("id")
        .eq("order_id", orderId)
        .eq("event_type", "sync_error")
        .limit(1)
        .maybeSingle();
      if (!prior) {
        const failMsg =
          `Custom PIN for Order #${orderId} was still unconfirmed at 5:00 AM, and the AlgoPIN failsafe failed. ` +
          `Pickup: ${booking.drop_off_date} ${booking.drop_off_time_slot || ""}.`;
        await supabase.from("rental_tracking_logs").insert({
          order_id: orderId,
          event_type: "sync_error",
          event_timestamp: new Date().toISOString(),
          notes: failMsg,
        });
      }
      issued.push({ orderId, action: "algopin_failed", error: algo.error });
      continue;
    }

    await supabase
      .from("rental_access_codes")
      .update({ status: "expired" })
      .eq("order_id", orderId)
      .eq("status", "active")
      .neq("id", algo.rowId);
    const failsafeNote =
      `Custom PIN for Order #${orderId} was not confirmed on the lock before the pickup window. ` +
      `Customer was sent AlgoPIN ${algo.pin} at 5:00 AM. Review why the lock did not confirm the original code.`;
    await supabase.from("bookings").update({
      pin_failsafe_at: new Date().toISOString(),
      pin_failsafe_note: failsafeNote,
    }).eq("id", orderId);
    await supabase.from("rental_tracking_logs").insert({
      order_id: orderId,
      event_type: "pin_generated",
      event_timestamp: new Date().toISOString(),
      notes: failsafeNote,
    });
    booking.pin_failsafe_at = new Date().toISOString();
    await notifyPinReady(supabase, booking, algo.pin, algo.startDate, algo.endDate);
    console.log(`${LOG} AlgoPIN failsafe for order #${orderId} (variance ${algo.variance})`);
    issued.push({ orderId, action: "algopin_fallback", variance: algo.variance });
  }
  return { issued };
}

async function runPinNotifyPass(
  supabase: SupabaseClient,
  focusOrderId: number | null,
) {
  let query = supabase
    .from("bookings")
    .select("*")
    .eq("status", "Confirmed")
    .not("pin_generated_at", "is", null);
  if (focusOrderId) query = query.eq("id", focusOrderId);
  const { data: bookings, error } = await query;
  if (error) {
    return { success: false as const, error: error.message };
  }

  const first: Array<Record<string, unknown>> = [];
  const reminders: Array<Record<string, unknown>> = [];
  for (const booking of bookings ?? []) {
    if (!isTrailerRental(booking)) continue;
    const { data: activePin } = await supabase
      .from("rental_access_codes")
      .select("access_pin, start_time, end_time, lock_confirmed_at")
      .eq("order_id", booking.id)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!activePin?.lock_confirmed_at || !activePin.access_pin) continue;

    const pin = String(activePin.access_pin);
    const startTime = String(activePin.start_time || "");
    const endTime = String(activePin.end_time || "");

    if (isDueForFirstPinNotify(booking as never) && !booking.pin_notification_sent_at) {
      const { data: fresh } = await supabase
        .from("bookings")
        .select("status")
        .eq("id", booking.id)
        .maybeSingle();
      if (fresh?.status !== "Confirmed") continue;
      await notifyPinReady(supabase, booking, pin, startTime, endTime);
      first.push({ bookingId: booking.id });
    }
    if (isDueForPinReminder(booking as never)) {
      const { data: fresh } = await supabase
        .from("bookings")
        .select("status")
        .eq("id", booking.id)
        .maybeSingle();
      if (fresh?.status !== "Confirmed") continue;
      await notifyPinReminder(supabase, booking, pin, startTime, endTime);
      reminders.push({ bookingId: booking.id });
    }
  }
  return { success: true as const, first, reminders };
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
  return deletePinVerified(accessToken, lockId, bridgeId, pin, 45_000);
}

async function tryBridgeDurationPin(
  accessToken: string,
  lockId: string,
  bridgeId: string,
  supabase: SupabaseClient,
  booking: Record<string, unknown>,
  opts?: { skipClear?: boolean },
) {
  const orderId = booking.id as number;
  const startDate = getPinActivationStart(booking as never);
  const endDate = addGraceHour(
    buildBookingDateUTC(String(booking.pickup_date ?? ""), booking.pickup_time_slot as string | null, 5),
  );
  return ensurePinOnLock(supabase, accessToken, {
    orderId,
    lockId,
    bridgeId,
    startDate,
    endDate,
    accessName: `Dump Trailer Rental - Order #${orderId}`,
    clearBudgetMs: 40_000,
    createBudgetMs: 50_000,
    skipClear: opts?.skipClear,
  });
}

/** Pickup-day minutes between hourly marks: same unconfirmed custom PIN only. */
async function pushPickupDayPins(
  supabase: SupabaseClient,
  accessToken: string,
  lockId: string,
  bridgeId: string,
  today: string,
  focusOrderId: number | null,
) {
  let query = supabase
    .from("bookings")
    .select("*")
    .eq("status", "Confirmed")
    .eq("drop_off_date", today)
    .not("pin_generated_at", "is", null)
    .is("pin_notification_sent_at", null)
    .is("pin_failsafe_at", null);
  if (focusOrderId) query = query.eq("id", focusOrderId);
  const { data: bookings } = await query;
  const results: Array<Record<string, unknown>> = [];
  let paced = false;
  for (const booking of bookings ?? []) {
    if (!isTrailerRental(booking)) continue;
    const { data: activePin } = await supabase
      .from("rental_access_codes")
      .select("*")
      .eq("order_id", booking.id)
      .eq("status", "active")
      .eq("pin_type", "bridge_proxied")
      .is("lock_confirmed_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!activePin) continue;
    if (paced) await sleep(15000);
    paced = true;
    const pushed = await pushReservedPin(accessToken, lockId, bridgeId, supabase, activePin);
    results.push({ orderId: booking.id, action: pushed.action, error: pushed.error });
  }
  return results;
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  const jsonResponse = makeJsonResponse(corsHeaders);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
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
    const reason = typeof requestBody.reason === "string" ? requestBody.reason : "manual";
    const { hour, minute } = denverClock();
    const isNotify = reason === "notify";
    const isCron = reason === "cron";
    if (isCron && !isNightTick(hour, minute)) {
      return jsonResponse({
        success: true,
        skipped: true,
        skipReason: hour > DENVER_CRON_HOURS.end || hour < DENVER_CRON_HOURS.start
          ? "outside_denver_window"
          : "not_a_night_tick",
        reason,
        denverHour: hour,
        denverMinute: minute,
      });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    if (isNotify) {
      console.log(`${LOG} Notify pass (focusOrderId=${focusOrderId ?? "none"})`);
      const reserved = await reserveMissingYardPins(supabase, focusOrderId);
      const notifyResult = await runPinNotifyPass(supabase, focusOrderId);
      if (!notifyResult.success) {
        return jsonResponse({ success: false, error: notifyResult.error }, 500);
      }
      return jsonResponse({
        success: true,
        reason,
        reserved: reserved.reserved,
        notify: {
          first: notifyResult.first,
          reminders: notifyResult.reminders,
        },
      });
    }

    const clientId = Deno.env.get("IGLOOHOME_CLIENT_ID");
    const clientSecret = Deno.env.get("IGLOOHOME_CLIENT_SECRET");
    const lockId = Deno.env.get("IGLOOHOME_LOCK_ID") || Deno.env.get("IGLOOHOME_DEVICE_ID");
    const bridgeId = Deno.env.get("IGLOOHOME_BRIDGE_ID");
    if (!clientId || !clientSecret || !lockId || !bridgeId) {
      return jsonResponse({ success: false, error: "Missing required environment variables" }, 500);
    }
    console.log(
      `${LOG} Started lock reconcile (reason=${reason}, focusOrderId=${focusOrderId ?? "none"}, denver=${hour}:${String(minute).padStart(2, "0")})`,
    );

    const oauthResult = await getOAuthToken(clientId, clientSecret, GENERATE_PIN_SCOPES);
    const accessToken = oauthResult.token;
    if (!accessToken) {
      return jsonResponse({ success: false, error: `Failed to get OAuth token: ${oauthResult.reason}` }, 500);
    }

    const now = new Date().toISOString();
    const today = denverCalendarDate();

    if (isCron && minute !== 0 && hour < 5) {
      const pushed = await pushPickupDayPins(supabase, accessToken, lockId, bridgeId, today, focusOrderId);
      return jsonResponse({
        success: true,
        reason,
        denverHour: hour,
        denverMinute: minute,
        pickupDayChecks: pushed,
      });
    }
    let jobIndex = 0;
    const pace = async () => {
      if (jobIndex > 0) {
        console.log(`${LOG} Waiting 15s before next bridge job...`);
        await sleep(15000);
      }
      jobIndex++;
    };

    // ================================================================
    // PHASE 1: DELETE PINs for cancelled / pending_review / cancellation_pending
    // ================================================================
    console.log(`${LOG} === PHASE 1: DELETIONS ===`);
    let deleteQuery = supabase
      .from("rental_access_codes")
      .select("id, order_id, access_pin, pin_type, status, bookings!inner(id, status)")
      .eq("status", "active")
      .in("bookings.status", [...PIN_REVOKE_STATUSES]);
    if (focusOrderId) deleteQuery = deleteQuery.eq("order_id", focusOrderId);
    const { data: activePinsToDelete } = await deleteQuery;

    let pendingQuery = supabase
      .from("rental_access_codes")
      .select("id, order_id, access_pin, pin_type, status, bookings!inner(id, status)")
      .eq("status", "expired")
      .neq("pin_type", "algopin")
      .is("lock_deleted_at", null)
      .in("bookings.status", [...PIN_REVOKE_STATUSES]);
    if (focusOrderId) pendingQuery = pendingQuery.eq("order_id", focusOrderId);
    const { data: pendingLockDeletes } = await pendingQuery;

    const allPinsToProcess = [...(activePinsToDelete ?? []), ...(pendingLockDeletes ?? [])].filter(
      (pin, index, self) => self.findIndex((p) => p.id === pin.id) === index,
    );
    const deleteResults: Array<Record<string, unknown>> = [];
    for (const record of allPinsToProcess) {
      if (record.pin_type === "algopin") {
        if (record.status === "expired") {
          deleteResults.push({ bookingId: record.order_id, success: true, method: "algopin_natural_expiry" });
          continue;
        }
        await supabase
          .from("rental_access_codes")
          .update({ status: "expired", notified_at: now })
          .eq("id", record.id);
        deleteResults.push({ bookingId: record.order_id, success: true, method: "algopin_natural_expiry" });
        continue;
      }
      await pace();
      try {
        const result = await deletePinFromLock(accessToken, lockId, bridgeId, record.access_pin);
        if (!result.ok) {
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
    // PHASE 2: Reserve custom PINs (no Igloohome call)
    // ================================================================
    console.log(`${LOG} === PHASE 2: RESERVE ===`);
    const lockOnline = await isLockOnline(accessToken, lockId);
    if (!lockOnline) {
      console.warn(`${LOG} Lock offline — reserved PINs stay waiting until the bridge can reach the padlock.`);
    }
    const reserved = await reserveMissingYardPins(supabase, focusOrderId);
    const generateResults = reserved.reserved;

    // ================================================================
    // PHASE 3: Send each reserved custom PIN until the lock confirms it
    // ================================================================
    console.log(`${LOG} === PHASE 3: CONFIRM RESERVED PINS ===`);
    let unconfirmedQuery = supabase
      .from("bookings")
      .select("*")
      .eq("status", "Confirmed")
      .gte("drop_off_date", today)
      .not("pin_generated_at", "is", null);
    if (focusOrderId) unconfirmedQuery = unconfirmedQuery.eq("id", focusOrderId);
    const { data: activeBookingsRaw } = await unconfirmedQuery;
    const activeBookings = [...(activeBookingsRaw ?? [])].sort((a, b) => {
      const dateCmp = String(a.drop_off_date || "").localeCompare(String(b.drop_off_date || ""));
      if (dateCmp !== 0) return dateCmp;
      return String(a.drop_off_time_slot || "").localeCompare(String(b.drop_off_time_slot || ""));
    });
    const pushDeadline = Date.now() + PUSH_PHASE_BUDGET_MS;

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

      if (!activePin) {
        if (!isBookingEnded(booking as never)) {
          const reservedPin = await reserveYardPinForBooking(supabase, booking, lockId);
          confirmResults.push({ orderId, action: reservedPin.action, error: reservedPin.error });
        }
        continue;
      }

      // Before the customer is told, a confirmed custom PIN is preferred.
      // After pin_notification_sent_at, the code they were given stays.
      if (
        activePin.pin_type === "algopin" &&
        activePin.lock_confirmed_at &&
        !booking.pin_notification_sent_at &&
        !booking.pin_failsafe_at &&
        lockOnline &&
        !isBookingEnded(booking as never)
      ) {
        await pace();
        const bridgeUpgrade = await tryBridgeDurationPin(
          accessToken,
          lockId,
          bridgeId,
          supabase,
          booking,
          { skipClear: true },
        );
        let confirmed = bridgeUpgrade.lockConfirmed;
        if (!confirmed && bridgeUpgrade.jobId) {
          const poll = await pollJob(accessToken, bridgeUpgrade.jobId, 20_000);
          confirmed = poll.state === "completed";
        }
        if (confirmed && bridgeUpgrade.pin) {
          const startTimeUTC = getPinActivationStart(booking as never);
          const endTimeUTC = addGraceHour(
            buildBookingDateUTC(String(booking.pickup_date ?? ""), booking.pickup_time_slot as string | null, 5),
          );
          const { error: insertError } = await supabase.from("rental_access_codes").insert({
            order_id: orderId,
            customer_email: booking.email,
            customer_phone: booking.phone || "",
            access_pin: bridgeUpgrade.pin,
            pin_id: bridgeUpgrade.jobId || "",
            pin_type: "bridge_proxied",
            lock_id: lockId,
            start_time: startTimeUTC,
            end_time: endTimeUTC,
            status: "active",
            lock_deleted_at: null,
            lock_confirmed_at: now,
            confirm_attempts: 0,
          });
          if (!insertError) {
            await supabase
              .from("rental_access_codes")
              .update({ status: "expired", lock_deleted_at: now, notified_at: now })
              .eq("id", activePin.id);
            console.log(`${LOG} Upgraded order #${orderId} from AlgoPIN to bridge duration PIN`);
            confirmResults.push({ orderId, action: "upgraded_algopin_to_bridge" });
            continue;
          }
          confirmResults.push({ orderId, action: "upgrade_insert_failed", error: insertError.message });
        } else if (bridgeUpgrade.jobId && !confirmed) {
          confirmResults.push({ orderId, action: "bridge_upgrade_pending", error: bridgeUpgrade.error });
        } else if (!bridgeUpgrade.jobId) {
          confirmResults.push({ orderId, action: "bridge_upgrade_failed", error: bridgeUpgrade.error });
        }
        continue;
      }

      if (activePin.lock_confirmed_at) {
        confirmResults.push({ orderId, action: "already_confirmed" });
        continue;
      }

      if (isCron && String(booking.drop_off_date || "").slice(0, 10) === today && hour === 5) {
        confirmResults.push({ orderId, action: "awaiting_5am_failsafe" });
        continue;
      }

      if (activePin.pin_type !== "bridge_proxied") {
        confirmResults.push({ orderId, action: "awaiting_confirmation" });
        continue;
      }

      if (Date.now() >= pushDeadline) {
        confirmResults.push({ orderId, action: "deferred_next_hour" });
        continue;
      }

      await pace();
      const pushed = await pushReservedPin(accessToken, lockId, bridgeId, supabase, activePin);
      confirmResults.push({ orderId, action: pushed.action, error: pushed.error });
    }

    let failsafe: { issued: Array<Record<string, unknown>> } | null = null;
    if (isCron && hour === 5 && minute === 0) {
      failsafe = await issueAlgoLastResort(supabase, focusOrderId);
    }

    const deletedCount = deleteResults.filter((r) => r.success).length;
    const generatedCount = generateResults.length;
    console.log(
      `${LOG} Done. Deleted: ${deletedCount}/${allPinsToProcess.length} | Reserved: ${generatedCount} | Confirm phase: ${confirmResults.length}`,
    );

    return jsonResponse({
      success: true,
      reason,
      denverHour: hour,
      focusOrderId,
      lockOnline,
      deleted: { processed: allPinsToProcess.length, succeeded: deletedCount, results: deleteResults },
      generated: {
        processed: generatedCount,
        succeeded: generatedCount,
        results: generateResults,
        error: reserved.error ?? null,
      },
      confirmed: { processed: confirmResults.length, results: confirmResults },
      failsafe,
    });
  } catch (error) {
    console.error(`${LOG} Unhandled exception:`, error);
    return jsonResponse({ success: false, error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
