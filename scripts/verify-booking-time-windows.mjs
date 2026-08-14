/**
 * Booking time window verification against the LOCAL Supabase stack.
 *
 * Run: npx supabase start
 *      node scripts/verify-booking-time-windows.mjs
 *
 * Three things are checked:
 *
 *  1. The JavaScript and SQL parsers agree. They are deliberately separate implementations
 *     (one for the browser and edge functions, one for the database backfill and trigger), so
 *     the only thing stopping them drifting apart is a test that compares them directly.
 *  2. Business-local times convert to UTC correctly on both sides of a daylight saving change.
 *     The previous implementation hardcoded a single offset and was an hour out for roughly
 *     half the year.
 *  3. The database trigger fills the typed window columns for whatever a writer stores.
 */
import { execSync } from "node:child_process";
import {
  businessWallTimeToUtc,
  parseBookingTimeSlot,
} from "../src/utils/parseBookingTimeSlot.js";

function readLocalEnv() {
  let out;
  try {
    out = execSync("npx supabase status -o env", {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
    });
  } catch (error) {
    console.error("Could not read local Supabase env. Start the stack with `npx supabase start`.");
    if (error?.stderr) console.error(String(error.stderr));
    process.exit(1);
  }
  const env = {};
  for (const rawLine of out.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    let value = line.slice(eq + 1).trim();
    if (/^(".*"|'.*')$/s.test(value)) value = value.slice(1, -1);
    env[line.slice(0, eq).trim()] = value;
  }
  const apiUrl = env.API_URL ?? env.SUPABASE_URL;
  const secretKey = env.SECRET_KEY ?? env.SERVICE_ROLE_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY;
  if (!apiUrl || !secretKey) {
    console.error("Missing API_URL / SECRET_KEY from `supabase status -o env`.");
    process.exit(1);
  }
  return { apiUrl, secretKey };
}

const { apiUrl, secretKey } = readLocalEnv();
const authHeaders = {
  apikey: secretKey,
  Authorization: `Bearer ${secretKey}`,
  "Content-Type": "application/json",
};

