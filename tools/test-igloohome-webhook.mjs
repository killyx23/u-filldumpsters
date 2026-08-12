/**
 * Offline checks for the igloohome webhook signature and activity-log parsing.
 *
 *   npm run test:igloohome
 *
 * Signs exactly as Igloohome documents (Node crypto example): PKCS#1 public key
 * bytes as HMAC key, RSA PKCS1 v1.5 over the HMAC digest.
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

/** Igloohome documented signing process (Node crypto example). */
function iglooSign(keyBytes, pathname, host = HOST) {
  const signed = ["POST", host, pathname, "application/json", DATE, BODY].join("|");
  const hmacDigest = crypto.createHmac("sha256", keyBytes).update(signed, "ascii").digest();
  return crypto
    .sign("sha256", hmacDigest, { key: privateKey, padding: crypto.constants.RSA_PKCS1_PADDING })
    .toString("base64");
}

function request(signature, rewrittenPath = REWRITTEN_PATH, hostHeader = HOST) {
  const headers = { host: hostHeader, date: DATE, "content-type": "application/json" };
  if (signature !== null) headers["x-igloocompany-sha256"] = signature;
  return new Request(`https://${HOST}${rewrittenPath}`, { method: "POST", headers, body: BODY });
}

console.log("\nRSA public key verification (Igloohome docs)");
env.IGLOOHOME_PUBLIC_KEY = pkcs1Der.toString("base64");

let result = await verifyIglooWebhook(request(iglooSign(pkcs1Der, PUBLIC_PATH)), BODY);
check("accepts signature over /functions/v1 path", result.valid, result.reason);
check("reports rsa_public_key method", result.method === "rsa_public_key");

result = await verifyIglooWebhook(request(iglooSign(pkcs1Der, REWRITTEN_PATH)), BODY);
check("accepts signature over rewritten /igloohome-webhook path", result.valid, result.reason);

env.SUPABASE_URL = "https://example.supabase.co";
result = await verifyIglooWebhook(
  request(iglooSign(pkcs1Der, PUBLIC_PATH, "example.supabase.co"), REWRITTEN_PATH, "edge-runtime.supabase.com"),
  BODY,
);
check("accepts when edge runtime rewrites Host header", result.valid, result.reason);
delete env.SUPABASE_URL;

result = await verifyIglooWebhook(request(iglooSign(pkcs1Der, PUBLIC_PATH)), `${BODY} tampered`);
check("rejects tampered body", !result.valid);

result = await verifyIglooWebhook(request("Zm9vYmFy"), BODY);
check("rejects bogus signature", !result.valid);

result = await verifyIglooWebhook(request(null), BODY);
check("rejects missing signature header", !result.valid);

console.log("\nFail-closed behaviour");
delete env.IGLOOHOME_PUBLIC_KEY;
result = await verifyIglooWebhook(request(iglooSign(pkcs1Der, PUBLIC_PATH)), BODY);
check("rejects when public key not configured", !result.valid && result.method === "none");

env.IGLOOHOME_WEBHOOK_ALLOW_UNSIGNED = "true";
result = await verifyIglooWebhook(request(null), BODY);
check("allows unsigned only with explicit dev opt-in", result.valid);
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
