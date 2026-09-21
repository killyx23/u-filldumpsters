import { getCorsHeaders } from "./cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.30.0";
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
    const { customer_id, phone, order_id } = await req.json();
    if (!customer_id || !phone) {
      return new Response(JSON.stringify({
        error: "Missing customer_id or phone"
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    // Verify customer exists
    const { data: customer, error: customerError } = await supabase.from("customers").select("id, phone").eq("id", customer_id).single();
    if (customerError || !customer) {
      return new Response(JSON.stringify({
        error: "Customer not found"
      }), {
        status: 404,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    // Normalize phone numbers for comparison
    const normalizedPhone = phone.replace(/\D/g, "");
    const normalizedCustomerPhone = (customer.phone || "").replace(/\D/g, "");
    if (!normalizedCustomerPhone.endsWith(normalizedPhone.slice(-4))) {
      return new Response(JSON.stringify({
        error: "Phone number does not match customer"
      }), {
        status: 403,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    let normalizedOrderId = null;
    if (order_id !== null && order_id !== undefined && String(order_id).trim() !== "") {
      const parsedOrderId = Number(order_id);
      if (!Number.isFinite(parsedOrderId)) {
        return new Response(JSON.stringify({
          error: "Invalid order_id"
        }), {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }
      const { data: booking, error: bookingError } = await supabase.from("bookings").select("id, customer_id").eq("id", parsedOrderId).maybeSingle();
      if (bookingError || !booking) {
        return new Response(JSON.stringify({
          error: "Booking not found"
        }), {
          status: 404,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }
      if (booking.customer_id && Number(booking.customer_id) !== Number(customer_id)) {
        return new Response(JSON.stringify({
          error: "Booking does not belong to this customer"
        }), {
          status: 403,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }
      normalizedOrderId = Number(booking.id);
    }
    // Generate secure token
    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    // Store token in database
    const { data: tokenData, error: tokenError } = await supabase.from("magic_link_tokens").insert({
      token,
      customer_id,
      phone: customer.phone,
      order_id: normalizedOrderId,
      expires_at: expiresAt
    }).select().single();
    if (tokenError) {
      console.error("[generate-magic-link-token] Error storing token:", tokenError);
      return new Response(JSON.stringify({
        error: "Failed to generate token"
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    return new Response(JSON.stringify({
      token,
      expires_at: expiresAt
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  } catch (error) {
    console.error("[generate-magic-link-token] Error:", error);
    return new Response(JSON.stringify({
      error: error.message || "Internal server error"
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
});
