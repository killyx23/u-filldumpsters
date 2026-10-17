import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export function jsonError(corsHeaders: Record<string, string>, error: string, status: number) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

export function jsonOk(corsHeaders: Record<string, string>, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

export async function requireAdminCaller(req: Request, corsHeaders: Record<string, string>) {
  const authHeader = req.headers.get('Authorization') || '';
  if (!authHeader.startsWith('Bearer ')) {
    return { error: jsonError(corsHeaders, 'Admin authentication required.', 401) };
  }

  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    return { error: jsonError(corsHeaders, 'Admin authentication required.', 401) };
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) {
    return { error: jsonError(corsHeaders, 'Unauthorized. Please sign in again.', 401) };
  }
  if (user.app_metadata?.is_admin !== true) {
    return { error: jsonError(corsHeaders, 'Admin access required. Sign in with the same admin session the dashboard uses (app_metadata.is_admin).', 403) };
  }

  return { user, token };
}

type PortalAuthUser = {
  id: string;
  user_metadata?: Record<string, unknown> | null;
};

/**
 * Portal logins are user JWTs. auth.getUser(jwt) on a service-role client
 * ignores that token and returns Unauthorized. Validate with the anon key.
 */
export async function requirePortalCaller(req: Request, corsHeaders: Record<string, string>): Promise<
  | { user: PortalAuthUser; token: string; error?: undefined }
  | { error: Response; user?: undefined; token?: undefined }
> {
  const authHeader = req.headers.get('Authorization') || '';
  if (!authHeader.startsWith('Bearer ')) {
    return { error: jsonError(corsHeaders, 'Missing Authorization header', 401) };
  }

  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    return { error: jsonError(corsHeaders, 'Missing Authorization header', 401) };
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) {
    return { error: jsonError(corsHeaders, 'Unauthorized', 401) };
  }

  return { user, token };
}

/** True when this portal login owns the booking. */
export function portalCallerOwnsBooking(
  user: PortalAuthUser,
  booking: {
    customer_id?: unknown;
    customers?: { user_id?: string | null } | { user_id?: string | null }[] | null;
  },
): boolean {
  const customerDbId = user.user_metadata?.customer_db_id;
  if (customerDbId != null && customerDbId !== '' && Number(customerDbId) === Number(booking.customer_id)) {
    return true;
  }

  const customers = booking.customers;
  const row = Array.isArray(customers) ? customers[0] : customers;
  return Boolean(row?.user_id) && row?.user_id === user.id;
}

export function assertOverridePassword(password: unknown) {
  const configuredPassword = String(Deno.env.get('ADMIN_DELETE_PASSWORD') || '').trim();
  if (configuredPassword) {
    if (password !== configuredPassword) {
      return 'Invalid password.';
    }
    return null;
  }
  if (!password || String(password).trim().length === 0) {
    return 'Confirmation password is required.';
  }
  return null;
}

export function serviceRoleClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );
}

export async function sha256Hex(value: string) {
  const data = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
