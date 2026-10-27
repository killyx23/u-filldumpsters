const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const EQUIPMENT_NAMES = {
  1: 'Wheelbarrow',
  2: 'Hand Truck',
  3: 'Working Gloves (Pair)',
};

const DISPOSAL_NAMES = {
  mattressDisposal: ['Mattress disposal', 4],
  tvDisposal: ['TV disposal', 5],
  applianceDisposal: ['Appliance disposal', 6],
};

export function customerChargeLabel(line, { serviceName, days, quantities } = {}) {
  const qtyOf = (id) => Number(quantities?.[id] || 0);
  if (!line) return 'Charge';
  if (line.key === 'base_rental') {
    const name = serviceName || line.label || 'Rental';
    const count = Number(days);
    if (count > 0) return `${name} · ${count} day${count === 1 ? '' : 's'}`;
    return name;
  }
  if (line.key === 'insurance') return 'Hardware Protection Plan';
  if (line.key === 'delivery_fee') return 'Delivery';
  if (line.key === 'mileage') return 'Mileage';
  if (line.key === 'driveway_protection') return 'Driveway protection';
  const equipmentMatch = String(line.key || '').match(/^equipment_(\d+)$/);
  if (equipmentMatch) {
    const id = Number(equipmentMatch[1]);
    const name = EQUIPMENT_NAMES[id] || line.label || 'Equipment';
    const qty = qtyOf(id);
    return qty > 1 ? `${name} × ${qty}` : name;
  }
  const disposal = DISPOSAL_NAMES[line.key];
  if (disposal) {
    const qty = qtyOf(disposal[1]);
    return qty > 1 ? `${disposal[0]} × ${qty}` : disposal[0];
  }
  return line.label || 'Charge';
}

function couponTitle(coupon) {
  const display = String(coupon?.displayCode || '').trim();
  const raw = String(coupon?.code || '').trim();
  const code = display || raw.replace(/\+PHONE$/i, '');
  if (!code || code.toUpperCase() === 'PHONE') return 'Savings from your call';
  return `Coupon ${code}`;
}

function sentence(value) {
  const text = String(value || '').trim();
  if (!text || /[.!?]$/.test(text)) return text;
  return `${text}.`;
}

function couponDetailText(coupon, appliedRule) {
  const parts = [];
  const headline = String(appliedRule?.headline || '').trim();
  const description = String(appliedRule?.description || '').trim();
  if (headline) parts.push(sentence(headline));
  if (description && description !== headline) parts.push(sentence(description));
  if (coupon?.phoneAdjustment) parts.push('Includes extra savings arranged when you booked by phone.');
  return parts.join(' ');
}

function rewardLines(rewards) {
  return (rewards || []).map((reward) => {
    const headline = String(reward.headline || '').trim() || 'Reward coupon for a future rental';
    const description = String(reward.description || '').trim();
    const value = Number(reward.rewardValue) || 0;
    return {
      headline,
      description: description || (value > 0
        ? `Worth $${value.toFixed(2)} on a future rental after this booking is complete.`
        : 'Added after this booking is complete.'),
    };
  }).filter((reward) => reward.headline);
}

/**
 * Customer-facing price review stored with a phone order and shown on the confirmation link.
 */
export function buildCustomerPriceReview({
  lines = [],
  serviceName,
  days = null,
  quantities = {},
  quote = {},
  coupon = null,
  loyaltyPoints = 0,
  referralDollars = 0,
  promoLabel = '',
} = {}) {
  const charges = (lines || [])
    .map((line) => ({
      key: String(line.key || line.label || 'charge'),
      label: customerChargeLabel(line, { serviceName, days, quantities }),
      amount: round2(line.amount),
    }))
    .filter((line) => line.amount > 0);

  const discounts = [];
  const couponDiscount = round2(quote.couponDiscount);
  if (couponDiscount > 0) {
    discounts.push({
      key: 'coupon',
      label: couponTitle(coupon),
      detail: couponDetailText(coupon, quote.couponAppliedRule),
      amount: couponDiscount,
    });
  }
  const loyaltyDiscount = round2(quote.loyaltyDiscount);
  if (loyaltyDiscount > 0) {
    const points = Number(loyaltyPoints) || 0;
    discounts.push({
      key: 'loyalty',
      label: points > 0 ? `Loyalty points (${points} pts)` : 'Loyalty points',
      detail: 'Redeemed on this order.',
      amount: loyaltyDiscount,
    });
  }
  const referralDiscount = round2(quote.referralDiscount);
  if (referralDiscount > 0) {
    const dollars = round2(referralDollars);
    discounts.push({
      key: 'referral',
      label: 'Referral balance',
      detail: dollars > 0 ? `$${dollars.toFixed(2)} from your referral balance.` : 'Applied from your referral balance.',
      amount: referralDiscount,
    });
  }

  const rewards = rewardLines(quote.couponRewards);
  const chargesTotal = round2(charges.reduce((sum, line) => sum + line.amount, 0));
  const savings = round2(discounts.reduce((sum, line) => sum + line.amount, 0));
  const code = coupon ? couponTitle(coupon).replace(/^Coupon /, '') : '';

  return {
    days: days == null ? null : Number(days),
    promoLabel: String(promoLabel || '').trim(),
    rewardCode: code && code !== 'Savings from your call' ? code : '',
    charges,
    discounts,
    rewards,
    chargesTotal,
    savings,
    subtotal: round2(quote.subtotal),
    tax: round2(quote.tax),
    taxRate: quote.taxRate == null || quote.taxRate === '' ? null : Number(quote.taxRate),
    total: round2(quote.total),
  };
}

/** Use the stored review when the confirmation link returned one. Otherwise rebuild it from line prices. */
export function priceReviewForSummary(summary) {
  const stored = summary?.priceReview;
  if (stored && Array.isArray(stored.charges) && stored.charges.length) return stored;

  const lines = Array.isArray(summary?.lineItems) ? summary.lineItems : [];
  const charges = lines
    .map((line) => ({
      key: String(line.key || line.label || 'charge'),
      label: customerChargeLabel(line, {
        serviceName: summary?.serviceName,
        days: summary?.rentalDays,
      }),
      amount: round2(line.amount ?? line.amountAfterDiscount),
    }))
    .filter((line) => line.amount > 0);

  const list = round2(charges.reduce((sum, line) => sum + line.amount, 0));
  const net = round2(lines.reduce((sum, line) => sum + Number(line.amountAfterDiscount ?? line.amount ?? 0), 0));
  const savings = round2(Math.max(0, list - net));
  const discounts = savings > 0
    ? [{
      key: 'savings',
      label: 'Discounts and coupons',
      detail: 'Everything taken off this order before tax.',
      amount: savings,
    }]
    : [];

  return {
    days: summary?.rentalDays ?? null,
    promoLabel: String(summary?.promoLabel || stored?.promoLabel || '').trim(),
    rewardCode: stored?.rewardCode || '',
    charges,
    discounts: stored?.discounts?.length ? stored.discounts : discounts,
    rewards: Array.isArray(stored?.rewards) ? stored.rewards : [],
    chargesTotal: list,
    savings: stored?.discounts?.length
      ? round2(stored.discounts.reduce((sum, line) => sum + Number(line.amount || 0), 0))
      : savings,
    subtotal: summary?.subtotal == null ? round2(Math.max(0, list - savings)) : round2(summary.subtotal),
    tax: summary?.tax == null ? null : round2(summary.tax),
    taxRate: summary?.taxRate == null || summary.taxRate === '' ? null : Number(summary.taxRate),
    total: round2(summary?.total),
  };
}
