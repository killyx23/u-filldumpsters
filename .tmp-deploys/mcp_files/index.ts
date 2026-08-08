/**
 * test-lock-lifecycle (admin only)
 *
 * Compress a booking into a short live window and exercise the lock rental flow
 * without waiting days.
 *
 * Actions:
 *   status            — booking + active PIN + recent tracking logs
 *   setup             — shift booking to NOW…NOW+N min, reset rental fields, create real PIN
 *   restore           — restore original booking dates from snapshot
 *   simulate_unlock   — inject unlock event → mark Rented + notify
 *   simulate_lock     — inject lock at/after scheduled end → mark Returned + notify
 *   sync              — pull real activity logs from the Wi-Fi bridge
 *   probe             — raw jobType 15 response (payload discovery)
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getCorsHeaders } from "./cors.ts";
import { applyLockEvent, sweepGraceHourReturns } from "../_shared/lockEventState.ts";
import { getBookingWindow } from "../_shared/pinTiming.ts";
import { parseActivityLogsFromPayload } from "../_shared/iglooActivity.ts";

const IGLOOHOME_OAUTH_URL = "https://auth.igloohome.co/oauth2/token";
const IGLOOHOME_API_BASE_URL = "https://api.igloodeveloper.co/igloohome";

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
  return new Promise((r) => setTimeout(r, ms));
}

/** Format a Date as MST calendar date + "h:mm AM/PM" slot (matches booking storage). */
function toMstDateAndSlot(d: Date): { date: string; timeSlot: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Denver",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(d);

  const get = (type: string) => parts.find((p) => p.type === type)?.value || "";
  const month = get("month");
  const day = get("day");
  const year = get("year");
  const hour = get("hour");
  const minute = get("minute");
  const dayPeriod = get("dayPeriod");
  return {
    date: `${year}-${month}-${day}`,
    timeSlot: `${hour}:${minute} ${dayPeriod}`,
  };
}

function isoPlusMinutes(minutes: number, from = new Date()): string {
  return new Date(from.getTime() + minutes * 60 * 1000)
    .toISOString()
    .replace(/\.\d{3}Z$/, "+00:00");
}

async function getOAuthToken(clientId: string, clientSecret: string) {
  const credentials = btoa(`${clientId}:${clientSecret}`);
  const res = await fetch(IGLOOHOME_OAUTH_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: [
        "igloohomeapi/create-pin-bridge-proxied-job",
        "igloohomeapi/create-bridge-proxied-job",
        "igloohomeapi/delete-pin-bridge-proxied-job",
        "igloohomeapi/get-devices",
        "igloohomeapi/get-job-status",
        "igloohomeapi/store-device-activity",
      ].join(" "),
    }),
  });
  const body = await readResponse(res);
  if (!res.ok || !body.json?.access_token) return null;
  return body.json.access_token as string;
}

async function requireAdmin(req: Request, supabase: ReturnType<typeof createClient>) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return { error: "Missing Authorization", status: 401 as const };
  const token = authHeader.replace("Bearer ", "");
  const anon = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: `Bearer ${token}` } } },
  );
  const { data: { user }, error } = await anon.auth.getUser();
  if (error || !user) return { error: "Unauthorized", status: 401 as const };
  const { data: admin } = await supabase
    .from("admin_users")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!admin) return { error: "Admin access required", status: 403 as const };
  return { user };
}

