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
    // 1. Check if any admin user already exists
    const { data: users, error: userError } = await supabaseAdmin.auth.admin.listUsers({
      page: 1,
      perPage: 1000
    });
    if (userError) throw userError;
    const adminExists = users.users.some((user)=>user.user_metadata?.is_admin === true);
    if (adminExists) {
      return new Response(JSON.stringify({
        error: "An admin user already exists. This function can only be used for initial setup."
      }), {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        },
        status: 403
      });
    }
    // 2. If no admin exists, proceed to create one
    const { email } = await req.json();
    if (!email) {
      throw new Error("Email is required to create an admin user.");
    }
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email: email,
      password: "ChangeMeNow8d",
      email_confirm: true,
      user_metadata: {
        is_admin: true,
        full_name: 'Site Administrator'
      }
    });
    if (error) {
      // Handle case where user might already exist but isn't an admin
      if (error.message.includes('already registered')) {
        return new Response(JSON.stringify({
          error: "This email is already registered. Cannot create a new admin account with it."
        }), {
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          },
          status: 409
        });
      }
      throw error;
    }
    return new Response(JSON.stringify({
      message: "Admin user created successfully.",
      user: data.user
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      },
      status: 200
    });
  } catch (error) {
    console.error("Create first admin error:", error.message);
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
