import { corsHeaders } from "./cors.ts";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [resend-confirmation-email] Function entry`);
  try {
    const { booking_id } = await req.json();
    console.log(`[${timestamp}] [resend-confirmation-email] Booking ID: ${booking_id}`);
    if (!booking_id) {
      console.error(`[${timestamp}] [resend-confirmation-email] ERROR: Missing booking_id`);
      return new Response(JSON.stringify({
        error: "booking_id is required"
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    // Call send-booking-confirmation function
    console.log(`[${timestamp}] [resend-confirmation-email] Calling send-booking-confirmation`);
    const response = await fetch(`${SUPABASE_URL}/functions/v1/send-booking-confirmation`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
      },
      body: JSON.stringify({
        booking_id
      })
    });
    const result = await response.json();
    if (response.ok && result.success) {
      console.log(`[${timestamp}] [resend-confirmation-email] SUCCESS: Email resent successfully`);
      return new Response(JSON.stringify({
        success: true,
        message: "Confirmation email resent successfully",
        recipient: result.recipient
      }), {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    } else {
      console.error(`[${timestamp}] [resend-confirmation-email] FAILED:`, result);
      return new Response(JSON.stringify({
        success: false,
        error: result.error || "Failed to resend confirmation email",
        details: result.details
      }), {
        status: response.status,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
  } catch (error) {
    const timestamp = new Date().toISOString();
    console.error(`[${timestamp}] [resend-confirmation-email] CRITICAL ERROR:`, error);
    return new Response(JSON.stringify({
      error: "Internal server error",
      details: error.message
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
});
