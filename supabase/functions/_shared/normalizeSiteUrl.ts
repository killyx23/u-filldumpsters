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
