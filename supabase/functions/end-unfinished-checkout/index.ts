/**
 * end-unfinished-checkout
 *
 * Teardown unpaid / unfinished checkout:
 * - restock equipment + free reserved dates (via finalize_unfinished_checkout)
 * - promote pending_customers → booking_not_finished when needed
 * - upsert Did Not Finalize CRM (left_early | reminded | expired)
 * - send sorry-to-see-you-go survey email with unsubscribe link
 *
 * verify_jwt = false so pagehide keepalive beacons can reach it with the anon key.
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

const ALLOWED_REASONS = new Set(["left_early", "reminded", "expired"]);

type SupabaseClient = any;

async function ensureBookingCustomer(
  supabase: SupabaseClient,
  bookingId: number,
): Promise<number | null> {
  const { data: booking, error } = await supabase
    .from("bookings")
    .select(
      "id, email, first_name, last_name, name, phone, street, city, state, zip, customer_id",
    )
    .eq("id", bookingId)
    .maybeSingle();

  if (error || !booking) {
    console.error("[end-unfinished-checkout] ensureBookingCustomer load failed:", error);
    return null;
  }

  if (booking.customer_id) {
    return Number(booking.customer_id);
  }

  const email = String(booking.email || "").trim().toLowerCase();
  if (!email) return null;

  const { data: existing } = await supabase
    .from("customers")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  let customerId = existing?.id ? Number(existing.id) : null;

  if (!customerId) {
    const cleanedPhone = String(booking.phone || "").replace(/\D/g, "");
    const { data: created, error: createError } = await supabase
      .from("customers")
      .insert({
        email,
        name: booking.name || `${booking.first_name || ""} ${booking.last_name || ""}`.trim(),
        first_name: booking.first_name,
        last_name: booking.last_name,
        phone: cleanedPhone || null,
        street: booking.street,
        city: booking.city,
        state: booking.state,
        zip: booking.zip,
        segment: "feedback_lead",
      })
      .select("id")
      .single();

    if (createError) {
      console.error("[end-unfinished-checkout] ensureBookingCustomer create failed:", createError);
      return null;
    }
    customerId = created?.id ? Number(created.id) : null;
  }

  if (customerId) {
    await supabase.from("bookings").update({ customer_id: customerId }).eq("id", bookingId);
  }

  return customerId;
}

async function createFeedbackTokenRow(
  supabase: SupabaseClient,
  bookingId: number,
) {
  const attempt = await supabase.rpc("create_early_leave_feedback_token", {
    p_booking_id: bookingId,
  });

  if (!attempt.error) {
    return attempt;
  }

  const message = String(attempt.error.message || "").toLowerCase();
  if (message.includes("no customer") || message.includes("customer")) {
    const customerId = await ensureBookingCustomer(supabase, bookingId);
    if (customerId) {
      return supabase.rpc("create_early_leave_feedback_token", {
        p_booking_id: bookingId,
      });
    }
  }

  return attempt;
}

type FeedbackTokenPayload = {
  token: string;
  customer_id: number | null;
  email: string;
  first_name: string;
  site_path: string;
};

/**
 * Prefer an existing unsent token (retry after Brevo/DNS blips).
 * Only create a new token when none exist for this booking.
 */
