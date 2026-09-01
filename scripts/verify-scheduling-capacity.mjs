/**
 * Scheduling / capacity verification against the LOCAL Supabase stack.
 *
 * Run: npx supabase start
 *      npx supabase functions serve
 *      node scripts/verify-scheduling-capacity.mjs
 *
 * Credentials come from `supabase status -o env` at runtime, so no keys live in the repo.
 *
 * The test window is far in the future and the script inserts its own
 * date_specific_availability rows for it. That keeps results independent of the rolling
 * window of real availability the office maintains, so a failure here means the capacity
 * logic is wrong rather than that the calendar simply ran out of configured days.
 * Everything created is removed again in the finally block.
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

/** Like rest(), but reports the Postgres error instead of throwing, for negative tests. */
async function restAttempt(path, init = {}) {
  const res = await fetch(`${apiUrl}/rest/v1/${path}`, {
    ...init,
    headers: { ...authHeaders, ...(init.headers ?? {}) },
  });
  const text = await res.text();
  if (res.ok) return { ok: true };
  let code = null;
  let message = text;
  let details = null;
  let hint = null;
  try {
    const body = JSON.parse(text);
    code = body.code ?? null;
    message = body.message ?? text;
    details = body.details ?? null;
    hint = body.hint ?? null;
  } catch {
    /* non-JSON error body */
  }
  return { ok: false, code, message, details, hint };
}

async function getAvailability({ serviceId, startDate, endDate, isDelivery = false }) {
  const res = await fetch(`${apiUrl}/functions/v1/get-availability`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ serviceId, startDate, endDate, isDelivery }),
  });
  const body = await res.json();
  if (!res.ok || body.error) {
    throw new Error(`get-availability failed: ${body.error ?? res.status}`);
  }
  return body.availability;
}

/** A far-future window that no real data touches, so capacity starts clean. */
const D1 = "2027-03-15";
const D2 = "2027-03-16";
const D3 = "2027-03-17";
const TEST_DATES = [D1, D2, D3];
const TEST_SERVICES = [1, 2, 3, 4, 5, 8];
const FIXTURE_EMAIL = "capacity-test@example.invalid";

async function openCalendar() {
  const rows = TEST_SERVICES.flatMap((service_id) =>
    TEST_DATES.map((date) => ({
      service_id,
      date,
      is_available: true,
      delivery_start_time: "06:00:00",
      delivery_end_time: "08:00:00",
      pickup_start_time: "06:00:00",
      return_by_time: "23:00:00",
      delivery_pickup_start_time: "06:00:00",
      delivery_pickup_end_time: "08:00:00",
    })),
  );
  await rest("date_specific_availability", {
    method: "POST",
    body: JSON.stringify(rows),
  });
}

async function closeCalendar() {
  await rest(
    `date_specific_availability?date=in.(${TEST_DATES.join(",")})&service_id=in.(${TEST_SERVICES.join(",")})`,
    { method: "DELETE" },
  );
}

