/**
 * Shared coupon rule evaluator — single source of truth for how a coupon's
 * dynamic, day-based rules translate into a discount (and any auto-issued
 * reward coupons) for a given booking.
 *
 * A coupon is either:
 *   - "flat"  → legacy single discount_type/discount_value, or
 *   - "rules" → an array of rules, each shaped like:
 *
 *       {
 *         condition: { minDays: 2, maxDays: null },
 *         benefit:   { type: 'percentage_off'|'fixed_off'|'free_days'|'issue_coupon',
 *                      value: number, appliesTo: 'base_rental'|'order' },
 *         advertise: boolean, headline: string, description: string
 *       }
 *
 * Multiple matching rules:
 *   - Value discounts (percentage_off / fixed_off / free_days) do NOT stack —
 *     the evaluator applies the single rule that saves the customer the most.
 *   - issue_coupon rewards are additive — every matching issue_coupon rule fires,
 *     since rewards don't conflict with one another or with a value discount.
 */

const MS_PER_DAY = 86400000;

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Inclusive rental-day count between a drop-off and pickup date. */
export function resolveRentalDays(dropOff, pickup, fallback = 1) {
  const start = toDate(dropOff);
  const end = toDate(pickup) || start;
  if (!start || !end) return fallback;
  const startDay = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const endDay = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
  return Math.max(1, Math.round((endDay - startDay) / MS_PER_DAY) + 1);
}

function conditionMatches(condition = {}, days) {
  const min = condition.minDays == null ? 0 : Number(condition.minDays);
  const max = condition.maxDays == null ? Infinity : Number(condition.maxDays);
  return days >= min && days <= max;
}

function benefitDiscount(benefit = {}, { baseRental = 0, grossBeforeDiscount = 0, rentalDays = 1 }) {
  const value = Number(benefit.value) || 0;
  switch (benefit.type) {
    case 'fixed_off':
      return value;
    case 'percentage_off': {
      const base = benefit.appliesTo === 'order' ? grossBeforeDiscount : baseRental;
      return (base * value) / 100;
    }
    case 'free_days': {
      const perDay = rentalDays > 0 ? baseRental / rentalDays : 0;
      return perDay * value;
    }
    default:
      return 0; // issue_coupon and unknown types carry no on-order discount
  }
}

function clamp(amount, max) {
  const n = Number(amount) || 0;
  if (n < 0) return 0;
  if (max != null && n > max) return max;
  return n;
}

/** Normalize a coupon object regardless of DB (snake) or client (camel) shape. */
function readCoupon(coupon = {}) {
  const rules = Array.isArray(coupon.rules) ? coupon.rules : [];
  const kind = coupon.coupon_kind || coupon.couponKind || (rules.length ? 'rules' : 'flat');
  const discountType = coupon.discountType || coupon.discount_type || null;
  const discountValue = Number(coupon.discountValue ?? coupon.discount_value ?? 0);
  return { rules, kind, discountType, discountValue };
}

/**
 * Evaluate a coupon against a booking.
 * @returns {{ discount:number, rewards:Array, appliedRule:(object|null), matchedRules:Array }}
 *   - discount: dollars to subtract from the order now
 *   - rewards: issue_coupon benefits that should mint a reward coupon
 *   - appliedRule: the value-discount rule that won (or null for flat/none)
 */
export function evaluateCoupon({ coupon, rentalDays, baseRental = 0, grossBeforeDiscount = 0 }) {
  if (!coupon || coupon.isValid === false) {
    return { discount: 0, rewards: [], appliedRule: null, matchedRules: [] };
  }

  const { rules, kind, discountType, discountValue } = readCoupon(coupon);

  // Legacy flat coupon.
  if (kind !== 'rules' || rules.length === 0) {
    let discount = 0;
    if (discountType === 'fixed') discount = discountValue;
    else if (discountType === 'percentage') discount = (grossBeforeDiscount * discountValue) / 100;
    return { discount: clamp(discount, grossBeforeDiscount), rewards: [], appliedRule: null, matchedRules: [] };
  }

  const days = Number(rentalDays) || 0;
  const matchedRules = rules.filter((r) => conditionMatches(r.condition, days));

  const rewards = [];
  let best = null; // { rule, discount }

  for (const rule of matchedRules) {
    const benefit = rule.benefit || {};
    if (benefit.type === 'issue_coupon') {
      rewards.push({
        rewardValue: Number(benefit.value) || 0,
        headline: rule.headline || '',
        description: rule.description || '',
      });
      continue;
    }
    const d = benefitDiscount(benefit, { baseRental, grossBeforeDiscount, rentalDays: days });
    if (!best || d > best.discount) best = { rule, discount: d };
  }

  return {
    discount: clamp(best ? best.discount : 0, grossBeforeDiscount),
    rewards,
    appliedRule: best ? best.rule : null,
    matchedRules,
  };
}
