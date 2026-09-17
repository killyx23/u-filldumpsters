/**
 * notify-feedback-chat-reply
 *
 * Invoked by DB trigger when an admin posts to chat for a customer with an
 * active How-can-we-do-better public reply token. Emails the lead a short
 * "we replied" notice with the same survey token link.
 *
 * verify_jwt = false — authorized via service_role bearer from vault/pg_net.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getCorsHeaders } from "./cors.ts";
import { sendEmail } from "../_shared/notify.ts";
import { normalizeSiteUrl } from "../_shared/normalizeSiteUrl.ts";

const PRODUCTION_SITE_URL = "https://u-filldumpsters.com";

/** Prefer SITE_URL, but never put localhost links in customer emails. */
function resolvePublicSiteUrl(): string {
  const normalized = normalizeSiteUrl(Deno.env.get("SITE_URL"));
  try {
    const host = new URL(normalized).hostname.toLowerCase();
    if (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "::1" ||
      host.endsWith(".local")
    ) {
      return PRODUCTION_SITE_URL;
    }
  } catch {
    return PRODUCTION_SITE_URL;
  }
  return normalized;
}

function jsonResponse(corsHeaders: Record<string, string>, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function buildReplyEmailHtml(opts: {
  firstName: string;
  chatUrl: string;
  contactUrl: string;
}): string {
  const { firstName, chatUrl, contactUrl } = opts;
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /></head>
<body style="margin:0;padding:0;background:#0f172a;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:640px;margin:0 auto;padding:24px 16px;">
    <div style="background:#111827;border:1px solid #334155;border-radius:16px;overflow:hidden;">
      <div style="background:linear-gradient(135deg,#1e3a8a,#0f172a);padding:28px 24px;text-align:center;">
        <p style="margin:0;color:#fbbf24;font-size:12px;letter-spacing:1.5px;text-transform:uppercase;font-weight:700;">U-Fill Dumpsters</p>
        <h1 style="margin:10px 0 0;color:#ffffff;font-size:22px;line-height:1.3;">We replied to your feedback</h1>
      </div>
      <div style="padding:28px 24px;background:#ffffff;color:#111827;">
        <p style="margin:0 0 14px;font-size:16px;">Hi ${firstName},</p>
        <p style="margin:0 0 18px;font-size:15px;line-height:1.55;color:#374151;">
          Our team sent a reply to the feedback conversation you started. Open the link below to read it and continue the conversation — no account or customer number needed.
        </p>
        <div style="text-align:center;margin:28px 0 10px;">
          <a href="${chatUrl}" style="display:inline-block;background:#eab308;color:#111827;text-decoration:none;font-weight:700;padding:14px 28px;border-radius:10px;font-size:15px;">
            View reply
          </a>
        </div>
        <p style="margin:18px 0 0;font-size:14px;line-height:1.55;color:#475569;text-align:center;">
          Prefer a phone call?
          <a href="${contactUrl}" style="color:#1e3a8a;font-weight:700;text-decoration:none;">Contact us</a>
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
    const tokenId = Number(body?.token_id ?? body?.tokenId ?? 0);
    if (!Number.isFinite(tokenId) || tokenId <= 0) {
      return jsonResponse(corsHeaders, { ok: false, error: "token_id required" }, 400);
    }

    const { data: tokenRow, error: tokenError } = await supabase
      .from("feedback_tokens")
      .select("id, token, customer_id, chat_expires_at, chat_closed_at, used_at")
      .eq("id", tokenId)
      .maybeSingle();

    if (tokenError || !tokenRow?.token) {
      console.error("[notify-feedback-chat-reply] token load failed:", tokenError);
      return jsonResponse(corsHeaders, { ok: false, error: "token not found" }, 404);
    }

    if (!tokenRow.used_at || tokenRow.chat_closed_at) {
      return jsonResponse(corsHeaders, { ok: true, skipped: true, reason: "chat_inactive" });
    }

    if (tokenRow.chat_expires_at && new Date(tokenRow.chat_expires_at).getTime() < Date.now()) {
      return jsonResponse(corsHeaders, { ok: true, skipped: true, reason: "chat_expired" });
    }

    const { data: customer, error: customerError } = await supabase
      .from("customers")
      .select("id, email, first_name, name")
      .eq("id", tokenRow.customer_id)
      .maybeSingle();

    if (customerError || !customer?.email) {
      console.error("[notify-feedback-chat-reply] customer load failed:", customerError);
      return jsonResponse(corsHeaders, { ok: false, error: "customer email missing" }, 400);
    }

    const siteUrl = resolvePublicSiteUrl();
    const chatUrl = `${siteUrl}/how-can-we-do-better?token=${encodeURIComponent(tokenRow.token)}`;
    const contactUrl = `${siteUrl}/contact`;
    const firstName = String(
      customer.first_name || String(customer.name || "there").split(" ")[0] || "there",
    );

    const html = buildReplyEmailHtml({ firstName, chatUrl, contactUrl });
    const emailResult = await sendEmail(
      String(customer.email),
      "We replied to your feedback — U-Fill Dumpsters",
      html,
    );

    if (!emailResult.success) {
      console.error("[notify-feedback-chat-reply] email failed:", emailResult.error);
      return jsonResponse(corsHeaders, { ok: false, error: emailResult.error || "email failed" }, 500);
    }

    console.log(
      `[notify-feedback-chat-reply] sent token=${tokenId} customer=${customer.id} messageId=${emailResult.messageId || "unknown"}`,
    );

    return jsonResponse(corsHeaders, {
      ok: true,
      email_sent: true,
      messageId: emailResult.messageId || null,
    });
  } catch (err) {
    console.error("[notify-feedback-chat-reply] CRITICAL:", err);
    return jsonResponse(
      corsHeaders,
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      500,
    );
  }
});
