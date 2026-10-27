import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canExtendBooking, quoteRentalExtension } from './rentalExtension.js';

function booking(overrides = {}) {
  return {
    id: 42,
    drop_off_date: '2026-10-27',
    pickup_date: '2026-10-27',
    pickup_time_slot: '5:00 PM',
    status: 'Delivered',
    ...overrides,
  };
}

const beforeReturn = new Date('2026-10-27T22:30:00.000Z');
const thirtyMinutesLate = new Date('2026-10-27T23:30:00.000Z');
const twoHoursLate = new Date('2026-10-28T01:00:00.000Z');
const threeAndAHalfHoursLate = new Date('2026-10-28T02:30:00.000Z');
const noticeAt = '2026-10-28T00:00:00.000Z';
const insideNoticeWindow = new Date('2026-10-28T01:30:00.000Z');
const noticeExpired = new Date('2026-10-28T02:00:00.000Z');

test('a rental can be extended before the scheduled return time', () => {
  assert.equal(canExtendBooking(booking(), beforeReturn), true);
});

test('a rental can be extended after the return time until the late notice is due', () => {
  assert.equal(canExtendBooking(booking(), thirtyMinutesLate), true);
  assert.equal(canExtendBooking(booking(), twoHoursLate), true);
  assert.equal(canExtendBooking(booking(), threeAndAHalfHoursLate), false);
});

test('a late notice keeps the extend action open for two hours', () => {
  const late = booking({ status: 'late_return', late_return_notice_at: noticeAt });
  assert.equal(canExtendBooking(late, insideNoticeWindow), true);
  assert.equal(canExtendBooking(late, noticeExpired), false);
});

test('a closed next day cannot be added onto this rental', () => {
  const result = quoteRentalExtension(booking({
    plan: { id: 2, base_price: 100 },
    tax_rate_used: 7.45,
  }), '2026-10-28', {
    '2026-10-28': { available: false, inventoryAvailable: false },
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'next_day_taken');
});

test('failure to return and a completed return close the extend action', () => {
  const duringWindow = booking({ status: 'late_return', late_return_notice_at: noticeAt });
  assert.equal(canExtendBooking({ ...duringWindow, status: 'failure_to_return' }, insideNoticeWindow), false);
  assert.equal(canExtendBooking({
    ...duringWindow,
    failure_to_return_notice_at: insideNoticeWindow.toISOString(),
  }, insideNoticeWindow), false);
  assert.equal(canExtendBooking({ ...duringWindow, returned_at: insideNoticeWindow.toISOString() }, insideNoticeWindow), false);
});
