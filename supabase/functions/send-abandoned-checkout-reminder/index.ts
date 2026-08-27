/**
 * send-abandoned-checkout-reminder
 *
 * Finds pending_payment bookings between 1h and 2h old that have not been
 * reminded yet, sends a professional finish-your-order email, stamps
 * addons.abandoned_reminder_sent_at, and upserts abandoned_checkouts.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getCorsHeaders } from "./cors.ts";
import { sendEmail } from "../_shared/notify.ts";
import { normalizeSiteUrl } from "../_shared/normalizeSiteUrl.ts";
import { formatCustomerFacingPlanName } from "../_shared/displayPlanName.ts";
import { formatBookingTime, parseBookingTimeToDate } from "../_shared/formatBookingTime.ts";

function jsonResponse(corsHeaders: Record<string, string>, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "N/A";
  try {
    const d = new Date(`${value}T12:00:00`);
    return d.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return String(value);
  }
}

function formatTimeSlot(raw: string | null | undefined): string {
  if (!raw) return "N/A";
  const s = String(raw);
  if (s.includes("|")) {
    const [start, end] = s.split("|").map((t) => t.trim());
    const a = parseBookingTimeToDate(start);
    const b = parseBookingTimeToDate(end);
    if (a && b) {
      const fmt = (d: Date) =>
        d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
      return `${fmt(a)} - ${fmt(b)}`;
    }
  }
  return formatBookingTime(s);
}

function money(amount: unknown): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) return "$0.00";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

function benefitCopy(serviceName: string, plan: Record<string, unknown>, addons: Record<string, unknown>): string {
  const name = (serviceName || "").toLowerCase();
  const isDelivery = Boolean(addons?.isDelivery || addons?.deliveryService || name.includes("delivery"));
  const planId = Number(plan?.id);

  if (planId === 2 || name.includes("dump trailer") || name.includes("dumpster")) {
    if (isDelivery) {
      return "Your Dump Trailer with Delivery is reserved in our system—convenient drop-off and pickup so you can focus on the job, not the logistics.";
    }
    return "Your dump trailer rental is almost ready. Finish checkout to lock in your dates and get clear pickup instructions.";
  }
  if (planId === 1 || name.includes("compact") || name.includes("equipment")) {
    return "The compact equipment you selected is still available on your hold. Complete payment to secure it for your project timeline.";
  }
  if (name.includes("rock") || name.includes("mulch") || name.includes("gravel") || name.includes("material")) {
    return "Your material delivery selection is saved. Finish checkout so we can schedule delivery for the dates you chose.";
  }
  return "Your rental details are saved and waiting. Completing checkout takes just a minute and keeps your preferred schedule.";
}

function equipmentListHtml(addons: Record<string, unknown>): string {
  const equipment = Array.isArray(addons?.equipment) ? addons.equipment : [];
  if (equipment.length === 0) return "";
  const items = equipment
    .map((item: Record<string, unknown>) => {
      const label = String(item.name || item.label || item.id || "Equipment");
      const qty = Number(item.quantity || 1);
      return `<li style="padding:6px 0;border-bottom:1px solid #e5e7eb;">${label} × ${qty}</li>`;
    })
    .join("");
  return `
    <div style="margin-top:18px;">
      <h3 style="margin:0 0 8px;color:#1e3a8a;font-size:16px;">Selected add-ons</h3>
      <ul style="list-style:none;padding:0;margin:0;">${items}</ul>
    </div>`;
}

function protectionListHtml(addons: Record<string, unknown>): string {
  const bits: string[] = [];
  if (addons?.insurance === "accept") bits.push("Rental Insurance");
  if (addons?.drivewayProtection === "accept") bits.push("Driveway Protection");
  if (bits.length === 0) return "";
  return `<p style="margin:12px 0 0;color:#374151;font-size:14px;"><strong>Protection:</strong> ${bits.join(" · ")}</p>`;
}

function buildReminderHtml(booking: Record<string, unknown>, siteUrl: string): string {
  const plan = (booking.plan || {}) as Record<string, unknown>;
  const addons = (booking.addons || {}) as Record<string, unknown>;
  const serviceName = formatCustomerFacingPlanName(plan.name || "Your rental");
  const firstName = String(booking.first_name || "").trim() ||
    String(booking.name || "there").trim().split(/\s+/)[0] ||
    "there";
  const total = money(booking.total_price);
  const dropOff = `${formatDate(String(booking.drop_off_date || ""))} · ${formatTimeSlot(String(booking.drop_off_time_slot || ""))}`;
  const pickUp = `${formatDate(String(booking.pickup_date || ""))} · ${formatTimeSlot(String(booking.pickup_time_slot || ""))}`;
  const ctaUrl = `${siteUrl}/`;
  const benefit = benefitCopy(serviceName, plan, addons);

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /></head>
<body style="margin:0;padding:0;background:#0f172a;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:640px;margin:0 auto;padding:24px 16px;">
    <div style="background:#111827;border:1px solid #334155;border-radius:16px;overflow:hidden;">
      <div style="background:linear-gradient(135deg,#1e3a8a,#0f172a);padding:28px 24px;text-align:center;">
        <p style="margin:0;color:#fbbf24;font-size:12px;letter-spacing:1.5px;text-transform:uppercase;font-weight:700;">U-Fill Dumpsters</p>
        <h1 style="margin:10px 0 0;color:#ffffff;font-size:24px;line-height:1.3;">Your rental is waiting</h1>
      </div>
      <div style="padding:28px 24px;background:#ffffff;color:#111827;">
        <p style="margin:0 0 14px;font-size:16px;">Hi ${firstName},</p>
        <p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:#374151;">
          You started a booking with us and left before payment was completed. We saved your details so you can finish whenever you are ready.
        </p>
        <p style="margin:0 0 18px;font-size:15px;line-height:1.55;color:#374151;">${benefit}</p>

        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:16px 18px;">
          <p style="margin:0 0 8px;color:#1e3a8a;font-weight:700;font-size:15px;">${serviceName}</p>
          <p style="margin:0;color:#475569;font-size:14px;line-height:1.5;"><strong>Start:</strong> ${dropOff}</p>
          <p style="margin:6px 0 0;color:#475569;font-size:14px;line-height:1.5;"><strong>End:</strong> ${pickUp}</p>
          <p style="margin:12px 0 0;color:#0f172a;font-size:18px;font-weight:700;">Total: ${total}</p>
          ${protectionListHtml(addons)}
          ${equipmentListHtml(addons)}
        </div>

        <div style="text-align:center;margin:28px 0 10px;">
          <a href="${ctaUrl}" style="display:inline-block;background:#eab308;color:#111827;text-decoration:none;font-weight:700;padding:14px 28px;border-radius:10px;font-size:15px;">
            Finish your booking
          </a>
        </div>
        <p style="margin:0;font-size:13px;line-height:1.5;color:#64748b;text-align:center;">
          Prefer to start fresh? Visit our site, choose the same service, and we will help you get scheduled.
        </p>
      </div>
      <div style="padding:18px 24px;background:#0f172a;text-align:center;">
        <p style="margin:0;color:#94a3b8;font-size:12px;line-height:1.5;">
          You fill it, we dump it — convenience brought to you.<br/>
          Questions? Reply to this email or visit <a href="${siteUrl}" style="color:#fbbf24;text-decoration:none;">u-filldumpsters.com</a>
        </p>
      </div>
    </div>
  </div>
</body>
</html>`;
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    const siteUrl = normalizeSiteUrl();
    const now = Date.now();
    const oneHourAgo = new Date(now - 60 * 60 * 1000).toISOString();
    const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString();

    const { data: bookings, error } = await supabase
      .from("bookings")
      .select(
        "id, email, phone, name, first_name, last_name, status, plan, addons, total_price, drop_off_date, pickup_date, drop_off_time_slot, pickup_time_slot, contact_address, delivery_address, created_at",
      )
      .eq("status", "pending_payment")
      .lt("created_at", oneHourAgo)
      .gte("created_at", twoHoursAgo)
      .order("created_at", { ascending: true })
      .limit(100);

    if (error) throw error;

    const candidates = (bookings || []).filter((b) => {
      const addons = (b.addons || {}) as Record<string, unknown>;
      return !addons.abandoned_reminder_sent_at;
    });

    let sent = 0;
    let skipped = 0;
    const errors: Array<{ bookingId: number; error: string }> = [];

    for (const booking of candidates) {
      const email = String(booking.email || "").trim();
      if (!email) {
        skipped += 1;
        continue;
      }

      // Skip if already filed as intentional leave-early (cancelled + CRM lead)
      const { data: existingLead } = await supabase
        .from("abandoned_checkouts")
        .select("id, status")
        .eq("booking_id", booking.id)
        .maybeSingle();

      if (existingLead?.status === "left_early") {
        skipped += 1;
        continue;
      }

      const plan = (booking.plan || {}) as Record<string, unknown>;
      const serviceName = formatCustomerFacingPlanName(plan.name || "your rental");
      const html = buildReminderHtml(booking as Record<string, unknown>, siteUrl);
      const subject = `Still interested? Finish your ${serviceName} booking`;

      const emailResult = await sendEmail(email, subject, html);
      if (!emailResult.success) {
        errors.push({ bookingId: booking.id, error: emailResult.error || "send failed" });
        continue;
      }

      const nextAddons = {
        ...((booking.addons || {}) as Record<string, unknown>),
        abandoned_reminder_sent_at: new Date().toISOString(),
      };

      const { error: stampError } = await supabase
        .from("bookings")
        .update({ addons: nextAddons })
        .eq("id", booking.id)
        .eq("status", "pending_payment");

      if (stampError) {
        errors.push({ bookingId: booking.id, error: stampError.message });
      }

      const { error: upsertError } = await supabase.rpc("upsert_abandoned_checkout_from_booking", {
        p_booking_id: booking.id,
        p_status: "reminded",
        p_set_reminder_sent: true,
      });

      if (upsertError) {
        console.error("[send-abandoned-checkout-reminder] upsert failed:", upsertError);
        errors.push({ bookingId: booking.id, error: upsertError.message });
      }

      sent += 1;
    }

    return jsonResponse(corsHeaders, {
      ok: true,
      scanned: bookings?.length || 0,
      candidates: candidates.length,
      sent,
      skipped,
      errors,
    });
  } catch (err) {
    console.error("[send-abandoned-checkout-reminder] CRITICAL:", err);
    return jsonResponse(
      corsHeaders,
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      500,
    );
  }
});
