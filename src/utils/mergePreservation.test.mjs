import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { parseISO } from 'date-fns';
import { describeBookingCapacityError, isBookingCapacityError } from './bookingCapacityError.js';
import { formatCustomerFacingPlanName } from './displayPlanName.js';
import { parseBookingTimeSlot, parseClockTime } from './parseBookingTimeSlot.js';
import { formatTimeWindowBetween, shouldShowTimeWindow } from './timeWindowFormatter.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const readSrc = (rel) => readFileSync(join(root, rel), 'utf8');

/** Same helper as PortalCalendar — scheduling-v2 calendar placement. */
function eventInstant(dateIso, typedTime, textSlot, fallbackHour) {
  if (!dateIso) return null;
  const time =
    parseClockTime(typedTime) ??
    parseBookingTimeSlot(textSlot, 0)?.start ??
    { hour: fallbackHour, minute: 0, second: 0 };
  const pad = (n) => String(n).padStart(2, '0');
  return parseISO(`${dateIso}T${pad(time.hour)}:${pad(time.minute)}:${pad(time.second)}`);
}

function serviceOffersDrivewayProtection(planOrId) {
  const id = planOrId && typeof planOrId === 'object' ? Number(planOrId.id) : Number(planOrId);
  return id === 1;
}

test('scheduling-v2: parseClockTime accepts 12-hour, 24-hour, and HH:mm:ss', () => {
  assert.deepEqual(parseClockTime('6:00 AM'), { hour: 6, minute: 0, second: 0 });
  assert.deepEqual(parseClockTime('06:00:00'), { hour: 6, minute: 0, second: 0 });
  assert.deepEqual(parseClockTime('08:00'), { hour: 8, minute: 0, second: 0 });
  assert.deepEqual(parseClockTime('5:30 PM'), { hour: 17, minute: 30, second: 0 });
});

test('scheduling-v2: pipe windows parse without Invalid Date (portal calendar)', () => {
  const window = parseBookingTimeSlot('06:00:00|08:00:00', 0);
  assert.deepEqual(window.start, { hour: 6, minute: 0, second: 0 });
  assert.deepEqual(window.end, { hour: 8, minute: 0, second: 0 });

  const fromText = eventInstant('2026-08-28', null, '06:00:00|08:00:00', 8);
  assert.equal(fromText instanceof Date && !Number.isNaN(fromText.getTime()), true);
  assert.equal(fromText.getHours(), 6);

  const fromTyped = eventInstant('2026-08-28', '06:00:00', 'garbage', 8);
  assert.equal(fromTyped.getHours(), 6);

  const fromTwelve = eventInstant('2026-08-28', null, '6:00 AM', 8);
  assert.equal(fromTwelve.getHours(), 6);
});

test('scheduling-v2: capacity rejection is tagged, not a generic P0001', () => {
  assert.equal(isBookingCapacityError({ code: 'P0001', message: 'unrelated raise' }), false);
  assert.equal(
    isBookingCapacityError({ details: 'booking_capacity_exceeded', hint: 'dumpster' }),
    true,
  );
  const copy = describeBookingCapacityError({ hint: 'dumpster' });
  assert.equal(copy.title, 'Those Dates Just Filled Up');
  assert.match(copy.description, /dumpster/);
  assert.equal(copy.description.includes('1 of 1 units'), false);
});

test('HE: driveway protection is dumpster delivery (plan id 1) only', () => {
  assert.equal(serviceOffersDrivewayProtection(1), true);
  assert.equal(serviceOffersDrivewayProtection({ id: '1' }), true);
  assert.equal(serviceOffersDrivewayProtection(2), false);
  assert.equal(serviceOffersDrivewayProtection({ id: 4 }), false);
  assert.equal(serviceOffersDrivewayProtection({ id: 2 }), false);

  const protection = readSrc('src/utils/protectionPlans.js');
  assert.match(protection, /DUMPSTER_DELIVERY_SERVICE_ID = 1/);
  assert.match(protection, /id === DUMPSTER_DELIVERY_SERVICE_ID/);

  const section = readSrc('src/components/addons/ProtectionSection.jsx');
  assert.match(section, /Number\(plan\?\.id\) === 1/);
  assert.equal(section.includes('plan?.id === 1 || (plan?.id === 2 && isDelivery)'), false);
});

test('HE: delivery times use "between start and end"', () => {
  assert.equal(formatTimeWindowBetween('06:00:00|08:00:00'), 'between 6:00 AM and 8:00 AM');
  assert.equal(formatTimeWindowBetween('06:00:00', { isWindow: true }), 'between 6:00 AM and 8:00 AM');
  assert.equal(shouldShowTimeWindow({ id: 1, service_type: 'window' }), true);
});

test('HE: customer-facing names hide old dump-loader / DIY labels', () => {
  assert.equal(formatCustomerFacingPlanName('Dump Loader Trailer Rental'), 'Dump Trailer Rental');
  assert.equal(formatCustomerFacingPlanName('16 Yard Dumpster Rental'), 'Dumpster Rental');
  assert.equal(formatCustomerFacingPlanName('DIY Heavy Equipment'), 'Compact Equipment Rental');
});

test('merge: PaymentPage keeps capacity errors and HE referral/hold imports', () => {
  const src = readSrc('src/components/PaymentPage.jsx');
  assert.match(src, /isBookingCapacityError/);
  assert.match(src, /describeBookingCapacityError/);
  assert.match(src, /getStoredReferralCode/);
  assert.match(src, /pendingBookingEquipmentHold/);
  assert.equal(src.includes('<<<<<<<'), false);
});

test('merge: PortalCalendar keeps eventInstant and renamed plan titles', () => {
  const src = readSrc('src/components/customer-portal/PortalCalendar.jsx');
  assert.match(src, /parseBookingTimeSlot/);
  assert.match(src, /formatCustomerFacingPlanName/);
  assert.match(src, /const eventInstant/);
  assert.equal(src.includes('<<<<<<<'), false);
});

test('merge: AdminDashboard keeps Capacity, Did Not Finalize, and feedback tabs', () => {
  const src = readSrc('src/pages/AdminDashboard.jsx');
  assert.match(src, /Boxes/);
  assert.match(src, /MailWarning/);
  assert.match(src, /MessageCircle/);
  assert.match(src, /value="capacity"/);
  assert.match(src, /AbandonedCheckoutsManager/);
  assert.match(src, /HowCanWeDoBetterManager/);
  assert.equal(src.includes('<<<<<<<'), false);
});