async function rest(path, init = {}) {
  const res = await fetch(`${apiUrl}/rest/v1/${path}`, {
    ...init,
    headers: { ...authHeaders, ...(init.headers ?? {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`REST ${path} -> ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

let passed = 0;
let failed = 0;
function check(label, actual, expected) {
  if (actual === expected) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}\n          expected ${expected}\n          actual   ${actual}`);
  }
}

const pad = (n) => String(n).padStart(2, "0");
const asText = (window) =>
  window
    ? `${pad(window.start.hour)}:${pad(window.start.minute)}:${pad(window.start.second)}-` +
      `${pad(window.end.hour)}:${pad(window.end.minute)}:${pad(window.end.second)}`
    : "null";

/** Every stored format, plus the cases that previously went wrong. */
const CASES = [
  { slot: "6:00 AM", span: 120 },
  { slot: "6:00 AM", span: 0 },
  { slot: "11:00 PM", span: 120 },
  { slot: "12:00 AM", span: 60 },
  { slot: "12:00 PM", span: 60 },
  { slot: "6:00AM", span: 120 },
  { slot: "06:00:00", span: 120 },
  { slot: "14:30", span: 60 },
  { slot: "06:00:00|08:00:00", span: 120 },
  { slot: "08:00|17:00", span: 120 },
  { slot: "23:00:00", span: 120 },
  { slot: "sometime tuesday", span: 120 },
  { slot: "", span: 120 },
  { slot: "25:00", span: 60 },
];

const FIXTURE_EMAIL = "time-window-test@example.invalid";

async function main() {
  console.log("\n=== JavaScript parser and SQL parser must agree ===");
  for (const { slot, span } of CASES) {
    const jsWindow = asText(parseBookingTimeSlot(slot, span));

    const rows = await rest("rpc/parse_booking_time_slot", {
      method: "POST",
      body: JSON.stringify({ p_slot: slot, p_span_minutes: span }),
    });
    const sqlWindow = rows?.length
      ? `${rows[0].window_start}-${rows[0].window_end}`
      : "null";

    check(`"${slot}" @ span ${span}min  ->  ${jsWindow}`, jsWindow, sqlWindow);
  }

  console.log("\n=== Daylight saving: America/Denver is UTC-7 in winter, UTC-6 in summer ===");
  const winter = businessWallTimeToUtc("2027-01-15", { hour: 6, minute: 0, second: 0 });
  check("6am on 2027-01-15 (MST) is 13:00 UTC", winter.toISOString(), "2027-01-15T13:00:00.000Z");

  const summer = businessWallTimeToUtc("2027-07-15", { hour: 6, minute: 0, second: 0 });
  check("6am on 2027-07-15 (MDT) is 12:00 UTC", summer.toISOString(), "2027-07-15T12:00:00.000Z");

  // The day the clocks go forward, to confirm the two-pass offset resolution holds up.
  const springForward = businessWallTimeToUtc("2027-03-14", { hour: 6, minute: 0, second: 0 });
  check(
    "6am on 2027-03-14 (the spring-forward day) is 12:00 UTC",
    springForward.toISOString(),
    "2027-03-14T12:00:00.000Z",
  );

  const lateEvening = businessWallTimeToUtc("2027-01-15", { hour: 23, minute: 0, second: 0 });
  check(
    "11pm local correctly rolls into the next UTC day",
    lateEvening.toISOString(),
    "2027-01-16T06:00:00.000Z",
  );

  console.log("\n=== The trigger fills typed columns for whatever a writer stores ===");
  await rest(`bookings?email=eq.${FIXTURE_EMAIL}`, { method: "DELETE" });
  try {
    // Service 4 is a window service, so a single-valued slot gets its 120 minute span.
    const windowRows = await rest("bookings", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        name: "TIME WINDOW TEST",
        email: FIXTURE_EMAIL,
        phone: "5555550101",
        street: "1 Test St",
        city: "Rapid City",
        state: "SD",
        zip: "57701",
        drop_off_date: "2027-04-10",
        pickup_date: "2027-04-10",
        plan: { id: 2 },
        addons: { isDelivery: true },
        total_price: 1,
        status: "Cancelled",
        drop_off_time_slot: "06:00:00",
        pickup_time_slot: "06:00:00|08:00:00",
      }),
    });
    const w = windowRows[0];
    check("delivery drop-off '06:00:00' became a 2 hour window", w.drop_off_window_end, "08:00:00");
    check("delivery pickup pipe window parsed start", w.pickup_window_start, "06:00:00");
    check("delivery pickup pipe window parsed end", w.pickup_window_end, "08:00:00");

    // Service 2 self-pickup stores a collection time and a return-by deadline, not windows.
    // A later date than the fixture above, because both consume the single Roll-off Trailer and
    // handle_new_booking() forces every insert to the active 'pending_payment' status.
    const hourlyRows = await rest("bookings", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        name: "TIME WINDOW TEST",
        email: FIXTURE_EMAIL,
        phone: "5555550101",
        street: "1 Test St",
        city: "Rapid City",
        state: "SD",
        zip: "57701",
        drop_off_date: "2027-04-20",
        pickup_date: "2027-04-20",
        plan: { id: 2 },
        addons: { isDelivery: false },
        total_price: 1,
        status: "Cancelled",
        drop_off_time_slot: "6:00 AM",
        pickup_time_slot: "11:00 PM",
      }),
    });
    const h = hourlyRows[0];
    check("self-pickup collection time stays an instant", h.drop_off_window_start, "06:00:00");
    check("self-pickup collection has no invented span", h.drop_off_window_end, "06:00:00");
    check("self-pickup return-by stays an instant", h.pickup_window_end, "23:00:00");

    // Changing the text slot must refresh the typed columns rather than leave them stale.
    const patched = await rest(`bookings?id=eq.${h.id}`, {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ drop_off_time_slot: "9:30 AM" }),
    });
    check("editing the text slot refreshes the typed column", patched[0].drop_off_window_start, "09:30:00");
  } finally {
    await rest(`bookings?email=eq.${FIXTURE_EMAIL}`, { method: "DELETE" });
    console.log("\nFixtures removed.");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error("\nVerification aborted:", err.message);
  try {
    await rest(`bookings?email=eq.${FIXTURE_EMAIL}`, { method: "DELETE" });
  } catch {
    /* best effort cleanup */
  }
  process.exit(1);
});
