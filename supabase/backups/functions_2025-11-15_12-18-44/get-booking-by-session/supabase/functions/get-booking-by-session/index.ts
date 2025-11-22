import { corsHeaders } from "./cors.ts";
import { createClient } from 'npm:@supabase/supabase-js@2';
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
    const authHeader = req.headers.get("Authorization");
    const supabase = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_ANON_KEY"), {
      global: {
        headers: {
          Authorization: authHeader
        }
      }
    });
    console.log("session id ", sessionId);
    const { data: paymentInfo, error: paymentError } = await supabase.from('stripe_payment_info').select('booking_id').eq('stripe_checkout_session_id', sessionId).single();
    if (paymentError || !paymentInfo) {
      const errorMessage = paymentError ? paymentError.message : "Payment info not found for the session.";
      console.error("Error fetching payment info by session ID:", errorMessage);
      throw new Error(errorMessage);
    }
    console.log("I made it past here");
    const { data: booking, error: bookingError } = await supabase.from('bookings').select(`
        *,
        customers(*)
      `).eq('id', paymentInfo.booking_id).single();
    if (bookingError || !booking) {
      const errorMessage = bookingError ? bookingError.message : "Could not find a booking for the provided session.";
      console.error("Error fetching booking by ID:", errorMessage);
      throw new Error(errorMessage);
    }
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
