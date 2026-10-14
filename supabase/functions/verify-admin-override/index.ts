import { getCorsHeaders } from './cors.ts';
import { assertOverridePassword, jsonError, jsonOk, requireAdminCaller } from '../_shared/phoneOrderAuth.ts';

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const adminAuth = await requireAdminCaller(req, corsHeaders);
    if (adminAuth.error) return adminAuth.error;

    const { password } = await req.json();
    const passwordError = assertOverridePassword(password);
    if (passwordError) return jsonError(corsHeaders, passwordError, 401);

    return jsonOk(corsHeaders, { ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Override check failed.';
    return jsonError(corsHeaders, message, 400);
  }
});
