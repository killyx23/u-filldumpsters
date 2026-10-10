/**
 * Customer notices for a Hardware Protection Plan claim.
 * received: email that the claim is pending.
 * completed: email and transactional SMS with the outcome and any card charge.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getCorsHeaders } from "../_shared/cors.ts";
import { sendEmail, sendSms } from "../_shared/notify.ts";
import { normalizeSiteUrl } from "../_shared/normalizeSiteUrl.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

function json(corsHeaders: Record<string, string>, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function money(value: unknown) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function when(value: string | null | undefined) {
  if (!value) return "Not recorded";
  try {
    return new Date(value).toLocaleString("en-US", {
      timeZone: "America/Denver",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return value;
  }
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) return json(corsHeaders, { error: "Sign in required" }, 401);

    const body = await req.json().catch(() => ({}));
    const event = body.event === "completed" ? "completed" : "received";
    const claimId = Number(body.claimId) || null;
    const noteId = Number(body.noteId) || null;
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const isAdmin = userData.user.app_metadata?.is_admin === true;

    let claim = null;
    if (claimId) {
      const { data, error } = await admin.from("protection_plan_claims").select("*").eq("id", claimId).maybeSingle();
      if (error) throw error;
      claim = data;
    }

    const customerId = claim?.customer_id || null;
    let note = null;
    if (!claim && noteId) {
      const { data, error } = await admin.from("customer_notes").select("*").eq("id", noteId).maybeSingle();
      if (error) throw error;
      note = data;
    }
    const ownerId = customerId || note?.customer_id;
    if (!ownerId) return json(corsHeaders, { error: "Claim not found" }, 404);

    const { data: customer, error: customerError } = await admin
      .from("customers")
      .select("id, name, email, phone, user_id, sms_opt_in")
      .eq("id", ownerId)
      .maybeSingle();
    if (customerError) throw customerError;
    if (!customer) return json(corsHeaders, { error: "Customer not found" }, 404);

    const ownsClaim = customer.user_id && customer.user_id === userData.user.id;
    if (event === "completed" && !isAdmin) return json(corsHeaders, { error: "Admin only" }, 403);
    if (event === "received" && !isAdmin && !ownsClaim) return json(corsHeaders, { error: "Not allowed" }, 403);

    if (event === "received" && claim?.received_notified_at) {
      return json(corsHeaders, { success: true, skipped: true });
    }
    if (event === "completed" && claim?.outcome_notified_at) {
      return json(corsHeaders, { success: true, skipped: true });
    }

    const siteUrl = normalizeSiteUrl(Deno.env.get("SITE_URL"));
    const portalUrl = `${siteUrl}/customer-portal?tab=messages&section=tickets`;
    const orderId = claim?.booking_id || note?.booking_id || "";
    const name = customer.name || "there";
    const photoCount = Array.isArray(claim?.proof_photos) ? claim.proof_photos.length : 0;

    let subject = "";
    let html = "";
    let sms = "";
    if (event === "received") {
      subject = `We received your damage claim for order #${orderId}`;
      html = `<p>Hi ${name},</p>
        <p>We received your hardware damage claim for order #${orderId}. It is <strong>pending review</strong>.</p>
        <p>Please check your customer portal later for any update, including extra charges, fees, or a decision that the claim is not covered because it does not follow the Hardware Protection Plan.</p>
        <p><a href="${portalUrl}">Open your support tickets</a></p>
        <p>The time of this ticket is your written notice. Photos you attached are saved on your file.</p>`;
    } else {
      const charged = money(claim?.amount_charged);
      const repair = money(claim?.claim_amount);
      const covered = money(claim?.covered_amount);
      const owes = money(claim?.customer_charge_amount);
      subject = `Your damage claim for order #${orderId} is complete`;
      html = `<p>Hi ${name},</p>
        <p>Your hardware damage claim for order #${orderId} is <strong>complete</strong> and is no longer pending.</p>
        <ul>
          <li>Repair amount reviewed: ${repair}</li>
          <li>Covered by the Hardware Protection Plan: ${covered}</li>
          <li>Charged to the card on file: ${charged}</li>
          ${claim?.stripe_charge_id ? `<li>Card charge reference: ${claim.stripe_charge_id}</li>` : ""}
          <li>Photos kept on file: ${photoCount}</li>
          <li>Written notice: ${when(claim?.notice_submitted_at)}</li>
        </ul>
        <p>This email is your receipt of the outcome. The same record, including the photos, is stored on your customer file.</p>
        <p><a href="${portalUrl}">View the claim in your portal</a></p>`;
      sms = `U-Fill Dumpsters: Your damage claim for order #${orderId} is complete and no longer pending. Charged to your card: ${charged}. Details were emailed to you.`;
    }

    const emailResult = customer.email
      ? await sendEmail(customer.email, subject, html)
      : { success: false, error: "No email" };
    const smsResult = event === "completed"
      ? await sendSms(customer.phone, sms, { smsOptIn: customer.sms_opt_in !== false })
      : { success: true, skipped: true, reason: "pending notice is email only" };

    const now = new Date().toISOString();
    if (claim?.id) {
      await admin.from("protection_plan_claims").update({
        [event === "received" ? "received_notified_at" : "outcome_notified_at"]: now,
        updated_at: now,
      }).eq("id", claim.id);
    }

    const photoList = Array.isArray(claim?.proof_photos)
      ? claim.proof_photos.map((photo: { path?: string }) => photo.path).filter(Boolean).join(", ")
      : "";
    const fileNote = event === "completed"
      ? `Hardware protection claim #${claim?.id} for order #${orderId} was completed on ${when(now)}. Repair amount ${money(claim?.claim_amount)}. Plan credit ${money(claim?.covered_amount)}. Charged to card ${money(claim?.amount_charged)}. Card reference ${claim?.stripe_charge_id || "none"}. Written notice ${when(claim?.notice_submitted_at)}. Photos on file: ${photoList || "none"}.`
      : `Hardware protection claim for order #${orderId} was received and marked pending. The customer was emailed to check the portal for the outcome.`;

    await admin.from("customer_notes").insert({
      customer_id: customer.id,
      booking_id: orderId || null,
      source: "Hardware Claim Notice",
      content: fileNote,
      author_type: "admin",
    });

    return json(corsHeaders, { success: true, email: emailResult, sms: smsResult });
  } catch (error) {
    console.error("[notify-hpp-claim]", error);
    return json(corsHeaders, { error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
