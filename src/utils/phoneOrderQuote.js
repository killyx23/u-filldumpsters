import { differenceInDays, isValid, parseISO, startOfDay } from 'date-fns';
import { calculateBookingTotal } from '@/utils/calculateBookingTotal';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

export function rentalDaysForPlan(planId, dropOff, pickup) {
  const id = Number(planId);
  const start = startOfDay(dropOff instanceof Date ? dropOff : parseISO(String(dropOff)));
  const endRaw = pickup || dropOff;
  const end = startOfDay(endRaw instanceof Date ? endRaw : parseISO(String(endRaw)));
  if (!isValid(start) || !isValid(end)) return 1;
  if (id === 3 || id === 4) {
    const diff = differenceInDays(end, start);
    return diff === 0 ? 1 : Math.max(1, diff);
  }
  return Math.max(1, differenceInDays(end, start) + 1);
}

export function catalogBaseRental(service, days) {
  const basePrice = Number(service?.base_price) || 0;
  const id = Number(service?.id);
  const dayCount = Math.max(1, Number(days) || 1);
  if (id === 1) {
    return dayCount === 7 ? 500 : basePrice + Math.max(0, dayCount - 1) * 50;
  }
  if (id === 2 || id === 4 || id === 5 || id === 8 || id === 3) {
    return basePrice * dayCount;
  }
  return basePrice * dayCount;
}

function couponDollars(addons, gross) {
  if (!addons?.coupon?.isValid) return 0;
  if (addons.coupon.discountType === 'fixed') return Number(addons.coupon.discountValue || 0);
  if (addons.coupon.discountType === 'percentage') {
    return (Number(gross) * Number(addons.coupon.discountValue || 0)) / 100;
  }
  return 0;
}

function withCouponExtra(addons, extra, gross) {
  const amount = round2(extra);
  if (amount <= 0) return addons;
  const existing = addons?.coupon?.isValid ? addons.coupon : null;
  return {
    ...addons,
    originalCoupon: existing || addons.originalCoupon || null,
    coupon: {
      isValid: true,
      discountType: 'fixed',
      discountValue: round2(couponDollars(addons, gross) + amount),
      code: existing?.code ? `${existing.code}+PHONE` : 'PHONE',
      phoneAdjustment: true,
    },
  };
}

function quoteTotal(inputs) {
  return calculateBookingTotal(
    inputs.plan,
    inputs.addons,
    inputs.equipmentPrices,
    inputs.taxRate,
    inputs.deliveryService,
    inputs.insurancePrice,
    inputs.taxOptions,
  );
}

/**
 * Find catalog inputs the existing payment page will reprice to `targetTotal`.
 * Discounts become a fixed coupon. Increases are added to the quoted base rental.
 */
export function solvePersistedPricing(catalogInputs, targetTotal) {
  const target = round2(targetTotal);
  const baseline = quoteTotal(catalogInputs);
  if (!Number.isFinite(target) || target <= 0) {
    return { ok: false, error: 'Approved total must be greater than zero.' };
  }
  if (Math.abs(baseline.total - target) <= 0.02) {
    return {
      ok: true,
      planPrice: Number(catalogInputs.plan.price),
      addons: catalogInputs.addons,
      total: baseline.total,
      quote: baseline,
    };
  }

  if (target < baseline.total) {
    const gross = baseline.lineItems?.reduce((sum, line) => sum + Number(line.amount || 0), 0) || baseline.subtotal;
    let lo = 0;
    let hi = Math.max(baseline.subtotal, baseline.total, gross) + 1;
    for (let i = 0; i < 42; i += 1) {
      const mid = (lo + hi) / 2;
      const addons = withCouponExtra(catalogInputs.addons, mid, gross);
      const next = quoteTotal({ ...catalogInputs, addons });
      if (next.total > target) lo = mid;
      else hi = mid;
    }
    const addons = withCouponExtra(catalogInputs.addons, hi, gross);
    const quote = quoteTotal({ ...catalogInputs, addons });
    if (Math.abs(quote.total - target) > 0.05) {
      return { ok: false, error: 'Could not match the approved total to checkout pricing.' };
    }
    return {
      ok: true,
      planPrice: Number(catalogInputs.plan.price),
      addons,
      total: quote.total,
      quote,
    };
  }

  const base = Number(catalogInputs.plan.price) || 0;
  let lo = 0;
  let hi = Math.max(50, target - baseline.total + 50);
  let quote = baseline;
  for (let i = 0; i < 42; i += 1) {
    const mid = (lo + hi) / 2;
    const plan = { ...catalogInputs.plan, price: round2(base + mid) };
    quote = quoteTotal({ ...catalogInputs, plan });
    if (quote.total < target) lo = mid;
    else hi = mid;
  }
  const plan = { ...catalogInputs.plan, price: round2(base + hi) };
  quote = quoteTotal({ ...catalogInputs, plan });
  if (Math.abs(quote.total - target) > 0.05) {
    return { ok: false, error: 'Could not match the approved total to checkout pricing.' };
  }
  return {
    ok: true,
    planPrice: plan.price,
    addons: catalogInputs.addons,
    total: quote.total,
    quote,
  };
}

export function money(amount) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(amount) || 0);
}

export function phoneOrderLabel(addons) {
  if (addons?.orderChannel !== 'phone') return '';
  const meta = addons.phoneOrder || {};
  const who = meta.agentEmail || 'admin';
  const when = meta.takenAt ? new Date(meta.takenAt).toLocaleString() : '';
  return `Phone order · ${who}${when ? ` · ${when}` : ''}`;
}
