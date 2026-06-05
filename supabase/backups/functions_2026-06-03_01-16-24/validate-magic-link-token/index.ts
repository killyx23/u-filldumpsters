import { getCorsHeaders } from "./cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.30.0";
const ACTIVE_BOOKING_STATUSES = new Set([
  "confirmed",
  "delivered",
  "waiting_to_be_returned",
  "rescheduled",
  "pending_payment",
  "pending_verification",
  "pending_review",
  "active"
]);
Deno.serve(async (req)=>{
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const supabase = createClient(supabaseUrl, supabaseKey);
    const { token, order_id } = await req.json();
    if (!token) {
      return new Response(JSON.stringify({
        error: "Missing token"
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    // Find token in database
    const { data: tokenData, error: tokenError } = await supabase.from("magic_link_tokens").select("*").eq("token", token).single();
    if (tokenError || !tokenData) {
      return new Response(JSON.stringify({
        error: "Invalid token",
        valid: false
      }), {
        status: 404,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const resolvedOrderId = tokenData.order_id ?? order_id;
    if (!resolvedOrderId) {
      return new Response(JSON.stringify({
        error: "Token is missing booking context",
        error_code: "booking_missing",
        valid: false
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const parsedOrderId = Number(resolvedOrderId);
    if (!Number.isFinite(parsedOrderId)) {
      return new Response(JSON.stringify({
        error: "Invalid booking reference",
        error_code: "booking_invalid",
        valid: false
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const { data: booking, error: bookingError } = await supabase.from("bookings").select("id, customer_id, status").eq("id", parsedOrderId).maybeSingle();
    if (bookingError || !booking) {
      return new Response(JSON.stringify({
        error: "Booking not found",
        error_code: "booking_not_found",
        valid: false
      }), {
        status: 404,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    if (booking.customer_id && Number(booking.customer_id) !== Number(tokenData.customer_id)) {
      return new Response(JSON.stringify({
        error: "Booking does not belong to this token",
        error_code: "booking_mismatch",
        valid: false
      }), {
        status: 403,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const normalizedStatus = String(booking.status || "").toLowerCase();
    if (!ACTIVE_BOOKING_STATUSES.has(normalizedStatus)) {
      return new Response(JSON.stringify({
        error: "Booking is no longer active. Please sign in to the portal.",
        error_code: "booking_inactive",
        booking_status: booking.status,
        valid: false
      }), {
        status: 403,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    if (!tokenData.order_id) {
      await supabase.from("magic_link_tokens").update({
        order_id: parsedOrderId
      }).eq("id", tokenData.id);
    }
    // Fetch customer details
    const { data: customer, error: customerError } = await supabase.from("customers").select("*").eq("id", tokenData.customer_id).single();
    if (customerError || !customer) {
      return new Response(JSON.stringify({
        error: "Customer not found",
        valid: false
      }), {
        status: 404,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    return new Response(JSON.stringify({
      valid: true,
      customer_id: customer.id,
      phone: customer.phone,
      customer,
      order_id: parsedOrderId,
      booking_status: booking.status
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  } catch (error) {
    console.error("[validate-magic-link-token] Error:", error);
    return new Response(JSON.stringify({
      error: error.message || "Internal server error",
      valid: false
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
});
