import { getCorsHeaders } from "./cors.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const ALLOWED_BODY_KEYS = new Set(["email", "full_name"]);

function jsonResponse(
  body: Record<string, unknown>,
  status: number,
  corsHeaders: Record<string, string>,
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** listUsers({ email }) is not honored by @supabase/supabase-js — paginate and match manually. */
async function findAuthUserByEmail(
  supabaseAdmin: ReturnType<typeof createClient>,
  email: string,
) {
  const perPage = 1000;
  let page = 1;

  while (true) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;

    const users = data?.users ?? [];
    const match = users.find(
      (user) => user.email && normalizeEmail(user.email) === email,
    );
    if (match) return match;
    if (users.length < perPage) return null;
    page += 1;
  }
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

    if (!supabaseUrl || !serviceRoleKey || !anonKey) {
      return jsonResponse({ error: "Supabase configuration missing" }, 500, corsHeaders);
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResponse({ error: "Authentication required" }, 401, corsHeaders);
    }

    const token = authHeader.replace("Bearer ", "").trim();
    const authClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { data: userData, error: userError } = await authClient.auth.getUser();
    if (userError || !userData?.user) {
      return jsonResponse({ error: "Invalid session" }, 401, corsHeaders);
    }

    const caller = userData.user;
    if (caller.app_metadata?.is_admin !== true) {
      return jsonResponse({ error: "Admin privileges required" }, 403, corsHeaders);
    }

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON body" }, 400, corsHeaders);
    }

    const extraKeys = Object.keys(body).filter((k) => !ALLOWED_BODY_KEYS.has(k));
    if (extraKeys.length > 0) {
      return jsonResponse(
        { error: `Unexpected fields: ${extraKeys.join(", ")}` },
        400,
        corsHeaders,
      );
    }

    const rawEmail = body.email;
    if (typeof rawEmail !== "string" || !rawEmail.trim()) {
      return jsonResponse({ error: "Email is required" }, 400, corsHeaders);
    }

    const email = normalizeEmail(rawEmail);
    if (!isValidEmail(email)) {
      return jsonResponse({ error: "Invalid email address" }, 400, corsHeaders);
    }

    const callerEmail = caller.email ? normalizeEmail(caller.email) : null;
    if (callerEmail && email === callerEmail) {
      return jsonResponse(
        { error: "Cannot create or modify your own admin account via this endpoint" },
        403,
        corsHeaders,
      );
    }

    const fullName =
      typeof body.full_name === "string" && body.full_name.trim()
        ? body.full_name.trim()
        : "Site Administrator";

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    const existingUser = await findAuthUserByEmail(supabaseAdmin, email);
    if (existingUser) {
      return jsonResponse(
        {
          error:
            "Account already exists; cannot grant admin via this endpoint. Use Supabase Dashboard to manage existing users.",
        },
        409,
        corsHeaders,
      );
    }

    const temporaryPassword = crypto.randomUUID();

    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: temporaryPassword,
      email_confirm: true,
      app_metadata: { is_admin: true },
      user_metadata: { full_name: fullName },
    });

    if (error) {
      if (error.message.includes("already registered")) {
        return jsonResponse(
          {
            error:
              "Account already exists; cannot grant admin via this endpoint.",
          },
          409,
          corsHeaders,
        );
      }
      throw error;
    }

    return jsonResponse(
      {
        message: "Admin user created successfully.",
        email,
        temporary_password: temporaryPassword,
        user: { id: data.user.id, email: data.user.email },
      },
      200,
      corsHeaders,
    );
  } catch (error) {
    console.error("[create-admin]", error);
    const message = error instanceof Error ? error.message : "Internal error";
    return jsonResponse({ error: message }, 500, corsHeaders);
  }
});
