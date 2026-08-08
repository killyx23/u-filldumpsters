/**
 * True-concurrency capacity verification against the LOCAL Supabase stack.
 *
 * Run: npx supabase start
 *      node scripts/verify-concurrent-booking-capacity.mjs
 *
 * scripts/verify-scheduling-capacity.mjs proves the write-time guard rejects a *second*,
 * sequential insert once a resource is already fully booked — but that never actually
 * exercises the trigger's `FOR UPDATE` lock, since by the time the second request starts,
 * the first has already committed. This script instead fires N requests for the same
 * singleton resource/date at the same instant with Promise.all, so Postgres has to
 * serialize them for real. Exactly one should win; the FOR UPDATE lock on inventory_items
 * in check_booking_inventory_capacity is what's supposed to guarantee that.
 */
import { execSync } from "node:child_process";

function readLocalEnv() {
  let out;
  try {
    out = execSync("npx supabase status -o env", { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
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
const authHeaders = { apikey: secretKey, Authorization: `Bearer ${secretKey}`, "Content-Type": "application/json" };

async function rest(path, init = {}) {
  const res = await fetch(`${apiUrl}/rest/v1/${path}`, { ...init, headers: { ...authHeaders, ...(init.headers ?? {}) } });
  const text = await res.text();
  if (!res.ok) throw new Error(`REST ${path} -> ${res.status}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : null;
}

async function restAttempt(path, init = {}) {
  const res = await fetch(`${apiUrl}/rest/v1/${path}`, { ...init, headers: { ...authHeaders, ...(init.headers ?? {}) } });
  const text = await res.text();
  if (res.ok) return { ok: true, body: text ? JSON.parse(text) : null };
  let code = null;
  let message = text;
  let details = null;
  try {
    const body = JSON.parse(text);
    code = body.code ?? null;
    message = body.message ?? text;
    details = body.details ?? null;
  } catch {
    /* non-JSON error body */
  }
  return { ok: false, code, message, details };
}

const D1 = "2027-08-10";
const SERVICE_ID = 5; // DIY Heavy Equipment — requires only the Mini Excavator (stock 1)
const FIXTURE_EMAIL = "concurrency-test@example.invalid";
const CONCURRENT_ATTEMPTS = 8;

async function openCalendar() {
  await rest("date_specific_availability", {
    method: "POST",
    body: JSON.stringify([
      {
        service_id: SERVICE_ID,
        date: D1,
        is_available: true,
        pickup_start_time: "06:00:00",
        return_by_time: "23:00:00",
      },
    ]),
  });
}

async function closeCalendar() {
  await rest(`date_specific_availability?date=eq.${D1}&service_id=eq.${SERVICE_ID}`, { method: "DELETE" });
}

async function removeFixtureBookings() {
  await rest(`bookings?email=eq.${FIXTURE_EMAIL}`, { method: "DELETE" });
}

function pendingBookingBody(n) {
  return {
    payload: {
      name: `CONCURRENCY TEST ${n}`,
      email: FIXTURE_EMAIL,
      phone: "5555550199",
      street: "1 Test St",
      city: "Rapid City",
      state: "SD",
      zip: "57701",
      drop_off_date: D1,
      pickup_date: D1,
      drop_off_time_slot: "6:00 AM",
      pickup_time_slot: "6:00 AM",
      plan: { id: SERVICE_ID, name: "test-service-5" },
      addons: { isDelivery: false },
      total_price: 1,
    },
  };
}

async function attemptCreatePendingBooking(n) {
  return restAttempt("rpc/create_pending_booking", { method: "POST", body: JSON.stringify(pendingBookingBody(n)) });
}

let passed = 0;
let failed = 0;
function check(label, actual, expected) {
  const same = JSON.stringify(actual) === JSON.stringify(expected);
  if (same) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}\n          expected ${JSON.stringify(expected)}\n          actual   ${JSON.stringify(actual)}`);
  }
}

async function main() {
  await removeFixtureBookings();
  await closeCalendar();
  await openCalendar();
  try {
    console.log(`\n=== Firing ${CONCURRENT_ATTEMPTS} truly concurrent create_pending_booking calls for a stock-1 resource ===`);
    const results = await Promise.all(
      Array.from({ length: CONCURRENT_ATTEMPTS }, (_, i) => attemptCreatePendingBooking(i)),
    );

    const succeeded = results.filter((r) => r.ok);
    const rejected = results.filter((r) => !r.ok);

    check("exactly one of the concurrent attempts succeeds", succeeded.length, 1);
    check("the rest are rejected", rejected.length, CONCURRENT_ATTEMPTS - 1);
    check(
      "every rejection carries the capacity-exceeded marker (not a generic/transient error)",
      rejected.every((r) => r.details === "booking_capacity_exceeded"),
      true,
    );

    const committed = await rest(
      `bookings?email=eq.${FIXTURE_EMAIL}&select=id,status&status=neq.Cancelled`,
    );
    check("exactly one booking actually landed in the table", committed.length, 1);

    if (rejected.some((r) => r.details !== "booking_capacity_exceeded")) {
      console.log("        unexpected rejection reasons:", rejected.filter((r) => r.details !== "booking_capacity_exceeded").map((r) => r.message));
    }
  } finally {
    await removeFixtureBookings();
    await closeCalendar();
    console.log("\nFixtures removed.");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error("\nVerification aborted:", err.message);
  try {
    await removeFixtureBookings();
    await closeCalendar();
  } catch {
    /* best effort cleanup */
  }
  process.exit(1);
});
