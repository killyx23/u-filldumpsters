/**
 * Mint three duration-hourly AlgoPINs on existing bookings at scheduled
 * Denver create times, calling the exact shared OAuth and
 * createAlgoPinWithVariance helpers used by production, then send pin_update
 * (12h issue) emails.
 *
 *   npx --yes tsx tools/mint-scheduled-hourly-algopin.mjs
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { createAlgoPinWithVariance } from "../supabase/functions/_shared/algoPin.ts";
import {
  GENERATE_PIN_SCOPES,
  getOAuthToken,
} from "../supabase/functions/_shared/iglooAuth.ts";

const TZ = "America/Denver";
const BASE = "http://127.0.0.1:55421/functions/v1";

const JOBS = [
  {
    bookingId: 1314,
    createAt: "2026-09-21T10:10:00",
    dropOffDate: "2026-09-21",
    dropOffSlot: "3:00 PM",
    pickupDate: "2026-09-22",
    pickupSlot: "12:05 PM",
    startIso: "2026-09-21T21:00:00+00:00", // 3:00 PM MDT
    endIso: "2026-09-22T18:05:00+00:00", // 12:05 PM MDT → Igloo ceils to 1:00 PM
  },
  {
    bookingId: 1315,
    createAt: "2026-09-21T11:00:00",
    dropOffDate: "2026-09-21",
    dropOffSlot: "7:00 PM",
    pickupDate: "2026-09-22",
    pickupSlot: "12:05 PM",
    startIso: "2026-09-22T01:00:00+00:00", // 7:00 PM MDT
    endIso: "2026-09-22T18:05:00+00:00", // 12:05 PM MDT → Igloo ceils to 1:00 PM
  },
  {
    bookingId: 1316,
    createAt: "2026-09-21T12:00:00",
    dropOffDate: "2026-09-21",
    dropOffSlot: "7:00 PM",
    pickupDate: "2026-09-23",
    pickupSlot: "12:01 AM",
    startIso: "2026-09-22T01:00:00+00:00", // 7:00 PM MDT
    endIso: "2026-09-23T06:01:00+00:00", // Wed 12:01 AM MDT → Igloo ceils to 1:00 AM
  },
];

function parseEnvFile(filePath) {
  const values = {};
  if (!fs.existsSync(filePath)) return values;
  for (const rawLine of fs.readFileSync(filePath, "utf8").split("\n")) {
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

function parseStatusEnv(output) {
  const values = {};
  for (const rawLine of output.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const eq = line.indexOf("=");
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

function denverDate(isoWall) {
  return new Date(`${isoWall}-06:00`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitUntil(createAtWall) {
  if (process.env.ASAP === "1") {
    console.log(`ASAP: skipping wait for ${createAtWall} MDT`);
    return;
  }
  const target = denverDate(createAtWall).getTime();
  while (Date.now() < target) {
    const remain = target - Date.now();
    const mins = Math.ceil(remain / 60000);
    console.log(`waiting until ${createAtWall} MDT (${mins} min)`);
    await sleep(Math.min(remain, 20_000));
  }
}

async function readResponse(res) {
  const text = await res.text();
  try {
    return { text, json: text ? JSON.parse(text) : null };
  } catch {
    return { text, json: null };
  }
}

async function getHourlyToken(clientId, clientSecret) {
  const result = await getOAuthToken(clientId, clientSecret, GENERATE_PIN_SCOPES);
  if (result.token) {
    console.log(`Igloohome OAuth scopes: ${result.scopesUsed}`);
    return result.token;
  }
  throw new Error(result.reason || "Failed to get Igloohome OAuth token");
}

const fnEnv = parseEnvFile("supabase/functions/.env");
const statusEnv = parseStatusEnv(
  execSync("npx --yes supabase@2.98.2 status -o env", { encoding: "utf8" }),
);
const url = statusEnv.API_URL;
const serviceKey = statusEnv.SERVICE_ROLE_KEY || statusEnv.SECRET_KEY;
const anonKey = statusEnv.ANON_KEY || statusEnv.PUBLISHABLE_KEY;
const lockId = fnEnv.IGLOOHOME_LOCK_ID || fnEnv.IGLOOHOME_DEVICE_ID;
const clientId = fnEnv.IGLOOHOME_CLIENT_ID;
const clientSecret = fnEnv.IGLOOHOME_CLIENT_SECRET;

if (!url || !serviceKey || !lockId || !clientId || !clientSecret) {
  console.error("Missing local Supabase or Igloohome credentials");
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function expireActive(bookingId) {
  const { data, error } = await supabase
    .from("rental_access_codes")
    .update({ status: "expired", notified_at: new Date().toISOString() })
    .eq("order_id", bookingId)
    .eq("status", "active")
    .select("id, access_pin, pin_type");
  if (error) throw error;
  console.log(`expired ${data?.length ?? 0} active PIN(s) for #${bookingId}`);
}

async function updateBookingWindow(job) {
  const { data: booking, error: fetchError } = await supabase
    .from("bookings")
    .select("*")
    .eq("id", job.bookingId)
    .single();
  if (fetchError || !booking) throw fetchError || new Error(`booking ${job.bookingId} not found`);

  const patch = {
    drop_off_date: job.dropOffDate,
    drop_off_time_slot: job.dropOffSlot,
    pickup_date: job.pickupDate,
    pickup_time_slot: job.pickupSlot,
    status: "Confirmed",
    pin_generated_at: null,
    pin_notification_sent_at: null,
    pin_reminder_sent_at: null,
  };

  const { error } = await supabase.from("bookings").update(patch).eq("id", job.bookingId);
  if (error) {
    console.warn(`booking update via API failed (${error.message}); trying SQL with triggers off`);
    const sql = `
      ALTER TABLE bookings DISABLE TRIGGER USER;
      UPDATE bookings SET
        drop_off_date = '${job.dropOffDate}',
        drop_off_time_slot = '${job.dropOffSlot}',
        pickup_date = '${job.pickupDate}',
        pickup_time_slot = '${job.pickupSlot}',
        status = 'Confirmed',
        pin_generated_at = NULL,
        pin_notification_sent_at = NULL,
        pin_reminder_sent_at = NULL
      WHERE id = ${job.bookingId};
      ALTER TABLE bookings ENABLE TRIGGER USER;
    `;
    execSync(
      `docker.exe exec -i supabase_db_u-filldumpsters psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c ${JSON.stringify(sql.replace(/\s+/g, " "))}`,
      { stdio: "inherit" },
    );
  } else {
    console.log(`updated booking #${job.bookingId} window ${job.dropOffDate} ${job.dropOffSlot} → ${job.pickupDate} ${job.pickupSlot}`);
  }
  return booking;
}

async function mintHourly(job, booking, token) {
  console.log(`Raw requested window #${job.bookingId}: ${job.startIso} → ${job.endIso}`);
  const result = await createAlgoPinWithVariance({
    supabase,
    accessToken: token,
    lockId,
    startDate: job.startIso,
    endDate: job.endIso,
    accessName: `Dump Trailer Rental - Order #${job.bookingId} (AlgoPIN)`,
    insertRow: {
        order_id: job.bookingId,
        customer_email: booking.email,
        customer_phone: booking.phone || "",
        status: "active",
        lock_confirmed_at: new Date().toISOString(),
        confirm_attempts: 0,
    },
  });

  if (!result.success) {
    const kind = result.exhausted ? "variance exhausted" : "AlgoPIN failed";
    throw new Error(`${kind}: ${result.error}`);
  }

  await supabase
    .from("bookings")
    .update({ pin_generated_at: new Date().toISOString() })
    .eq("id", job.bookingId);

  console.log(
    `Shared helper normalized window #${job.bookingId}: ${result.startDate} → ${result.endDate}`,
  );
  return result;
}

async function sendPinUpdate(job, pin, booking) {
  const res = await fetch(`${BASE}/send-booking-confirmation`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serviceKey}`,
      apikey: anonKey || serviceKey,
    },
    body: JSON.stringify({
      booking_id: job.bookingId,
      email_type: "pin_update",
      pin,
      email: booking.email,
    }),
  });
  const body = await readResponse(res);

  console.log(`pin_update #${job.bookingId} HTTP ${res.status}`, JSON.stringify(body.json || body.text).slice(0, 500));
  return body.json;
}

const onlyIds = (process.env.ONLY_BOOKING_IDS || "")
  .split(",")
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isFinite(n) && n > 0);
const jobs = onlyIds.length ? JOBS.filter((j) => onlyIds.includes(j.bookingId)) : JOBS;

const results = [];
try {
  console.log("preparing booking windows (Denver customer-facing times)");
  const originals = {};
  for (const job of jobs) {
    originals[job.bookingId] = await updateBookingWindow(job);
    await expireActive(job.bookingId);
  }

  const token = await getHourlyToken(clientId, clientSecret);
  console.log("Igloohome OAuth ok");

  for (const job of jobs) {
    console.log(`\n=== booking #${job.bookingId} create ${job.createAt} MDT ===`);
    await waitUntil(job.createAt);
    const { data: booking, error } = await supabase.from("bookings").select("*").eq("id", job.bookingId).single();
    if (error || !booking) throw error || new Error("missing booking");
    const minted = await mintHourly(job, booking, token);
    console.log(`minted PIN ${minted.pin} variance ${minted.variance}`);
    const emailResult = await sendPinUpdate(job, minted.pin, originals[job.bookingId] || booking);
    results.push({
      bookingId: job.bookingId,
      recipientEmail: booking.email,
      pin: minted.pin,
      variance: minted.variance,
      iglooStart: minted.startDate,
      iglooEnd: minted.endDate,
      emailResult,
    });
  }
} catch (err) {
  console.error("FAIL:", err.message || err);
  console.log("partial results", results);
  process.exit(1);
}

console.log("\n===== DONE =====");
console.log(JSON.stringify(results, null, 2));
