/**
 * igloohome-webhook
 *
 * Public endpoint for Igloohome / iglooaccess webhook deliveries.
 * Verifies x-igloocompany-sha256 HMAC signature, parses activity events,
 * and feeds the rented/returned state machine.
 *
 * Register in iglooaccess portal:
 *   https://<project>.supabase.co/functions/v1/igloohome-webhook
 *
 * Env: IGLOOHOME_WEBHOOK_SECRET (shared secret from iglooaccess)
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getCorsHeaders } from "./cors.ts";
import { parseActivityLogsFromPayload } from "../_shared/iglooActivity.ts";
import {
  applyLockEvent,
  resolveOrderIdByPin,
  sweepGraceHourReturns,
} from "../_shared/lockEventState.ts";

function makeJsonResponse(corsHeaders: Record<string, string>) {
  return (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
}

async function hmacSha256Base64(secret: string, data: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  const bytes = new Uint8Array(sig);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/**
 * Signed string per Igloohome docs:
 * METHOD|HOST|PATH|CONTENT-TYPE|DATE|BODY
 */
async function verifyIglooSignature(req: Request, rawBody: string): Promise<boolean> {
  const secret = Deno.env.get("IGLOOHOME_WEBHOOK_SECRET");
  if (!secret) {
    console.warn("[igloohome-webhook] IGLOOHOME_WEBHOOK_SECRET not set — skipping verify in non-prod only");
    // Fail closed in production-like setups when secret is missing
    return Deno.env.get("IGLOOHOME_WEBHOOK_ALLOW_UNSIGNED") === "true";
  }

  const provided =
    req.headers.get("x-igloocompany-sha256") ||
    req.headers.get("X-Igloocompany-Sha256") ||
    "";
  if (!provided) return false;

  const url = new URL(req.url);
  const host = req.headers.get("host") || url.host;
  const contentType = req.headers.get("content-type") || "application/json";
  const date = req.headers.get("date") || "";
  const path = url.pathname;
  const signed = `${req.method}|${host}|${path}|${contentType}|${date}|${rawBody}`;
  const expected = await hmacSha256Base64(secret, signed);

  // Constant-time-ish compare
  const a = provided.replace(/^"|"$/g, "");
  if (a.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return mismatch === 0;
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  const jsonResponse = makeJsonResponse(corsHeaders);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ success: false, error: "Method not allowed" }, 405);
  }

  try {
    const rawBody = await req.text();
    const valid = await verifyIglooSignature(req, rawBody);
    if (!valid) {
      console.warn("[igloohome-webhook] Signature verification failed");
      return jsonResponse({ success: false, error: "Invalid signature" }, 401);
    }

    let payload: unknown = null;
    try {
      payload = rawBody ? JSON.parse(rawBody) : null;
    } catch {
      return jsonResponse({ success: false, error: "Invalid JSON" }, 400);
    }

    const events = parseActivityLogsFromPayload(payload);
    console.log(`[igloohome-webhook] Parsed ${events.length} events`);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) {
      return jsonResponse({ success: false, error: "Missing Supabase env" }, 500);
    }
    const supabase = createClient(supabaseUrl, serviceKey);

    const actions: Array<{ pin: string | null; orderId: number | null; action: string }> = [];
    for (const event of events) {
      const orderId = await resolveOrderIdByPin(supabase, event.pinCode, event.eventTimestamp);
      if (!orderId) {
        actions.push({ pin: event.pinCode, orderId: null, action: "unmatched_pin" });
        continue;
      }
      const action = await applyLockEvent(supabase, {
        orderId,
        eventType: event.eventType,
        eventTimestamp: event.eventTimestamp,
        notes: `${event.eventType} via igloohome-webhook`,
      });
      actions.push({ pin: event.pinCode, orderId, action });
    }

    const swept = await sweepGraceHourReturns(supabase);

    return jsonResponse({
      success: true,
      eventsParsed: events.length,
      actions,
      graceHourClosed: swept,
    });
  } catch (error) {
    console.error("[igloohome-webhook] Unhandled:", error);
    return jsonResponse({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }, 500);
  }
});
