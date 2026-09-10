import assert from 'node:assert/strict';
import { test } from 'node:test';
import { format } from 'date-fns';
import {
  isDateInventoryAvailable,
  isMinimumPickupBlocked,
  isMinimumPickupDate,
  isPickupDateBlockedByRange,
  minimumPickupDate,
  rangeHasBlockedOccupancyNight,
  rangeHasUnavailableDay,
} from './calendarAvailabilityHints.js';

const d = (year, month, day) => new Date(year, month - 1, day);

/** Heather occupies the trailer on 9/12; 9/11 and 9/13 stay visit-open. */
const diySeptember = {
  '2026-09-11': { available: true, inventoryAvailable: true },
  '2026-09-12': { available: false, inventoryAvailable: false },
  '2026-09-13': { available: true, inventoryAvailable: true },
};

test('same-day 9/11 stay is not blocked when that day has inventory', () => {
  assert.equal(isPickupDateBlockedByRange(d(2026, 9, 11), d(2026, 9, 11), diySeptember), false);
});

test('pickup 9/13 after drop-off 9/11 is blocked because 9/12 has no trailer', () => {
  assert.equal(isPickupDateBlockedByRange(d(2026, 9, 11), d(2026, 9, 13), diySeptember), true);
  assert.equal(rangeHasBlockedOccupancyNight(d(2026, 9, 11), d(2026, 9, 13), diySeptember), true);
});

test('pickup 9/12 is blocked when that night is inventory-full', () => {
  assert.equal(isPickupDateBlockedByRange(d(2026, 9, 11), d(2026, 9, 12), diySeptember), true);
});

test('drop-off 9/13 is not extra-blocked; only pickup ranges from 9/11 are', () => {
  assert.equal(isPickupDateBlockedByRange(d(2026, 9, 13), d(2026, 9, 13), diySeptember), false);
});

test('yard-closed Sunday does not block overnight occupancy when inventory is free', () => {
  const spanningClosedSunday = {
    '2026-09-11': { available: true, inventoryAvailable: true },
    '2026-09-12': { available: false, inventoryAvailable: true },
    '2026-09-13': { available: true, inventoryAvailable: true },
  };
  assert.equal(isPickupDateBlockedByRange(d(2026, 9, 11), d(2026, 9, 13), spanningClosedSunday), false);
  assert.equal(rangeHasUnavailableDay(d(2026, 9, 11), d(2026, 9, 13), spanningClosedSunday), true);
});

test('legacy payloads without inventoryAvailable still block a fully unavailable interior day', () => {
  const legacy = {
    '2026-09-11': { available: true },
    '2026-09-12': { available: false },
    '2026-09-13': { available: true },
  };
  assert.equal(isDateInventoryAvailable(legacy['2026-09-12']), false);
  assert.equal(isPickupDateBlockedByRange(d(2026, 9, 11), d(2026, 9, 13), legacy), true);
});

test('minimum pickup helpers for 24-hour delivery services', () => {
  assert.equal(format(minimumPickupDate(d(2026, 9, 11)), 'yyyy-MM-dd'), '2026-09-12');
  assert.equal(isMinimumPickupDate(d(2026, 9, 11), d(2026, 9, 12)), true);
  assert.equal(isMinimumPickupDate(d(2026, 9, 11), d(2026, 9, 13)), false);
  assert.equal(isMinimumPickupBlocked(d(2026, 9, 11), diySeptember), true);
  assert.equal(isMinimumPickupBlocked(d(2026, 9, 13), diySeptember), false);
});

test('missing days are not treated as inventory-full', () => {
  assert.equal(isDateInventoryAvailable(undefined), true);
  assert.equal(
    rangeHasBlockedOccupancyNight(d(2026, 9, 11), d(2026, 9, 13), {
      '2026-09-11': { available: true, inventoryAvailable: true },
    }),
    false,
  );
});
