import assert from 'node:assert/strict';
import { test } from 'node:test';

/**
 * Same rule as public.equipment_quantity_available:
 * on-hand stock, plus outstanding active rentals whose dates do not overlap
 * the requested window. Overlap is inclusive on both ends.
 */
function quantityAvailable({ onHand, holds, start, end, excludeBookingId = null }) {
  const freed = holds.reduce((sum, hold) => {
    if (hold.returned || !hold.active) return sum;
    if (excludeBookingId != null && hold.bookingId === excludeBookingId) return sum;
    const holdEnd = hold.end || hold.start;
    const overlaps = hold.start <= end && holdEnd >= start;
    return overlaps ? sum : sum + hold.quantity;
  }, 0);
  return onHand + freed;
}

test('cancelled rental is back in stock once it is no longer an active hold', () => {
  assert.equal(
    quantityAvailable({
      onHand: 1,
      holds: [],
      start: '2026-09-28',
      end: '2026-09-28',
    }),
    1
  );
});

test('a wheelbarrow rented on the new date stays unavailable that day', () => {
  assert.equal(
    quantityAvailable({
      onHand: 0,
      holds: [{ bookingId: 1413, quantity: 1, start: '2026-09-28', end: '2026-09-28', active: true }],
      start: '2026-09-28',
      end: '2026-09-28',
    }),
    0
  );
});

test('reschedule frees the days the customer is no longer using', () => {
  assert.equal(
    quantityAvailable({
      onHand: 0,
      holds: [{ bookingId: 20, quantity: 1, start: '2026-10-05', end: '2026-10-05', active: true }],
      start: '2026-09-28',
      end: '2026-09-28',
    }),
    1
  );
});

test('a second unit stays available on a day the first unit is already out', () => {
  assert.equal(
    quantityAvailable({
      onHand: 1,
      holds: [{ bookingId: 20, quantity: 1, start: '2026-09-28', end: '2026-09-28', active: true }],
      start: '2026-09-28',
      end: '2026-09-28',
    }),
    1
  );
  assert.equal(
    quantityAvailable({
      onHand: 1,
      holds: [{ bookingId: 20, quantity: 1, start: '2026-09-28', end: '2026-09-28', active: true }],
      start: '2026-10-05',
      end: '2026-10-05',
    }),
    2
  );
});

test('the booking being rescheduled does not count its own unit as extra stock', () => {
  assert.equal(
    quantityAvailable({
      onHand: 0,
      holds: [{ bookingId: 20, quantity: 1, start: '2026-09-28', end: '2026-09-28', active: true }],
      start: '2026-10-05',
      end: '2026-10-05',
      excludeBookingId: 20,
    }),
    0
  );
});
