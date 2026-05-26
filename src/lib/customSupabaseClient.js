import { createClient } from '@supabase/supabase-js';

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

const rawSupabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseUrl = normalizeSupabaseUrl(rawSupabaseUrl);
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  const message =
    '[Supabase] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Copy .env.example to .env.local and set values for local dev (e.g. http://127.0.0.1:54321).';
  console.error(message);
  throw new Error(message);
}

if (import.meta.env.DEV) {
  let host = "";
  try {
    host = new URL(supabaseUrl).hostname;
  } catch {
    host = "";
  }

  const isLocalHost = host === "127.0.0.1" || host === "localhost";
  if (!isLocalHost) {
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
