import { corsHeaders } from "./cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const jsonResponse = (body: Record<string, unknown>, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { email, code, pending_customer_id } = await req.json();

    if (!email || typeof email !== "string") {
      return jsonResponse(
        { success: false, error: "Email is required" },
        400,
      );
    }

    if (!code || typeof code !== "string") {
      return jsonResponse(
        { success: false, error: "Verification code is required" },
        400,
      );
    }

    const emailLower = email.trim().toLowerCase();
    const trimmedCode = code.trim();

    if (!emailLower.includes("@")) {
      return jsonResponse(
        { success: false, error: "Invalid email address" },
        400,
      );
    }

    if (!/^\d{6}$/.test(trimmedCode)) {
      return jsonResponse(
        { success: false, error: "Invalid code format. Enter the 6-digit code from your email." },
        400,
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseKey) {
      console.error("[verify-email-code] Missing Supabase configuration");
      return jsonResponse(
        { success: false, error: "Server configuration error" },
        500,
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log("[verify-email-code] Verifying:", { email: emailLower, code: trimmedCode });

    const { data: verification, error: fetchError } = await supabase
      .from("email_verifications")
      .select("email, verification_code, code_expires_at, is_verified")
      .eq("email", emailLower)
      .eq("verification_code", trimmedCode)
      .maybeSingle();

    if (fetchError) {
      console.error("[verify-email-code] Database query error:", fetchError);
      return jsonResponse(
        { success: false, error: "Verification failed. Please try again." },
        500,
      );
    }

    if (!verification) {
      console.warn("[verify-email-code] No matching record for email + code");
      return jsonResponse(
        { success: false, error: "Invalid verification code" },
        400,
      );
    }

    const expiresAt = new Date(verification.code_expires_at);
    const now = new Date();

    if (now > expiresAt) {
      console.warn("[verify-email-code] Code expired:", { email: emailLower, expiresAt });
      return jsonResponse(
        {
          success: false,
          error: "Verification code has expired. Please request a new one.",
        },
        400,
      );
    }

    if (!verification.is_verified) {
      const { error: updateError } = await supabase
        .from("email_verifications")
        .update({ is_verified: true })
        .eq("email", emailLower)
        .eq("verification_code", trimmedCode);

      if (updateError) {
        console.error("[verify-email-code] Update error:", updateError);
        return jsonResponse(
          { success: false, error: "Failed to mark email as verified" },
          500,
        );
      }
    } else {
      console.log("[verify-email-code] Already verified, reusing valid code for:", emailLower);
    }

    if (pending_customer_id) {
      const { error: pendingError } = await supabase
        .from("pending_customers")
        .update({
          is_verified: true,
          verified_at: new Date().toISOString(),
        })
        .eq("id", pending_customer_id);

      if (pendingError) {
        console.error("[verify-email-code] pending_customers update error:", pendingError);
      }
    }

    const { data: booking } = await supabase
      .from("bookings")
      .select("id")
      .eq("email", emailLower)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    console.log("[verify-email-code] ✓ Verified:", emailLower, "booking_id:", booking?.id ?? null);

    return jsonResponse(
      {
        success: true,
        message: verification.is_verified
          ? "Email already verified"
          : "Email verified successfully",
        booking_id: booking?.id ?? null,
        email: emailLower,
        ...(pending_customer_id ? { pending_customer_id } : {}),
      },
      200,
    );
  } catch (error) {
    console.error("[verify-email-code] Error:", error);
    return jsonResponse(
      {
        success: false,
        error: error instanceof Error ? error.message : "Verification failed",
      },
      500,
    );
  }
});
