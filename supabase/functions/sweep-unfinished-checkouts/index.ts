/**
 * sweep-unfinished-checkouts
 *
 * pg_cron backstop (every minute): find stale unpaid checkouts / pending
 * drafts with no recent heartbeat and run the same teardown + survey email
 * path as end-unfinished-checkout (reason = expired).
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getCorsHeaders } from "../_shared/cors.ts";
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

type SupabaseClient = any;

async function teardownAndEmail(
  supabase: SupabaseClient,
  bookingId: number,
  siteUrl: string,
): Promise<{ booking_id: number; ok: boolean; email_sent: boolean; error?: string }> {
  const { data: finalizeResult, error: finalizeError } = await supabase.rpc(
    "finalize_unfinished_checkout",
    { p_booking_id: bookingId, p_reason: "expired" },
  );

  if (finalizeError) {
    return { booking_id: bookingId, ok: false, email_sent: false, error: finalizeError.message };
  }
  if (finalizeResult?.ok === false && finalizeResult?.error === "not_pending_payment") {
    return { booking_id: bookingId, ok: true, email_sent: false, error: "skipped" };
  }
  if (finalizeResult?.ok === false) {
    return {
      booking_id: bookingId,
      ok: false,
      email_sent: false,
      error: String(finalizeResult?.error || "finalize failed"),
    };
  }

  if (
    finalizeResult?.skip_email ||
    finalizeResult?.skipped ||
    finalizeResult?.skipped_reason === "already_converted"
  ) {
    return {
      booking_id: bookingId,
      ok: true,
      email_sent: false,
      error: "already_converted",
    };
  }

  // Prefer unsent token retry; skip only when already emailed
  const { data: existingTokens } = await supabase
    .from("feedback_tokens")
    .select("id, token, customer_id, email_sent_at")
    .eq("booking_id", bookingId)
    .order("created_at", { ascending: false })
    .limit(5);

  const tokens = Array.isArray(existingTokens) ? existingTokens : [];
  if (tokens.some((t) => t.email_sent_at)) {
    return { booking_id: bookingId, ok: true, email_sent: false, error: "email_already_sent" };
  }

  let row: {
    token: string;
    customer_id: number | null;
    email: string;
    first_name: string;
    site_path: string;
  } | null = null;

  const unsent = tokens.find((t) => t?.token && !t.email_sent_at);
  if (unsent?.token) {
    const { data: booking } = await supabase
      .from("bookings")
      .select("email, first_name, name, customer_id")
      .eq("id", bookingId)
      .maybeSingle();
    const email = String(booking?.email || "").trim();
    if (!email) {
      return { booking_id: bookingId, ok: true, email_sent: false, error: "no_email" };
    }
    row = {
      token: String(unsent.token),
      customer_id: unsent.customer_id != null
        ? Number(unsent.customer_id)
        : booking?.customer_id != null
        ? Number(booking.customer_id)
        : null,
      email,
      first_name: String(
        booking?.first_name || String(booking?.name || "there").split(" ")[0] || "there",
      ),
      site_path: `/how-can-we-do-better?token=${unsent.token}`,
    };
  } else {
    const { data: tokenRows, error: tokenError } = await supabase.rpc(
      "create_early_leave_feedback_token",
      { p_booking_id: bookingId },
    );
    if (tokenError) {
      return { booking_id: bookingId, ok: true, email_sent: false, error: tokenError.message };
    }
    const created = Array.isArray(tokenRows) ? tokenRows[0] : tokenRows;
    if (!created?.token || !created?.email) {
      return { booking_id: bookingId, ok: true, email_sent: false, error: "no_token" };
    }
    row = {
      token: String(created.token),
      customer_id: created.customer_id != null ? Number(created.customer_id) : null,
      email: String(created.email),
      first_name: String(created.first_name || "there"),
      site_path: String(created.site_path || `/how-can-we-do-better?token=${created.token}`),
    };
  }

  const abandonedCheckoutId = finalizeResult?.abandoned_checkout_id ?? null;
  const { data: unsubToken } = await supabase.rpc("create_unsubscribe_token", {
    p_abandoned_checkout_id: abandonedCheckoutId,
    p_booking_id: bookingId,
    p_customer_id: row.customer_id ?? null,
    p_email: row.email,
  });

  const feedbackUrl = `${siteUrl}${row.site_path}`;
  const contactUrl = `${siteUrl}/contact`;
  const unsubscribeUrl = buildUnsubscribeUrl(unsubToken, siteUrl) || contactUrl;

  const html = buildEarlyLeaveEmailHtml({
    firstName: String(row.first_name || "there"),
    feedbackUrl,
    contactUrl,
    unsubscribeUrl,
  });

  const emailResult = await sendEmail(String(row.email), EARLY_LEAVE_EMAIL_SUBJECT, html);
  if (emailResult.success) {
    await supabase
      .from("feedback_tokens")
      .update({
        email_sent_at: new Date().toISOString(),
        email_message_id: emailResult.messageId || null,
      })
      .eq("token", row.token);
  }

  return {
    booking_id: bookingId,
    ok: true,
    email_sent: Boolean(emailResult.success),
    error: emailResult.success ? undefined : emailResult.error,
  };
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
    const siteUrl = normalizeSiteUrl(null);
    const { data: candidates, error } = await supabase.rpc("find_stale_unfinished_checkouts", {
      p_stale_after: "31 minutes",
    });

    if (error) {
      console.error("[sweep-unfinished-checkouts] find failed:", error);
      return jsonResponse(corsHeaders, { ok: false, error: error.message }, 500);
    }

    const rows = Array.isArray(candidates) ? candidates : [];
    const results: unknown[] = [];

    for (const row of rows.slice(0, 50)) {
      let bookingId = Number(row.booking_id);
      const pendingId = row.pending_id;

      if (pendingId) {
        const { data: completion } = await supabase.rpc("get_checkout_completion_status", {
          p_pending_id: pendingId,
        });
        if (completion?.completed) {
          results.push({
            pending_id: pendingId,
            ok: true,
            skipped: true,
            skipped_reason: "already_converted",
            booking_id: completion.booking_id ?? null,
          });
          continue;
        }
      }

      if ((!Number.isFinite(bookingId) || bookingId <= 0) && pendingId) {
        const { data: promoted, error: promoteError } = await supabase.rpc(
          "create_unfinished_booking_from_pending",
          { p_pending_id: pendingId },
        );
        if (promoteError) {
          results.push({ pending_id: pendingId, ok: false, error: promoteError.message });
          continue;
        }
        if (promoted?.skipped || promoted?.reason === "already_converted") {
          results.push({
            pending_id: pendingId,
            ok: true,
            skipped: true,
            skipped_reason: "already_converted",
            booking_id: promoted?.converted_booking_id || promoted?.booking_id || null,
          });
          continue;
        }
        bookingId = Number(promoted?.booking_id);
      }

      if (!Number.isFinite(bookingId) || bookingId <= 0) {
        results.push({ ok: false, error: "missing_booking_id", row });
        continue;
      }

      const outcome = await teardownAndEmail(supabase, bookingId, siteUrl);
      results.push(outcome);
    }

    console.log(`[sweep-unfinished-checkouts] processed=${results.length}`);
    return jsonResponse(corsHeaders, { ok: true, processed: results.length, results });
  } catch (err) {
    console.error("[sweep-unfinished-checkouts] CRITICAL:", err);
    return jsonResponse(
      corsHeaders,
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      500,
    );
  }
});
