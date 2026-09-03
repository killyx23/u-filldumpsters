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
import { buildUnsubscribeUrl, normalizeSiteUrl } from "../_shared/normalizeSiteUrl.ts";
import {
  buildEarlyLeaveEmailHtml,
  EARLY_LEAVE_EMAIL_SUBJECT,
} from "../_shared/earlyLeaveEmail.ts";

function jsonResponse(corsHeaders: Record<string, string>, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
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
    const { data: abandonedId, error: leadError } = await supabase.rpc(
      "upsert_abandoned_checkout_from_booking",
      {
        p_booking_id: bookingId,
        p_status: "left_early",
        p_set_reminder_sent: false,
      },
    );
    if (leadError) {
      console.error("[send-early-leave-feedback] abandoned_checkouts upsert failed:", leadError);
    }

    const { data: unsubToken, error: unsubError } = await supabase.rpc("create_unsubscribe_token", {
      p_abandoned_checkout_id: abandonedId ?? null,
      p_booking_id: bookingId,
      p_customer_id: row.customer_id ?? null,
      p_email: row.email,
    });
    if (unsubError) {
      console.error("[send-early-leave-feedback] unsubscribe token failed:", unsubError);
    }

    const siteUrl = normalizeSiteUrl(body?.siteUrl);
    const feedbackUrl = `${siteUrl}${row.site_path}`;
    const contactUrl = `${siteUrl}/contact`;
    const unsubscribeUrl = buildUnsubscribeUrl(unsubToken, siteUrl) || contactUrl;
    const firstName = String(row.first_name || "there");

    const html = buildEarlyLeaveEmailHtml({
      firstName,
      feedbackUrl,
      contactUrl,
      unsubscribeUrl,
    });
    const emailResult = await sendEmail(String(row.email), EARLY_LEAVE_EMAIL_SUBJECT, html);

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
