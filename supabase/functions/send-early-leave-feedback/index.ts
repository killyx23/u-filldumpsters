/**
 * send-early-leave-feedback
 *
 * Called after a customer leaves checkout early. Creates a feedback token,
 * marks the customer as feedback_lead, and emails a sorry-to-see-you-go
 * message with a link to /how-can-we-do-better?token=...
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getCorsHeaders } from "./cors.ts";
import { sendEmail } from "../_shared/notify.ts";
import { normalizeSiteUrl } from "../_shared/normalizeSiteUrl.ts";

function jsonResponse(corsHeaders: Record<string, string>, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function buildEmailHtml(opts: {
  firstName: string;
  feedbackUrl: string;
  contactUrl: string;
}): string {
  const { firstName, feedbackUrl, contactUrl } = opts;
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /></head>
<body style="margin:0;padding:0;background:#0f172a;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:640px;margin:0 auto;padding:24px 16px;">
    <div style="background:#111827;border:1px solid #334155;border-radius:16px;overflow:hidden;">
      <div style="background:linear-gradient(135deg,#1e3a8a,#0f172a);padding:28px 24px;text-align:center;">
        <p style="margin:0;color:#fbbf24;font-size:12px;letter-spacing:1.5px;text-transform:uppercase;font-weight:700;">U-Fill Dumpsters</p>
        <h1 style="margin:10px 0 0;color:#ffffff;font-size:24px;line-height:1.3;">Sorry to see you go</h1>
      </div>
      <div style="padding:28px 24px;background:#ffffff;color:#111827;">
        <p style="margin:0 0 14px;font-size:16px;">Hi ${firstName},</p>
        <p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:#374151;">
          We noticed you left before finishing your booking. No hard feelings — we hope to see you again soon whenever you are ready.
        </p>
        <p style="margin:0 0 18px;font-size:15px;line-height:1.55;color:#374151;">
          We are always trying to do better. If there is something we could offer, change, or clarify to help you get your job done, we would love to hear it.
        </p>
        <div style="text-align:center;margin:28px 0 10px;">
          <a href="${feedbackUrl}" style="display:inline-block;background:#eab308;color:#111827;text-decoration:none;font-weight:700;padding:14px 28px;border-radius:10px;font-size:15px;">
            Tell us how we can do better
          </a>
        </div>
        <p style="margin:18px 0 0;font-size:14px;line-height:1.55;color:#475569;text-align:center;">
          Prefer a phone call back? Visit our
          <a href="${contactUrl}" style="color:#1e3a8a;font-weight:700;text-decoration:none;">Contact page</a>
          and we will help answer your questions on a timeline that works for you.
        </p>
      </div>
      <div style="padding:18px 24px;background:#0f172a;text-align:center;">
        <p style="margin:0;color:#94a3b8;font-size:12px;line-height:1.5;">
          You fill it, we dump it — convenience brought to you.<br/>
          <a href="${feedbackUrl.split("?")[0].replace(/\/how-can-we-do-better$/, "/")}" style="color:#fbbf24;text-decoration:none;">u-filldumpsters.com</a>
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
    const body = await req.json().catch(() => ({}));
    const bookingId = Number(body?.bookingId ?? body?.booking_id);
    if (!Number.isFinite(bookingId) || bookingId <= 0) {
      return jsonResponse(corsHeaders, { ok: false, error: "bookingId required" }, 400);
    }

    const { data: tokenRows, error: tokenError } = await supabase.rpc(
      "create_early_leave_feedback_token",
      { p_booking_id: bookingId },
    );

    if (tokenError) {
      console.error("[send-early-leave-feedback] token RPC failed:", tokenError);
      return jsonResponse(corsHeaders, { ok: false, error: tokenError.message }, 400);
    }

    const row = Array.isArray(tokenRows) ? tokenRows[0] : tokenRows;
    if (!row?.token || !row?.email) {
      return jsonResponse(corsHeaders, { ok: false, error: "Could not create feedback token" }, 400);
    }

    // CRM lead for Did Not Finalize — do this even if email fails later
    const { error: leadError } = await supabase.rpc("upsert_abandoned_checkout_from_booking", {
      p_booking_id: bookingId,
      p_status: "left_early",
      p_set_reminder_sent: false,
    });
    if (leadError) {
      console.error("[send-early-leave-feedback] abandoned_checkouts upsert failed:", leadError);
    }

    const siteUrl = normalizeSiteUrl(body?.siteUrl);
    const feedbackUrl = `${siteUrl}${row.site_path}`;
    const contactUrl = `${siteUrl}/contact`;
    const firstName = String(row.first_name || "there");

    const html = buildEmailHtml({ firstName, feedbackUrl, contactUrl });
    const subject = "Sorry to see you go — how can we do better?";
    const emailResult = await sendEmail(String(row.email), subject, html);

    if (!emailResult.success) {
      console.error("[send-early-leave-feedback] email failed:", emailResult.error);
      return jsonResponse(
        corsHeaders,
        {
          ok: false,
          error: emailResult.error || "Email send failed",
          token: row.token,
          customer_id: row.customer_id,
        },
        502,
      );
    }

    await supabase
      .from("feedback_tokens")
      .update({
        email_sent_at: new Date().toISOString(),
        email_message_id: emailResult.messageId || null,
      })
      .eq("token", row.token);

    console.log(
      `[send-early-leave-feedback] sent booking=${bookingId} customer=${row.customer_id} messageId=${emailResult.messageId || "unknown"}`,
    );

    return jsonResponse(corsHeaders, {
      ok: true,
      booking_id: bookingId,
      customer_id: row.customer_id,
      messageId: emailResult.messageId || null,
      provider: emailResult.provider,
    });
  } catch (err) {
    console.error("[send-early-leave-feedback] CRITICAL:", err);
    return jsonResponse(
      corsHeaders,
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      500,
    );
  }
});
