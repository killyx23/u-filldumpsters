import { corsHeaders } from "./cors.ts";
import { createClient } from 'npm:@supabase/supabase-js@2';
const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }
  try {
    // ✅ Verify the caller is logged in
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({
        error: "Missing Authorization header"
      }), {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        },
        status: 401
      });
    }
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError || !user) {
      return new Response(JSON.stringify({
        error: "Unauthorized"
      }), {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        },
        status: 401
      });
    }
    const { bookingId, reason } = await req.json();
    if (!bookingId || !reason) throw new Error("Booking ID and reason are required.");
    console.log(`[Request Booking Change] User ${user.id} requesting change for booking ${bookingId}`);
    // Fetch booking with customer info
    const { data: booking, error: bookingError } = await supabaseAdmin.from("bookings").select("*, customers(*)").eq("id", bookingId).single();
    if (bookingError || !booking) throw new Error("Booking not found.");
    // ✅ Optional: verify that this user owns the booking
    // if (booking.customer_id !== user.id) {
    //   return new Response(JSON.stringify({
    //     error: "You do not own this booking."
    //   }), {
    //     headers: {
    //       ...corsHeaders,
    //       "Content-Type": "application/json"
    //     },
    //     status: 403
    //   });
    // }
    // Update booking status
    const { error: updateError } = await supabaseAdmin.from("bookings").update({
      status: "pending_review",
      notes: reason
    }).eq("id", bookingId);
    if (updateError) throw new Error(`Failed to update booking: ${updateError.message}`);
    // Insert customer note
    const { error: noteError } = await supabaseAdmin.from("customer_notes").insert({
      customer_id: booking.customer_id,
      booking_id: bookingId,
      source: "Customer Portal - Cancellation Request",
      content: `Customer requested cancellation/rescheduling. Reason: ${reason}`,
      author_type: "customer"
    });
    if (noteError) console.error(`Failed to add customer note: ${noteError.message}`);
    console.log(`[Request Booking Change] Successfully processed request for booking ${bookingId}`);
    return new Response(JSON.stringify({
      success: true,
      message: "Your cancellation/rescheduling request has been submitted for review."
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      },
      status: 200
    });
  } catch (error) {
    console.error("[Request Booking Change] Error:", error.message);
    return new Response(JSON.stringify({
      error: error.message
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      },
      status: 500
    });
  }
});