async function deleteBridgePin(
  accessToken: string,
  lockId: string,
  bridgeId: string,
  pin: string,
) {
  const url = `${IGLOOHOME_API_BASE_URL}/devices/${lockId}/jobs/bridges/${bridgeId}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ jobType: 5, jobData: { pin } }),
  });
  return res.ok || res.status === 201;
}

async function createBridgeDurationPin(
  accessToken: string,
  lockId: string,
  bridgeId: string,
  pin: string,
  startDate: string,
  endDate: string,
  accessName: string,
) {
  const url = `${IGLOOHOME_API_BASE_URL}/devices/${lockId}/jobs/bridges/${bridgeId}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      jobType: 4,
      jobData: { accessName, pin, pinType: 4, startDate, endDate },
    }),
  });
  const body = await readResponse(res);
  if (!res.ok && res.status !== 201) {
    return { success: false as const, error: body.text, raw: body.json };
  }
  return {
    success: true as const,
    pinId: String(body.json?.jobId || body.json?.pinId || body.json?.id || ""),
    raw: body.json,
  };
}

async function fetchBookingStatus(supabase: ReturnType<typeof createClient>, bookingId: number) {
  const { data: booking, error } = await supabase
    .from("bookings")
    .select(
      "id, name, email, phone, status, plan, addons, drop_off_date, drop_off_time_slot, pickup_date, pickup_time_slot, rented_out_at, returned_at, rental_started_notified_at, return_notified_at, pin_generated_at, archive_details",
    )
    .eq("id", bookingId)
    .single();
  if (error || !booking) return { error: error?.message || "Booking not found" };

  const { data: pin } = await supabase
    .from("rental_access_codes")
    .select("*")
    .eq("order_id", bookingId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: logs } = await supabase
    .from("rental_tracking_logs")
    .select("*")
    .eq("order_id", bookingId)
    .order("event_timestamp", { ascending: false })
    .limit(20);

  const window = getBookingWindow(booking);
  return {
    booking,
    pin,
    logs: logs || [],
    window: {
      startIso: window.startIso,
      endIso: window.endIso,
      graceEndIso: window.graceEndIso,
      pinEligibleFromMs: window.pinEligibleFromMs,
    },
    snapshot: booking.archive_details?.test_lock_snapshot || null,
  };
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  const jsonResponse = makeJsonResponse(corsHeaders);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return jsonResponse({ success: false, error: "Method not allowed" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const clientId = Deno.env.get("IGLOOHOME_CLIENT_ID") ?? "";
    const clientSecret = Deno.env.get("IGLOOHOME_CLIENT_SECRET") ?? "";
    const lockId = Deno.env.get("IGLOOHOME_LOCK_ID") || Deno.env.get("IGLOOHOME_DEVICE_ID") || "";
    const bridgeId = Deno.env.get("IGLOOHOME_BRIDGE_ID") || "";

    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const admin = await requireAdmin(req, supabase);
    if ("error" in admin && admin.error) {
      return jsonResponse({ success: false, error: admin.error }, admin.status);
    }

    const body = await req.json();
    const action = String(body.action || "status");
    const bookingId = Number(body.bookingId ?? body.booking_id ?? body.order_id);
    if (!bookingId || Number.isNaN(bookingId)) {
      return jsonResponse({ success: false, error: "bookingId is required" }, 400);
    }

    // -------- status --------
    if (action === "status") {
      const status = await fetchBookingStatus(supabase, bookingId);
      if (status.error) return jsonResponse({ success: false, error: status.error }, 404);
      return jsonResponse({ success: true, ...status });
    }

    // -------- restore --------
    if (action === "restore") {
      const { data: booking } = await supabase
        .from("bookings")
        .select("id, archive_details")
        .eq("id", bookingId)
        .single();
      const snap = booking?.archive_details?.test_lock_snapshot;
      if (!snap) {
        return jsonResponse({
          success: false,
          error: "No test_lock_snapshot found on this booking — nothing to restore",
        }, 400);
      }
      const archive = { ...(booking.archive_details || {}) };
      delete archive.test_lock_snapshot;
      await supabase
        .from("bookings")
        .update({
          drop_off_date: snap.drop_off_date,
          drop_off_time_slot: snap.drop_off_time_slot,
          pickup_date: snap.pickup_date,
          pickup_time_slot: snap.pickup_time_slot,
          status: snap.status || "Confirmed",
          rented_out_at: snap.rented_out_at ?? null,
          returned_at: snap.returned_at ?? null,
          rental_started_notified_at: snap.rental_started_notified_at ?? null,
          return_notified_at: snap.return_notified_at ?? null,
          pin_generated_at: snap.pin_generated_at ?? null,
          archive_details: archive,
        })
        .eq("id", bookingId);

      // Expire test PINs in DB (best-effort delete from lock)
      const { data: activePins } = await supabase
        .from("rental_access_codes")
        .select("id, access_pin, pin_type")
        .eq("order_id", bookingId)
        .eq("status", "active");

      if (activePins?.length && clientId && clientSecret && lockId && bridgeId) {
        const token = await getOAuthToken(clientId, clientSecret);
        if (token) {
          for (const row of activePins) {
            if (row.pin_type === "bridge_proxied" && row.access_pin) {
              await deleteBridgePin(token, lockId, bridgeId, row.access_pin);
            }
          }
        }
      }
      await supabase
        .from("rental_access_codes")
        .update({ status: "expired", lock_deleted_at: new Date().toISOString() })
        .eq("order_id", bookingId)
        .eq("status", "active");

      const status = await fetchBookingStatus(supabase, bookingId);
      return jsonResponse({ success: true, restored: true, ...status });
    }

    // -------- setup --------
    if (action === "setup") {
      const durationMinutes = Math.min(180, Math.max(5, Number(body.durationMinutes) || 30));
      const { data: booking, error } = await supabase
        .from("bookings")
        .select("*")
        .eq("id", bookingId)
        .single();
      if (error || !booking) {
        return jsonResponse({ success: false, error: "Booking not found" }, 404);
      }

      if (!clientId || !clientSecret || !lockId || !bridgeId) {
        return jsonResponse({
          success: false,
          error: "Missing IGLOOHOME_CLIENT_ID / SECRET / LOCK_ID / BRIDGE_ID",
        }, 500);
      }

      // Snapshot original schedule once (keep first snapshot if re-setup)
      const existingSnap = booking.archive_details?.test_lock_snapshot;
      const snapshot = existingSnap || {
        drop_off_date: booking.drop_off_date,
        drop_off_time_slot: booking.drop_off_time_slot,
        pickup_date: booking.pickup_date,
        pickup_time_slot: booking.pickup_time_slot,
        status: booking.status,
        rented_out_at: booking.rented_out_at,
        returned_at: booking.returned_at,
        rental_started_notified_at: booking.rental_started_notified_at,
        return_notified_at: booking.return_notified_at,
        pin_generated_at: booking.pin_generated_at,
        saved_at: new Date().toISOString(),
      };

      const startLocal = new Date(Date.now() - 2 * 60 * 1000); // 2 min ago so PIN is already active
      const endLocal = new Date(Date.now() + durationMinutes * 60 * 1000);
      const startMst = toMstDateAndSlot(startLocal);
      const endMst = toMstDateAndSlot(endLocal);

      // Expire existing active PINs on lock + DB
      const accessToken = await getOAuthToken(clientId, clientSecret);
      if (!accessToken) {
        return jsonResponse({ success: false, error: "OAuth failed" }, 502);
      }

      const { data: oldPins } = await supabase
        .from("rental_access_codes")
        .select("id, access_pin, pin_type")
        .eq("order_id", bookingId)
        .eq("status", "active");
      for (const row of oldPins || []) {
        if (row.pin_type === "bridge_proxied" && row.access_pin) {
          await deleteBridgePin(accessToken, lockId, bridgeId, row.access_pin);
        }
      }
      await supabase
        .from("rental_access_codes")
        .update({ status: "expired", lock_deleted_at: new Date().toISOString() })
        .eq("order_id", bookingId)
        .eq("status", "active");

      // Shift booking window + reset lifecycle fields
      await supabase
        .from("bookings")
        .update({
          drop_off_date: startMst.date,
          drop_off_time_slot: startMst.timeSlot,
          pickup_date: endMst.date,
          pickup_time_slot: endMst.timeSlot,
          status: "Confirmed",
          rented_out_at: null,
          returned_at: null,
          rental_started_notified_at: null,
          return_notified_at: null,
          pin_generated_at: null,
          pin_notification_sent_at: null,
          archive_details: {
            ...(booking.archive_details || {}),
            test_lock_snapshot: snapshot,
          },
        })
        .eq("id", bookingId);

      // Create short-lived bridge PIN (start slightly in past, end = duration)
      const pin = String(Math.floor(Math.random() * 900000) + 100000);
      const startIso = isoPlusMinutes(-2);
      const endIso = isoPlusMinutes(durationMinutes);
      const pinResult = await createBridgeDurationPin(
        accessToken,
        lockId,
        bridgeId,
        pin,
        startIso,
        endIso,
        `TEST Lock Lifecycle - Order #${bookingId}`,
      );
      if (!pinResult.success) {
        return jsonResponse({
          success: false,
          error: `Bridge PIN failed: ${pinResult.error}`,
          raw: pinResult.raw,
        }, 502);
      }

      const now = new Date().toISOString();
      await supabase.from("rental_access_codes").insert({
        order_id: bookingId,
        customer_email: booking.email,
        customer_phone: booking.phone || "",
        access_pin: pin,
        pin_id: pinResult.pinId,
        pin_type: "bridge_proxied",
        lock_id: lockId,
        start_time: startIso,
        end_time: endIso,
        status: "active",
      });
      await supabase
        .from("bookings")
        .update({ pin_generated_at: now })
        .eq("id", bookingId);

      await supabase.from("rental_tracking_logs").insert({
        order_id: bookingId,
        event_type: "admin_override",
        event_timestamp: now,
        notes: `TEST setup: ${durationMinutes}min window, PIN ${pin} valid ${startIso} → ${endIso}`,
      });

      const status = await fetchBookingStatus(supabase, bookingId);
      return jsonResponse({
        success: true,
        action: "setup",
        pin,
        durationMinutes,
        instructions: [
          `PIN ${pin} is active on the lock for ~${durationMinutes} minutes.`,
          "Walk to the lock (keep it in Wi-Fi/bridge range), enter the PIN, and unlock.",
          "Then click Sync Lock Activity — or Simulate Unlock if you want to skip the physical step.",
          "After unlock is marked Rented, lock the padlock again (or Simulate Lock) to test Returned + emails/SMS.",
          "Click Restore Dates when finished so the booking schedule is put back.",
        ],
        ...status,
      });
    }

    // -------- simulate_unlock --------
    if (action === "simulate_unlock") {
      const status = await fetchBookingStatus(supabase, bookingId);
      if (status.error) return jsonResponse({ success: false, error: status.error }, 404);
      const ts = body.eventTimestamp || new Date().toISOString();
      const result = await applyLockEvent(supabase, {
        orderId: bookingId,
        eventType: "unlock",
        eventTimestamp: ts,
        notes: "TEST simulate_unlock",
      });
      const after = await fetchBookingStatus(supabase, bookingId);
      return jsonResponse({ success: true, action: "simulate_unlock", result, ...after });
    }

    // -------- simulate_lock --------
    if (action === "simulate_lock") {
      const status = await fetchBookingStatus(supabase, bookingId);
      if (status.error) return jsonResponse({ success: false, error: status.error }, 404);
      const window = getBookingWindow(status.booking!);
      // Use max(now, scheduled end) so the return rule always fires
      const nowMs = Date.now();
      const eventMs = Math.max(nowMs, window.endMs);
      const ts = body.eventTimestamp || new Date(eventMs).toISOString();
      const result = await applyLockEvent(supabase, {
        orderId: bookingId,
        eventType: "lock",
        eventTimestamp: ts,
        notes: "TEST simulate_lock (timestamp forced to at/after scheduled end)",
      });
      const swept = await sweepGraceHourReturns(supabase);
      const after = await fetchBookingStatus(supabase, bookingId);
      return jsonResponse({
        success: true,
        action: "simulate_lock",
        result,
        graceHourClosed: swept,
        ...after,
      });
    }

    // -------- sync / probe (bridge activity logs) --------
    if (action === "sync" || action === "probe") {
      if (!clientId || !clientSecret || !lockId || !bridgeId) {
        return jsonResponse({ success: false, error: "Missing Igloohome env" }, 500);
      }
      const accessToken = await getOAuthToken(clientId, clientSecret);
      if (!accessToken) return jsonResponse({ success: false, error: "OAuth failed" }, 502);

      const createRes = await fetch(
        `${IGLOOHOME_API_BASE_URL}/devices/${lockId}/jobs/bridges/${bridgeId}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            jobType: 15,
            jobData: {
              lockTime: new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00"),
            },
          }),
        },
      );
      const createBody = await readResponse(createRes);
      const jobId = createBody.json?.jobId || createBody.json?.id;
      if ((!createRes.ok && createRes.status !== 201) || !jobId) {
        return jsonResponse({
          success: false,
          error: "Activity log job failed",
          raw: createBody.json || createBody.text,
        }, 502);
      }

      let jobRaw: unknown = null;
      let completed = false;
      for (let i = 0; i < 24; i++) {
        await sleep(2500);
        const poll = await fetch(`${IGLOOHOME_API_BASE_URL}/jobs/${jobId}`, {
          headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
        });
        const pollBody = await readResponse(poll);
        jobRaw = pollBody.json;
        if (pollBody.json?.completed === true || pollBody.json?.jobResponse?.jobStatus === 0) {
          completed = true;
          break;
        }
        if (pollBody.json?.jobResponse?.jobStatus === 2) break;
      }

      if (action === "probe") {
        return jsonResponse({
          success: true,
          probe: true,
          jobId,
          jobResult: jobRaw,
          parsedEvents: parseActivityLogsFromPayload(jobRaw),
        });
      }

      if (!completed) {
        return jsonResponse({
          success: false,
          error: "Activity log job did not complete — is the lock in bridge range?",
          jobId,
          raw: jobRaw,
        }, 504);
      }

      // Delegate to the shared sync path via internal invoke would recurse;
      // instead apply events that match this booking's PIN.
      const events = parseActivityLogsFromPayload(jobRaw);
      const { data: pinRow } = await supabase
        .from("rental_access_codes")
        .select("access_pin")
        .eq("order_id", bookingId)
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const actions: string[] = [];
      for (const event of events) {
        if (pinRow?.access_pin && event.pinCode && event.pinCode !== pinRow.access_pin) {
          continue;
        }
        // If no PIN on event, still apply to this booking when testing a single lock
        const result = await applyLockEvent(supabase, {
          orderId: bookingId,
          eventType: event.eventType,
          eventTimestamp: event.eventTimestamp,
          notes: `TEST sync job ${jobId}`,
        });
        actions.push(`${event.eventType}@${event.eventTimestamp}:${result}`);
      }
      const swept = await sweepGraceHourReturns(supabase);
      const after = await fetchBookingStatus(supabase, bookingId);
      return jsonResponse({
        success: true,
        action: "sync",
        jobId,
        eventsParsed: events.length,
        actions,
        graceHourClosed: swept,
        ...after,
      });
    }

    return jsonResponse({
      success: false,
      error: `Unknown action: ${action}. Use status|setup|restore|simulate_unlock|simulate_lock|sync|probe`,
    }, 400);
  } catch (error) {
    console.error("[test-lock-lifecycle] Unhandled:", error);
    return jsonResponse({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }, 500);
  }
});
