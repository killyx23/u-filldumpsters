// supabase/functions/customer-portal-login/index.ts
// Drop this file into your Edge Functions folder and deploy.
// Assumes you have a local `cors.ts` in the same folder exporting corsHeaders.
import { corsHeaders } from "./cors.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
// Admin client (service role) for privileged operations
const supabaseAdmin = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
// Public client for end-user auth flows (signInWithPassword)
const supabasePublic = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_ANON_KEY"));
// Helpers
const sanitizePhone = (value)=>value.replace(/\D/g, "");
function genTempPassword(length = 48) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b)=>b.toString(16).padStart(2, "0")).join("");
}
// Find a user by email via admin.listUsers (paginates a few pages to be safe)
async function findUserByEmail(email) {
  const perPage = 1000;
  for(let page = 1; page <= 5; page++){
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({
      page,
      perPage
    });
    if (error) throw error;
    const found = data.users.find((u)=>u.email?.toLowerCase() === email.toLowerCase());
    if (found) return found;
    if (data.users.length < perPage) break; // no more pages
  }
  return null;
}
console.info("[customer-portal-login] server started");
Deno.serve(async (req)=>{
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }
  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({
        error: "Method not allowed"
      }), {
        status: 405,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const { customerId, phone } = await req.json();
    console.log(`[Portal Login] Attempting login for customerId: ${customerId}`);
    if (!customerId || !phone) {
      console.error("[Portal Login] Missing customerId or phone in request.");
      return new Response(JSON.stringify({
        error: "Customer ID and phone number are required."
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const sanitizedPhone = sanitizePhone(String(phone));
    // 1) Lookup customer by ID text (case-insensitive)
    const { data: customer, error: customerError } = await supabaseAdmin.from("customers").select("id, email, phone, name").eq("customer_id_text", String(customerId).toUpperCase()).single();
    if (customerError || !customer) {
      console.error(`[Portal Login] Customer lookup failed for CID ${customerId}. Error:`, customerError);
      return new Response(JSON.stringify({
        error: "Invalid credentials. Please check your Customer ID and phone number."
      }), {
        status: 401,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    console.log(`[Portal Login] Found customer record: ${customer.id}`);
    // 2) Compare sanitized phones
    const dbPhone = sanitizePhone(String(customer.phone ?? ""));
    if (!dbPhone || dbPhone !== sanitizedPhone) {
      console.warn(`[Portal Login] Phone mismatch for customer ${customer.id}. Provided: ${sanitizedPhone}, DB: ${dbPhone}`);
      return new Response(JSON.stringify({
        error: "Invalid credentials. Please check your Customer ID and phone number."
      }), {
        status: 401,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    // 3) Ensure there is a Supabase Auth user for this email
    const email = String(customer.email || "").trim();
    if (!email) {
      console.error(`[Portal Login] Customer ${customer.id} has no email on file.`);
      return new Response(JSON.stringify({
        error: "No email on file for this customer."
      }), {
        status: 422,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const tempPassword = `portal-${genTempPassword(24)}`;
    let authUser = await findUserByEmail(email);
    if (!authUser) {
      console.log(`[Portal Login] No auth user found for ${email}. Creating new user.`);
      const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email,
        password: tempPassword,
        email_confirm: true,
        user_metadata: {
          is_admin: false,
          full_name: customer.name ?? null,
          customer_db_id: customer.id
        }
      });
      if (createError) {
        console.error(`[Portal Login] Error creating auth user for ${email}:`, createError);
        return new Response(JSON.stringify({
          error: "Could not create user."
        }), {
          status: 500,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }
      authUser = created.user;
      console.log(`[Portal Login] New auth user created with ID: ${authUser.id}`);
    } else {
      console.log(`[Portal Login] Found existing auth user ${authUser.id}. Updating password and metadata.`);
      const { error: updErr } = await supabaseAdmin.auth.admin.updateUserById(authUser.id, {
        password: tempPassword,
        user_metadata: {
          ...authUser.user_metadata ?? {},
          customer_db_id: customer.id,
          full_name: customer.name ?? authUser.user_metadata?.full_name ?? null,
          is_admin: false
        }
      });
      if (updErr) {
        console.error(`[Portal Login] Error updating user ${authUser.id}:`, updErr);
        return new Response(JSON.stringify({
          error: "Could not update user."
        }), {
          status: 500,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }
    }
    // 4) Sign in with the temp password and return session
    console.log(`[Portal Login] Attempting sign-in for ${email}.`);
    const { data: signInData, error: signInError } = await supabasePublic.auth.signInWithPassword({
      email,
      password: tempPassword
    });
    if (signInError) {
      console.error(`[Portal Login] Sign-in failed for ${email}:`, signInError);
      return new Response(JSON.stringify({
        error: "Could not authenticate user. Please try again."
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    console.log(`[Portal Login] Sign-in successful for ${email}. Returning session.`);
    return new Response(JSON.stringify(signInData), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  } catch (error) {
    console.error("[Portal Login] Top-level error:", error?.message || error);
    return new Response(JSON.stringify({
      error: "Internal server error"
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
});
