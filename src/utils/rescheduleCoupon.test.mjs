import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluateCoupon } from './couponRules.js';
import {
  discountsFromTaxBreakdown,
  normalizeCouponPayload,
  resolveRescheduleCoupon,
  stampCouponDiscountAmounts,
} from './rescheduleCoupon.js';
import { extensionCouponDiscount } from './rentalExtension.js';

const flatCoupon = {
  isValid: true,
  id: 11,
  code: 'SAVE10',
  discountType: 'percentage',
  discountValue: 10,
  coupon_kind: 'flat',
  rules: [],
};

const rulesStayCoupon = {
  isValid: true,
  id: 22,
  code: 'STAY5',
  discountType: null,
  discountValue: 0,
  coupon_kind: 'rules',
  rules: [{
    condition: { minDays: 5, maxDays: null },
    benefit: { type: 'percentage_off', value: 20, appliesTo: 'base_rental' },
    advertise: true,
    headline: '20% off 5+ days',
  }],
};

test('normalizeCouponPayload builds the booking addons.coupon shape', () => {
  const normalized = normalizeCouponPayload({
    isValid: true,
    id: 7,
    code: 'ABC',
    discount_type: 'fixed',
    discount_value: 25,
    coupon_kind: 'flat',
  });
  assert.equal(normalized.code, 'ABC');
  assert.equal(normalized.discountType, 'fixed');
  assert.equal(normalized.discountValue, 25);
  assert.equal(normalized.isValid, true);
});

test('same-service keep reuses the stored coupon when validate still passes', async () => {
  const result = await resolveRescheduleCoupon({
    storedCoupon: flatCoupon,
    newServiceId: 2,
    rentalDays: 3,
    previousServiceId: 2,
    validateFn: async () => ({ ok: true, error: null, coupon: flatCoupon }),
  });
  assert.equal(result.status, 'kept');
  assert.equal(result.coupon.code, 'SAVE10');
  assert.match(result.message, /still applied/i);
});

test('service-change drop clears coupon when validate fails', async () => {
  const result = await resolveRescheduleCoupon({
    storedCoupon: flatCoupon,
    newServiceId: 4,
    rentalDays: 3,
    previousServiceId: 2,
    validateFn: async () => ({
      ok: false,
      error: 'Not valid for this service',
      coupon: null,
    }),
  });
  assert.equal(result.status, 'dropped');
  assert.equal(result.coupon, null);
  assert.match(result.message, /does not apply to this service/i);
});

test('rules coupon longer stay increases discount via evaluateCoupon', () => {
  const short = evaluateCoupon({
    coupon: rulesStayCoupon,
    rentalDays: 3,
    baseRental: 300,
    grossBeforeDiscount: 300,
  });
  const longer = evaluateCoupon({
    coupon: rulesStayCoupon,
    rentalDays: 5,
    baseRental: 500,
    grossBeforeDiscount: 500,
  });
  assert.equal(short.discount, 0);
  assert.equal(longer.discount, 100);
});

test('discountsFromTaxBreakdown matches evaluateCoupon coupon amount', () => {
  const evaluation = evaluateCoupon({
    coupon: flatCoupon,
    rentalDays: 2,
    baseRental: 200,
    grossBeforeDiscount: 250,
  });
  const detail = discountsFromTaxBreakdown(
    {
      couponDiscount: evaluation.discount,
      loyaltyDiscount: 5,
      referralDiscount: 0,
    },
    flatCoupon,
  );
  assert.equal(detail.coupon, evaluation.discount);
  assert.equal(detail.couponCode, 'SAVE10');
  assert.equal(detail.total, evaluation.discount + 5);
});

test('stampCouponDiscountAmounts writes checkout-style fields', () => {
  const stamped = stampCouponDiscountAmounts(flatCoupon, 24.5);
  assert.equal(stamped.couponDiscountAmount, 24.5);
  assert.equal(stamped.coupon.discountAmount, 24.5);
});

test('extension coupon only discounts the incremental subtotal', () => {
  const { discount } = extensionCouponDiscount({
    coupon: flatCoupon,
    serviceSubtotal: 100,
    grossSubtotal: 100,
    totalRentalDays: 4,
  });
  assert.equal(discount, 10);

  const rules = extensionCouponDiscount({
    coupon: rulesStayCoupon,
    serviceSubtotal: 100,
    grossSubtotal: 120,
    totalRentalDays: 5,
  });
  assert.equal(rules.discount, 20);

  const tooShort = extensionCouponDiscount({
    coupon: rulesStayCoupon,
    serviceSubtotal: 100,
    grossSubtotal: 120,
    totalRentalDays: 3,
  });
  assert.equal(tooShort.discount, 0);
});
