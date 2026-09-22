/**
 * Invoke generate-pin against an existing confirmed booking (local stack).
 *
 * Prerequisites:
 *   npx supabase start
 *   npm run supabase:sync-local-env
 *   npm run dev:functions   (separate terminal; needs Igloohome creds in supabase/functions/.env)
 *
 *   npm run test:generate-pin
 *   BOOKING_ID=1314 npm run test:generate-pin   # optional override
 */

import { execSync } from "node:child_process";
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { challengeAndVerifyTotp } from "../src/lib/adminMfa.js";

const BASE = "http://127.0.0.1:55421/functions/v1";

function parseStatusEnv(output) {
  const values = {};
  for (const rawLine of output.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[line.slice(0, eq).trim()] = value;
  }
  return values;
}

function base32Decode(input) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const cleaned = input.replace(/=+$/, "").toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = "";
  for (const char of cleaned) {
    const val = alphabet.indexOf(char);
    if (val < 0) continue;
    bits += val.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

function generateTotp(secret, counterOffset = 0) {
  const key = base32Decode(secret);
  const counter = Buffer.alloc(8);
  counter.writeUInt32BE(Math.floor(Date.now() / 1000 / 30) + counterOffset, 4);
  const hmac = crypto.createHmac("sha1", key).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const bin =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(bin % 1_000_000).padStart(6, "0");
}

async function verifyWithWindow(client, factorId, secret) {
  let lastError = null;
  for (const offset of [0, -1, 1]) {
    const { error } = await challengeAndVerifyTotp(client, factorId, generateTotp(secret, offset));
    if (!error) return;
    lastError = error;
  }
  throw lastError;
}

function psql(sql) {
  const oneLine = sql.replace(/\s+/g, " ").trim();
  return execSync(
    `docker exec -i supabase_db_u-filldumpsters psql -U postgres -d postgres -t -A -c ${JSON.stringify(oneLine)}`,
    { encoding: "utf8" },
  ).trim();
}

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
}

function pass(message) {
  console.log(`PASS: ${message}`);
}

let statusEnv;
try {
  statusEnv = parseStatusEnv(
    execSync("npx --yes supabase@2.98.2 status -o env", { encoding: "utf8" }),
  );
} catch (err) {
  fail("Local Supabase is not running. Start Docker, then run `npx supabase start`.");
  console.error(err.message || String(err));
  process.exit(1);
}

const url = statusEnv.API_URL;
const anonKey = statusEnv.ANON_KEY || statusEnv.PUBLISHABLE_KEY;
const serviceKey = statusEnv.SERVICE_ROLE_KEY || statusEnv.SECRET_KEY;

if (!url || !anonKey || !serviceKey) {
  fail("Missing local Supabase keys from `supabase status -o env`.");
  process.exit(1);
}

const bookingId = process.env.BOOKING_ID
  ?? psql(`SELECT id FROM bookings WHERE status IN ('Confirmed','confirmed','Delivered','delivered','waiting_to_be_returned','Rescheduled','rescheduled','pending_verification','pending_review') AND drop_off_date IS NOT NULL AND pickup_date IS NOT NULL ORDER BY id DESC LIMIT 1;`);

if (!/^\d+$/.test(String(bookingId))) {
  fail(`No eligible booking found locally. Seed a booking or set BOOKING_ID. Got: ${bookingId || "(empty)"}`);
  process.exit(1);
}

console.log(`\nUsing booking #${bookingId}`);

const bookingRow = psql(`
  SELECT status || '|' || drop_off_date || '|' || COALESCE(drop_off_time_slot,'') || '|' || pickup_date || '|' || COALESCE(pickup_time_slot,'')
  FROM bookings WHERE id = ${bookingId} LIMIT 1;
`);
console.log(`  booking: ${bookingRow.replace(/\|/g, " | ")}`);

const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });

const email = `generate-pin-test-${Date.now()}@example.com`;
const password = "Generate-Pin-Test-0!";

const { data: created, error: createError } = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
  app_metadata: { is_admin: true },
});
if (createError) {
  fail(`createUser: ${createError.message}`);
  process.exit(1);
}
const userId = created.user.id;

try {
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;

  const { data: enrollData, error: enrollError } = await client.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: "Authenticator",
  });
  if (enrollError) throw enrollError;

  await verifyWithWindow(client, enrollData.id, enrollData.totp.secret);
  pass("admin MFA enrolled and verified (AAL2)");

  const { data: sessionData, error: sessionError } = await client.auth.getSession();
  if (sessionError) throw sessionError;
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) throw new Error("Missing access token after MFA verify");

  const start = Date.now();
  const res = await fetch(`${BASE}/generate-pin`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      apikey: anonKey,
    },
    body: JSON.stringify({ bookingId: Number(bookingId), callerType: "admin" }),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 500) };
  }
  const duration = Date.now() - start;

  console.log(`\ngenerate-pin response (${duration}ms, HTTP ${res.status}):`);
  console.log(JSON.stringify(json, null, 2));

  if (res.status !== 200) {
    fail(`HTTP ${res.status}: ${json?.error || text.slice(0, 200)}`);
  } else if (json?.success !== true) {
    fail(json?.error || "success=false");
  } else {
    pass(`PIN generated via ${json.pinType}${json.lockConfirmed ? " (lock confirmed)" : " (pending confirmation)"}`);
    if (json.pin) console.log(`  pin: ${json.pin}`);
  }

  const activePin = psql(`
    SELECT access_pin || '|' || COALESCE(pin_type,'') || '|' || COALESCE(lock_confirmed_at::text,'null')
    FROM rental_access_codes
    WHERE order_id = ${bookingId} AND status = 'active'
    ORDER BY created_at DESC LIMIT 1;
  `);
  if (activePin) {
    const [pin, pinType, lockConfirmed] = activePin.split("|");
    pass(`active rental_access_codes row: pin=${pin} type=${pinType} lock_confirmed_at=${lockConfirmed}`);
  } else {
    fail("no active rental_access_codes row after generate-pin");
  }
} catch (err) {
  fail(err.message || String(err));
} finally {
  await admin.auth.admin.deleteUser(userId);
}

if (process.exitCode) {
  console.error("\ngenerate-pin local test failed.\n");
  process.exit(process.exitCode);
}
console.log("\ngenerate-pin local test passed.\n");