async function resolveFeedbackTokenForEmail(
  supabase: SupabaseClient,
  bookingId: number,
): Promise<{ data: FeedbackTokenPayload | null; error: { message: string } | null; reused: boolean }> {
  const { data: existing, error: existingError } = await supabase
    .from("feedback_tokens")
    .select("id, token, customer_id, email_sent_at")
    .eq("booking_id", bookingId)
    .order("created_at", { ascending: false })
    .limit(5);

  if (existingError) {
    return { data: null, error: { message: existingError.message }, reused: false };
  }

  const rows = Array.isArray(existing) ? existing : [];
  if (rows.some((r) => r.email_sent_at)) {
    return { data: null, error: null, reused: false };
  }

  const unsent = rows.find((r) => r?.token && !r.email_sent_at);
  if (unsent?.token) {
    const { data: booking } = await supabase
      .from("bookings")
      .select("email, first_name, name, customer_id")
      .eq("id", bookingId)
      .maybeSingle();

    const email = String(booking?.email || "").trim();
    if (!email) {
      return { data: null, error: { message: "Unsent token booking has no email" }, reused: true };
    }

    const firstName = String(
      booking?.first_name ||
        String(booking?.name || "there").split(" ")[0] ||
        "there",
    );

    return {
      data: {
        token: String(unsent.token),
        customer_id: unsent.customer_id != null
          ? Number(unsent.customer_id)
          : booking?.customer_id != null
          ? Number(booking.customer_id)
          : null,
        email,
        first_name: firstName,
        site_path: `/how-can-we-do-better?token=${unsent.token}`,
      },
      error: null,
      reused: true,
    };
  }

  const created = await createFeedbackTokenRow(supabase, bookingId);
  if (created.error) {
    return { data: null, error: { message: created.error.message }, reused: false };
  }

  const row = Array.isArray(created.data) ? created.data[0] : created.data;
  if (!row?.token || !row?.email) {
    return { data: null, error: { message: "Could not create feedback token" }, reused: false };
  }

  return {
    data: {
      token: String(row.token),
      customer_id: row.customer_id != null ? Number(row.customer_id) : null,
      email: String(row.email),
      first_name: String(row.first_name || "there"),
      site_path: String(row.site_path || `/how-can-we-do-better?token=${row.token}`),
    },
    error: null,
    reused: false,
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
    const body = await req.json().catch(() => ({}));
    let bookingId = Number(body?.bookingId ?? body?.booking_id ?? 0);
    const pendingIdRaw = body?.pendingId ?? body?.pending_id ?? null;
    const pendingId =
      typeof pendingIdRaw === "string" && pendingIdRaw.length > 0 ? pendingIdRaw : null;
    let reason = String(body?.reason || "left_early").toLowerCase().trim();
    if (!ALLOWED_REASONS.has(reason)) reason = "left_early";

    if ((!Number.isFinite(bookingId) || bookingId <= 0) && !pendingId) {
      return jsonResponse(
        corsHeaders,
        { ok: false, error: "bookingId or pendingId required" },
        400,
      );
    }

    // Already paid in another tab — never invent an unfinished booking or survey email.
    // If this tab still has an unpaid hold, fall through so finalize can close it
    // without restocking.
    let alreadyConverted = false;
    let convertedBookingId = null;
    if (pendingId) {
      const { data: completion } = await supabase.rpc("get_checkout_completion_status", {
        p_pending_id: pendingId,
      });
      if (completion?.completed) {
        alreadyConverted = true;
        convertedBookingId = Number(completion.booking_id) || null;
      }
    }

    // Stale session hold: if bookingId is not an open checkout, promote from pending instead.
    if (Number.isFinite(bookingId) && bookingId > 0 && pendingId) {
      const { data: bookingRow } = await supabase
        .from("bookings")
        .select("status")
        .eq("id", bookingId)
        .maybeSingle();
      const status = String(bookingRow?.status || "").toLowerCase();
      if (
        status &&
        status !== "pending_payment" &&
        status !== "booking_not_finished"
      ) {
        bookingId = 0;
      }
    }

    if (alreadyConverted && (!Number.isFinite(bookingId) || bookingId <= 0)) {
      console.log(
        `[end-unfinished-checkout] skip already_converted pending=${pendingId} booking=${convertedBookingId}`,
      );
      return jsonResponse(corsHeaders, {
        ok: true,
        skipped: true,
        skip_email: true,
        skipped_reason: "already_converted",
        email_sent: false,
        email_skipped: "already_converted",
        booking_id: convertedBookingId,
        converted_booking_id: convertedBookingId,
        restocked: false,
      });
    }

    // Step 6–8 leavers: promote pending → booking_not_finished first
    if ((!Number.isFinite(bookingId) || bookingId <= 0) && pendingId) {
      const { data: promoted, error: promoteError } = await supabase.rpc(
        "create_unfinished_booking_from_pending",
        { p_pending_id: pendingId },
      );
      if (promoteError) {
        console.error("[end-unfinished-checkout] promote failed:", promoteError);
        return jsonResponse(corsHeaders, { ok: false, error: promoteError.message }, 400);
      }
      if (promoted?.skipped || promoted?.reason === "already_converted") {
        const convertedId = Number(promoted?.converted_booking_id || promoted?.booking_id) || convertedBookingId;
        return jsonResponse(corsHeaders, {
          ok: true,
          skipped: true,
          skip_email: true,
          skipped_reason: "already_converted",
          email_sent: false,
          email_skipped: "already_converted",
          booking_id: convertedId,
          converted_booking_id: convertedId,
          restocked: false,
        });
      }
      bookingId = Number(promoted?.booking_id);
      if (!Number.isFinite(bookingId) || bookingId <= 0) {
        return jsonResponse(
          corsHeaders,
          { ok: false, error: "Could not create unfinished booking from pending" },
          400,
        );
      }
    }

    const { data: finalizeResult, error: finalizeError } = await supabase.rpc(
      "finalize_unfinished_checkout",
      {
        p_booking_id: bookingId,
        p_reason: reason,
      },
    );

    if (finalizeError) {
      console.error("[end-unfinished-checkout] finalize failed:", finalizeError);
      return jsonResponse(corsHeaders, { ok: false, error: finalizeError.message }, 400);
    }

    if (finalizeResult?.ok === false && finalizeResult?.error === "not_pending_payment") {
      return jsonResponse(
        corsHeaders,
        {
          ok: false,
          error: "not_pending_payment",
          skipped_reason: "not_pending_payment",
          booking_id: bookingId,
        },
        400,
      );
    }

    // If booking was created already as booking_not_finished from pending,
    // finalize returns already_finalized — still send survey email below
    // unless a sibling Confirmed booking means this checkout converted.
    if (finalizeResult?.ok === false) {
      return jsonResponse(
        corsHeaders,
        { ok: false, error: finalizeResult?.error || "finalize failed", booking_id: bookingId },
        400,
      );
    }

    if (
      finalizeResult?.skip_email ||
      finalizeResult?.skipped ||
      finalizeResult?.skipped_reason === "already_converted"
    ) {
      return jsonResponse(corsHeaders, {
        ok: true,
        skipped: true,
        skip_email: true,
        skipped_reason: finalizeResult?.skipped_reason || "already_converted",
        email_sent: false,
        email_skipped: "already_converted",
        booking_id: bookingId,
        converted_booking_id: finalizeResult?.converted_booking_id ?? null,
        restocked: finalizeResult?.restocked ?? false,
        abandoned_checkout_id: finalizeResult?.abandoned_checkout_id ?? null,
      });
    }

    const abandonedCheckoutId = finalizeResult?.abandoned_checkout_id ?? null;

    let crmStatus: string | null = null;
    if (abandonedCheckoutId) {
      const { data: crmRow } = await supabase
        .from("abandoned_checkouts")
        .select("status")
        .eq("id", abandonedCheckoutId)
        .maybeSingle();
      crmStatus = crmRow?.status ? String(crmRow.status) : null;
    }

    // Ensure customer exists before feedback token (promoted pending rows often have no customer_id)
    await ensureBookingCustomer(supabase, bookingId);

    // Already emailed for this booking — do not send again
    const { data: sentTokens } = await supabase
      .from("feedback_tokens")
      .select("id, email_sent_at")
      .eq("booking_id", bookingId)
      .not("email_sent_at", "is", null)
      .limit(1);

    if (Array.isArray(sentTokens) && sentTokens.length > 0) {
      return jsonResponse(corsHeaders, {
        ok: true,
        booking_id: bookingId,
        reason,
        restocked: finalizeResult?.restocked ?? false,
        email_sent: false,
        email_skipped: "already_sent",
        abandoned_checkout_id: abandonedCheckoutId,
        crm_status: crmStatus,
      });
    }

    const { data: row, error: tokenError, reused } = await resolveFeedbackTokenForEmail(
      supabase,
      bookingId,
    );

    if (tokenError || !row?.token || !row?.email) {
      console.error("[end-unfinished-checkout] feedback token failed:", tokenError);
      return jsonResponse(corsHeaders, {
        ok: true,
        booking_id: bookingId,
        reason,
        restocked: finalizeResult?.restocked ?? false,
        email_sent: false,
        email_error: tokenError?.message || "Could not create feedback token",
        abandoned_checkout_id: abandonedCheckoutId,
        crm_status: crmStatus,
      });
    }

    const { data: unsubToken } = await supabase.rpc("create_unsubscribe_token", {
      p_abandoned_checkout_id: abandonedCheckoutId,
      p_booking_id: bookingId,
      p_customer_id: row.customer_id ?? null,
      p_email: row.email,
    });

    const siteUrl = normalizeSiteUrl(body?.siteUrl);
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
    } else {
      console.error("[end-unfinished-checkout] email failed:", emailResult.error);
    }

    console.log(
      `[end-unfinished-checkout] booking=${bookingId} reason=${reason} crm=${abandonedCheckoutId} email=${emailResult.success} reused_token=${reused} restocked=${finalizeResult?.restocked}`,
    );

    return jsonResponse(corsHeaders, {
      ok: true,
      booking_id: bookingId,
      reason,
      restocked: finalizeResult?.restocked ?? false,
      email_sent: emailResult.success,
      email_error: emailResult.success ? null : emailResult.error,
      email_token_reused: reused,
      abandoned_checkout_id: abandonedCheckoutId,
      crm_updated: Boolean(abandonedCheckoutId),
      crm_status: crmStatus,
      messageId: emailResult.messageId || null,
    });
  } catch (err) {
    console.error("[end-unfinished-checkout] CRITICAL:", err);
    return jsonResponse(
      corsHeaders,
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      500,
    );
  }
});
