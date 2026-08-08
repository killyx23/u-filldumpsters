/**
 * Verification for the `x-igloocompany-sha256` header on igloohome webhooks.
 *
 * Igloohome documents the signed string as:
 *   METHOD|HOST|PATH|CONTENT-TYPE|DATE|BODY
 *
 * Two credential styles are supported and auto-detected:
 *
 *   IGLOOHOME_PUBLIC_KEY  — the documented scheme. HMAC-SHA256 the signed
 *                           string using the raw public key bytes as the HMAC
 *                           key, then RSA (PKCS#1 v1.5 / SHA-256) verify that
 *                           digest against the header signature.
 *   IGLOOHOME_WEBHOOK_SECRET — plain shared-secret HMAC-SHA256, base64.
 *
 * Set IGLOOHOME_WEBHOOK_ALLOW_UNSIGNED=true to accept unsigned posts when
 * neither is configured (local development only).
 */

export type WebhookVerifyResult = {
  valid: boolean;
  method: "rsa_public_key" | "shared_secret" | "unsigned_allowed" | "none";
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

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

async function hmacSha256(keyBytes: Uint8Array, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return new Uint8Array(sig);
}

/** DER length prefix for a payload of `len` bytes. */
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

/**
 * Web Crypto only imports SPKI. Igloohome hands out a PKCS#1 `RSAPublicKey`,
 * so wrap it in the rsaEncryption AlgorithmIdentifier envelope.
 */
function pkcs1ToSpki(pkcs1: Uint8Array): Uint8Array {
  // SEQUENCE { OID 1.2.840.113549.1.1.1, NULL }
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

async function importRsaPublicKey(keyBytes: Uint8Array): Promise<CryptoKey> {
  const algorithm = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" };
  try {
    return await crypto.subtle.importKey("spki", keyBytes, algorithm, false, ["verify"]);
  } catch {
    return await crypto.subtle.importKey("spki", pkcs1ToSpki(keyBytes), algorithm, false, [
      "verify",
    ]);
  }
}

/**
 * Candidate signed strings.
 *
 * Supabase rewrites the request path before it reaches the function, so
 * `url.pathname` is usually `/igloohome-webhook` while igloohome signed
 * `/functions/v1/igloohome-webhook`. Content-Type may also arrive with a
 * charset parameter appended by a proxy. Try the plausible combinations
 * rather than guessing one and failing silently in production.
 */
function buildSignedStrings(req: Request, rawBody: string): string[] {
  const url = new URL(req.url);
  const host = req.headers.get("host") || url.host;
  const date = req.headers.get("date") || "";
  const rawContentType = req.headers.get("content-type") || "application/json";
  const baseContentType = rawContentType.split(";")[0].trim();

  const paths = new Set<string>();
  paths.add(url.pathname);
  if (!url.pathname.startsWith("/functions/v1")) {
    paths.add(`/functions/v1${url.pathname}`);
  } else {
    paths.add(url.pathname.replace(/^\/functions\/v1/, ""));
  }
  const override = Deno.env.get("IGLOOHOME_WEBHOOK_PATH");
  if (override) paths.add(override);

  const contentTypes = new Set([rawContentType, baseContentType]);

  const candidates: string[] = [];
  for (const path of paths) {
    for (const contentType of contentTypes) {
      candidates.push(`${req.method}|${host}|${path}|${contentType}|${date}|${rawBody}`);
    }
  }
  return candidates;
}

export async function verifyIglooWebhook(
  req: Request,
  rawBody: string,
): Promise<WebhookVerifyResult> {
  const publicKey = Deno.env.get("IGLOOHOME_PUBLIC_KEY");
  const sharedSecret = Deno.env.get("IGLOOHOME_WEBHOOK_SECRET");
  const allowUnsigned = Deno.env.get("IGLOOHOME_WEBHOOK_ALLOW_UNSIGNED") === "true";

  // Dev override must win even when a public key is present — local simulate
  // tools cannot forge igloohome's RSA signature.
  if (allowUnsigned && !req.headers.get("x-igloocompany-sha256")) {
    return { valid: true, method: "unsigned_allowed" };
  }

  if (!publicKey && !sharedSecret) {
    return allowUnsigned
      ? { valid: true, method: "unsigned_allowed" }
      : {
        valid: false,
        method: "none",
        reason:
          "Neither IGLOOHOME_PUBLIC_KEY nor IGLOOHOME_WEBHOOK_SECRET is set. Request the webhook public key from dev+support@igloocompany.co.",
      };
  }

  const provided = (req.headers.get("x-igloocompany-sha256") || "").replace(/^"|"$/g, "").trim();
  if (!provided) {
    return {
      valid: false,
      method: publicKey ? "rsa_public_key" : "shared_secret",
      reason: "Missing x-igloocompany-sha256 header",
    };
  }

  const candidates = buildSignedStrings(req, rawBody);

  if (publicKey) {
    try {
      const keyBytes = base64ToBytes(publicKey);
      const cryptoKey = await importRsaPublicKey(keyBytes);
      const signature = base64ToBytes(provided);
      for (const signed of candidates) {
        const digest = await hmacSha256(keyBytes, signed);
        const ok = await crypto.subtle.verify(
          "RSASSA-PKCS1-v1_5",
          cryptoKey,
          signature,
          digest,
        );
        if (ok) return { valid: true, method: "rsa_public_key" };
      }
      return {
        valid: false,
        method: "rsa_public_key",
        reason: "RSA signature did not match any candidate signed string",
      };
    } catch (err) {
      return {
        valid: false,
        method: "rsa_public_key",
        reason: `Public key verification error: ${err instanceof Error ? err.message : err}`,
      };
    }
  }

  const secretBytes = new TextEncoder().encode(sharedSecret!);
  for (const signed of candidates) {
    const expected = bytesToBase64(await hmacSha256(secretBytes, signed));
    if (timingSafeEqual(provided, expected)) {
      return { valid: true, method: "shared_secret" };
    }
  }
  return {
    valid: false,
    method: "shared_secret",
    reason: "HMAC signature did not match any candidate signed string",
  };
}
