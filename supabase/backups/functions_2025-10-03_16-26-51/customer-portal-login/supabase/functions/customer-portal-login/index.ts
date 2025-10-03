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
    const { customerId, phone } = await req.json();
    console.log(`[Portal Login] Attempting login for customerId: ${customerId}`);
    if (!customerId || !phone) {
      console.error("[Portal Login] Missing customerId or phone in request.");
      throw new Error("Customer ID and phone number are required.");
    }
    const sanitizedPhone = phone.replace(/\D/g, '');
    console.log(`[Portal Login] Sanitized phone: ${sanitizedPhone}`);
    const { data: customer, error: customerError } = await supabaseAdmin.from('customers').select('id, email, phone, name').eq('customer_id_text', customerId.toUpperCase()).single();
    if (customerError || !customer) {
      console.error(`[Portal Login] Customer lookup failed for CID ${customerId}. Error:`, customerError);
      return new Response(JSON.stringify({
        error: "Invalid credentials. Please check your Customer ID and phone number."
      }), {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        },
        status: 401
      });
    }
    console.log(`[Portal Login] Found customer record:`, customer.id);
    const dbPhone = customer.phone.replace(/\D/g, '');
    if (dbPhone !== sanitizedPhone) {
      console.warn(`[Portal Login] Phone number mismatch for customer ${customer.id}. Provided: ${sanitizedPhone}, DB: ${dbPhone}`);
      return new Response(JSON.stringify({
        error: "Invalid credentials. Please check your Customer ID and phone number."
      }), {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        },
        status: 401
      });
    }
    console.log(`[Portal Login] Credentials verified for customer ${customer.id}.`);
    const tempPassword = `portal-login-${Deno.env.get("SUPABASE_JWT_SECRET")}`;
    const { data: { users }, error: listError } = await supabaseAdmin.auth.admin.listUsers({
      email: customer.email
    });
    if (listError) {
      console.error(`[Portal Login] Error listing users for email ${customer.email}:`, listError);
      throw listError;
    }
    let authUser = users.length > 0 ? users[0] : null;
    if (!authUser) {
      console.log(`[Portal Login] No auth user found for ${customer.email}. Creating new user.`);
      const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email: customer.email,
        password: tempPassword,
        email_confirm: true,
        user_metadata: {
          is_admin: false,
          full_name: customer.name,
          customer_db_id: customer.id
        }
      });
      if (createError) {
        console.error(`[Portal Login] Error creating new auth user for ${customer.email}:`, createError);
        throw createError;
      }
      authUser = newUser.user;
      console.log(`[Portal Login] New auth user created with ID: ${authUser.id}`);
    } else {
      console.log(`[Portal Login] Found existing auth user ${authUser.id}. Updating password and metadata.`);
      await supabaseAdmin.auth.admin.updateUserById(authUser.id, {
        user_metadata: {
          ...authUser.user_metadata,
          customer_db_id: customer.id
        },
        password: tempPassword
      });
    }
    console.log(`[Portal Login] Attempting to sign in user ${authUser.id} with temporary password.`);
    const { data: signInData, error: signInError } = await supabaseAdmin.auth.signInWithPassword({
      email: customer.email,
      password: tempPassword
    });
    if (signInError) {
      console.error(`[Portal Login] Sign-in failed for user ${authUser.id}:`, signInError);
      throw new Error("Could not authenticate user. Please try again.");
    }
    console.log(`[Portal Login] Sign-in successful for user ${authUser.id}. Returning session.`);
    return new Response(JSON.stringify(signInData), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      },
      status: 200
    });
  } catch (error) {
    console.error("[Portal Login] Top-level error:", error.message);
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
