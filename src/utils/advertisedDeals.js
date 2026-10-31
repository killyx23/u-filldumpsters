/**
 * Customer-facing deals from coupons whose rules have "advertise this deal" on.
 * Day range and benefit come from the rule. Time of day is not part of a coupon rule.
 */

function serviceApplies(serviceIds, serviceId) {
  if (!Array.isArray(serviceIds) || serviceIds.length === 0) return true;
  const id = Number(serviceId);
  return serviceIds.some((value) => Number(value) === id);
}

function isExpired(expiresAt, now) {
  if (!expiresAt) return false;
  const expires = new Date(expiresAt);
  return !Number.isNaN(expires.getTime()) && expires.getTime() <= now.getTime();
}

function isExhausted(coupon) {
  if (coupon?.usage_limit == null || coupon.usage_limit === '') return false;
  const limit = Number(coupon.usage_limit);
  if (!Number.isFinite(limit)) return false;
  return Number(coupon.usage_count || 0) >= limit;
}

function dayPhrase(condition = {}) {
  const minRaw = condition.minDays;
  const maxRaw = condition.maxDays;
  const min = minRaw == null || minRaw === '' ? null : Number(minRaw);
  const max = maxRaw == null || maxRaw === '' ? null : Number(maxRaw);
  const hasMin = Number.isFinite(min) && min > 0;
  const hasMax = Number.isFinite(max) && max > 0;
  if (hasMin && hasMax) {
    if (min === max) return `${min} day${min === 1 ? '' : 's'}`;
    return `${min} to ${max} days`;
  }
  if (hasMin && min > 1) return `${min} or more days`;
  if (hasMax) return `Up to ${max} days`;
  return 'Any rental length';
}

function benefitPhrase(benefit = {}) {
  const value = Number(benefit.value) || 0;
  const target = benefit.appliesTo === 'order' ? 'the whole order' : 'the base rental';
  switch (benefit.type) {
    case 'percentage_off':
      return `${value}% off ${target}`;
    case 'fixed_off':
      return `$${value.toFixed(2)} off ${target}`;
    case 'free_days': {
      const days = Number.isInteger(value) ? String(value) : value.toFixed(2);
      return `${days} free day${value === 1 ? '' : 's'}`;
    }
    case 'issue_coupon':
      return value > 0 ? `a $${value.toFixed(2)} reward coupon for a future rental` : 'a reward coupon for a future rental';
    default:
      return '';
  }
}

export function describeAdvertisedOffer(rule = {}) {
  const days = dayPhrase(rule.condition);
  const benefit = benefitPhrase(rule.benefit);
  return benefit ? `${days}, ${benefit}` : days;
}

export function advertisedDealsForService(coupons, serviceId, now = new Date()) {
  const deals = [];
  for (const coupon of coupons || []) {
    if (!coupon || coupon.is_active === false) continue;
    if (isExpired(coupon.expires_at, now)) continue;
    if (isExhausted(coupon)) continue;
    if (!serviceApplies(coupon.service_ids, serviceId)) continue;
    const code = String(coupon.code || '').trim();
    if (!code) continue;
    const rules = Array.isArray(coupon.rules) ? coupon.rules : [];
    for (const rule of rules) {
      if (!rule?.advertise) continue;
      const headline = String(rule.headline || '').trim();
      const description = String(rule.description || '').trim();
      if (!headline && !description) continue;
      deals.push({
        code,
        headline,
        description,
        offer: describeAdvertisedOffer(rule),
      });
    }
  }
  return deals;
}
