import { getCorsHeaders } from "./cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { formatPlainBookingTime } from "../_shared/formatBookingTime.ts";
import { normalizeSiteUrl } from "../_shared/normalizeSiteUrl.ts";
import { formatCustomerFacingPlanName } from "../_shared/displayPlanName.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const BREVO_API_KEY = Deno.env.get("BREVO_API_KEY");
const BREVO_FROM_EMAIL = Deno.env.get("BREVO_FROM_EMAIL") || "noreply@u-filldumpsters.com";

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(amount) || 0);

const formatDate = (dateString: unknown) => {
  if (!dateString) return "N/A";
  try {
    const raw = String(dateString);
    const dateOnly = raw.match(/^(\d{4}-\d{2}-\d{2})/);
    if (dateOnly) {
      const [y, m, d] = dateOnly[1].split("-").map(Number);
      const local = new Date(y, m - 1, d);
      return local.toLocaleDateString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      });
    }
    return new Date(raw).toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return String(dateString);
  }
};

const formatDateTime = (dateValue: unknown, timeValue: unknown) => {
  const datePart = formatDate(dateValue);
  const timePart = timeValue ? formatPlainBookingTime(String(timeValue)) : null;
  if (datePart !== "N/A" && timePart && timePart !== "N/A") return `${datePart} at ${timePart}`;
  return datePart;
};

const formatAddonList = (addons: unknown) => {
  if (!Array.isArray(addons) || addons.length === 0) return "None";
  return addons
    .map((a: Record<string, unknown>) => {
      const name = String(a?.name || a?.label || "Add-on");
      const qty = Number(a?.quantity || 1);
      return `${name} (qty ${qty})`;
    })
    .join(", ");
};

const parseJsonField = (value: unknown) => {
  if (value == null) return {};
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }
  if (typeof value === "object") return value as Record<string, unknown>;
  return {};
};

const sendEmailWithRetry = async (toEmail: string, subject: string, htmlContent: string, maxRetries = 2) => {
  let lastError: string | null = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      if (BREVO_API_KEY) {
        const brevoResponse = await fetch("https://api.brevo.com/v3/smtp/email", {
          method: "POST",
          headers: {
            "api-key": BREVO_API_KEY,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            sender: { email: BREVO_FROM_EMAIL, name: "U-Fill Dumpsters" },
            to: [{ email: toEmail }],
            subject,
            htmlContent,
          }),
        });
        if (brevoResponse.ok) {
          return { success: true, provider: "brevo", result: await brevoResponse.json() };
        }
        lastError = `Brevo API error: ${await brevoResponse.text()}`;
      }
      if (RESEND_API_KEY) {
        const resendResponse = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: "U-Fill Dumpsters <noreply@u-filldumpsters.com>",
            to: [toEmail],
            subject,
            html: htmlContent,
          }),
        });
        if (resendResponse.ok) {
          return { success: true, provider: "resend", result: await resendResponse.json() };
        }
        lastError = `Resend API error: ${await resendResponse.text()}`;
      }
      if (!RESEND_API_KEY && !BREVO_API_KEY) {
        lastError = "No email service configured";
        break;
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }
  return { success: false, error: lastError };
};

const sectionBlock = (title: string, rows: Array<[string, string]>) => {
  const body = rows
    .filter(([, v]) => v)
    .map(
      ([label, value]) =>
        `<tr><td style="padding:6px 0;color:#6b7280;width:140px;vertical-align:top;">${label}</td><td style="padding:6px 0;color:#111827;font-weight:600;">${value}</td></tr>`,
    )
    .join("");
  if (!body) return "";
  return `
    <div style="margin: 0 0 22px 0;">
      <h3 style="margin:0 0 10px 0;color:#1f2937;font-size:15px;text-transform:uppercase;letter-spacing:0.04em;">${title}</h3>
      <table style="width:100%;border-collapse:collapse;">${body}</table>
    </div>`;
};