/** `isDelivery` with plan id 2 is what the app resolves to service 4. */
function bookingBody({ serviceId, dropOff, pickup, isDelivery = false, status = "Confirmed" }) {
  return {
    name: "CAPACITY TEST",
    email: FIXTURE_EMAIL,
    phone: "5555550100",
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

async function attemptCreateBooking(spec) {
  return restAttempt("bookings", { method: "POST", body: JSON.stringify(bookingBody(spec)) });
}

async function attemptPatchBooking(id, patch) {
  return restAttempt(`bookings?id=eq.${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

/** The RPC the checkout page actually calls, so enforcement is proven on the real path. */
async function attemptCreatePendingBooking({ serviceId, dropOff, pickup, isDelivery = false }) {
  return restAttempt("rpc/create_pending_booking", {
    method: "POST",
    body: JSON.stringify({
      payload: {
        name: "CAPACITY TEST",
        email: FIXTURE_EMAIL,
        phone: "5555550100",
        street: "1 Test St",
        city: "Rapid City",
        state: "SD",
        zip: "57701",
        drop_off_date: dropOff,
        pickup_date: pickup,
        drop_off_time_slot: "6:00 AM",
        pickup_time_slot: "6:00 AM",
        plan: { id: serviceId, name: `test-service-${serviceId}` },
        addons: { isDelivery },
        total_price: 1,
      },
    }),
  });
}

async function removeFixtureBookings() {
  await rest(`bookings?email=eq.${FIXTURE_EMAIL}`, { method: "DELETE" });
}

let passed = 0;
let failed = 0;
function check(label, actual, expected) {
  if (actual === expected) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}  (expected ${expected}, got ${actual})`);
  }
}

async function main() {
  await removeFixtureBookings();
  await closeCalendar();
  await openCalendar();
  try {
    console.log("\n=== Resource requirements per service ===");
    const rules = await rest(
      "inventory_rules?select=service_id,quantity_required,inventory_items(id,name,total_quantity)&order=service_id",
    );
    for (const r of rules) {
      console.log(
        `  service ${r.service_id} needs ${r.quantity_required}x ${r.inventory_items.name} (stock ${r.inventory_items.total_quantity})`,
      );
    }
    check(
      "service 4 (delivery variant) declares resource requirements",
      rules.some((r) => r.service_id === 4),
      true,
    );

    console.log("\n=== Baseline: calendar open, nothing booked ===");
    const baseSelf = await getAvailability({ serviceId: 2, startDate: D1, endDate: D2 });
    check(`service 2 self-pickup available on ${D1}`, baseSelf[D1].available, true);
    const baseDelivery = await getAvailability({
      serviceId: 2,
      startDate: D1,
      endDate: D2,
      isDelivery: true,
    });
    check(`service 2 with delivery available on ${D1}`, baseDelivery[D1].available, true);
    const baseBin = await getAvailability({ serviceId: 1, startDate: D1, endDate: D2 });
    check(`service 1 (bin only) available on ${D1}`, baseBin[D1].available, true);

    console.log("\n=== A dump-trailer delivery booking holds the trailer only on trip days ===");
    await createBooking({ serviceId: 2, dropOff: D1, pickup: D1, isDelivery: true });
    const afterDelivery = await getAvailability({ serviceId: 2, startDate: D1, endDate: D2 });
    check(
      `service 2 self-pickup blocked on ${D1} by the delivery booking`,
      afterDelivery[D1].available,
      false,
    );
    check(`service 2 self-pickup still free on ${D2}`, afterDelivery[D2].available, true);

    console.log("\n=== Dumpster delivery also needs that trailer on the trip day ===");
    const dumpsterAfterLoader = await getAvailability({ serviceId: 1, startDate: D1, endDate: D2 });
    check(`service 1 dumpster blocked on ${D1} (trailer occupied all day)`, dumpsterAfterLoader[D1].available, false);
    check(`service 1 dumpster still free on ${D2}`, dumpsterAfterLoader[D2].available, true);

    console.log("\n=== Unrelated resource pool is independent ===");
    const excavator = await getAvailability({ serviceId: 5, startDate: D1, endDate: D2 });
    check(`service 5 (excavator) still available on ${D1}`, excavator[D1].available, true);

    console.log("\n=== Multi-day self-pickup (service 2) occupies every day; delivery only trip days ===");
    await removeFixtureBookings();
    await createBooking({ serviceId: 2, dropOff: D1, pickup: D2, isDelivery: false });
    const selfPickupSpan = await getAvailability({ serviceId: 2, startDate: D1, endDate: D2 });
    check(`service 2 self-pickup blocked on ${D1} (span start)`, selfPickupSpan[D1].available, false);
    check(`service 2 self-pickup blocked on ${D2} (span end)`, selfPickupSpan[D2].available, false);

    await removeFixtureBookings();
    await createBooking({ serviceId: 4, dropOff: D1, pickup: D3, isDelivery: true });
    const deliverySpan = await getAvailability({ serviceId: 2, startDate: D1, endDate: D3 });
    check(`service 2 self-pickup blocked on delivery drop-off ${D1}`, deliverySpan[D1].available, false);
    check(
      `service 2 self-pickup free on middle day ${D2} (trailer not held on middle days)`,
      deliverySpan[D2].available,
      true,
    );
    check(`service 2 self-pickup blocked on delivery pickup ${D3}`, deliverySpan[D3].available, false);

    console.log("\n=== Cross-service: dumpster holds a bin all week but frees the trailer on middle days ===");
    await removeFixtureBookings();
    await createBooking({ serviceId: 1, dropOff: D1, pickup: D3 });
    const middleDay = await getAvailability({ serviceId: 2, startDate: D1, endDate: D3 });
    check(`self-pickup blocked on dumpster drop-off day ${D1}`, middleDay[D1].available, false);
    check(`self-pickup free on middle day ${D2} (trailer not on a trip)`, middleDay[D2].available, true);
    check(`self-pickup blocked on dumpster pickup day ${D3}`, middleDay[D3].available, false);
    const dumpsterStill = await getAvailability({ serviceId: 1, startDate: D1, endDate: D3 });
    check(`second dumpster still bookable on ${D2} (one bin left, trailer free)`, dumpsterStill[D2].available, true);

    console.log("\n=== Service 4 delivery returning vs service 2 self-pickup on the same calendar day ===");
    await removeFixtureBookings();
    await createBooking({ serviceId: 4, dropOff: D1, pickup: D2, isDelivery: true });
    const overlapAvail = await getAvailability({ serviceId: 2, startDate: D1, endDate: D3 });
    check(`self-pickup blocked on delivery drop-off ${D1}`, overlapAvail[D1].available, false);
    check(
      `self-pickup blocked on delivery return ${D2} (same-day overlap with the returning unit)`,
      overlapAvail[D2].available,
      false,
    );
    check(`self-pickup free the day after return ${D3}`, overlapAvail[D3].available, true);
    const sameDayPickup = await attemptCreateBooking({ serviceId: 2, dropOff: D2, pickup: D2 });
    check("write-time rejects self-pickup on the delivery return day", sameDayPickup.ok, false);
    check("same-day conflict carries the capacity marker", sameDayPickup.details, "booking_capacity_exceeded");
    if (!sameDayPickup.ok) console.log(`        exhausted: ${sameDayPickup.hint} — ${sameDayPickup.message}`);

    console.log("\n=== Service 2 and 4 with no overlapping pickup/return dates ===");
    await removeFixtureBookings();
    await createBooking({ serviceId: 4, dropOff: D1, pickup: D1, isDelivery: true });
    const noOverlapAvail = await getAvailability({ serviceId: 2, startDate: D1, endDate: D2 });
    check(`self-pickup blocked on the delivery day ${D1}`, noOverlapAvail[D1].available, false);
    check(`self-pickup free on ${D2} (no date overlap)`, noOverlapAvail[D2].available, true);
    const nextDay = await attemptCreateBooking({ serviceId: 2, dropOff: D2, pickup: D2 });
    check("write-time accepts self-pickup the day after delivery returns", nextDay.ok, true);

    console.log("\n=== Heavy equipment (service 5 excavator) is its own pool ===");
    await removeFixtureBookings();
    await createBooking({ serviceId: 5, dropOff: D1, pickup: D2 });
    const heAvail = await getAvailability({ serviceId: 5, startDate: D1, endDate: D3 });
    check(`excavator blocked on ${D1}`, heAvail[D1].available, false);
    check(`excavator blocked on ${D2}`, heAvail[D2].available, false);
    check(`excavator free on ${D3}`, heAvail[D3].available, true);
    const loaderAvail = await getAvailability({ serviceId: 8, startDate: D1, endDate: D2 });
    check(`mini telescoping loader still free on ${D1} (separate machine)`, loaderAvail[D1].available, true);
    const dumpAvail = await getAvailability({ serviceId: 2, startDate: D1, endDate: D1 });
    check(`dump-loader self-pickup still free on ${D1} (excavator does not share trailer)`, dumpAvail[D1].available, true);
    const secondEx = await attemptCreateBooking({ serviceId: 5, dropOff: D1, pickup: D1 });
    check("second excavator booking on occupied days is rejected", secondEx.ok, false);
    const loaderBook = await attemptCreateBooking({ serviceId: 8, dropOff: D1, pickup: D1 });
    check("mini telescoping loader can still be booked on the excavator days", loaderBook.ok, true);

    // ── Write-time enforcement ────────────────────────────────────────────────────────────
    // Read-time availability is advisory: two customers can both be told a day is free and
    // both check out. These cases exercise the database trigger, which is what actually
    // prevents the oversell.
    console.log("\n=== Write-time: a competing booking is refused, not silently accepted ===");
    await removeFixtureBookings();
    const holder = await createBooking({ serviceId: 5, dropOff: D1, pickup: D1 });
    const competing = await attemptCreateBooking({ serviceId: 5, dropOff: D1, pickup: D1 });
    check("second excavator booking on the same day is rejected", competing.ok, false);
    // P0001 is the default for ~49 unrelated RAISE statements in this schema, so the UI keys
    // off details rather than the code.
    check("rejection carries the booking_capacity_exceeded marker", competing.details, "booking_capacity_exceeded");
    check("rejection names the exhausted resource", competing.hint, "Mini Excavator");
    if (!competing.ok) console.log(`        message: ${competing.message}`);

    console.log("\n=== Write-time: a status step on an unchanged booking still works ===");
    const statusStep = await attemptPatchBooking(holder, { status: "Delivered" });
    check("Confirmed -> Delivered on the holding booking succeeds", statusStep.ok, true);

    console.log("\n=== Write-time: cancelling releases the resource ===");
    const cancel = await attemptPatchBooking(holder, { status: "Cancelled" });
    check("cancelling the holding booking succeeds", cancel.ok, true);
    const afterCancel = await attemptCreateBooking({ serviceId: 5, dropOff: D1, pickup: D1 });
    check("the freed day can now be booked", afterCancel.ok, true);

    console.log("\n=== Write-time: un-cancelling into a full day is refused ===");
    const unCancel = await attemptPatchBooking(holder, { status: "Confirmed" });
    check("reactivating a cancelled booking into a full day is rejected", unCancel.ok, false);
    check("reactivation carries the capacity marker", unCancel.details, "booking_capacity_exceeded");

    console.log("\n=== Write-time: moving a booking onto a full day is refused ===");
    await removeFixtureBookings();
    await createBooking({ serviceId: 5, dropOff: D1, pickup: D1 });
    const mover = await createBooking({ serviceId: 5, dropOff: D2, pickup: D2 });
    const move = await attemptPatchBooking(mover, { drop_off_date: D1, pickup_date: D1 });
    check("rescheduling onto an occupied day is rejected", move.ok, false);
    check("reschedule carries the capacity marker", move.details, "booking_capacity_exceeded");

    console.log("\n=== Write-time: the real checkout RPC is covered too ===");
    await removeFixtureBookings();
    const freeRpc = await attemptCreatePendingBooking({ serviceId: 5, dropOff: D1, pickup: D1 });
    check("create_pending_booking succeeds when the day is open", freeRpc.ok, true);
    const takenRpc = await attemptCreatePendingBooking({ serviceId: 5, dropOff: D1, pickup: D1 });
    check("create_pending_booking is rejected once the day is full", takenRpc.ok, false);
    check(
      "the RPC surfaces the capacity marker rather than swallowing it",
      takenRpc.details,
      "booking_capacity_exceeded",
    );
    check("the RPC names the exhausted resource", takenRpc.hint, "Mini Excavator");
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
