import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { getCorsHeaders } from './cors.ts';

const SIGNED_URL_TTL_SECONDS = 3600;
const LOCAL_HOST_PATTERN = /^(127\.0\.0\.1|localhost|\[::1\])$/i;
const DOCKER_INTERNAL_HOST_PATTERN = /^(kong|storage|rest|meta|auth)$/i;

function normalizeEmail(email: string) {
  return String(email || '').trim().toLowerCase();
}

function isLocalOrDockerHost(hostname: string) {
  return (
    LOCAL_HOST_PATTERN.test(hostname) ||
    DOCKER_INTERNAL_HOST_PATTERN.test(hostname) ||
    hostname.startsWith('supabase_') ||
    hostname.includes('_network')
  );
}

function rewriteSignedUrlForSite(url: string, siteUrl: string | null) {
  if (!url || !siteUrl) return url;

  try {
    const signed = new URL(url);
    const site = new URL(siteUrl);
    // Local edge runtime signs with http://kong:8000 — rewrite to the browser/Vite origin.
    if (
      isLocalOrDockerHost(signed.hostname) &&
      LOCAL_HOST_PATTERN.test(site.hostname) &&
      signed.origin !== site.origin
    ) {
      return `${site.origin}${signed.pathname}${signed.search}`;
    }
  } catch {
    // ignore invalid URLs
  }

  return url;
}

async function customerMatchesEmail(
  supabase: ReturnType<typeof createClient>,
  customerId: number,
  email: string,
) {
  const { data, error } = await supabase
    .from('customers')
    .select('id, email')
    .eq('id', customerId)
    .maybeSingle();

  if (error || !data) return false;
  return normalizeEmail(data.email) === normalizeEmail(email);
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    if (!supabaseUrl || !serviceRoleKey) {
      return new Response(JSON.stringify({ success: false, error: 'Server configuration error' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const body = await req.json();
    const customerId = Number(body.customer_id);
    const email = normalizeEmail(body.email);
    const paths = Array.isArray(body.paths)
      ? body.paths.map((path: unknown) => String(path || '').trim()).filter(Boolean)
      : [];
    const siteUrl = body.site_url ? String(body.site_url).trim() : null;

    if (!customerId || !email.includes('@')) {
      return new Response(JSON.stringify({ success: false, error: 'customer_id and email are required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!(await customerMatchesEmail(supabase, customerId, email))) {
      return new Response(JSON.stringify({ success: false, error: 'Customer email does not match' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (paths.length === 0) {
      return new Response(JSON.stringify({ success: true, signed_urls: {} }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const signedUrls: Record<string, string> = {};

    for (const path of paths) {
      const { error: downloadError } = await supabase.storage
        .from('verification-documents')
        .download(path);

      if (downloadError) {
        console.warn('[sign-checkout-verification-urls] object missing, skipping:', path, downloadError.message);
        continue;
      }

      const { data, error } = await supabase.storage
        .from('verification-documents')
        .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);

      if (error) {
        console.error('[sign-checkout-verification-urls] sign failed:', path, error);
        continue;
      }

      if (data?.signedUrl) {
        signedUrls[path] = rewriteSignedUrlForSite(data.signedUrl, siteUrl);
      }
    }

    return new Response(JSON.stringify({ success: true, signed_urls: signedUrls }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[sign-checkout-verification-urls] error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return new Response(JSON.stringify({ success: false, error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
