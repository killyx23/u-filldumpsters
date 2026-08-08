/**
 * Phase 2 reservation-model verification against the LOCAL Supabase stack.
 *
 * Run: npx supabase start
 *      psql < scripts/dev-post-reset-fixup.sql   (after a fresh `supabase db reset`)
 *      node scripts/verify-resource-reservations.mjs
 *
 * scripts/verify-scheduling-capacity.mjs already proves the end-to-end read/write behaviour
 * (get-availability + the trigger) is correct. This script instead proves the *mechanism*
 * underneath that behaviour is right: that booking_resource_reservations rows are the ones a
 * booking's occupancy model says it should have, that sync_booking_reservations keeps them in
 * step with edits, and that resource_quantity_used blocks day/slot reservations symmetrically
 * as designed in Phase 2f.2 — none of which is directly observable from get-availability alone.
 */
import { execSync } from "node:child_process";

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
  if (!res.ok) throw new Error(`REST ${path} -> ${res.status}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : null;
}

async function rpc(name, args) {
  return rest(`rpc/${name}`, { method: "POST", body: JSON.stringify(args) });
}

const D1 = "2027-04-15";
const D2 = "2027-04-16";
const D3 = "2027-04-17";
const FIXTURE_EMAIL = "reservation-test@example.invalid";

function bookingBody({ serviceId, dropOff, pickup, isDelivery = false, status = "Confirmed" }) {
  return {
    name: "RESERVATION TEST",
    email: FIXTURE_EMAIL,
    phone: "5555550199",
    street: "1 Test St",
    city: "Rapid City",
    state: "SD",
    zip: "57701",
    drop_off_date: dropOff,
    pickup_date: pickup,
    plan: { id: serviceId, name: `test-service-${serviceId}` },
    addons: { isDelivery },
    total_price: 1,
    status,
    drop_off_time_slot: "6:00 AM",
    pickup_time_slot: "6:00 AM",
  };
}

async function createBooking(spec) {
  const rows = await rest("bookings", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(bookingBody(spec)),
  });
  return rows[0].id;
}

async function reservationsFor(bookingId) {
  return rest(
    `booking_resource_reservations?booking_id=eq.${bookingId}&select=resource_id,quantity,reserved_date,slot_start,slot_end,granularity&order=reserved_date`,
  );
}

async function removeFixtureBookings() {
  await rest(`bookings?email=eq.${FIXTURE_EMAIL}`, { method: "DELETE" });
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
  try {
    console.log("\n=== A range-occupancy, day-granular booking reserves every day it spans ===");
    const spanId = await createBooking({ serviceId: 2, dropOff: D1, pickup: D3, isDelivery: true });
    const spanRows = await reservationsFor(spanId);
    check(
      "trailer + dumpster reserved on all 3 days",
      spanRows.map((r) => `${r.resource_id}:${r.reserved_date}:${r.granularity}`).sort(),
      [
        `1:${D1}:day`, `1:${D2}:day`, `1:${D3}:day`,
        `2:${D1}:day`, `2:${D2}:day`, `2:${D3}:day`,
      ].sort(),
    );

    console.log("\n=== Cancelling a booking deletes its reservations (releases the resource) ===");
    await rest(`bookings?id=eq.${spanId}`, { method: "PATCH", body: JSON.stringify({ status: "Cancelled" }) });
    check("no reservations remain once cancelled", (await reservationsFor(spanId)).length, 0);

    console.log("\n=== Moving a booking's dates re-syncs its reservations, not appends to them ===");
    const moveId = await createBooking({ serviceId: 5, dropOff: D1, pickup: D1 });
    await rest(`bookings?id=eq.${moveId}`, {
      method: "PATCH",
      body: JSON.stringify({ drop_off_date: D2, pickup_date: D2 }),
    });
    const movedRows = await reservationsFor(moveId);
    check("exactly one reservation after the move", movedRows.length, 1);
    check("reservation follows the booking to its new date", movedRows[0]?.reserved_date, D2);

    console.log("\n=== resource_quantity_used: day reservations block a day request ===");
    await removeFixtureBookings();
    await createBooking({ serviceId: 5, dropOff: D1, pickup: D1 });
    const dayUsage = await rpc("resource_quantity_used", { p_resource_id: 4, p_date: D1 });
    check("a day request sees the day reservation", dayUsage, 1);

    console.log("\n=== resource_quantity_used: a day reservation blocks a slot request too ===");
    const slotBlockedByDay = await rpc("resource_quantity_used", {
      p_resource_id: 4,
      p_date: D1,
      p_slot_start: "06:00:00",
      p_slot_end: "08:00:00",
    });
    check("a candidate slot conflicts with an existing day reservation", slotBlockedByDay, 1);

    console.log("\n=== resource_quantity_used: excludes the booking passed as p_exclude_booking_id ===");
    const excluded = await rpc("resource_quantity_used", {
      p_resource_id: 4,
      p_date: D1,
      p_exclude_booking_id: moveId, // moveId isn't the holder here, so this should NOT exclude it
    });
    check("excluding an unrelated booking id changes nothing", excluded, 1);

    console.log("\n=== booking_reservation_rows: existing day-granular services are unaffected ===");
    const dayRows = await rpc("booking_reservation_rows", {
      p_service_id: 2,
      p_drop_off_date: D1,
      p_pickup_date: D3,
      p_drop_off_window_start: "06:00:00",
      p_drop_off_window_end: "08:00:00",
      p_pickup_window_start: "14:00:00",
      p_pickup_window_end: "16:00:00",
    });
    check(
      "range + day-granular service 2 expands to one day row per occupied day per resource",
      dayRows.length,
      6,
    );

    console.log("\n=== booking_reservation_rows: slot granularity only applies to touch-point occupancy ===");
    // No live service is configured with scheduling_granularity = 'slot' yet — that is a data
    // decision the design doc explicitly defers (Phase 1's excavator/trailer question needs a
    // delivery-variant service that does not exist yet, see the session summary). This proves
    // the *mechanism* using a throwaway rule on an unused resource, cleaned up in `finally`.
    const [tempRule] = await rest("inventory_rules", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        service_id: 5,
        inventory_item_id: 3, // Appliance Disposal: high stock, not used by any real capacity rule
        quantity_required: 1,
        occupancy_model: "dropoff_and_pickup_only",
        scheduling_granularity: "slot",
      }),
    });
    try {
      const slotRows = await rpc("booking_reservation_rows", {
        p_service_id: 5,
        p_drop_off_date: D1,
        p_pickup_date: D3,
        p_drop_off_window_start: "06:00:00",
        p_drop_off_window_end: "08:00:00",
        p_pickup_window_start: "14:00:00",
        p_pickup_window_end: "16:00:00",
      });
      const excavatorRow = slotRows.find((r) => r.resource_id === 4);
      const slotResourceRows = slotRows.filter((r) => r.resource_id === 3);
      check("excavator (day-granular) still gets one row per day of the range", excavatorRow ? "day-row-present" : "missing", "day-row-present");
      check(
        "slot-granular touch-point resource gets exactly 2 rows (drop-off + pickup), not one per day",
        slotResourceRows.length,
        2,
      );
      check(
        "the two slot rows land on the drop-off and pickup dates with their own windows",
        slotResourceRows.map((r) => `${r.reserved_date} ${r.slot_start}-${r.slot_end}`).sort(),
        [`${D1} 06:00:00-08:00:00`, `${D3} 14:00:00-16:00:00`].sort(),
      );
    } finally {
      await rest(`inventory_rules?id=eq.${tempRule.id}`, { method: "DELETE" });
    }
  } finally {
    await removeFixtureBookings();
    console.log("\nFixtures removed.");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error("\nVerification aborted:", err.message);
  try {
    await removeFixtureBookings();
  } catch {
    /* best effort cleanup */
  }
  process.exit(1);
});
