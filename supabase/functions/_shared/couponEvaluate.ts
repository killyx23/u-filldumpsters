/**
 * Deno port of src/utils/couponRules.js evaluateCoupon — keep in sync with the frontend.
 */

function conditionMatches(condition: Record<string, unknown> = {}, days: number) {
  const min = condition.minDays == null ? 0 : Number(condition.minDays);
  const max = condition.maxDays == null ? Infinity : Number(condition.maxDays);
  return days >= min && days <= max;
}

function benefitDiscount(
  benefit: Record<string, unknown> = {},
  { baseRental = 0, grossBeforeDiscount = 0, rentalDays = 1 }: {
    baseRental?: number;
    grossBeforeDiscount?: number;
    rentalDays?: number;
  },
) {
  const value = Number(benefit.value) || 0;
  switch (benefit.type) {
    case "fixed_off":
      return value;
    case "percentage_off": {
      const base = benefit.appliesTo === "order" ? grossBeforeDiscount : baseRental;
      return (Number(base) * value) / 100;
    }
    case "free_days": {
      const perDay = rentalDays > 0 ? baseRental / rentalDays : 0;
      return perDay * value;
    }
    default:
      return 0;
  }
}

function clamp(amount: number, max: number) {
  const n = Number(amount) || 0;
  if (n < 0) return 0;
  if (n > max) return max;
  return n;
}

function readCoupon(coupon: Record<string, unknown> = {}) {
  const rules = Array.isArray(coupon.rules) ? coupon.rules as Array<Record<string, unknown>> : [];
  const kind = String(coupon.coupon_kind || coupon.couponKind || (rules.length ? "rules" : "flat"));
  const discountType = (coupon.discountType || coupon.discount_type || null) as string | null;
  const discountValue = Number(coupon.discountValue ?? coupon.discount_value ?? 0);
  return { rules, kind, discountType, discountValue };
}

export function evaluateCoupon({
  coupon,
  rentalDays,
  baseRental = 0,
  grossBeforeDiscount = 0,
}: {
  coupon: Record<string, unknown> | null | undefined;
  rentalDays: number;
  baseRental?: number;
  grossBeforeDiscount?: number;
}) {
  if (!coupon || coupon.isValid === false) {
    return { discount: 0, rewards: [] as Array<Record<string, unknown>>, appliedRule: null as Record<string, unknown> | null, matchedRules: [] as Array<Record<string, unknown>> };
  }

  const { rules, kind, discountType, discountValue } = readCoupon(coupon);

  if (kind !== "rules" || rules.length === 0) {
    let discount = 0;
    if (discountType === "fixed") discount = discountValue;
    else if (discountType === "percentage") discount = (grossBeforeDiscount * discountValue) / 100;
    return {
      discount: clamp(discount, grossBeforeDiscount),
      rewards: [] as Array<Record<string, unknown>>,
      appliedRule: null as Record<string, unknown> | null,
      matchedRules: [] as Array<Record<string, unknown>>,
    };
  }

  const days = Number(rentalDays) || 0;
  const matchedRules = rules.filter((r) => conditionMatches((r.condition || {}) as Record<string, unknown>, days));
  const rewards: Array<Record<string, unknown>> = [];
  let best: { rule: Record<string, unknown>; discount: number } | null = null;

  for (const rule of matchedRules) {
    const benefit = (rule.benefit || {}) as Record<string, unknown>;
    if (benefit.type === "issue_coupon") {
      rewards.push({
        rewardValue: Number(benefit.value) || 0,
        headline: rule.headline || "",
        description: rule.description || "",
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

export function resolveRentalDays(dropOff: unknown, pickup: unknown, fallback = 1) {
  const startKey = String(dropOff || "").match(/^(\d{4}-\d{2}-\d{2})/)?.[1];
  const endKey = String(pickup || "").match(/^(\d{4}-\d{2}-\d{2})/)?.[1] || startKey;
  if (!startKey || !endKey) return fallback;
  const start = Date.UTC(
    Number(startKey.slice(0, 4)),
    Number(startKey.slice(5, 7)) - 1,
    Number(startKey.slice(8, 10)),
  );
  const end = Date.UTC(
    Number(endKey.slice(0, 4)),
    Number(endKey.slice(5, 7)) - 1,
    Number(endKey.slice(8, 10)),
  );
  return Math.max(1, Math.round((end - start) / 86400000) + 1);
}
