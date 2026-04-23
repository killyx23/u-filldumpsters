import { corsHeaders } from "./cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
Deno.serve(async (req)=>{
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [finalize-booking] Function entry - request received`);
  try {
    // Parse request body
    const { booking_id } = await req.json();
    console.log(`[${timestamp}] [finalize-booking] Booking ID received: ${booking_id}`);
    if (!booking_id) {
      console.error(`[${timestamp}] [finalize-booking] ERROR: Missing booking_id in request`);
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
    // Initialize Supabase client
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    // Step 1: Fetch the booking
    console.log(`[${timestamp}] [finalize-booking] Fetching booking #${booking_id} from database`);
    const { data: booking, error: fetchError } = await supabase.from("bookings").select("*").eq("id", booking_id).single();
    if (fetchError || !booking) {
      console.error(`[${timestamp}] [finalize-booking] ERROR: Failed to fetch booking #${booking_id}:`, fetchError);
      return new Response(JSON.stringify({
        error: "Booking not found",
        details: fetchError?.message
      }), {
        status: 404,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    console.log(`[${timestamp}] [finalize-booking] Booking fetched successfully. Current status: ${booking.status}`);
    // Step 2: Check if booking is already confirmed
    if (booking.status === "confirmed") {
      console.log(`[${timestamp}] [finalize-booking] Booking #${booking_id} already confirmed. Skipping update.`);
      return new Response(JSON.stringify({
        success: true,
        booking_id: booking.id,
        status: "already_confirmed",
        message: "Booking was already confirmed"
      }), {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    // Step 3: Update booking status to confirmed
    console.log(`[${timestamp}] [finalize-booking] Updating booking #${booking_id} status to 'confirmed'`);
    const { error: updateError } = await supabase.from("bookings").update({
      status: "confirmed"
    }).eq("id", booking_id);
    if (updateError) {
      console.error(`[${timestamp}] [finalize-booking] ERROR: Failed to update booking status:`, updateError);
      return new Response(JSON.stringify({
        error: "Failed to update booking status",
        details: updateError.message
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    console.log(`[${timestamp}] [finalize-booking] Booking status updated successfully to 'confirmed'`);
    // Step 4: Send confirmation email
    console.log(`[${timestamp}] [finalize-booking] Calling send-booking-confirmation for booking #${booking_id}`);
    let emailStatus = "not_sent";
    let emailError = null;
    try {
      const emailResponse = await fetch(`${SUPABASE_URL}/functions/v1/send-booking-confirmation`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
        },
        body: JSON.stringify({
          booking_id,
          email: booking.email
        })
      });
      const emailResult = await emailResponse.json();
      if (emailResponse.ok && emailResult.success) {
        emailStatus = "sent";
        console.log(`[${timestamp}] [finalize-booking] Confirmation email sent successfully to ${booking.email}`);
      } else {
        emailStatus = "failed";
        emailError = emailResult.error || "Unknown email error";
        console.error(`[${timestamp}] [finalize-booking] Email sending failed:`, emailError);
      }
    } catch (emailErr) {
      emailStatus = "failed";
      emailError = emailErr.message;
      console.error(`[${timestamp}] [finalize-booking] Email sending exception:`, emailErr);
    }
    // Step 5: Return success response
    console.log(`[${timestamp}] [finalize-booking] SUCCESS: Booking #${booking_id} finalized. Email status: ${emailStatus}`);
    return new Response(JSON.stringify({
      success: true,
      booking_id: booking.id,
      customer_email: booking.email,
      email_status: emailStatus,
      email_error: emailError,
      message: "Booking confirmed successfully"
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  } catch (error) {
    console.error(`[${timestamp}] [finalize-booking] CRITICAL ERROR:`, error);
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
