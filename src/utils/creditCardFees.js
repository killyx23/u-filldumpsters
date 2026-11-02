import { resolveBookingGrandTotal } from '@/utils/resolveBookingGrandTotal';

export const CARD_FEE_RATE = 0.029;
export const CARD_FEE_FIXED = 0.3;

function roundMoney(value) {
  return Math.round(Number(value) * 100) / 100;
}

/** Amount charged for one order. Card fees use the tax-inclusive total. */
export function orderTransactionAmount(booking) {
  return roundMoney(resolveBookingGrandTotal(booking || {}));
}

/** 2.9% of the charged amount plus $0.30. Orders with nothing charged are $0. */
export function creditCardFeeForOrder(booking) {
  const amount = orderTransactionAmount(booking);
  if (!(amount > 0)) return 0;
  return roundMoney(amount * CARD_FEE_RATE + CARD_FEE_FIXED);
}

export function sumCreditCardFees(bookings) {
  const orders = Array.isArray(bookings) ? bookings : [];
  let total = 0;
  let orderCount = 0;
  orders.forEach((booking) => {
    const fee = creditCardFeeForOrder(booking);
    if (!(orderTransactionAmount(booking) > 0)) return;
    orderCount += 1;
    total = roundMoney(total + fee);
  });
  return { total, orderCount };
}

/** Staff override wins. Otherwise the field stays on the calculated total. */
export function effectiveCreditCardFees(calculatedTotal, override) {
  const overrideAmount = Number(override);
  if (override == null || override === '' || !Number.isFinite(overrideAmount)) {
    return roundMoney(calculatedTotal);
  }
  return roundMoney(Math.max(0, overrideAmount));
}
