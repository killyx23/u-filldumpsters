const DEFAULT_SITE_URL = "https://u-filldumpsters.com";

/** Resolve app origin for links in emails (request body → SITE_URL env → production default). */
export function normalizeSiteUrl(url?: string | null): string {
  const fallback = Deno.env.get("SITE_URL") || DEFAULT_SITE_URL;
  const candidate = url && url.trim().length > 0 ? url : fallback;

  try {
    const parsed = new URL(candidate);
    return `${parsed.origin}`.replace(/\/$/, "");
  } catch {
    return DEFAULT_SITE_URL;
  }
}

/**
 * Hostnames that work inside the Supabase Docker network but not in a customer's browser.
 * Never put these into email links.
 */
function isInternalSupabaseHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host === "kong" ||
    host === "host.docker.internal" ||
    host.endsWith(".internal") ||
    host.endsWith(".local")
  );
}

/**
 * Public base for edge-function links used in outbound emails.
 * Prefer an explicit public URL; never emit docker-internal SUPABASE_URL (e.g. http://kong:8000).
 */
export function resolvePublicFunctionsBaseUrl(siteUrl?: string | null): string {
  const site = normalizeSiteUrl(siteUrl);

  const explicit =
    Deno.env.get("PUBLIC_SUPABASE_URL") ||
    Deno.env.get("PUBLIC_FUNCTIONS_URL") ||
    Deno.env.get("SITE_SUPABASE_URL");

  if (explicit && explicit.trim()) {
    const cleaned = explicit
      .trim()
      .replace(/\/+$/, "")
      .replace(/\/functions\/v1$/i, "");
    return `${cleaned}/functions/v1`;
  }

  const supabaseUrl = (Deno.env.get("SUPABASE_URL") || "").trim();
  if (supabaseUrl) {
    try {
      const parsed = new URL(supabaseUrl);
      if (!isInternalSupabaseHostname(parsed.hostname)) {
        return `${parsed.origin.replace(/\/$/, "")}/functions/v1`;
      }
    } catch {
      // fall through to site origin
    }
  }

  // Local docker injects http://kong:8000 — use the app origin (Vite proxies /functions/v1).
  return `${site}/functions/v1`;
}

/** Build a browser-reachable unsubscribe link for early-leave emails. */
export function buildUnsubscribeUrl(
  token: string | null | undefined,
  siteUrl?: string | null,
): string | null {
  if (!token) return null;
  const base = resolvePublicFunctionsBaseUrl(siteUrl);
  return `${base}/unsubscribe?token=${encodeURIComponent(String(token))}`;
}
