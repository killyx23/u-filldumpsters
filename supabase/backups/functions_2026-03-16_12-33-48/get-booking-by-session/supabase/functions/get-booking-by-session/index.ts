import { corsHeaders } from "./cors.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }
  try {
    const { sessionId } = await req.json();
    if (!sessionId) {
      throw new Error("Session ID is required.");
    }
    console.log("Looking up session:", sessionId);
    // 🔥 FIX: USE SERVICE ROLE KEY (anon cannot read stripe_payment_info due to RLS)
    const supabase = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
    // --- LOOKUP PAYMENT INFO ---
    const { data: paymentInfo, error: paymentError } = await supabase.from("stripe_payment_info").select("booking_id").eq("stripe_checkout_session_id", sessionId).single();
    if (paymentError || !paymentInfo) {
      const errorMessage = paymentError?.message ?? "Payment info not found for the session.";
      console.error("Payment lookup failed:", errorMessage);
      throw new Error(errorMessage);
    }
    console.log("Payment info found:", paymentInfo);
    // --- LOOKUP BOOKING ---
    const { data: booking, error: bookingError } = await supabase.from("bookings").select(`
        *,
        customers(*)
      `).eq("id", paymentInfo.booking_id).single();
    if (bookingError || !booking) {
      const errorMessage = bookingError?.message ?? "Could not find a booking for the provided session.";
      console.error("Booking lookup failed:", errorMessage);
      throw new Error(errorMessage);
    }
    console.log("Booking found:", booking.id);
    return new Response(JSON.stringify({
      booking
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      },
      status: 200
    });
  } catch (error) {
    console.error("Get booking by session error:", error.message);
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
