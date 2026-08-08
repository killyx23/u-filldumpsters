/**
 * send-return-confirmation
 *
 * Fired when the final lock of a self-pickup rental is detected (at/after
 * scheduled end). Sends thank-you email + SMS with referral info and review CTA.
 *
 * Status / returned_at are written by the lock event state machine — this
 * function only notifies and sets return_notified_at.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getCorsHeaders } from "./cors.ts";
import { sendEmail, sendSms } from "../_shared/notify.ts";
import { normalizeSiteUrl } from "../_shared/normalizeSiteUrl.ts";

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

function formatDollars(amount: number | null | undefined): string {
  const n = Number(amount) || 0;
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function buildEmailHTML(opts: {
  name: string;
  orderId: number | string;
  returnedAt: string;
  portalUrl: string;
  reviewUrl: string;
  referralUrl: string | null;
  referralBalance: number;
}): string {
  const {
    name,
    orderId,
    returnedAt,
    portalUrl,
    reviewUrl,
    referralUrl,
    referralBalance,
  } = opts;

  const referralBlock = referralUrl
    ? `<div style="background:#ecfdf5;border:1px solid #10b981;border-radius:8px;padding:16px;margin:20px 0;">
        <p style="margin:0 0 8px 0;font-weight:bold;color:#065f46;">Share the love — earn referral rewards</p>
        <p style="margin:0 0 8px 0;color:#047857;">
          ${
            referralBalance > 0
              ? `You currently have <strong>${formatDollars(referralBalance)}</strong> in referral rewards available for your next booking.`
              : "Invite friends and family to book with U-Fill Dumpsters and earn referral rewards you can use on your next rental."
          }
        </p>
        <p style="margin:0;color:#047857;">Your personal referral link:<br/>
          <a href="${referralUrl}" style="color:#047857;font-weight:bold;word-break:break-all;">${referralUrl}</a>
        </p>
      </div>`
    : "";

  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,sans-serif;">
  <div style="max-width:600px;margin:24px auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,0.08);">
    <div style="background:linear-gradient(135deg,#065f46 0%,#10b981 100%);padding:36px 24px;text-align:center;">
      <h1 style="color:#ffffff;margin:0;font-size:26px;">Thank You for Your Rental!</h1>
      <p style="color:#d1fae5;margin:10px 0 0 0;">Order #${orderId}</p>
    </div>
    <div style="padding:28px 24px;color:#1f2937;line-height:1.55;">
      <p>Hi ${name || "there"},</p>
      <p>Thank you for using <strong>U-Fill Dumpsters</strong>. We confirmed that your rental was locked and returned at <strong>${returnedAt}</strong>.</p>
      <p>Our team will complete a final inspection shortly. <strong>Any final charges</strong> (dump fees, overtime, damage, or other adjustments) will be sent to this email separately. If there are no additional charges, you are all set.</p>
      ${referralBlock}
      <div style="background:#eff6ff;border:1px solid #3b82f6;border-radius:8px;padding:16px;margin:20px 0;">
        <p style="margin:0 0 8px 0;font-weight:bold;color:#1e3a8a;">Loved the service?</p>
        <p style="margin:0;color:#1e40af;">We would be grateful if you left a quick review in your customer portal, and please share your referral link with friends and family so they can enjoy the same convenience — and so you can earn referral rewards.</p>
      </div>
      <p style="text-align:center;margin:24px 0;">
        <a href="${reviewUrl}" style="display:inline-block;background:#1e3a8a;color:#ffffff;padding:12px 22px;text-decoration:none;border-radius:8px;font-weight:bold;margin:4px;">Leave a Review</a>
        <a href="${portalUrl}" style="display:inline-block;background:#3b82f6;color:#ffffff;padding:12px 22px;text-decoration:none;border-radius:8px;font-weight:bold;margin:4px;">Customer Portal</a>
      </p>
      <p>We appreciate your business and hope to see you again soon.</p>
      <p style="color:#6b7280;font-size:12px;">If you did not return this rental, please contact us immediately.</p>
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
    const lockEventTimestamp = body.lock_event_timestamp || new Date().toISOString();
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

    if (booking.return_notified_at) {
      return jsonResponse({
        success: true,
        skipped: true,
        reason: "already_notified",
        order_id: orderId,
      });
    }

    const customer = booking.customers || {};
    const customerId = booking.customer_id || customer.id;
    const name = booking.name || customer.name || "Customer";
    const email = booking.email || customer.email;
    const phone = booking.phone || customer.phone;
    const smsOptIn = customer.sms_opt_in !== false;

    const siteUrl = normalizeSiteUrl(body.site_url || Deno.env.get("SITE_URL"));
    const portalUrl = `${siteUrl}/customer-portal`;
    const reviewUrl = `${siteUrl}/customer-portal?tab=communication`;

    let referralUrl: string | null = null;
    let referralBalance = 0;

    if (customerId) {
      const [{ data: referralRows }, { data: wallet }] = await Promise.all([
        supabase
          .from("referrals")
          .select("referral_code")
          .eq("referrer_customer_id", customerId)
          .order("created_at", { ascending: true })
          .limit(1),
        supabase
          .from("customer_referral_wallets")
          .select("available_balance")
          .eq("customer_id", customerId)
          .maybeSingle(),
      ]);

      const code = referralRows?.[0]?.referral_code;
      if (code) {
        referralUrl = `${siteUrl}/?ref=${encodeURIComponent(code)}`;
      }
      referralBalance = Number(wallet?.available_balance) || 0;
    }

    const returnedAtFriendly = formatFriendly(lockEventTimestamp);
    const html = buildEmailHTML({
      name,
      orderId,
      returnedAt: returnedAtFriendly,
      portalUrl,
      reviewUrl,
      referralUrl,
      referralBalance,
    });

    const emailResult = email
      ? await sendEmail(email, `Thank you for your rental! (Order #${orderId})`, html)
      : { success: false, error: "No email" };

    const smsParts = [
      `U-Fill Dumpsters: Thanks for returning your rental (locked ${returnedAtFriendly}).`,
      "Any final charges will be emailed after inspection.",
    ];
    if (referralUrl) {
      smsParts.push(`Share & earn rewards: ${referralUrl}`);
    }
    smsParts.push(`Review us: ${reviewUrl}`);
    const smsResult = await sendSms(phone, smsParts.join(" "), { smsOptIn });

    // Admin alert (best-effort)
    const adminEmail = Deno.env.get("BREVO_FROM_EMAIL");
    if (adminEmail) {
      await sendEmail(
        adminEmail,
        `Trailer Returned — Order #${orderId}`,
        `<h2>Trailer Return Notification</h2>
         <p><strong>Order:</strong> #${orderId}</p>
         <p><strong>Customer:</strong> ${name} (${email || "n/a"})</p>
         <p><strong>Return Time:</strong> ${returnedAtFriendly}</p>
         <p><strong>Status:</strong> pending_checklist — awaiting inspection</p>`,
      );
    }

    const now = new Date().toISOString();
    await supabase
      .from("bookings")
      .update({ return_notified_at: now })
      .eq("id", orderId);

    console.log("[send-return-confirmation] Done", { orderId, emailResult, smsResult });
    return jsonResponse({
      success: true,
      order_id: orderId,
      email: emailResult,
      sms: smsResult,
    });
  } catch (error) {
    console.error("[send-return-confirmation] Error:", error);
    return jsonResponse({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }, 500);
  }
});
