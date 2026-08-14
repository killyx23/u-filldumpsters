/**
 * ensure-lock-pin-ready
 *
 * Primary T−12h sweeper (every 5 min): for Confirmed self-pickup bookings inside
 * the PIN generation window, ensure a confirmed PIN is ready on the padlock.
 *
 * - No PIN yet → create via ensurePinOnLock
 * - PIN exists but lock_confirmed_at IS NULL → poll existing job, then retry bridge
 * - After ~15 min / 3 confirm attempts still unconfirmed → AlgoPIN backup
 * - Hard bridge failure (no jobId) → AlgoPIN immediately
 * - Confirmed PIN → notify customer (email + SMS via pin_update)
 * - Exhausted failure or <2h to pickup still unready → urgent admin chat + email
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getCorsHeaders } from "../_shared/cors.ts";
import { sendEmail } from "../_shared/notify.ts";
import {
  addGraceHour,
  buildBookingDateUTC,
  getBookingWindow,
  getPinActivationStart,
  isWithinPinGenerationWindow,
  PIN_LEAD_TIME_MS,
} from "../_shared/pinTiming.ts";
import { ensurePinOnLock, pollJob } from "../_shared/lockPin.ts";
import { getOAuthToken, GENERATE_PIN_SCOPES } from "../_shared/iglooAuth.ts";

const IGLOOHOME_API_BASE_URL = "https://api.igloodeveloper.co/igloohome";
const FINAL_HOUR_MS = 60 * 60 * 1000;
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const ALERT_ATTEMPTS_THRESHOLD = 3;
const RETRY_BUDGET_MS = 15 * 60 * 1000;

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

function isTrailerRental(booking: Record<string, unknown>) {
  const plan = (booking.plan || {}) as Record<string, unknown>;
  const addons = (booking.addons || {}) as Record<string, unknown>;
  if (addons.isDelivery || addons.deliveryService) return false;
  if (plan.customer_pickup === true) return true;
  const id = Number(plan.id);
  if (id === 2 || id === 5) return true;
  const planName = String(plan.name ?? booking.service_name ?? "").toLowerCase();
  const serviceType = String(plan.service_type ?? booking.service_type ?? "");
  return serviceType === "trailer_rental" || planName.includes("dump loader") || planName.includes("trailer");
}

async function getOAuthTokenForWatchdog(clientId: string, clientSecret: string) {
  const result = await getOAuthToken(clientId, clientSecret, GENERATE_PIN_SCOPES);
  if (!result.token) {
    console.error("[ensure-lock-pin-ready] OAuth failed:", result.reason);
    return null;
  }
  return result.token;
}

async function createAlgoPin(
  accessToken: string,
  lockId: string,
  booking: Record<string, unknown>,
) {
  const startDate = getPinActivationStart(booking as { drop_off_date?: string; drop_off_time_slot?: string });
  const startDateHourOnly = startDate.replace(/T(\d{2}):\d{2}:00/, "T$1:00:00");
  const pickupDate = String(booking.pickup_date || "");
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
      accessName: `Dump Loader Rental - Order #${booking.id} (AlgoPIN fallback)`,
      startDate: startDateHourOnly,
      variance,
    }),
  });
  const body = await readResponse(res);
  if (!res.ok && res.status !== 201) {
    return { success: false as const, error: `AlgoPIN HTTP ${res.status}`, raw: body.json };
  }
  const pin = String(body.json?.pin || body.json?.access_code || body.json?.code || "");
  if (!pin) return { success: false as const, error: "AlgoPIN response missing pin", raw: body.json };
  return {
    success: true as const,
    pin,
    pinId: String(body.json?.pinId || body.json?.id || ""),
    startDate: startDateHourOnly,
  };
}

async function logSyncError(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  orderId: number,
  notes: string,
) {
  await supabase.from("rental_tracking_logs").insert({
    order_id: orderId,
    event_type: "sync_error",
    event_timestamp: new Date().toISOString(),
    notes,
  });
}

async function alertAdmin(subject: string, html: string) {
  const adminEmail = Deno.env.get("BREVO_FROM_EMAIL");
  if (!adminEmail) {
    console.warn("[ensure-lock-pin-ready] No BREVO_FROM_EMAIL for admin alert");
    return;
  }
  const result = await sendEmail(adminEmail, subject, html);
  if (!result.success) {
    console.error("[ensure-lock-pin-ready] Admin alert failed:", result.error);
  }
}

async function alertCustomerChat(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  booking: Record<string, unknown>,
  message: string,
) {
  const customerId = Number(booking.customer_id);
  if (!customerId) {
    console.warn("[ensure-lock-pin-ready] No customer_id for chat alert on order", booking.id);
    return;
  }
  const { error } = await supabase.from("chat_messages").insert({
    conversation_id: `cust_${customerId}`,
    customer_id: customerId,
    booking_id: Number(booking.id),
    sender_type: "admin",
    message_content: message,
    is_read: false,
    message_severity: "urgent",
    message_context: {
      action: "pin_failed",
      order_id: Number(booking.id),
      source: "ensure-lock-pin-ready",
    },
  });
  if (error) {
    console.error("[ensure-lock-pin-ready] chat_messages insert failed:", error.message);
  }
}

async function maybeNotifyCustomer(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  booking: Record<string, unknown>,
  pin: string,
  startTime: string,
  endTime: string,
) {
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
    console.error(`[ensure-lock-pin-ready] PIN notification failed for #${booking.id}:`, error.message);
  }
}

function shouldUseAlgoPinFallback(
  activePin: Record<string, unknown> | null,
  attempts: number,
  nowMs: number,
  msToPickup: number,
): boolean {
  if (attempts >= ALERT_ATTEMPTS_THRESHOLD) return true;
  if (msToPickup <= FINAL_HOUR_MS && msToPickup > -FINAL_HOUR_MS) return true;
  if (activePin?.created_at) {
    const age = nowMs - new Date(String(activePin.created_at)).getTime();
    if (age >= RETRY_BUDGET_MS && !activePin.lock_confirmed_at) return true;
  }
  return false;
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  const jsonResponse = makeJsonResponse(corsHeaders);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const clientId = Deno.env.get("IGLOOHOME_CLIENT_ID") ?? "";
    const clientSecret = Deno.env.get("IGLOOHOME_CLIENT_SECRET") ?? "";
    const lockId = Deno.env.get("IGLOOHOME_LOCK_ID") || Deno.env.get("IGLOOHOME_DEVICE_ID") || "";
    const bridgeId = Deno.env.get("IGLOOHOME_BRIDGE_ID") || "";

    const authHeader = req.headers.get("Authorization");
    const incomingKey = authHeader?.replace("Bearer ", "").trim();
    if (!incomingKey || incomingKey !== serviceRoleKey) {
      return jsonResponse({ success: false, error: "Unauthorized" }, 401);
    }
    if (!supabaseUrl || !serviceRoleKey || !clientId || !clientSecret || !lockId || !bridgeId) {
      return jsonResponse({ success: false, error: "Missing env" }, 500);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const accessToken = await getOAuthTokenForWatchdog(clientId, clientSecret);
    if (!accessToken) {
      return jsonResponse({ success: false, error: "OAuth failed" }, 502);
    }

    const now = new Date();
    const nowMs = now.getTime();
    const horizonIso = new Date(nowMs + PIN_LEAD_TIME_MS).toISOString().slice(0, 10);
    const today = now.toISOString().slice(0, 10);

    const { data: bookings, error: fetchError } = await supabase
      .from("bookings")
      .select("*")
      .eq("status", "Confirmed")
      .gte("drop_off_date", today)
      .lte("drop_off_date", horizonIso)
      .order("drop_off_date", { ascending: true });

    if (fetchError) {
      return jsonResponse({ success: false, error: fetchError.message }, 500);
    }

    const candidates = (bookings || []).filter((b: Record<string, unknown>) => {
      if (!isTrailerRental(b)) return false;
      if (!isWithinPinGenerationWindow(b, now)) return false;
      return true;
    });

    const results: Array<Record<string, unknown>> = [];

    for (const booking of candidates) {
      const orderId = Number(booking.id);
      const window = getBookingWindow(booking);
      const msToPickup = window.startMs - nowMs;
      const underTwoHours = msToPickup <= TWO_HOURS_MS && msToPickup > -FINAL_HOUR_MS;

      const { data: activePin } = await supabase
        .from("rental_access_codes")
        .select("*")
        .eq("order_id", orderId)
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (activePin?.lock_confirmed_at && activePin?.access_pin) {
        if (!booking.pin_notification_sent_at) {
          await maybeNotifyCustomer(
            supabase,
            booking,
            String(activePin.access_pin),
            String(activePin.start_time || window.activationIso),
            String(activePin.end_time || window.graceEndIso),
          );
        }
        results.push({ orderId, action: "skip_confirmed" });
        continue;
      }

      // If we have a jobId and it's still pending, try a quick poll first.
      if (activePin?.pin_id && activePin.pin_type === "bridge_proxied") {
        const poll = await pollJob(accessToken, activePin.pin_id, 20_000, 2500);
        if (poll.state === "completed") {
          const nowIso = new Date().toISOString();
          await supabase
            .from("rental_access_codes")
            .update({ lock_confirmed_at: nowIso })
            .eq("id", activePin.id);
          await maybeNotifyCustomer(
            supabase,
            booking,
            String(activePin.access_pin),
            String(activePin.start_time || window.activationIso),
            String(activePin.end_time || window.graceEndIso),
          );
          results.push({ orderId, action: "confirmed_existing" });
          continue;
        }
      }

      const startDate = getPinActivationStart(booking);
      const endDate = addGraceHour(
        buildBookingDateUTC(booking.pickup_date, booking.pickup_time_slot, 5),
      );
      const attempts = (activePin?.confirm_attempts || 0) + 1;
      const useAlgo = shouldUseAlgoPinFallback(activePin, attempts, nowMs, msToPickup);

      if (useAlgo) {
        const algo = await createAlgoPin(accessToken, lockId, booking);
        if (algo.success) {
          await supabase
            .from("rental_access_codes")
            .update({ status: "expired" })
            .eq("order_id", orderId)
            .eq("status", "active");
          const nowIso = new Date().toISOString();
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
          if (insertError) {
            console.error(`[ensure-lock-pin-ready] AlgoPIN insert failed #${orderId}:`, insertError.message);
            await alertCustomerChat(
              supabase,
              booking,
              `URGENT: Access PIN for Order #${orderId} could not be saved after AlgoPIN fallback (${insertError.message}). Staff must generate a PIN before pickup on ${booking.drop_off_date} ${booking.drop_off_time_slot || ""}.`,
            );
            await alertAdmin(
              `PIN save failed after AlgoPIN — Order #${orderId}`,
              `<p>AlgoPIN was issued but DB insert failed: ${insertError.message}</p>`,
            );
            results.push({ orderId, action: "algopin_insert_failed", error: insertError.message });
            continue;
          }
          await supabase.from("bookings").update({ pin_generated_at: nowIso }).eq("id", orderId);
          await maybeNotifyCustomer(supabase, booking, algo.pin, algo.startDate, endDate);
          const notes =
            `AlgoPIN fallback issued for order #${orderId} — bridge never confirmed within retry budget. ` +
            `PIN ${algo.pin} (single-use offline).`;
          await logSyncError(supabase, orderId, notes);
          await alertAdmin(
            `AlgoPIN fallback — Order #${orderId}`,
            `<h2>Bridge PIN failed — AlgoPIN issued</h2>
             <p><strong>Order:</strong> #${orderId}</p>
             <p><strong>Customer:</strong> ${booking.name || ""} (${booking.email || "n/a"})</p>
             <p><strong>Pickup:</strong> ${booking.drop_off_date} ${booking.drop_off_time_slot || ""}</p>
             <p><strong>AlgoPIN:</strong> ${algo.pin}</p>
             <p>The bridge could not confirm the custom PIN within the retry window. An offline AlgoPIN was issued so the customer can still open the lock.</p>`,
          );
          results.push({ orderId, action: "algopin_fallback", pin: algo.pin });
          continue;
        }

        // AlgoPIN also failed — alert staff on customer file.
        const failMsg =
          `URGENT: Access PIN has NOT been generated for Order #${orderId}. ` +
          `Bridge retries exhausted and AlgoPIN fallback failed (${algo.error || "unknown"}). ` +
          `Pickup: ${booking.drop_off_date} ${booking.drop_off_time_slot || ""}. ` +
          `Generate a PIN manually before the customer arrives.`;
        await logSyncError(supabase, orderId, failMsg);
        await alertCustomerChat(supabase, booking, failMsg);
        await alertAdmin(
          `PIN generation FAILED — Order #${orderId}`,
          `<h2>No access PIN available</h2>
           <p><strong>Order:</strong> #${orderId}</p>
           <p><strong>Customer:</strong> ${booking.name || ""} (${booking.email || "n/a"})</p>
           <p><strong>Pickup:</strong> ${booking.drop_off_date} ${booking.drop_off_time_slot || ""}</p>
           <p><strong>AlgoPIN error:</strong> ${algo.error || "unknown"}</p>
           <p>Manual intervention required.</p>`,
        );
        results.push({ orderId, action: "failed_alerted", error: algo.error });
        continue;
      }

      // Create or retry bridge PIN.
      const ensured = await ensurePinOnLock(supabase, accessToken, {
        orderId,
        lockId,
        bridgeId,
        startDate,
        endDate,
        accessName: `Dump Loader Rental - Order #${orderId}`,
        clearBudgetMs: 40_000,
        createBudgetMs: 50_000,
      });

      const nowIso = new Date().toISOString();

      // Hard bridge failure with no job — try AlgoPIN immediately on next path via attempts,
      // but if there is literally no usable pin/job, escalate to AlgoPIN now.
      if (!ensured.jobId && !ensured.lockConfirmed) {
        const algo = await createAlgoPin(accessToken, lockId, booking);
        if (algo.success) {
          await supabase
            .from("rental_access_codes")
            .update({ status: "expired" })
            .eq("order_id", orderId)
            .eq("status", "active");
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
            await supabase.from("bookings").update({ pin_generated_at: nowIso }).eq("id", orderId);
            await maybeNotifyCustomer(supabase, booking, algo.pin, algo.startDate, endDate);
            await logSyncError(
              supabase,
              orderId,
              `AlgoPIN issued after hard bridge failure for #${orderId}: ${ensured.error || ensured.createState}`,
            );
            results.push({ orderId, action: "algopin_hard_fail_fallback", pin: algo.pin });
            continue;
          }
        }
      }

      await supabase
        .from("rental_access_codes")
        .update({ status: "expired" })
        .eq("order_id", orderId)
        .eq("status", "active");

      const { error: insertError } = await supabase.from("rental_access_codes").insert({
        order_id: orderId,
        customer_email: booking.email,
        customer_phone: booking.phone || "",
        access_pin: ensured.pin,
        pin_id: ensured.jobId || "",
        pin_type: "bridge_proxied",
        lock_id: lockId,
        start_time: startDate,
        end_time: endDate,
        status: "active",
        lock_confirmed_at: ensured.lockConfirmed ? nowIso : null,
        confirm_attempts: attempts,
      });

      if (insertError) {
        console.error(`[ensure-lock-pin-ready] Bridge PIN insert failed #${orderId}:`, insertError.message);
        await logSyncError(supabase, orderId, `Bridge PIN insert failed: ${insertError.message}`);
        if (underTwoHours || attempts >= ALERT_ATTEMPTS_THRESHOLD) {
          await alertCustomerChat(
            supabase,
            booking,
            `URGENT: Access PIN for Order #${orderId} was queued on the lock but failed to save in the portal (${insertError.message}). Staff must verify/generate before pickup.`,
          );
          await alertAdmin(
            `PIN DB insert failed — Order #${orderId}`,
            `<p>Insert failed: ${insertError.message}</p>`,
          );
        }
        results.push({ orderId, action: "insert_failed", error: insertError.message });
        continue;
      }

      await supabase.from("bookings").update({ pin_generated_at: nowIso }).eq("id", orderId);

      if (ensured.lockConfirmed) {
        await maybeNotifyCustomer(supabase, booking, ensured.pin, startDate, endDate);
        results.push({ orderId, action: "created_confirmed", pin: ensured.pin });
      } else {
        await logSyncError(
          supabase,
          orderId,
          `Bridge PIN not confirmed (attempt ${attempts}): ${ensured.error || ensured.createState}. jobId=${ensured.jobId}`,
        );
        if (attempts >= ALERT_ATTEMPTS_THRESHOLD || underTwoHours) {
          const msg =
            `Access PIN for Order #${orderId} is not confirmed on the lock yet ` +
            `(attempt ${attempts}). Pickup: ${booking.drop_off_date} ${booking.drop_off_time_slot || ""}. ` +
            `Watchdog will retry / issue AlgoPIN backup. Job: ${ensured.jobId || "n/a"}.`;
          await alertCustomerChat(supabase, booking, msg);
          await alertAdmin(
            `PIN not confirmed on lock — Order #${orderId}`,
            `<h2>Bridge has not confirmed PIN delivery</h2>
             <p><strong>Order:</strong> #${orderId}</p>
             <p><strong>Customer:</strong> ${booking.name || ""} (${booking.email || "n/a"})</p>
             <p><strong>Pickup:</strong> ${booking.drop_off_date} ${booking.drop_off_time_slot || ""}</p>
             <p><strong>Job ID:</strong> ${ensured.jobId || "n/a"}</p>
             <p><strong>Attempts:</strong> ${attempts}</p>
             <p><strong>State:</strong> ${ensured.createState}</p>
             <p>Wake the padlock / check bridge range. Watchdog will retry; AlgoPIN backup fires after the retry budget.</p>`,
          );
        }
        results.push({
          orderId,
          action: "created_unconfirmed",
          pin: ensured.pin,
          jobId: ensured.jobId,
          attempts,
        });
      }
    }

    return jsonResponse({
      success: true,
      processed: results.length,
      results,
    });
  } catch (error) {
    console.error("[ensure-lock-pin-ready]", error);
    return jsonResponse({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }, 500);
  }
});
