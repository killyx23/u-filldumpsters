function round2(value: unknown) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

const EQUIPMENT_NAMES: Record<number, string> = {
  1: 'Wheelbarrow',
  2: 'Hand Truck',
  3: 'Working Gloves (Pair)',
};

const DISPOSAL_NAMES: Record<string, [string, number]> = {
  mattressDisposal: ['Mattress disposal', 4],
  tvDisposal: ['TV disposal', 5],
  applianceDisposal: ['Appliance disposal', 6],
};

function rentalDayCount(booking: Record<string, unknown> | null) {
  const plan = (booking?.plan as Record<string, unknown>) || {};
  const id = Number(plan.id);
  const start = String(booking?.drop_off_date || '');
  const end = String(booking?.pickup_date || start);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return null;
  const [ys, ms, ds] = start.split('-').map(Number);
  const [ye, me, de] = end.split('-').map(Number);
  const diff = Math.round((Date.UTC(ye, me - 1, de) - Date.UTC(ys, ms - 1, ds)) / 86400000);
  if (id === 3) return diff === 0 ? 1 : Math.max(1, diff);
  return Math.max(1, diff + 1);
}

function chargeLabel(line: Record<string, unknown>, serviceName: string, days: number | null, quantities: Record<string, number>) {
  const key = String(line.key || '');
  if (key === 'base_rental') {
    const name = serviceName || String(line.label || 'Rental');
    return days ? `${name} · ${days} day${days === 1 ? '' : 's'}` : name;
  }
  if (key === 'insurance') return 'Hardware Protection Plan';
  if (key === 'delivery_fee') return 'Delivery';
  if (key === 'mileage') return 'Mileage';
  if (key === 'driveway_protection') return 'Driveway protection';
  const equipmentMatch = key.match(/^equipment_(\d+)$/);
  if (equipmentMatch) {
    const id = Number(equipmentMatch[1]);
    const name = EQUIPMENT_NAMES[id] || String(line.label || 'Equipment');
    const qty = Number(quantities[id] || 0);
    return qty > 1 ? `${name} × ${qty}` : name;
  }
  const disposal = DISPOSAL_NAMES[key];
  if (disposal) {
    const qty = Number(quantities[disposal[1]] || 0);
    return qty > 1 ? `${disposal[0]} × ${qty}` : disposal[0];
  }
  return String(line.label || 'Charge');
}

function ruleMatches(rule: Record<string, unknown>, days: number) {
  const condition = (rule.condition as Record<string, unknown>) || {};
  const min = condition.minDays == null ? 0 : Number(condition.minDays);
  const max = condition.maxDays == null ? Infinity : Number(condition.maxDays);
  return days >= min && days <= max;
}

function couponTitle(coupon: Record<string, unknown> | null, originalCode: string) {
  const raw = String(originalCode || coupon?.code || '').trim().replace(/\+PHONE$/i, '');
  if (!raw || raw.toUpperCase() === 'PHONE') return 'Savings from your call';
  return `Coupon ${raw}`;
}

