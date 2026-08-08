import { createClient } from '@supabase/supabase-js';

const LOCAL_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

/** Project root only — supabase-js appends /rest/v1 and /functions/v1 itself. */
function normalizeSupabaseUrl(url) {
  if (!url) return url;
  const trimmed = url.trim().replace(/\/+$/, '');
  const normalized = trimmed.replace(/\/rest\/v1$/i, '');
  if (normalized !== trimmed) {
    console.warn(
      '[Supabase] VITE_SUPABASE_URL should not include /rest/v1 — using:',
      normalized
    );
  }
  return normalized;
}

function getHostname(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function isLocalHostname(hostname) {
  return LOCAL_HOSTNAMES.has(hostname);
}

function resolveSupabaseUrl(baseUrl) {
  if (!import.meta.env.DEV || typeof window === 'undefined' || !window.location?.origin) {
    return baseUrl;
  }

  const browserOrigin = normalizeSupabaseUrl(window.location.origin);
  const baseHost = getHostname(baseUrl);
  const baseIsLocalHost = baseHost && isLocalHostname(baseHost);

  if (baseIsLocalHost) {
    console.info(
      `[Supabase] Using browser origin "${browserOrigin}" for local dev via Vite proxy.`,
    );
    return browserOrigin;
  }

  return baseUrl;
}

const rawSupabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const baseSupabaseUrl = normalizeSupabaseUrl(rawSupabaseUrl);
const supabaseUrl = resolveSupabaseUrl(baseSupabaseUrl);
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  const message =
    '[Supabase] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Copy .env.example to .env.local, then run `npm run supabase:sync-local-env` after `npx supabase start`.';
  console.error(message);
  throw new Error(message);
}

if (import.meta.env.DEV) {
  const resolvedHost = getHostname(supabaseUrl);
  const browserHost =
    typeof window !== 'undefined' && window.location?.origin
      ? getHostname(window.location.origin)
      : '';

  const isLocalHost = isLocalHostname(resolvedHost);
  const isCurrentBrowserHost = browserHost && resolvedHost === browserHost;
  if (!isLocalHost && !isCurrentBrowserHost) {
    const message =
      `[Supabase] Dev mode requires a local Supabase URL. Received "${supabaseUrl}". ` +
      "Run `npm run supabase:sync-local-env` after `npx supabase start`.";
    console.error(message);
    throw new Error(message);
  }
}

const customSupabaseClient = createClient(supabaseUrl, supabaseAnonKey);

export default customSupabaseClient;

export {
  customSupabaseClient,
  customSupabaseClient as supabase,
};
