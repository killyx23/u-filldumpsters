/**
 * Shared loyalty transaction display helpers for portal + admin.
 */

export function isLoyaltyDebit(tx) {
  const type = String(tx?.transaction_type || '');
  if (type === 'cancelled' || type.includes('redeem') || type.includes('remove')) return true;
  if (type === 'reschedule_adjustment' && Number(tx?.points_amount || 0) < 0) return true;
  return false;
}

export function formatLoyaltyTxLabel(tx) {
  const type = String(tx?.transaction_type || '');
  const bookingSuffix = tx?.booking_id ? ` (#${tx.booking_id})` : '';

  switch (type) {
    case 'earned':
      return `Earned${bookingSuffix}`;
    case 'redeemed':
      return `Redeemed${bookingSuffix}`;
    case 'cancelled':
      return `Cancelled${bookingSuffix}`;
    case 'reschedule_adjustment': {
      const delta = Number(tx?.points_amount || 0);
      if (delta < 0) return `Reschedule adjustment (price decrease)${bookingSuffix}`;
      if (delta > 0) return `Reschedule adjustment (price increase)${bookingSuffix}`;
      return `Reschedule adjustment${bookingSuffix}`;
    }
    case 'admin_adjustment_add':
      return `Customer service adjustment (added)${bookingSuffix}`;
    case 'admin_adjustment_remove':
      return `Customer service adjustment (removed)${bookingSuffix}`;
    case 'referral_bonus':
      return `Referral bonus${bookingSuffix}`;
    default:
      return `${type.replace(/_/g, ' ')}${bookingSuffix}`;
  }
}

export function formatLoyaltyTxAmount(tx) {
  const amount = Math.abs(Number(tx?.points_amount || 0));
  const debit = isLoyaltyDebit(tx);
  return {
    debit,
    signedLabel: `${debit ? '-' : '+'}${amount}`,
    amount,
  };
}
