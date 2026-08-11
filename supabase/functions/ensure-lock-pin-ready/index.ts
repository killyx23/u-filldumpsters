/**
 * ensure-lock-pin-ready (thin orchestrator)
 *
 * Runs every 5 minutes. Creates PINs by invoking generate-daily-pins (service role),
 * then confirms pending bridge jobs, notifies customers, escalates AlgoPIN via a
 * second generate-daily-pins-friendly path, and posts urgent admin chat on failure.
 *
 * Kept small so it can be deployed reliably via Management API.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const IGLOO_API = "https://api.igloodeveloper.co/igloohome";
const PIN_LEAD_MS = 12 * 60 * 60 * 1000;
const RETRY_BUDGET_MS = 15 * 60 * 1000;
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const ALERT_ATTEMPTS = 3;

function cors(req: Request) {
  const h: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Content-Type": "application/json",
  };
  const origin = req.headers.get("Origin");
  const allowed = (Deno.env.get("ALLOWED_ORIGINS") || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (origin && allowed.includes(origin)) {
    h["Access-Control-Allow-Origin"] = origin;
    h["Vary"] = "Origin";
  }
  return h;
}

function json(headers: Record<string, string>, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers });
}

async function oauth(clientId: string, clientSecret: string) {
  const credentials = btoa(`${clientId}:${clientSecret}`);
  const tryScopes = [
    "igloohomeapi/create-pin-bridge-proxied-job igloohomeapi/get-devices igloohomeapi/get-job-status igloohomeapi/algopin-onetime igloohomeapi/store-device-activity",
    "",
  ];
  for (const scope of tryScopes) {
    const form = new URLSearchParams({ grant_type: "client_credentials" });
    if (scope) form.set("scope", scope);
    const res = await fetch("https://auth.igloohome.co/oauth2/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: form,
    });
    const body = await res.json().catch(() => null);
    if (res.ok && body?.access_token) return body.access_token as string;
  }
  return null;
}

async function pollJob(token: string, jobId: string, budgetMs = 20000) {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2500));
    const res = await fetch(`${IGLOO_API}/jobs/${jobId}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    const body = await res.json().catch(() => null);
    if (body?.completed === true || body?.jobResponse?.jobStatus === 0) return "completed";
    if (body?.jobResponse?.jobStatus === 2) return "failed";
  }
  return "pending";
}

async function createAlgoPin(token: string, lockId: string, booking: Record<string, unknown>) {
  const drop = String(booking.drop_off_date || "");
  const startDate = `${drop}T12:00:00+00:00`.replace(/T(\d{2}):\d{2}:00/, "T$1:00:00");
  const pickup = String(booking.pickup_date || drop);
  const variance = 1;
  const res = await fetch(`${IGLOO_API}/devices/${lockId}/algopin/onetime`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      accessName: `Dump Loader Rental - Order #${booking.id} (AlgoPIN fallback)`,
      startDate,
      variance,
    }),
  });
  const body = await res.json().catch(() => null);
  const pin = String(body?.pin || body?.access_code || body?.code || "");
  if ((!res.ok && res.status !== 201) || !pin) {
    return { success: false as const, error: `AlgoPIN failed HTTP ${res.status}` };
  }
  return {
    success: true as const,
    pin,
    pinId: String(body?.pinId || body?.id || ""),
    startDate,
  };
}

async function notifyPinReady(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  booking: Record<string, unknown>,
  pin: string,
  startTime: string,
  endTime: string,
) {
  if (booking.pin_notification_sent_at) return;
  await supabase.functions.invoke("send-booking-confirmation", {
    body: {
      booking_id: booking.id,
      email_type: "pin_update",
      pin,
      start_time: startTime,
      end_time: endTime,
    },
  });
  try {
    const { data: customer } = await supabase
      .from("customers")
      .select("phone, sms_opt_in")
      .eq("id", booking.customer_id)
      .maybeSingle();
    const phone = customer?.phone || booking.phone || "";
    if (customer?.sms_opt_in === false || !phone) return;
    const digits = String(phone).replace(/\D/g, "");
    const to = digits.length === 10
      ? `+1${digits}`
      : digits.length === 11 && digits.startsWith("1")
      ? `+${digits}`
      : null;
    if (!to) return;
    const site = (Deno.env.get("SITE_URL") || "https://u-filldumpsters.com").replace(/\/$/, "");
    const content =
      `U-Fill Dumpsters: Your access PIN for Order #${booking.id} is ${pin}. View: ${site}/customer-portal?tab=access-codes`;
    const key = Deno.env.get("BREVO_API_KEY");
    if (!key) return;
    await fetch("https://api.brevo.com/v3/transactionalSMS/sms", {
      method: "POST",
      headers: { "api-key": key, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        sender: (Deno.env.get("BREVO_SMS_SENDER") || "UFillDump").slice(0, 11),
        recipient: to,
        content,
        type: "transactional",
      }),
    });
  } catch {
    // non-fatal
  }
}

Deno.serve(async (req) => {
  const headers = cors(req);
  if (req.method === "OPTIONS") return new Response(null, { headers });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const clientId = Deno.env.get("IGLOOHOME_CLIENT_ID") ?? "";
    const clientSecret = Deno.env.get("IGLOOHOME_CLIENT_SECRET") ?? "";
    const lockId = Deno.env.get("IGLOOHOME_LOCK_ID") || Deno.env.get("IGLOOHOME_DEVICE_ID") || "";

    const incoming = req.headers.get("Authorization")?.replace("Bearer ", "").trim();
    if (!incoming || incoming !== serviceRoleKey) {
      return json(headers, { success: false, error: "Unauthorized" }, 401);
    }
    if (!supabaseUrl || !serviceRoleKey || !clientId || !clientSecret || !lockId) {
      return json(headers, { success: false, error: "Missing env" }, 500);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // 1) Coarse create/retry via existing daily generator (service-role auth).
    const genRes = await fetch(`${supabaseUrl}/functions/v1/generate-daily-pins`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    const genBody = await genRes.json().catch(() => ({ ok: false }));

    const accessToken = await oauth(clientId, clientSecret);
    if (!accessToken) {
      return json(headers, { success: false, error: "OAuth failed", generateDailyPins: genBody }, 502);
    }

    const now = new Date();
    const nowMs = now.getTime();
    const today = now.toISOString().slice(0, 10);
    const horizon = new Date(nowMs + PIN_LEAD_MS).toISOString().slice(0, 10);

    const { data: bookings } = await supabase
      .from("bookings")
      .select("*")
      .eq("status", "Confirmed")
      .gte("drop_off_date", today)
      .lte("drop_off_date", horizon);

    const results: Array<Record<string, unknown>> = [];

    for (const booking of bookings || []) {
      const plan = booking.plan || {};
      const name = String(plan.name || "").toLowerCase();
      const isTrailer =
        Number(plan.id) === 2 ||
        Number(plan.id) === 5 ||
        name.includes("trailer") ||
        name.includes("dump loader") ||
        plan.customer_pickup === true;
      if (!isTrailer) continue;

      const orderId = Number(booking.id);
      const { data: activePin } = await supabase
        .from("rental_access_codes")
        .select("*")
        .eq("order_id", orderId)
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (activePin?.lock_confirmed_at && activePin.access_pin) {
        if (!booking.pin_notification_sent_at) {
          await notifyPinReady(
            supabase,
            booking,
            String(activePin.access_pin),
            String(activePin.start_time || ""),
            String(activePin.end_time || ""),
          );
        }
        results.push({ orderId, action: "skip_confirmed" });
        continue;
      }

      if (activePin?.pin_id && activePin.pin_type === "bridge_proxied") {
        const state = await pollJob(accessToken, activePin.pin_id);
        if (state === "completed") {
          const nowIso = new Date().toISOString();
          await supabase
            .from("rental_access_codes")
            .update({ lock_confirmed_at: nowIso })
            .eq("id", activePin.id);
          await notifyPinReady(
            supabase,
            booking,
            String(activePin.access_pin),
            String(activePin.start_time || ""),
            String(activePin.end_time || ""),
          );
          results.push({ orderId, action: "confirmed_existing" });
          continue;
        }
      }

      const attempts = Number(activePin?.confirm_attempts || 0) + 1;
      const ageMs = activePin?.created_at
        ? nowMs - new Date(activePin.created_at).getTime()
        : 0;
      const dropOff = booking.drop_off_date ? new Date(`${booking.drop_off_date}T12:00:00Z`).getTime() : nowMs;
      const msToPickup = dropOff - nowMs;
      const needAlgo =
        !!activePin &&
        !activePin.lock_confirmed_at &&
        (attempts >= ALERT_ATTEMPTS || ageMs >= RETRY_BUDGET_MS || msToPickup <= TWO_HOURS_MS);

      if (needAlgo) {
        const algo = await createAlgoPin(accessToken, lockId, booking);
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
            await supabase.from("bookings").update({ pin_generated_at: nowIso }).eq("id", orderId);
            await notifyPinReady(supabase, booking, algo.pin, algo.startDate, endDate);
            results.push({ orderId, action: "algopin_fallback", pin: algo.pin });
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
            message_context: { action: "pin_failed", order_id: orderId, source: "ensure-lock-pin-ready" },
          });
        }
        await supabase.from("rental_tracking_logs").insert({
          order_id: orderId,
          event_type: "sync_error",
          event_timestamp: new Date().toISOString(),
          notes: failMsg,
        });
        results.push({ orderId, action: "failed_alerted" });
        continue;
      }

      if (activePin && !activePin.lock_confirmed_at) {
        await supabase
          .from("rental_access_codes")
          .update({ confirm_attempts: attempts })
          .eq("id", activePin.id);
        results.push({ orderId, action: "awaiting_confirmation", attempts });
      } else if (!activePin) {
        results.push({ orderId, action: "awaiting_generate_daily_pins" });
      }
    }

    return json(headers, {
      success: true,
      generateDailyPins: genBody,
      processed: results.length,
      results,
    });
  } catch (error) {
    return json(headers, {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }, 500);
  }
});
