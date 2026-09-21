/**
 * Local live test: mint 3 hourly AlgoPINs in the same window (no collision),
 * then send pin_update (12h) and pin_reminder (1h) emails.
 */
import { execSync } from "node:child_process";
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { challengeAndVerifyTotp } from "/home/razmataz23/Dev/u-filldumpsters/src/lib/adminMfa.js";

const BASE = "http://127.0.0.1:55421/functions/v1";
const BOOKING_IDS = [1314, 1315, 1316];
const FOURTH_BOOKING_ID = 1312;

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

const report = { pass: [], fail: [], notes: [] };
function pass(msg) {
  report.pass.push(msg);
  console.log(`PASS: ${msg}`);
}
function fail(msg) {
  report.fail.push(msg);
  console.error(`FAIL: ${msg}`);
}

const statusEnv = parseStatusEnv(execSync("npx --yes supabase@2.98.2 status -o env", { encoding: "utf8" }));
const url = statusEnv.API_URL;
const anonKey = statusEnv.ANON_KEY || statusEnv.PUBLISHABLE_KEY;
const serviceKey = statusEnv.SERVICE_ROLE_KEY || statusEnv.SECRET_KEY;
if (!url || !anonKey || !serviceKey) {
  fail("Missing local Supabase keys");
  process.exit(1);
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });

const email = `hourly-algopin-test-${Date.now()}@example.com`;
const password = "Hourly-AlgoPin-Test-0!";
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

