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
    const { customerId } = await req.json();
    if (!customerId) {
      throw new Error("Customer ID is required.");
    }
    console.log(`[Account Creation] Handling account for customer ID: ${customerId}`);
    const { data: customer, error: fetchError } = await supabaseAdmin.from('customers').select('name, email').eq('id', customerId).single();
    if (fetchError) {
      console.error(`[Account Creation] Error fetching customer ${customerId}:`, fetchError);
      throw fetchError;
    }
    if (!customer) {
      throw new Error(`Customer with ID ${customerId} not found.`);
    }
    console.log(`[Account Creation] Found customer email: ${customer.email}`);
    const tempPassword = `portal-login-${Deno.env.get("SUPABASE_JWT_SECRET")}`;
    const { data: { users }, error: listError } = await supabaseAdmin.auth.admin.listUsers({
      email: customer.email
    });
    if (listError) {
      console.error(`[Account Creation] Error listing users for ${customer.email}:`, listError);
      throw listError;
    }
    if (users && users.length > 0) {
      console.log(`[Account Creation] User ${users[0].id} already exists. Ensuring metadata is correct.`);
      await supabaseAdmin.auth.admin.updateUserById(users[0].id, {
        user_metadata: {
          ...users[0].user_metadata,
          customer_db_id: customerId,
          full_name: customer.name
        }
      });
      console.log(`[Account Creation] Metadata updated for user ${users[0].id}.`);
    } else {
      console.log(`[Account Creation] User does not exist for ${customer.email}. Creating new auth user.`);
      const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email: customer.email,
        password: tempPassword,
        email_confirm: true,
        user_metadata: {
          is_admin: false,
          full_name: customer.name,
          customer_db_id: customerId
        }
      });
      if (createError) {
        console.error(`[Account Creation] Failed to create user for ${customer.email}:`, createError);
        throw createError;
      }
      console.log(`[Account Creation] Successfully created new user with ID: ${newUser.user.id}`);
    }
    return new Response(JSON.stringify({
      success: true,
      message: "Account setup or verification successful."
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      },
      status: 200
    });
  } catch (error) {
    console.error("[Account Creation] Top-level error:", error.message);
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
