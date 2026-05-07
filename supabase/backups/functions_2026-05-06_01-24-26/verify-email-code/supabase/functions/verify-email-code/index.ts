import { corsHeaders } from "./cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  try {
    const { email, code } = await req.json();
    if (!code) {
      return new Response(JSON.stringify({
        success: false,
        error: "Verification code is required"
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    console.log("[verify-email-code] Verifying code:", code);
    // Initialize Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const supabase = createClient(supabaseUrl, supabaseKey);
    // Find verification record by code
    const { data: verification, error: fetchError } = await supabase.from("email_verifications").select("*").eq("verification_code", code).single();
    if (fetchError || !verification) {
      console.error("[verify-email-code] Verification not found:", fetchError);
      return new Response(JSON.stringify({
        success: false,
        error: "Invalid verification code"
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    // Check if code has expired
    const expiresAt = new Date(verification.code_expires_at);
    const now = new Date();
    if (now > expiresAt) {
      console.error("[verify-email-code] Code expired:", {
        expiresAt,
        now
      });
      return new Response(JSON.stringify({
        success: false,
        error: "Verification code has expired. Please request a new one."
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    // Check if already verified
    if (verification.is_verified) {
      console.log("[verify-email-code] Already verified, finding booking...");
      // Find booking by email
      const { data: booking } = await supabase.from("bookings").select("id").eq("email", verification.email.toLowerCase()).order("created_at", {
        ascending: false
      }).limit(1).single();
      return new Response(JSON.stringify({
        success: true,
        message: "Email already verified",
        booking_id: booking?.id || null
      }), {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    // Mark as verified
    const { error: updateError } = await supabase.from("email_verifications").update({
      is_verified: true
    }).eq("email", verification.email);
    if (updateError) {
      console.error("[verify-email-code] Update error:", updateError);
      throw new Error("Failed to mark email as verified");
    }
    // Find most recent booking for this email
    const { data: booking, error: bookingError } = await supabase.from("bookings").select("id, email, status").eq("email", verification.email.toLowerCase()).order("created_at", {
      ascending: false
    }).limit(1).single();
    if (bookingError || !booking) {
      console.error("[verify-email-code] Booking not found:", bookingError);
      return new Response(JSON.stringify({
        success: true,
        message: "Email verified but no booking found",
        booking_id: null
      }), {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    console.log("[verify-email-code] ✓ Email verified successfully, booking_id:", booking.id);
    return new Response(JSON.stringify({
      success: true,
      message: "Email verified successfully",
      booking_id: booking.id,
      email: verification.email
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  } catch (error) {
    console.error("[verify-email-code] Error:", error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message || "Verification failed"
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
});
