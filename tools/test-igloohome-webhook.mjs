/**
 * Offline checks for the igloohome webhook signature and activity-log parsing.
 *
 *   npm run test:igloohome
 *
 * The edge functions are Deno TypeScript, so each module is transpiled with
 * esbuild and imported with a stubbed `Deno.env`. No network, no Supabase, and
 * no real igloohome credentials are required — the RSA keypair is generated
 * here and signed exactly the way igloohome documents it.
 */

import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { transform } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = {};
globalThis.Deno = { env: { get: (key) => env[key] } };

async function importDenoModule(relPath) {
  const source = await readFile(path.join(root, relPath), "utf8");
  const { code } = await transform(source, { loader: "ts", format: "esm" });
  return import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
}

const { verifyIglooWebhook } = await importDenoModule(
  "supabase/functions/_shared/iglooWebhookAuth.ts",
);
const { parseActivityLogEntry, logTypeToEventKind, redactPins } = await importDenoModule(
  "supabase/functions/_shared/iglooActivity.ts",
);

let failures = 0;
function check(name, condition, detail = "") {
  if (condition) {
    console.log(`  ok    ${name}`);
  } else {
    console.log(`  FAIL  ${name}${detail ? ` -> ${detail}` : ""}`);
    failures += 1;
  }
}

const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const pkcs1Der = publicKey.export({ type: "pkcs1", format: "der" });

const HOST = "example.supabase.co";
const DATE = "Sat, 20 Jun 2015 12:34:56 GMT";
const BODY = JSON.stringify({ payload: { event: { type: 5 } } });
const PUBLIC_PATH = "/functions/v1/igloohome-webhook";
const REWRITTEN_PATH = "/igloohome-webhook";

/** Reproduces igloohome's documented signing process. */
function iglooSign(keyBytes, pathname) {
  const signed = ["POST", HOST, pathname, "application/json", DATE, BODY].join("|");
  const digest = crypto.createHmac("sha256", keyBytes).update(signed).digest();
  return crypto
    .sign("sha256", digest, { key: privateKey, padding: crypto.constants.RSA_PKCS1_PADDING })
    .toString("base64");
}

function request(signature) {
  const headers = { host: HOST, date: DATE, "content-type": "application/json" };
  if (signature !== null) headers["x-igloocompany-sha256"] = signature;
  return new Request(`https://${HOST}${REWRITTEN_PATH}`, { method: "POST", headers, body: BODY });
}

console.log("\nRSA public key verification");
env.IGLOOHOME_PUBLIC_KEY = pkcs1Der.toString("base64");

// Supabase strips /functions/v1 before the function sees the request, so the
// signed path never matches the observed path. This is the failure mode most
// likely to bite in production.
let result = await verifyIglooWebhook(request(iglooSign(pkcs1Der, PUBLIC_PATH)), BODY);
check("accepts a signature over the public /functions/v1 path", result.valid, result.reason);
check("reports the rsa_public_key method", result.method === "rsa_public_key");

result = await verifyIglooWebhook(request(iglooSign(pkcs1Der, REWRITTEN_PATH)), BODY);
check("accepts a signature over the rewritten path", result.valid, result.reason);

result = await verifyIglooWebhook(request(iglooSign(pkcs1Der, PUBLIC_PATH)), `${BODY} tampered`);
check("rejects a tampered body", !result.valid);

result = await verifyIglooWebhook(request("Zm9vYmFy"), BODY);
check("rejects a bogus signature", !result.valid);

result = await verifyIglooWebhook(request(null), BODY);
check("rejects a missing signature header", !result.valid);

const spkiDer = publicKey.export({ type: "spki", format: "der" });
env.IGLOOHOME_PUBLIC_KEY = spkiDer.toString("base64");
result = await verifyIglooWebhook(request(iglooSign(spkiDer, PUBLIC_PATH)), BODY);
check("accepts an SPKI-encoded public key too", result.valid, result.reason);

console.log("\nShared secret fallback");
delete env.IGLOOHOME_PUBLIC_KEY;
env.IGLOOHOME_WEBHOOK_SECRET = "s3cret";
const hmacSignature = crypto
  .createHmac("sha256", "s3cret")
  .update(["POST", HOST, PUBLIC_PATH, "application/json", DATE, BODY].join("|"))
  .digest("base64");
result = await verifyIglooWebhook(request(hmacSignature), BODY);
check("accepts a valid shared-secret HMAC", result.valid, result.reason);
check("reports the shared_secret method", result.method === "shared_secret");
result = await verifyIglooWebhook(request(hmacSignature), `${BODY}x`);
check("rejects a tampered body under the shared secret", !result.valid);

console.log("\nFail-closed behaviour");
delete env.IGLOOHOME_WEBHOOK_SECRET;
result = await verifyIglooWebhook(request(hmacSignature), BODY);
check("rejects when no credential is configured", !result.valid && result.method === "none");
env.IGLOOHOME_WEBHOOK_ALLOW_UNSIGNED = "true";
result = await verifyIglooWebhook(request(hmacSignature), BODY);
check("allows unsigned posts only with the explicit dev opt-in", result.valid);
delete env.IGLOOHOME_WEBHOOK_ALLOW_UNSIGNED;

console.log("\nActivity log parsing");
check("logType 50 is an unlock", logTypeToEventKind(50) === "unlock");
check("logType 49 is a lock", logTypeToEventKind(49) === "lock");
check("logType 20 (one-time PIN) is an unlock", logTypeToEventKind(20) === "unlock");
check("logType 53 is a break-in", logTypeToEventKind(53) === "breakin");
check("a non-access logType is ignored", logTypeToEventKind(1) === null);

const parsed = parseActivityLogEntry({
  logType: 50,
  entryDate: 1754530000,
  pin: "123456",
  keyId: "k-1",
  operationId: "op-9",
  deviceId: "IGP1abc",
});
check("parses a realistic type-5 entry", parsed !== null);
check("classifies it as an unlock", parsed?.eventType === "unlock");
check(
  "reads entryDate as epoch seconds",
  parsed?.eventTimestamp === new Date(1754530000 * 1000).toISOString(),
  parsed?.eventTimestamp,
);
check("keeps the PIN in memory for booking matching", parsed?.pinCode === "123456");
check("captures keyId and operationId", parsed?.keyId === "k-1" && parsed?.operationId === "op-9");

const millis = parseActivityLogEntry({ logType: 49, entryDate: 1754530000000 });
check(
  "does not misread a millisecond entryDate as seconds",
  millis?.eventTimestamp === new Date(1754530000000).toISOString(),
  millis?.eventTimestamp,
);

check(
  "parses a break-in entry",
  parseActivityLogEntry({ logType: 53, entryDate: 1754530001 })?.eventType === "breakin",
);

const redacted = redactPins({ pin: "123456", nested: { newPin: "999", keyId: "k" } });
check("redacts a top-level pin", redacted.pin === "[redacted]");
check("redacts a nested newPin", redacted.nested.newPin === "[redacted]");
check("leaves non-secret fields intact", redacted.nested.keyId === "k");

console.log(failures === 0 ? "\nAll checks passed\n" : `\n${failures} check(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
