import assert from 'node:assert/strict';
import { test } from 'node:test';
import { advertisedDealsForService } from './advertisedDeals.js';

const now = new Date('2026-10-31T12:00:00Z');

const advertised = {
  code: 'THREE',
  is_active: true,
  service_ids: [4],
  usage_limit: 10,
  usage_count: 1,
  expires_at: '2026-12-01T00:00:00Z',
  rules: [{
    advertise: true,
    headline: 'Rent 3 days and get an extra discount',
    description: 'Book a longer stay.',
    condition: { minDays: 3, maxDays: null },
    benefit: { type: 'percentage_off', value: 25, appliesTo: 'base_rental' },
  }],
};

test('returns the headline, code, and day offer for the selected service', () => {
  const deals = advertisedDealsForService([advertised], 4, now);
  assert.equal(deals.length, 1);
  assert.equal(deals[0].code, 'THREE');
  assert.equal(deals[0].headline, 'Rent 3 days and get an extra discount');
  assert.equal(deals[0].description, 'Book a longer stay.');
  assert.equal(deals[0].offer, '3 or more days, 25% off the base rental');
});

test('skips other services, expired coupons, exhausted coupons, and quiet rules', () => {
  const deals = advertisedDealsForService([
    advertised,
    { ...advertised, code: 'OTHER', service_ids: [1] },
    { ...advertised, code: 'OLD', expires_at: '2026-10-01T00:00:00Z' },
    { ...advertised, code: 'GONE', usage_limit: 1, usage_count: 1 },
    { ...advertised, code: 'QUIET', rules: [{ ...advertised.rules[0], advertise: false }] },
    { ...advertised, code: 'BLANK', rules: [{ ...advertised.rules[0], headline: '  ', description: '' }] },
    { ...advertised, code: 'OFF', is_active: false },
  ], 4, now);
  assert.deepEqual(deals.map((deal) => deal.code), ['THREE']);
});

test('a coupon with no service limit applies, and each advertised rule is listed', () => {
  const deals = advertisedDealsForService([{
    code: 'STAY',
    is_active: true,
    service_ids: null,
    rules: [
      {
        advertise: true,
        headline: 'Two to four days',
        description: '',
        condition: { minDays: 2, maxDays: 4 },
        benefit: { type: 'fixed_off', value: 10, appliesTo: 'order' },
      },
      {
        advertise: true,
        headline: '',
        description: 'A free day on a week-long stay.',
        condition: { minDays: 7, maxDays: 7 },
        benefit: { type: 'free_days', value: 1 },
      },
    ],
  }], 2, now);
  assert.equal(deals.length, 2);
  assert.equal(deals[0].offer, '2 to 4 days, $10.00 off the whole order');
  assert.equal(deals[1].headline, '');
  assert.equal(deals[1].offer, '7 days, 1 free day');
});
