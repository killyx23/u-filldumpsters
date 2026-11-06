/**
 * Regression: reschedule used to pass a multi-day total as plan.base_price into
 * resolveBaseRentalAmount, which then multiplied by days again ($200 → $400).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

function catalogBaseRental(service, days) {
  const basePrice = Number(service?.base_price) || 0;
  const id = Number(service?.id);
  const dayCount = Math.max(1, Number(days) || 1);
  if (id === 1) return dayCount === 7 ? 500 : basePrice + Math.max(0, dayCount - 1) * 50;
  if (id === 4) {
    const dailyRate = Number(service?.additional_day_rate) || 0;
    return basePrice + Math.max(0, dayCount - 1) * dailyRate;
  }
  return basePrice * dayCount;
}

function resolveBaseRentalAmount(plan, { rentalDays = null } = {}) {
  const daily = Number(plan?.base_price) || 0;
  const quoted = Number(plan?.price);
  const hasQuote = Number.isFinite(quoted) && quoted > 0 && quoted !== daily;
  if (hasQuote) return quoted;
  const days = rentalDays != null ? Math.max(1, Number(rentalDays) || 1) : null;
  if (days != null && daily > 0) return catalogBaseRental(plan, days);
  return quoted > 0 ? quoted : daily;
}

function countedServiceDays(service, inclusiveDays) {
  const days = Math.max(1, Number(inclusiveDays) || 1);
  const id = Number(service?.id);
  if (id === 1 || id === 3 || id === 4) return days <= 1 ? 1 : days - 1;
  return days;
}

test('pickup trailer subtotal is not double-counted', () => {
  const service = { id: 2, base_price: 100, price: 100 };
  const counted = countedServiceDays(service, 2);
  const multiDay = catalogBaseRental(service, counted);

  const buggy = resolveBaseRentalAmount(
    { ...service, base_price: multiDay, price: multiDay },
    { rentalDays: 2 },
  );
  const fixed = resolveBaseRentalAmount(
    { ...service, base_price: 100, price: 100 },
    { rentalDays: counted },
  );

  assert.equal(multiDay, 200);
  assert.equal(buggy, 400);
  assert.equal(fixed, 200);
});

test('delivery trailer does not bill a phantom extra day', () => {
  const service = { id: 4, base_price: 105, price: 105, additional_day_rate: 65 };
  const counted = countedServiceDays(service, 2);
  assert.equal(counted, 1);

  const buggy = resolveBaseRentalAmount(service, { rentalDays: 2 });
  const fixed = resolveBaseRentalAmount(service, { rentalDays: counted });
  assert.equal(buggy, 170);
  assert.equal(fixed, 105);
  assert.equal(fixed + 125 + 19.95, 249.95);
});
