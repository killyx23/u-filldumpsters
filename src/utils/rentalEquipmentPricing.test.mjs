import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  additionalDayFinePrint,
  quoteEquipmentExtension,
  quoteRentalEquipmentLine,
  resolveEquipmentCharge,
} from './rentalEquipmentPricing.js';

test('one day charges only the base price', () => {
  const quote = quoteRentalEquipmentLine({
    basePrice: 15,
    additionalDayPrice: 5,
    dropOff: '2026-10-04',
    pickup: '2026-10-04',
    quantity: 1,
  });
  assert.equal(quote.rentalDays, 1);
  assert.equal(quote.extraDays, 0);
  assert.equal(quote.extraDayCharge, 0);
  assert.equal(quote.lineTotal, 15);
});

test('two days adds one extra-day charge', () => {
  const quote = quoteRentalEquipmentLine({
    basePrice: 15,
    additionalDayPrice: 5,
    dropOff: '2026-10-04',
    pickup: '2026-10-05',
  });
  assert.equal(quote.extraDays, 1);
  assert.equal(quote.lineTotal, 20);
});

test('three days adds the extra-day rate twice', () => {
  const quote = quoteRentalEquipmentLine({
    basePrice: 15,
    additionalDayPrice: 5,
    rentalDays: 3,
  });
  assert.equal(quote.extraDays, 2);
  assert.equal(quote.extraDayCharge, 10);
  assert.equal(quote.lineTotal, 25);
  assert.equal(additionalDayFinePrint(quote), 'Additional days: $5.00 × 2 = $10.00');
});

test('quantity multiplies the whole stay', () => {
  const quote = quoteRentalEquipmentLine({
    basePrice: 15,
    additionalDayPrice: 5,
    rentalDays: 3,
    quantity: 2,
  });
  assert.equal(quote.lineTotal, 50);
  assert.equal(quote.extraDayCharge, 20);
});

test('a zero extra-day rate stays at the base price', () => {
  const quote = quoteRentalEquipmentLine({
    basePrice: 15,
    additionalDayPrice: 0,
    rentalDays: 4,
  });
  assert.equal(quote.lineTotal, 15);
  assert.equal(additionalDayFinePrint(quote), '');
});

test('purchases ignore the extra-day rate', () => {
  const quote = quoteRentalEquipmentLine({
    basePrice: 8,
    additionalDayPrice: 5,
    rentalDays: 3,
    isRental: false,
  });
  assert.equal(quote.lineTotal, 8);
  assert.equal(quote.extraDays, 0);
});

test('a saved snapshot is what the receipt charges', () => {
  const quote = resolveEquipmentCharge({
    quantity: 1,
    basePrice: 15,
    additionalDayPrice: 5,
    extraDays: 2,
    extraDayCharge: 10,
    lineTotal: 25,
    price: 15,
  });
  assert.equal(quote.lineTotal, 25);
  assert.equal(quote.snapshotted, true);
});

test('an older booking without a snapshot stays at the flat price', () => {
  const quote = resolveEquipmentCharge(
    { quantity: 1, price: 15 },
    { liveBasePrice: 15 },
  );
  assert.equal(quote.lineTotal, 15);
  assert.equal(quote.extraDays, 0);
  assert.equal(additionalDayFinePrint(quote), '');
});

test('extending a rental bills the stored extra-day rate for the new days only', () => {
  const extension = quoteEquipmentExtension({
    addons: {
      equipment: [{
        dbId: 2,
        type: 'rental',
        name: 'Hand Truck',
        quantity: 1,
        additionalDayPrice: 5,
      }],
    },
  }, 2);
  assert.equal(extension.subtotal, 10);
});
