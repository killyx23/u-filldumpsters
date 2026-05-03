import { corsHeaders } from "./cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.30.0";
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const supabase = createClient(supabaseUrl, supabaseKey);
    const { token } = await req.json();
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
    // Check if token is expired
    if (new Date(tokenData.expires_at) < new Date()) {
      return new Response(JSON.stringify({
        error: "Token expired",
        valid: false
      }), {
        status: 401,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    // Check if token has been used
    if (tokenData.used_at) {
      return new Response(JSON.stringify({
        error: "Token already used",
        valid: false
      }), {
        status: 401,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    // Mark token as used
    await supabase.from("magic_link_tokens").update({
      used_at: new Date().toISOString()
    }).eq("id", tokenData.id);
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
      customer
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
