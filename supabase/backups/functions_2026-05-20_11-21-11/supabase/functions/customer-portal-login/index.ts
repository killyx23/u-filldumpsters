import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.30.0";
import { corsHeaders } from "./cors.ts";
const DOMAIN = "ufilldumpsters.com";
const ENV_PASSWORD_SUFFIX = (Deno.env.get("SUPABASE_PASSWORD_SUFFIX") ?? "").trim();
function buildPasswordFromPhone(cleanedPhone) {
  return `${cleanedPhone}${ENV_PASSWORD_SUFFIX}`;
}
serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }
  try {
    console.log(`[Customer Portal Login] Received request: ${req.method} ${req.url}`);
    const contentType = req.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      return new Response(JSON.stringify({
        error: "Invalid Content-Type. Expected application/json."
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const rawBody = await req.text();
    console.log(`[Customer Portal Login] Raw request body:`, rawBody);
    if (!rawBody || rawBody.trim() === "") {
      return new Response(JSON.stringify({
        error: "Request body cannot be empty."
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    let payload;
    try {
      payload = JSON.parse(rawBody);
    } catch (parseError) {
      return new Response(JSON.stringify({
        error: "Invalid JSON in request body."
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const { portal_number, customerId, phone } = payload;
    const identifier = String(portal_number || customerId || "").trim();
    if (!identifier) {
      return new Response(JSON.stringify({
        error: "Customer ID is required."
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const cleanedPhone = String(phone || "").replace(/\D/g, "");
    if (cleanedPhone.length !== 10) {
      return new Response(JSON.stringify({
        error: "Invalid phone number format. Must be 10 digits."
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    if (!supabaseUrl || !supabaseServiceKey || !supabaseAnonKey) {
      console.error("[Customer Portal Login] Missing environment variables.");
      return new Response(JSON.stringify({
        error: "Server misconfiguration."
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
    // 1. Look up customer
    const { data: customer, error: fetchError } = await supabaseAdmin.from("customers").select("id, name, email, user_id, customer_id_text, phone").eq("customer_id_text", identifier).single();
    if (fetchError || !customer) {
      console.log(`[Customer Portal Login] Customer not found for CID: ${identifier}`);
      return new Response(JSON.stringify({
        error: "Invalid customer ID or phone number."
      }), {
        status: 401,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    // 2. Validate phone
    const cleanDbPhone = String(customer.phone || "").replace(/\D/g, "");
    console.log(`[Customer Portal Login] Phone comparison - Input: ${cleanedPhone}, DB: ${cleanDbPhone}`);
    if (cleanedPhone !== cleanDbPhone) {
      console.log(`[Customer Portal Login] Phone mismatch for CID: ${identifier}`);
      return new Response(JSON.stringify({
        error: "Invalid customer ID or phone number."
      }), {
        status: 401,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    // 3. Build deterministic auth email + password (same as old working version)
    const authEmail = `${identifier}@${DOMAIN}`.toLowerCase();
    const password = buildPasswordFromPhone(cleanedPhone);
    // 4. Ensure auth user exists and is up to date
    const { data: userList, error: listErr } = await supabaseAdmin.auth.admin.listUsers({
      email: authEmail
    });
    if (listErr) {
      return new Response(JSON.stringify({
        error: `Error checking existing user: ${listErr.message}`
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const existingUser = userList?.users?.find((u)=>(u.email ?? "").toLowerCase() === authEmail) ?? null;
    let authUserId;
    if (existingUser) {
      authUserId = existingUser.id;
      console.log(`[Customer Portal Login] Updating existing auth user: ${authUserId}`);
      const { error: updErr } = await supabaseAdmin.auth.admin.updateUserById(authUserId, {
        password,
        email_confirm: true,
        user_metadata: {
          name: customer.name,
          customer_db_id: customer.id,
          original_email: customer.email
        }
      });
      if (updErr) {
        return new Response(JSON.stringify({
          error: `Failed to update auth user: ${updErr.message}`
        }), {
          status: 500,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }
    } else {
      console.log(`[Customer Portal Login] Creating new auth user for: ${authEmail}`);
      const { data: created, error: crtErr } = await supabaseAdmin.auth.admin.createUser({
        email: authEmail,
        password,
        email_confirm: true,
        user_metadata: {
          name: customer.name,
          customer_db_id: customer.id,
          original_email: customer.email
        }
      });
      if (crtErr || !created?.user) {
        return new Response(JSON.stringify({
          error: `Failed to create auth user: ${crtErr?.message}`
        }), {
          status: 500,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }
      authUserId = created.user.id;
    }
    // 5. Link user_id on customers row if needed
    if (customer.user_id !== authUserId) {
      const { error: linkErr } = await supabaseAdmin.from("customers").update({
        user_id: authUserId
      }).eq("id", customer.id);
      if (linkErr) {
        console.error("[Customer Portal Login] Warning: failed to link user_id to customer:", linkErr.message);
      }
    }
    // 6. Sign in with password — no OTP, no magic links, no expiry issues
    console.log(`[Customer Portal Login] Signing in with password for: ${authEmail}`);
    const supabaseAnon = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
    const { data: signInData, error: signInError } = await supabaseAnon.auth.signInWithPassword({
      email: authEmail,
      password
    });
    if (signInError || !signInData?.session) {
      console.error("[Customer Portal Login] Sign-in failed:", signInError);
      return new Response(JSON.stringify({
        error: `Failed to sign in: ${signInError?.message}`,
        hints: [
          "Check SUPABASE_PASSWORD_SUFFIX — must match what was used when user was created.",
          "Ensure Auth > Settings > Password policy allows the password format.",
          "Ensure email_confirm: true is set so the user can sign in without confirming email."
        ]
      }), {
        status: 401,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    console.log(`[Customer Portal Login] Success for customer ${customer.id}`);
    return new Response(JSON.stringify({
      success: true,
      session: signInData.session,
      user: signInData.user,
      customer
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  } catch (err) {
    console.error("[Customer Portal Login] Unhandled Exception:", err);
    return new Response(JSON.stringify({
      error: err.message || "Internal server error during login."
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
});
