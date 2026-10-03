/**
 * send-rental-started
 *
 * Fired when the first unlock of a self-pickup rental is detected.
 * Sends thank-you email + SMS with how-to guides link, safety reminder,
 * and the scheduled return deadline.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getCorsHeaders } from "./cors.ts";
import { sendEmail, sendSms } from "../_shared/notify.ts";
import { normalizeSiteUrl } from "../_shared/normalizeSiteUrl.ts";
import { formatPlainBookingTime } from "../_shared/formatBookingTime.ts";
import { getBookingWindow } from "../_shared/pinTiming.ts";

function makeJsonResponse(corsHeaders: Record<string, string>) {
  return (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
}

function formatFriendly(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-US", {
      timeZone: "America/Denver",
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function buildEmailHTML(opts: {
  name: string;
  orderId: number | string;
  unlockAt: string;
  returnDeadline: string;
  portalUrl: string;
  guidesUrl: string;
}): string {
  const { name, orderId, unlockAt, returnDeadline, portalUrl, guidesUrl } = opts;
  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,sans-serif;">
  <div style="max-width:600px;margin:24px auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,0.08);">
    <div style="background:linear-gradient(135deg,#1e3a8a 0%,#3b82f6 100%);padding:36px 24px;text-align:center;">
      <h1 style="color:#ffffff;margin:0;font-size:26px;">Thank You for Renting With Us!</h1>
      <p style="color:#e0f2fe;margin:10px 0 0 0;">Order #${orderId}</p>
    </div>
    <div style="padding:28px 24px;color:#1f2937;line-height:1.55;">
      <p>Hi ${name || "there"},</p>
      <p>Thank you for using <strong>U-Fill Dumpsters</strong>. We recorded that you unlocked your rental at <strong>${unlockAt}</strong>.</p>
      <p>If you need help with hitching, loading, dumping, or anything else, visit your customer portal for how-to guides, videos, and other resources:</p>
      <p style="text-align:center;margin:24px 0;">
        <a href="${guidesUrl}" style="display:inline-block;background:#1e3a8a;color:#ffffff;padding:12px 22px;text-decoration:none;border-radius:8px;font-weight:bold;">Open How-To Guides</a>
      </p>
      <div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:8px;padding:16px;margin:20px 0;">
        <p style="margin:0 0 8px 0;font-weight:bold;color:#92400e;">Safety &amp; return reminder</p>
        <p style="margin:0;color:#78350f;">Your rental period ends on <strong>${returnDeadline}</strong>. Please have everything loaded and secured under the lock by that time.</p>
      </div>
      <p style="text-align:center;margin:24px 0;">
        <a href="${portalUrl}" style="display:inline-block;background:#3b82f6;color:#ffffff;padding:12px 22px;text-decoration:none;border-radius:8px;font-weight:bold;">Go to Customer Portal</a>
      </p>
      <p style="color:#6b7280;font-size:13px;">Questions? Reply to this email or contact us through your portal.</p>
      <p>Thank you again for choosing U-Fill Dumpsters!</p>
    </div>
  </div>
</body></html>`;
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  const jsonResponse = makeJsonResponse(corsHeaders);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const orderId = body.order_id ?? body.bookingId ?? body.booking_id;
    const unlockTimestamp = body.unlock_timestamp || new Date().toISOString();
    if (!orderId) {
      return jsonResponse({ success: false, error: "order_id required" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { data: booking, error } = await supabase
      .from("bookings")
      .select("*, customers(*)")
      .eq("id", orderId)
      .single();
    if (error || !booking) {
      return jsonResponse({ success: false, error: error?.message || "Booking not found" }, 404);
    }

    if (booking.rental_started_notified_at) {
      return jsonResponse({
        success: true,
        skipped: true,
        reason: "already_notified",
        order_id: orderId,
      });
    }

    const siteUrl = normalizeSiteUrl(body.site_url || Deno.env.get("SITE_URL"));
    const portalUrl = `${siteUrl}/customer-portal`;
    const guidesUrl = `${siteUrl}/customer-portal?tab=guides`;
    const window = getBookingWindow(booking);
    const returnDeadline = booking.pickup_time_slot
      ? `${booking.pickup_date} ${formatPlainBookingTime(booking.pickup_time_slot) || booking.pickup_time_slot}`
      : formatFriendly(window.endIso);

    const customer = booking.customers || {};
    const name = booking.name || customer.name || "Customer";
    const email = booking.email || customer.email;
    const phone = booking.phone || customer.phone;
    const smsOptIn = customer.sms_opt_in !== false;

    const html = buildEmailHTML({
      name,
      orderId,
      unlockAt: formatFriendly(unlockTimestamp),
      returnDeadline,
      portalUrl,
      guidesUrl,
    });

    const emailResult = email
      ? await sendEmail(email, `You're all set — rental started (Order #${orderId})`, html)
      : { success: false, error: "No email" };

    const smsContent =
      `U-Fill Dumpsters: Thanks for renting with us! Your rental started at ${formatFriendly(unlockTimestamp)}. ` +
      `Return by ${returnDeadline} and lock securely. Guides: ${guidesUrl}`;
    const smsResult = await sendSms(phone, smsContent, { smsOptIn });

    const now = new Date().toISOString();
    await supabase
      .from("bookings")
      .update({ rental_started_notified_at: now })
      .eq("id", orderId);

    console.log("[send-rental-started] Done", { orderId, emailResult, smsResult });
    return jsonResponse({
      success: true,
      order_id: orderId,
      email: emailResult,
      sms: smsResult,
    });
  } catch (error) {
    console.error("[send-rental-started] Error:", error);
    return jsonResponse({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }, 500);
  }
});
