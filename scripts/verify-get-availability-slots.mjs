/**
 * Phase 2d/2f get-availability verification against the LOCAL Supabase stack.
 *
 * Run: npx supabase start
 *      npx supabase functions serve
 *      node scripts/verify-get-availability-slots.mjs
 *
 * Covers what scripts/verify-scheduling-capacity.mjs doesn't: that get-availability sources the
 * right calendar columns per service (2f.4 — this is what makes it safe to delete BookingForm's
 * direct-DB pickup-window override) and that per-slot capacity annotation actually flips a slot
 * to unavailable and gates the date once a resource is configured slot-granular (2f.2/2f.3).
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

async function getAvailability(body) {
  const res = await fetch(`${apiUrl}/functions/v1/get-availability`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok || json.error) throw new Error(`get-availability failed: ${json.error ?? res.status}`);
  return json.availability;
}

const D1 = "2027-06-15";
const D2 = "2027-06-16"; // single-slot day (no pickup window) for the date-level gate check
const TEST_SERVICES = [1, 2, 3, 4, 5];
const FIXTURE_EMAIL = "getavail-slots-test@example.invalid";

async function openCalendar() {
  const rows = TEST_SERVICES.map((service_id) => ({
    service_id,
    date: D1,
    is_available: true,
    delivery_start_time: "06:00:00",
    delivery_end_time: "08:00:00",
    pickup_start_time: "09:00:00",
    return_by_time: "17:00:00",
    delivery_pickup_start_time: "14:00:00",
    delivery_pickup_end_time: "16:00:00",
  }));
  // D2: service 1 only, delivery window only (no delivery-pickup window), so its single
  // delivery slot is the *only* candidate slot get-availability can weigh for that date.
  rows.push({
    service_id: 1,
    date: D2,
    is_available: true,
    delivery_start_time: "06:00:00",
    delivery_end_time: "08:00:00",
    pickup_start_time: null,
    return_by_time: null,
    delivery_pickup_start_time: null,
    delivery_pickup_end_time: null,
  });
  await rest("date_specific_availability", { method: "POST", body: JSON.stringify(rows) });
}

async function closeCalendar() {
  await rest(`date_specific_availability?date=eq.${D1}&service_id=in.(${TEST_SERVICES.join(",")})`, { method: "DELETE" });
  await rest(`date_specific_availability?date=eq.${D2}&service_id=eq.1`, { method: "DELETE" });
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
  await closeCalendar();
  await openCalendar();
  try {
    console.log("\n=== 2f.4: window services (1, 4) source pickupSlots from the delivery-pickup window ===");
    const svc1 = await getAvailability({ serviceId: 1, startDate: D1, endDate: D1 });
    check(
      "service 1 pickupSlots come from delivery_pickup_start/end (14:00-16:00), not pickup_start/return_by (09:00-17:00)",
      svc1[D1].pickupSlots.map((s) => s.value),
      ["14:00:00"],
    );

    const svc2Delivery = await getAvailability({ serviceId: 2, startDate: D1, endDate: D1, isDelivery: true });
    check(
      "service 2 + isDelivery resolves to service 4's calendar (delivery_variant_service_id lookup, not a hardcoded id)",
      svc2Delivery[D1].pickupSlots.map((s) => s.value),
      ["14:00:00"],
    );

    console.log("\n=== 2f.4: hourly self-pickup services (2, 5) keep pickup_start/return_by semantics ===");
    const svc2SelfPickup = await getAvailability({ serviceId: 2, startDate: D1, endDate: D1, isDelivery: false });
    check(
      "service 2 self-pickup pickupSlots come from pickup_start/return_by (09:00-17:00), not the delivery pickup window (14:00-16:00)",
      svc2SelfPickup[D1].pickupSlots.map((s) => s.value),
      ["09:00:00", "11:00:00", "13:00:00", "15:00:00"],
    );

    console.log("\n=== 2f.2/2f.3: a slot-granular requirement annotates and gates individual slots ===");
    // Service 1 (window service, real 2hr slot span) with a scratch slot-granular requirement
    // bolted on. Service 5 (hourly self-pickup) collapses its slot to a zero-width instant
    // (start == end), which is correct for real bookings but would make a synthetic
    // slot-granular test fail brr_slot_times_consistent for reasons unrelated to what's under
    // test here, so we exercise this against a window-type service instead.
    //
    // A dedicated total_quantity=1 scratch resource, so one fixture booking can actually
    // exhaust it without touching any real resource's stock (e.g. Appliance Disposal's 999).
    const [scratchItem] = await rest("inventory_items", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ name: "TEST scratch resource (safe to delete)", type: "test", total_quantity: 1 }),
    });
    const [tempRule] = await rest("inventory_rules", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        service_id: 1,
        inventory_item_id: scratchItem.id,
        quantity_required: 1,
        occupancy_model: "dropoff_and_pickup_only",
        scheduling_granularity: "slot",
      }),
    });
    try {
      const before = await getAvailability({ serviceId: 1, startDate: D2, endDate: D2 });
      check("before any reservation, the 6am delivery slot is available", before[D2].deliverySlots.find((s) => s.value === "06:00:00")?.available, true);
      check("D2 has no pickup slots configured (isolates the delivery slot as the only candidate)", before[D2].pickupSlots.length, 0);

      // Same-day drop-off/pickup on D2, whose only candidate slot (06:00 delivery) this
      // booking itself will exhaust against the total_quantity=1 scratch resource.
      const [booking] = await rest("bookings", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          name: "SLOT AVAIL TEST",
          email: FIXTURE_EMAIL,
          phone: "5555550188",
          street: "1 Test St",
          city: "Rapid City",
          state: "SD",
          zip: "57701",
          drop_off_date: D2,
          pickup_date: D2,
          plan: { id: 1 },
          addons: { isDelivery: true },
          total_price: 1,
          status: "Confirmed",
          drop_off_time_slot: "06:00:00", // parses to a 2hr window: 06:00-08:00
          pickup_time_slot: "06:00:00",
        }),
      });

      const after = await getAvailability({ serviceId: 1, startDate: D2, endDate: D2 });
      const sixAmSlot = after[D2].deliverySlots.find((s) => s.value === "06:00:00");
      check("the 6am delivery slot is now full (scratch resource's 1 unit is exhausted)", sixAmSlot?.available, false);
      check("date-level availability is dragged down once the slot-granular resource has no free slot", after[D2].available, false);

      await rest(`bookings?id=eq.${booking.id}`, { method: "DELETE" });
    } finally {
      await rest(`inventory_rules?id=eq.${tempRule.id}`, { method: "DELETE" });
      await rest(`inventory_items?id=eq.${scratchItem.id}`, { method: "DELETE" });
    }
  } finally {
    await rest(`bookings?email=eq.${FIXTURE_EMAIL}`, { method: "DELETE" });
    await closeCalendar();
    console.log("\nFixtures removed.");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error("\nVerification aborted:", err.message);
  try {
    await rest(`bookings?email=eq.${FIXTURE_EMAIL}`, { method: "DELETE" });
    await closeCalendar();
  } catch {
    /* best effort cleanup */
  }
  process.exit(1);
});
