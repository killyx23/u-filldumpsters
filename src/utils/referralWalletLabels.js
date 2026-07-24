/**
 * Human-readable labels for referral_wallet_transactions.transaction_type.
 * These are historical event names — not current wallet balances.
 */
export const REFERRAL_WALLET_TX_LABELS = {
  pending_accrual: 'Accrued (held pending)',
  activated: 'Activated (now available)',
  redeemed: 'Redeemed at checkout',
  expired: 'Expired',
  reversed: 'Reversed',
  admin_adjustment_add: 'Admin add',
  admin_adjustment_remove: 'Admin remove',
};

export const formatReferralWalletTxType = (type) =>
  REFERRAL_WALLET_TX_LABELS[type] || String(type || '').replace(/_/g, ' ');

export const isReferralWalletDebit = (type) =>
  String(type || '').includes('redeem') ||
  String(type || '').includes('remove') ||
  type === 'expired' ||
  type === 'reversed';
