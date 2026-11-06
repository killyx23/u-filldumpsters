import { evaluateCoupon } from './couponRules.js';

/**
 * Normalize validate-coupon / stored booking coupon into the booking addons.coupon shape.
 */
export function normalizeCouponPayload(data) {
  if (!data) return null;
  if (data.isValid === false) return null;
  const rules = Array.isArray(data.rules) ? data.rules : [];
  return {
    isValid: true,
    id: data.id ?? null,
    code: data.code || '',
    discountType: data.discountType ?? data.discount_type ?? null,
    discountValue: Number(data.discountValue ?? data.discount_value ?? 0),
    coupon_kind: data.coupon_kind || data.couponKind || (rules.length ? 'rules' : 'flat'),
    rules,
    discountAmount: data.discountAmount != null ? Number(data.discountAmount) : undefined,
  };
}

/**
 * Validate a coupon code the same way OrderSummary does at booking.
 */
export async function validateCouponForService({ couponCode, serviceId, rentalDays }) {
  const code = String(couponCode || '').trim();
  if (!code) {
    return { ok: false, error: 'Please enter a coupon code.', coupon: null };
  }

  const { supabase } = await import('@/lib/customSupabaseClient');
  const { data, error } = await supabase.functions.invoke('validate-coupon', {
    body: {
      couponCode: code,
      serviceId: Number(serviceId),
      rentalDays: Math.max(1, Number(rentalDays) || 1),
    },
  });

  if (error) {
    return { ok: false, error: error.message || 'Failed to validate coupon.', coupon: null };
  }
  if (!data?.isValid) {
    return {
      ok: false,
      error: data?.error || 'This coupon is not valid for the selected service.',
      coupon: null,
    };
  }

  return { ok: true, error: null, coupon: normalizeCouponPayload(data) };
}

/**
 * Re-check a stored booking coupon against the new service + rental length.
 * Same-service / still-eligible → keep. Otherwise drop with a reason.
 */
export async function resolveRescheduleCoupon({
  storedCoupon,
  newServiceId,
  rentalDays,
  previousServiceId = null,
  validateFn = validateCouponForService,
}) {
  const stored = normalizeCouponPayload(storedCoupon);
  if (!stored?.code) {
    return { coupon: null, status: 'none', message: null, previousCode: null };
  }

  const previousCode = stored.code;
  const result = await validateFn({
    couponCode: stored.code,
    serviceId: newServiceId,
    rentalDays,
  });

  if (!result.ok || !result.coupon) {
    const serviceChanged =
      previousServiceId != null && Number(previousServiceId) !== Number(newServiceId);
    return {
      coupon: null,
      status: 'dropped',
      previousCode,
      message: serviceChanged
        ? `Coupon ${previousCode} does not apply to this service.`
        : (result.error || `Coupon ${previousCode} is no longer valid.`),
    };
  }

  const evaluation = evaluateCoupon({
    coupon: result.coupon,
    rentalDays: Math.max(1, Number(rentalDays) || 1),
    baseRental: 0,
    grossBeforeDiscount: 0,
  });

  // Rules coupons that match service but not day length still "apply" as an object;
  // evaluateCoupon may return 0 until priced with real base/gross. Keep the coupon
  // so pricing can re-evaluate with real amounts; surface a soft day hint later.
  const sameService =
    previousServiceId == null || Number(previousServiceId) === Number(newServiceId);

  return {
    coupon: result.coupon,
    status: sameService ? 'kept' : 'revalidated',
    previousCode,
    message: sameService
      ? `Coupon ${result.coupon.code} still applied.`
      : `Coupon ${result.coupon.code} applied to the new service.`,
    dayRuleMissHint: evaluation.discount === 0 && result.coupon.coupon_kind === 'rules'
      ? `Coupon ${result.coupon.code} may not apply to this rental length.`
      : null,
  };
}

/**
 * Build discount rows for UI from tax-breakdown fields (matches booking math).
 */
export function discountsFromTaxBreakdown(breakdown, coupon = null) {
  const loyalty = Number(breakdown?.loyaltyDiscount || 0);
  const referral = Number(breakdown?.referralDiscount || 0);
  const couponAmount = Number(breakdown?.couponDiscount || 0);
  return {
    loyalty: round2(loyalty),
    referral: round2(referral),
    coupon: round2(couponAmount),
    couponCode: coupon?.isValid ? coupon.code || null : null,
    total: round2(loyalty + referral + couponAmount),
  };
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/**
 * Stamp checkout-style discountAmount fields onto addons after pricing.
 */
export function stampCouponDiscountAmounts(coupon, couponDiscount) {
  if (!coupon?.isValid) {
    return { coupon: null, couponDiscountAmount: 0 };
  }
  const amount = round2(couponDiscount);
  return {
    coupon: { ...coupon, discountAmount: amount },
    couponDiscountAmount: amount,
  };
}
