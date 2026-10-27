import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildCustomerPriceReview, priceReviewForSummary } from './customerPriceReview.js';

test('names the coupon, loyalty, referral, and a future reward', () => {
  const review = buildCustomerPriceReview({
    lines: [
      { key: 'base_rental', amount: 300 },
      { key: 'equipment_1', amount: 20 },
      { key: 'mattressDisposal', amount: 25 },
    ],
    serviceName: 'Dump Trailer',
    days: 3,
    quantities: { 1: 2, 4: 1 },
    quote: {
      couponDiscount: 50,
      loyaltyDiscount: 5,
      referralDiscount: 10,
      couponAppliedRule: { headline: 'Half off one day', description: 'One rental day is half price.' },
      couponRewards: [{ headline: 'Free gloves next time', description: 'A pair of gloves on your next rental.' }],
      subtotal: 280,
      tax: 18.99,
      taxRate: 7.45,
      total: 298.99,
    },
    coupon: { code: 'SUMMER+PHONE', displayCode: 'SUMMER', phoneAdjustment: true },
    loyaltyPoints: 500,
    referralDollars: 10,
    promoLabel: 'Weekly special',
  });

  assert.equal(review.charges[0].label, 'Dump Trailer · 3 days');
  assert.equal(review.charges[1].label, 'Wheelbarrow × 2');
  assert.equal(review.charges[2].label, 'Mattress disposal');
  assert.equal(review.discounts[0].label, 'Coupon SUMMER');
  assert.match(review.discounts[0].detail, /Half off one day/);
  assert.match(review.discounts[0].detail, /extra savings arranged when you booked by phone/);
  assert.equal(review.discounts[1].label, 'Loyalty points (500 pts)');
  assert.equal(review.discounts[2].label, 'Referral balance');
  assert.equal(review.savings, 65);
  assert.equal(review.chargesTotal, 345);
  assert.equal(review.rewards[0].headline, 'Free gloves next time');
  assert.equal(review.rewardCode, 'SUMMER');
  assert.equal(review.promoLabel, 'Weekly special');
  assert.equal(review.total, 298.99);
});

test('rebuilds one savings line from list prices when the link has no named review', () => {
  const review = priceReviewForSummary({
    serviceName: 'Dump Trailer',
    rentalDays: 2,
    total: 108,
    subtotal: 100,
    tax: 8,
    taxRate: 8,
    lineItems: [
      { key: 'base_rental', label: 'Base Rental', amount: 120, amountAfterDiscount: 100 },
    ],
  });

  assert.equal(review.charges[0].label, 'Dump Trailer · 2 days');
  assert.equal(review.charges[0].amount, 120);
  assert.equal(review.savings, 20);
  assert.equal(review.discounts[0].label, 'Discounts and coupons');
  assert.equal(review.subtotal, 100);
  assert.equal(review.total, 108);
});