const generateRescheduleEmailHTML = (opts: {
  booking: Record<string, unknown>;
  customerName: string;
  originalTotal: number;
  newTotal: number;
  delta: number;
  stripeType: string;
  stripeTransactionId: string | null;
  amountProcessed: number;
  snapshot: Record<string, unknown> | null;
  siteUrl: string;
}) => {
  const { booking, customerName, originalTotal, newTotal, delta, stripeType, stripeTransactionId, amountProcessed, snapshot, siteUrl } = opts;
  const snap = snapshot || {};
  const receiptHistory = Array.isArray(booking.receipt_status_history) ? booking.receipt_status_history : [];
  const latestApproval = [...receiptHistory].reverse().find((e: Record<string, unknown>) => e?.action === "reschedule_approved") || null;
  const source = { ...snap, ...(latestApproval || {}) } as Record<string, unknown>;

  const originalDrop = formatDateTime(source.original_drop_off_date || booking.drop_off_date, source.original_drop_off_time || booking.drop_off_time_slot);
  const originalPick = formatDateTime(source.original_pickup_date || booking.pickup_date, source.original_pickup_time || booking.pickup_time_slot);
  const newDrop = formatDateTime(source.new_drop_off_date || booking.drop_off_date, source.new_drop_off_time || booking.drop_off_time_slot);
  const newPick = formatDateTime(source.new_pickup_date || booking.pickup_date, source.new_pickup_time || booking.pickup_time_slot);

  const serviceFrom = formatCustomerFacingPlanName(String(source.original_service_name || (booking.plan as Record<string, unknown>)?.name || "N/A"));
  const serviceTo = formatCustomerFacingPlanName(String(source.new_service_name || (booking.plan as Record<string, unknown>)?.name || serviceFrom));
  const serviceChanged = serviceFrom !== serviceTo;

  const addressChanged = Boolean(source.address_changed);
  const fromAddr = String(source.original_address || "").trim();
  const toAddr = String(source.new_address || "").trim();

  let stripeLine = "No additional charge or refund.";
  if (stripeType === "charge") stripeLine = `Card charged ${formatCurrency(amountProcessed || Math.abs(delta))}`;
  if (stripeType === "refund") stripeLine = `Refunded to card ${formatCurrency(amountProcessed || Math.abs(delta))}`;

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Reschedule Approved</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:640px;margin:24px auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
    <div style="background:#1d4ed8;padding:28px 24px;color:#fff;">
      <h1 style="margin:0;font-size:24px;">Reschedule Approved</h1>
      <p style="margin:8px 0 0;opacity:0.9;">Booking #${booking.id} — confirmation of your approved changes</p>
    </div>
    <div style="padding:28px 24px;">
      <p style="color:#374151;font-size:15px;line-height:1.5;">Hi ${customerName},</p>
      <p style="color:#374151;font-size:15px;line-height:1.5;">Your reschedule request has been reviewed and approved. Below is a clear summary of what changed and how your payment was updated.</p>

      ${sectionBlock("Previous schedule", [
        ["Drop-off", originalDrop],
        ["Pickup", originalPick],
      ])}
      ${sectionBlock("Approved schedule", [
        ["Drop-off", newDrop],
        ["Pickup", newPick],
      ])}
      ${serviceChanged ? sectionBlock("Service", [["Change", `${serviceFrom} → ${serviceTo}`]]) : sectionBlock("Service", [["Service", serviceTo]])}
      ${
        addressChanged || (fromAddr && toAddr && fromAddr !== toAddr)
          ? sectionBlock("Delivery address", [
              ["From", fromAddr || "N/A"],
              ["To", toAddr || "N/A"],
            ])
          : ""
      }
      ${sectionBlock("Equipment & add-ons", [
        ["Previous", formatAddonList(source.original_addons)],
        ["Approved", formatAddonList(source.new_addons)],
      ])}
      ${sectionBlock("Pricing", [
        ["Original total", formatCurrency(originalTotal)],
        ["New total", formatCurrency(newTotal)],
        ["Difference", formatCurrency(delta)],
        ["Payment", stripeLine],
      ])}

      <div style="margin-top:24px;padding:16px;background:#eff6ff;border-radius:8px;border:1px solid #bfdbfe;">
        <p style="margin:0;color:#1e40af;font-size:14px;line-height:1.5;">
          You can review this booking anytime in your Customer Portal under Communication and Receipts.
          ${siteUrl ? ` Portal: <a href="${siteUrl}" style="color:#1d4ed8;">${siteUrl}</a>` : ""}
        </p>
      </div>
      <div style="margin-top:24px;text-align:center;color:#6b7280;font-size:13px;">
        Questions? Contact support@u-filldumpsters.com
      </div>
    </div>
    <div style="background:#111827;padding:16px;text-align:center;color:#9ca3af;font-size:12px;">
      © ${new Date().getFullYear()} U-Fill Dumpsters LLC. All rights reserved.
    </div>
  </div>
</body>
</html>`;
};

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const bookingId = body.bookingId ?? body.booking_id;
    if (!bookingId) throw new Error("bookingId is required");

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
    const { data: booking, error } = await supabase
      .from("bookings")
      .select("*, customers(*)")
      .eq("id", bookingId)
      .single();

    if (error || !booking) throw new Error("Booking not found");

    booking.plan = parseJsonField(booking.plan);
    booking.addons = parseJsonField(booking.addons);

    const recipientEmail = body.email || booking.email || booking.customers?.email;
    if (!recipientEmail) throw new Error("No email address available");

    const customerName =
      booking.customers?.name ||
      [booking.customers?.first_name, booking.customers?.last_name].filter(Boolean).join(" ") ||
      "Customer";

    const paymentDelta = parseJsonField(booking.payment_delta_details);
    const originalTotal = Number(
      body.originalTotal ?? paymentDelta.original_total_price ?? booking.total_price ?? 0,
    );
    const newTotal = Number(body.newTotal ?? paymentDelta.new_total_price ?? booking.total_price ?? 0);
    const delta = Number(body.delta ?? newTotal - originalTotal);
    const stripeType = String(body.stripeType ?? paymentDelta.stripe_type ?? "none");
    const stripeTransactionId =
      body.stripeTransactionId ?? paymentDelta.stripe_transaction_id ?? null;
    const amountProcessed = Number(body.amountProcessed ?? paymentDelta.amount_processed ?? Math.abs(delta));

    const history = Array.isArray(booking.reschedule_history) ? booking.reschedule_history : [];
    const snapshot =
      body.approvalSnapshot ||
      [...history].reverse().find((e: Record<string, unknown>) => e?.type === "reschedule_request") ||
      null;

    const siteUrl = normalizeSiteUrl(body.site_url);
    const html = generateRescheduleEmailHTML({
      booking,
      customerName,
      originalTotal,
      newTotal,
      delta,
      stripeType,
      stripeTransactionId,
      amountProcessed,
      snapshot,
      siteUrl,
    });

    const subject = `Reschedule approved – Booking #${booking.id} — U-Fill Dumpsters`;
    const emailResult = await sendEmailWithRetry(recipientEmail, subject, html);

    if (!emailResult.success) {
      return new Response(
        JSON.stringify({ success: false, error: emailResult.error || "Failed to send email" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: "Reschedule confirmation email sent.",
        provider: emailResult.provider,
        recipient: recipientEmail,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[send-reschedule-confirmation-email]", message);
    return new Response(JSON.stringify({ success: false, error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
