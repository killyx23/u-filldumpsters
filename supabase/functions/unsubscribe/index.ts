/**
 * unsubscribe
 *
 * Public page: validates unsubscribe token and purges unfinished-checkout
 * admin data while preserving paid customer history.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getCorsHeaders } from "../_shared/cors.ts";
import { normalizeSiteUrl } from "../_shared/normalizeSiteUrl.ts";

function htmlPage(title: string, body: string): Response {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    body { margin:0; font-family: Arial, Helvetica, sans-serif; background:#0f172a; color:#e2e8f0; }
    .wrap { max-width:520px; margin:64px auto; padding:24px; }
    .card { background:#111827; border:1px solid #334155; border-radius:16px; padding:28px 24px; }
    h1 { margin:0 0 12px; font-size:22px; color:#fbbf24; }
    p { margin:0 0 12px; line-height:1.55; color:#cbd5e1; font-size:15px; }
    a { color:#fbbf24; }
  </style>
</head>
<body>
  <div class="wrap"><div class="card">${body}</div></div>
</body>
</html>`;
  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const siteUrl = normalizeSiteUrl(null);
  const contactUrl = `${siteUrl}/contact`;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    const url = new URL(req.url);
    let token = url.searchParams.get("token") || "";

    if (!token && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      token = String(body?.token || "");
    }

    if (!token) {
      return htmlPage(
        "Unsubscribe",
        `<h1>Missing link</h1><p>This unsubscribe link is incomplete. If you need help, visit our <a href="${contactUrl}">Contact page</a>.</p>`,
      );
    }

    const { data, error } = await supabase.rpc("process_unsubscribe", { p_token: token });

    if (error) {
      console.error("[unsubscribe] RPC failed:", error);
      return htmlPage(
        "Unsubscribe",
        `<h1>Something went wrong</h1><p>We could not process your request right now. Please try again later or <a href="${contactUrl}">contact us</a>.</p>`,
      );
    }

    if (data?.ok === false) {
      const msg =
        data.error === "expired_token"
          ? "This unsubscribe link has expired."
          : "This unsubscribe link is invalid.";
      return htmlPage("Unsubscribe", `<h1>Unable to unsubscribe</h1><p>${msg}</p>`);
    }

    return htmlPage(
      "Unsubscribed",
      `<h1>You are unsubscribed</h1>
       <p>You will no longer receive future correspondence from us about unfinished bookings.</p>
       <p>If this was a mistake, please <a href="${contactUrl}">contact us</a> and we will help.</p>`,
    );
  } catch (err) {
    console.error("[unsubscribe] CRITICAL:", err);
    return htmlPage(
      "Unsubscribe",
      `<h1>Something went wrong</h1><p>Please try again later or <a href="${contactUrl}">contact us</a>.</p>`,
    );
  }
});
