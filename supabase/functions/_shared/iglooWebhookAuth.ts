/**
 * Verification for the `x-igloocompany-sha256` header on igloohome webhooks.
 *
 * Igloohome documents the signed string as:
 *   METHOD|HOST|URL_PATH|CONTENT_TYPE|DATE|BODY
 *
 * Then HMAC-SHA256 that string using the PKCS#1 RSA public key bytes (DER) as
 * the HMAC key, and RSA-SHA256 verify the digest against the header signature.
 *
 * Env: IGLOOHOME_PUBLIC_KEY — base64 PKCS#1 DER (2048-bit RSA), from
 * dev+support@igloocompany.co
 *
 * Local only: IGLOOHOME_WEBHOOK_ALLOW_UNSIGNED=true accepts posts with no
 * signature header (simulate tools cannot forge Igloohome's RSA signature).
 */

export type WebhookVerifyResult = {
  valid: boolean;
  method: "rsa_public_key" | "unsigned_allowed" | "none";
  reason?: string;
};

function base64ToBytes(b64: string): Uint8Array {
  const clean = b64
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Match Node crypto HMAC `.update(payload, 'ascii')`. */
function stringToAsciiBytes(s: string): Uint8Array {
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i) & 0xff;
  return bytes;
}

function derLength(len: number): number[] {
  if (len < 0x80) return [len];
  const out: number[] = [];
  let n = len;
  while (n > 0) {
    out.unshift(n & 0xff);
    n >>= 8;
  }
  return [0x80 | out.length, ...out];
}

function derWrap(tag: number, contents: Uint8Array): Uint8Array {
  const header = [tag, ...derLength(contents.length)];
  const out = new Uint8Array(header.length + contents.length);
  out.set(header, 0);
  out.set(contents, header.length);
  return out;
}

/** Web Crypto imports SPKI; Igloohome issues PKCS#1 `RSAPublicKey` DER. */
function pkcs1ToSpki(pkcs1: Uint8Array): Uint8Array {
  const algorithmIdentifier = new Uint8Array([
    0x30, 0x0d,
    0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01,
    0x05, 0x00,
  ]);
  const bitString = derWrap(0x03, new Uint8Array([0x00, ...pkcs1]));
  const body = new Uint8Array(algorithmIdentifier.length + bitString.length);
  body.set(algorithmIdentifier, 0);
  body.set(bitString, algorithmIdentifier.length);
  return derWrap(0x30, body);
}

async function importPkcs1PublicKey(pkcs1Der: Uint8Array): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    "spki",
    pkcs1ToSpki(pkcs1Der),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
}

/** HMAC-SHA256(key=publicKeyDer, message=signedString) per Igloohome docs. */
async function hmacSha256(keyBytes: Uint8Array, signed: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, stringToAsciiBytes(signed));
  return new Uint8Array(sig);
}

/**
 * Build candidate signed strings per Igloohome docs.
 *
 * Supabase Edge may rewrite before the function runs:
 * - `/functions/v1/igloohome-webhook` → `/igloohome-webhook`
 * - `Host: <project>.supabase.co` → `Host: edge-runtime.supabase.com`
 *
 * Igloohome signs the public URL the portal was configured with.
 */
function buildSignedStrings(req: Request, rawBody: string): string[] {
  const url = new URL(req.url);
  const method = req.method.toUpperCase();
  const date = req.headers.get("date") || "";
  const contentType = req.headers.get("content-type") || "application/json";
  const baseContentType = contentType.split(";")[0].trim();

  const hosts = new Set<string>();
  const headerHost = req.headers.get("host");
  if (headerHost) hosts.add(headerHost);
  if (url.host) hosts.add(url.host);
  const hostOverride = Deno.env.get("IGLOOHOME_WEBHOOK_HOST");
  if (hostOverride) hosts.add(hostOverride);
  try {
    const supabaseHost = new URL(Deno.env.get("SUPABASE_URL") || "").host;
    if (supabaseHost) hosts.add(supabaseHost);
  } catch {
    // ignore invalid SUPABASE_URL
  }

  const paths = new Set<string>();
  paths.add(url.pathname);
  if (!url.pathname.startsWith("/functions/v1")) {
    paths.add(`/functions/v1${url.pathname}`);
  } else {
    paths.add(url.pathname.replace(/^\/functions\/v1/, "") || url.pathname);
  }
  const pathOverride = Deno.env.get("IGLOOHOME_WEBHOOK_PATH");
  if (pathOverride) paths.add(pathOverride);

  const contentTypes = contentType === baseContentType
    ? [contentType]
    : [contentType, baseContentType];

  const candidates: string[] = [];
  for (const host of hosts) {
    for (const path of paths) {
      for (const ct of contentTypes) {
        candidates.push(`${method}|${host}|${path}|${ct}|${date}|${rawBody}`);
      }
    }
  }
  return [...new Set(candidates)];
}

export async function verifyIglooWebhook(
  req: Request,
  rawBody: string,
): Promise<WebhookVerifyResult> {
  const publicKeyB64 = Deno.env.get("IGLOOHOME_PUBLIC_KEY")?.trim();
  const allowUnsigned = Deno.env.get("IGLOOHOME_WEBHOOK_ALLOW_UNSIGNED") === "true";

  if (allowUnsigned && !req.headers.get("x-igloocompany-sha256")) {
    return { valid: true, method: "unsigned_allowed" };
  }

  if (!publicKeyB64) {
    return {
      valid: false,
      method: "none",
      reason: "IGLOOHOME_PUBLIC_KEY is not set. Request the webhook public key from dev+support@igloocompany.co.",
    };
  }

  const provided = (req.headers.get("x-igloocompany-sha256") || "")
    .replace(/^"|"$/g, "")
    .trim();
  if (!provided) {
    return { valid: false, method: "rsa_public_key", reason: "Missing x-igloocompany-sha256 header" };
  }

  try {
    const keyBytes = base64ToBytes(publicKeyB64);
    const cryptoKey = await importPkcs1PublicKey(keyBytes);
    const signature = base64ToBytes(provided);
    const candidates = buildSignedStrings(req, rawBody);

    for (const signed of candidates) {
      const hmacDigest = await hmacSha256(keyBytes, signed);
      const ok = await crypto.subtle.verify(
        "RSASSA-PKCS1-v1_5",
        cryptoKey,
        signature,
        hmacDigest,
      );
      if (ok) return { valid: true, method: "rsa_public_key" };
    }

    const url = new URL(req.url);
    console.warn("[igloohome-webhook] Signature verification failed", JSON.stringify({
      publicKey: publicKeyB64,
      publicKeyDerBytes: keyBytes.length,
      host: req.headers.get("host"),
      path: url.pathname,
      date: req.headers.get("date"),
      contentType: req.headers.get("content-type"),
      bodyLen: rawBody.length,
      bodyPreview: rawBody.slice(0, 120),
      candidateCount: candidates.length,
      primaryCandidate: candidates[0] ?? null,
      altCandidate: candidates[1] ?? null,
    }));

    return {
      valid: false,
      method: "rsa_public_key",
      reason: "RSA signature did not match any candidate signed string",
    };
  } catch (err) {
    console.warn("[igloohome-webhook] Signature verification error", JSON.stringify({
      publicKey: publicKeyB64,
      error: err instanceof Error ? err.message : String(err),
    }));
    return {
      valid: false,
      method: "rsa_public_key",
      reason: `Public key verification error: ${err instanceof Error ? err.message : err}`,
    };
  }
}
