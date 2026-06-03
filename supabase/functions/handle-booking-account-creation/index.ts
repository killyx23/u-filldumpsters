import { getCorsHeaders } from "./cors.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const DOMAIN = "ufilldumpsters.com";
const ENV_PASSWORD_SUFFIX = (Deno.env.get("SUPABASE_PASSWORD_SUFFIX") ?? "").trim();

function buildPasswordFromPhone(cleanedPhone: string) {
  return `${cleanedPhone}${ENV_PASSWORD_SUFFIX}`;
}

function buildAuthEmail(customerIdText: string) {
  return `${String(customerIdText).trim()}@${DOMAIN}`.toLowerCase();
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { customerId } = await req.json();
    if (!customerId) {
      throw new Error("Customer ID is required.");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error("Server misconfiguration.");
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    console.log(`[Account Creation] Handling account for customer ID: ${customerId}`);

    const { data: customer, error: fetchError } = await supabaseAdmin
      .from("customers")
      .select("id, name, email, phone, user_id, customer_id_text")
      .eq("id", customerId)
      .single();

    if (fetchError || !customer) {
      console.error(`[Account Creation] Error fetching customer ${customerId}:`, fetchError);
      throw fetchError ?? new Error(`Customer with ID ${customerId} not found.`);
    }

    const portalId = String(customer.customer_id_text ?? "").trim();
    if (!portalId) {
      throw new Error(`Customer ${customerId} is missing customer_id_text.`);
    }

    const cleanedPhone = String(customer.phone ?? "").replace(/\D/g, "");
    if (cleanedPhone.length !== 10) {
      throw new Error(`Customer ${customerId} has invalid phone for portal auth.`);
    }

    const authEmail = buildAuthEmail(portalId);
    const password = buildPasswordFromPhone(cleanedPhone);

    console.log(`[Account Creation] Provisioning auth user ${authEmail} for customer ${customerId}`);

    const { data: userList, error: listError } = await supabaseAdmin.auth.admin.listUsers({
      email: authEmail,
    });
    if (listError) {
      console.error(`[Account Creation] Error listing users for ${authEmail}:`, listError);
      throw listError;
    }

    const existingUser =
      userList?.users?.find((u) => (u.email ?? "").toLowerCase() === authEmail) ?? null;

    let authUserId: string;

    if (existingUser) {
      authUserId = existingUser.id;
      console.log(`[Account Creation] Updating existing auth user: ${authUserId}`);
      const { error: updErr } = await supabaseAdmin.auth.admin.updateUserById(authUserId, {
        password,
        email_confirm: true,
        user_metadata: {
          name: customer.name,
          customer_db_id: customer.id,
          original_email: customer.email,
        },
      });
      if (updErr) {
        throw new Error(`Failed to update auth user: ${updErr.message}`);
      }
    } else {
      console.log(`[Account Creation] Creating new auth user for: ${authEmail}`);
      const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email: authEmail,
        password,
        email_confirm: true,
        user_metadata: {
          name: customer.name,
          customer_db_id: customer.id,
          original_email: customer.email,
        },
      });
      if (createError || !created?.user) {
        console.error(`[Account Creation] Failed to create user for ${authEmail}:`, createError);
        throw createError ?? new Error("Failed to create auth user.");
      }
      authUserId = created.user.id;
      console.log(`[Account Creation] Successfully created auth user: ${authUserId}`);
    }

    if (customer.user_id !== authUserId) {
      const { error: linkErr } = await supabaseAdmin
        .from("customers")
        .update({ user_id: authUserId })
        .eq("id", customer.id);
      if (linkErr) {
        console.error("[Account Creation] Warning: failed to link user_id to customer:", linkErr.message);
      } else {
        console.log(`[Account Creation] Linked customer ${customer.id} to auth user ${authUserId}`);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        authUserId,
        authEmail,
        message: "Account setup or verification successful.",
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[Account Creation] Top-level error:", message);
    return new Response(JSON.stringify({ error: message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
