/** Canonical public site for customer email links (phones must be able to open these). */
const DEFAULT_SITE_URL = "https://www.u-filldumpsters.com";
const APEX_HOST = "u-filldumpsters.com";
const WWW_HOST = "www.u-filldumpsters.com";

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

/** Hosts a customer's phone cannot reach (localhost, loopback, LAN/WSL private ranges). */
function isUnreachableCustomerHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host.endsWith(".local")
  ) {
    return true;
  }

  // IPv4 private / link-local (includes typical WSL 172.16–31.x addresses)
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const a = Number(ipv4[1]);
    const b = Number(ipv4[2]);
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
  }

  return false;
}

/** Prefer www — apex redirects, but some mobile email clients mishandle the hop. */
function canonicalizePublicOrigin(origin: string): string {
  try {
    const parsed = new URL(origin);
    const host = parsed.hostname.toLowerCase();
    if (host === APEX_HOST || host === WWW_HOST) {
      return DEFAULT_SITE_URL;
    }
  } catch {
    return DEFAULT_SITE_URL;
  }
  return origin.replace(/\/$/, "");
}

/**
 * Public site origin for links in customer emails.
 * Always emit a phone-reachable production URL — never localhost / LAN / WSL.
 * (If the code was created on local Supabase, the phone can still open the page and
 * tap Resend to get a fresh production code.)
 */
export function resolvePublicSiteUrl(url?: string | null): string {
  const normalized = normalizeSiteUrl(url);
  try {
    const host = new URL(normalized).hostname;
    if (isUnreachableCustomerHostname(host)) {
      return DEFAULT_SITE_URL;
    }
    return canonicalizePublicOrigin(normalized);
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