export function priceReviewFromBooking(booking: Record<string, unknown> | null, serviceName: string) {
  const addons = (booking?.addons as Record<string, unknown>) || {};
  const stored = addons.customerPriceReview as Record<string, unknown> | undefined;
  if (stored && Array.isArray(stored.charges) && stored.charges.length) return stored;

  const plan = (booking?.plan as Record<string, unknown>) || {};
  const lines = Array.isArray(addons.taxLineItemsSnapshot) ? addons.taxLineItemsSnapshot as Record<string, unknown>[] : [];
  const days = rentalDayCount(booking);
  const quantities: Record<string, number> = {
    4: Number(addons.mattressDisposal || 0),
    5: Number(addons.tvDisposal || 0),
    6: Number(addons.applianceDisposal || 0),
  };
  if (Array.isArray(addons.equipment)) {
    for (const item of addons.equipment as Record<string, unknown>[]) {
      const id = Number(item.equipment_id || item.dbId || item.id);
      if (id) quantities[id] = Number(item.quantity || 1);
    }
  }

  const charges = lines
    .map((line) => ({
      key: String(line.key || line.label || 'charge'),
      label: chargeLabel(line, serviceName, days, quantities),
      amount: round2(line.amount ?? line.amountAfterDiscount),
    }))
    .filter((line) => line.amount > 0);

  const list = round2(charges.reduce((sum, line) => sum + line.amount, 0));
  const net = round2(lines.reduce((sum, line) => sum + Number(line.amountAfterDiscount ?? line.amount ?? 0), 0));
  const savings = round2(Math.max(0, list - net));
  const loyalty = round2(addons.loyaltyDiscountAmount);
  const referral = round2(addons.referralDiscountAmount);
  const coupon = (addons.coupon && typeof addons.coupon === 'object') ? addons.coupon as Record<string, unknown> : null;
  const original = (addons.originalCoupon && typeof addons.originalCoupon === 'object')
    ? addons.originalCoupon as Record<string, unknown>
    : null;
  const couponAmount = round2(Math.max(0, savings - loyalty - referral));
  const rules = Array.isArray(coupon?.rules) ? coupon.rules as Record<string, unknown>[] : [];
  const matched = days == null ? [] : rules.filter((rule) => ruleMatches(rule, days));
  const valueRule = matched.find((rule) => (rule.benefit as Record<string, unknown> | undefined)?.type !== 'issue_coupon');
  const detailParts = [valueRule?.headline, valueRule?.description]
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .map((part) => (/[.!?]$/.test(part) ? part : `${part}.`));
  if (coupon?.phoneAdjustment === true) detailParts.push('Includes extra savings arranged when you booked by phone.');

  const discounts = [];
  if (couponAmount > 0) {
    discounts.push({
      key: 'coupon',
      label: couponTitle(coupon, String(original?.code || '')),
      detail: [...new Set(detailParts)].join(' '),
      amount: couponAmount,
    });
  }
  if (loyalty > 0) {
    const points = Number(addons.loyaltyPointsToRedeem || 0);
    discounts.push({
      key: 'loyalty',
      label: points > 0 ? `Loyalty points (${points} pts)` : 'Loyalty points',
      detail: 'Redeemed on this order.',
      amount: loyalty,
    });
  }
  if (referral > 0) {
    const dollars = round2(addons.referralDollarsToRedeem || referral);
    discounts.push({
      key: 'referral',
      label: 'Referral balance',
      detail: dollars > 0 ? `$${dollars.toFixed(2)} from your referral balance.` : 'Applied from your referral balance.',
      amount: referral,
    });
  }
  const explained = round2(discounts.reduce((sum, line) => sum + line.amount, 0));
  const other = round2(savings - explained);
  if (other > 0.009) {
    discounts.push({
      key: 'savings',
      label: 'Additional savings',
      detail: 'Extra amount taken off this order.',
      amount: other,
    });
  }

  const rewards = matched
    .filter((rule) => (rule.benefit as Record<string, unknown> | undefined)?.type === 'issue_coupon')
    .map((rule) => {
      const benefit = (rule.benefit as Record<string, unknown>) || {};
      const value = Number(benefit.value) || 0;
      const headline = String(rule.headline || '').trim() || 'Reward coupon for a future rental';
      const description = String(rule.description || '').trim()
        || (value > 0 ? `Worth $${value.toFixed(2)} on a future rental after this booking is complete.` : 'Added after this booking is complete.');
      return { headline, description };
    });

  const shownCode = couponTitle(coupon, String(original?.code || '')).replace(/^Coupon /, '');
  const taxRate = booking?.tax_rate_used == null ? null : Number(booking.tax_rate_used);

  return {
    days,
    promoLabel: String(plan.promo_label || '').trim(),
    rewardCode: shownCode && shownCode !== 'Savings from your call' ? shownCode : '',
    charges,
    discounts,
    rewards,
    chargesTotal: list,
    savings,
    subtotal: booking?.subtotal_before_tax == null ? round2(Math.max(0, list - savings)) : round2(booking.subtotal_before_tax),
    tax: booking?.tax_amount == null ? null : round2(booking.tax_amount),
    taxRate: Number.isFinite(taxRate) ? taxRate : null,
    total: round2(booking?.total_price),
  };
}