async function invoke(name, body, token) {
  const res = await fetch(`${BASE}/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      apikey: anonKey,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 800) };
  }
  return { status: res.status, json, text };
}

try {
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  const { data: enrollData, error: enrollError } = await client.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: "Authenticator",
  });
  if (enrollError) throw enrollError;
  await verifyWithWindow(client, enrollData.id, enrollData.totp.secret);
  pass("admin MFA enrolled (AAL2)");
  const { data: sessionData, error: sessionError } = await client.auth.getSession();
  if (sessionError) throw sessionError;
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) throw new Error("Missing access token");

  const appRes = await fetch("http://127.0.0.1:3000/");
  if (appRes.ok) pass(`Vite app responding HTTP ${appRes.status}`);
  else fail(`Vite app HTTP ${appRes.status}`);

  const minted = [];
  for (const bookingId of BOOKING_IDS) {
    console.log(`\n--- algopin booking #${bookingId} ---`);
    const { status, json } = await invoke(
      "test-lock-lifecycle",
      { action: "algopin", bookingId, durationMinutes: 60 },
      accessToken,
    );
    console.log(JSON.stringify({ status, success: json?.success, pin: json?.pin, error: json?.error, variance: json?.variance }, null, 2));
    if (status === 200 && json?.success && json?.pin) {
      pass(`booking ${bookingId} hourly AlgoPIN ${json.pin}`);
      minted.push({ bookingId, pin: String(json.pin), error: null });
    } else {
      fail(`booking ${bookingId} HTTP ${status}: ${json?.error || json?.raw || "unknown"}`);
      minted.push({ bookingId, pin: null, error: json?.error || `HTTP ${status}` });
    }
  }

  const rows = psql(`
    SELECT order_id || '|' || access_pin || '|' || COALESCE(variance::text,'') || '|' || start_time || '|' || end_time || '|' || pin_type
    FROM rental_access_codes
    WHERE order_id IN (${BOOKING_IDS.join(",")})
      AND status = 'active'
      AND pin_type = 'algopin'
    ORDER BY variance NULLS LAST, created_at;
  `);
  console.log("\nActive AlgoPIN rows:\n" + (rows || "(none)"));
  const parsed = (rows ? rows.split("\n") : []).filter(Boolean).map((line) => {
    const [orderId, pin, variance, start, end, pinType] = line.split("|");
    return { orderId, pin, variance: Number(variance), start, end, pinType };
  });

  const pins = parsed.map((r) => r.pin);
  const variances = parsed.map((r) => r.variance);
  if (new Set(pins).size === pins.length && pins.length >= 2) {
    pass(`${pins.length} distinct PINs minted: ${pins.join(", ")}`);
  } else {
    fail(`PIN collision or too few rows. pins=${JSON.stringify(pins)}`);
  }
  if (new Set(variances).size === variances.length && variances.every((v) => v >= 1 && v <= 3)) {
    pass(`distinct variances 1-3: ${variances.join(", ")}`);
  } else {
    fail(`variance issue: ${JSON.stringify(variances)}`);
  }
  const windows = new Set(parsed.map((r) => `${r.start}|${r.end}`));
  if (windows.size === 1 && parsed.length >= 2) {
    pass(`same start/end window: ${parsed[0].start} → ${parsed[0].end}`);
  } else {
    report.notes.push(`windows seen: ${[...windows].join(" || ")}`);
    if (parsed.length >= 2) fail(`expected one shared window, got ${windows.size}`);
  }

  console.log(`\n--- 4th algopin booking #${FOURTH_BOOKING_ID} (expect variance exhausted if window matches) ---`);
  const fourth = await invoke(
    "test-lock-lifecycle",
    { action: "algopin", bookingId: FOURTH_BOOKING_ID, durationMinutes: 60 },
    accessToken,
  );
  console.log(JSON.stringify({ status: fourth.status, success: fourth.json?.success, error: fourth.json?.error, pin: fourth.json?.pin }, null, 2));
  const fourthErr = String(fourth.json?.error || "");
  if (!fourth.json?.success && /variance|slot|exhausted|already active/i.test(fourthErr)) {
    pass(`4th same-window mint rejected: ${fourthErr}`);
  } else if (fourth.json?.success && fourth.json?.pin && !pins.includes(String(fourth.json.pin))) {
    report.notes.push(`4th mint succeeded with a different PIN ${fourth.json.pin} — window may have differed after hour ceil`);
  } else if (fourth.json?.success && pins.includes(String(fourth.json.pin))) {
    fail(`4th mint reused an existing PIN ${fourth.json.pin}`);
  } else {
    report.notes.push(`4th mint result: HTTP ${fourth.status} ${fourthErr || "ok"}`);
  }

  const emailBooking = 1316;
  const emailPin = parsed.find((r) => Number(r.orderId) === emailBooking)?.pin || minted.find((m) => m.bookingId === emailBooking)?.pin || "000000";
  const recipient = "erikras1223@gmail.com";

  console.log(`\n--- pin_update (12h issue email) to ${recipient} for booking #${emailBooking} ---`);
  const updateRes = await invoke(
    "send-booking-confirmation",
    { booking_id: emailBooking, email_type: "pin_update", pin: emailPin, email: recipient },
    serviceKey,
  );
  console.log(JSON.stringify({ status: updateRes.status, json: updateRes.json }, null, 2));
  if (updateRes.status === 200 && updateRes.json?.success) {
    pass(`pin_update sent via ${updateRes.json.provider} to ${updateRes.json.recipient}`);
    if (String(updateRes.json.recipient).toLowerCase() !== recipient.toLowerCase()) {
      fail(`pin_update went to ${updateRes.json.recipient} instead of override ${recipient}`);
    }
  } else {
    fail(`pin_update failed: ${updateRes.json?.error || updateRes.text.slice(0, 200)}`);
  }

  console.log(`\n--- pin_reminder (1h pickup reminder) to ${recipient} for booking #${emailBooking} ---`);
  const reminderRes = await invoke(
    "send-booking-confirmation",
    { booking_id: emailBooking, email_type: "pin_reminder", pin: emailPin, email: recipient },
    serviceKey,
  );
  console.log(JSON.stringify({ status: reminderRes.status, json: reminderRes.json }, null, 2));
  if (reminderRes.status === 200 && reminderRes.json?.success) {
    pass(`pin_reminder sent via ${reminderRes.json.provider} to ${reminderRes.json.recipient}`);
  } else {
    fail(`pin_reminder failed: ${reminderRes.json?.error || reminderRes.text.slice(0, 200)}`);
  }

  console.log("\n--- restore booking dates ---");
  for (const bookingId of [...BOOKING_IDS, FOURTH_BOOKING_ID]) {
    const restored = await invoke("test-lock-lifecycle", { action: "restore", bookingId }, accessToken);
    if (restored.json?.success) pass(`restored booking ${bookingId}`);
    else report.notes.push(`restore ${bookingId}: ${restored.json?.error || restored.status}`);
  }

  psql(`
    UPDATE rental_access_codes
    SET status = 'expired', notified_at = now()
    WHERE order_id IN (${[...BOOKING_IDS, FOURTH_BOOKING_ID].join(",")})
      AND pin_type = 'algopin'
      AND status = 'active';
  `);
  pass("expired test AlgoPIN portal rows (lock codes remain until natural end)");
} catch (err) {
  fail(err.message || String(err));
} finally {
  await admin.auth.admin.deleteUser(userId);
}

console.log("\n===== SUMMARY =====");
console.log(`PASS ${report.pass.length}`);
for (const m of report.pass) console.log("  + " + m);
console.log(`FAIL ${report.fail.length}`);
for (const m of report.fail) console.log("  - " + m);
if (report.notes.length) {
  console.log("NOTES");
  for (const m of report.notes) console.log("  * " + m);
}
process.exit(report.fail.length ? 1 : 0);
