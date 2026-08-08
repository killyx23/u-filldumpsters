import React from 'react';
import { Gift, Wallet, History, Users } from 'lucide-react';
import { formatReferralWalletTxType } from '@/utils/referralWalletLabels';
import { formatLoyaltyTxLabel, formatLoyaltyTxAmount, isLoyaltyDebit } from '@/utils/loyaltyTransactionLabels';

const fmtMoney = (value) => `$${Number(value || 0).toFixed(2)}`;
const fmtDate = (value) => {
  if (!value) return 'N/A';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? 'N/A' : d.toLocaleString();
};

const ToneChip = ({ children, tone = 'blue' }) => {
  const tones = {
    blue: 'bg-blue-500/20 text-blue-300',
    green: 'bg-green-500/20 text-green-300',
    yellow: 'bg-yellow-500/20 text-yellow-300',
    red: 'bg-red-500/20 text-red-300',
    purple: 'bg-purple-500/20 text-purple-300',
  };
  return <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${tones[tone] || tones.blue}`}>{children}</span>;
};

export const CustomerRewardsOverview = ({
  loyaltySummary,
  referralWallet,
  loyaltyTransactions = [],
  referralWalletTransactions = [],
  referrals = [],
}) => {
  const pointsBalance = Number(loyaltySummary?.points_balance || 0);
  const pointsEarned = Number(loyaltySummary?.total_points_earned || 0);
  const pointsRedeemed = Number(loyaltySummary?.total_points_redeemed || 0);
  const pendingReferral = Number(referralWallet?.pending_balance || 0);
  const availableReferral = Number(referralWallet?.available_balance || 0);
  const referralEarned = Number(referralWallet?.total_earned || 0);
  const referralRedeemed = Number(referralWallet?.total_redeemed || 0);

  const recentLoyalty = loyaltyTransactions.slice(0, 20);
  const recentWallet = referralWalletTransactions.slice(0, 20);
  const recentReferrals = referrals.slice(0, 20);

  return (
    <div className="space-y-6 mt-6">
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        <div className="bg-white/5 border border-white/10 rounded-lg p-4">
          <p className="text-xs text-blue-200">Active Points</p>
          <p className="text-2xl font-bold text-yellow-400">{pointsBalance}</p>
        </div>
        <div className="bg-white/5 border border-white/10 rounded-lg p-4">
          <p className="text-xs text-blue-200">Used Points</p>
          <p className="text-2xl font-bold text-blue-300">{pointsRedeemed}</p>
        </div>
        <div className="bg-white/5 border border-white/10 rounded-lg p-4">
          <p className="text-xs text-blue-200">Pending Referral Dollars</p>
          <p className="text-2xl font-bold text-orange-300">{fmtMoney(pendingReferral)}</p>
        </div>
        <div className="bg-white/5 border border-white/10 rounded-lg p-4">
          <p className="text-xs text-blue-200">Available Referral Dollars</p>
          <p className="text-2xl font-bold text-emerald-300">{fmtMoney(availableReferral)}</p>
        </div>
      </div>

      <div className="bg-white/5 border border-white/10 rounded-xl p-4">
        <h4 className="text-lg font-bold text-yellow-400 flex items-center gap-2">
          <Gift className="h-5 w-5" />
          Rewards Quick View
        </h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3 text-sm">
          <p className="text-gray-200">Points earned lifetime: <span className="font-semibold text-white">{pointsEarned}</span></p>
          <p className="text-gray-200">Points redeemed lifetime: <span className="font-semibold text-white">{pointsRedeemed}</span></p>
          <p className="text-gray-200">Referral wallet earned: <span className="font-semibold text-white">{fmtMoney(referralEarned)}</span></p>
          <p className="text-gray-200">Referral wallet redeemed: <span className="font-semibold text-white">{fmtMoney(referralRedeemed)}</span></p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="bg-white/5 border border-white/10 rounded-xl p-4">
          <h4 className="text-lg font-bold text-yellow-400 flex items-center gap-2 mb-3">
            <History className="h-5 w-5" />
            Loyalty History
          </h4>
          {recentLoyalty.length === 0 ? (
            <p className="text-sm text-gray-400">No loyalty transactions yet.</p>
          ) : (
            <div className="space-y-2">
              {recentLoyalty.map((tx) => {
                const { signedLabel } = formatLoyaltyTxAmount(tx);
                const debit = isLoyaltyDebit(tx);
                return (
                <div key={tx.id} className="bg-black/20 border border-white/5 rounded p-2 text-xs">
                  <div className="flex justify-between items-center gap-2">
                    <span className="text-blue-200">{formatLoyaltyTxLabel(tx)}</span>
                    <ToneChip tone={debit ? 'red' : 'green'}>
                      {signedLabel} pts
                    </ToneChip>
                  </div>
                  <p className="text-gray-400 mt-1">
                    {fmtDate(tx.created_at)}
                    {tx.notes ? ` • ${tx.notes}` : ''}
                  </p>
                </div>
              );
              })}
            </div>
          )}
        </div>

        <div className="bg-white/5 border border-white/10 rounded-xl p-4">
          <h4 className="text-lg font-bold text-yellow-400 flex items-center gap-2 mb-3">
            <Wallet className="h-5 w-5" />
            Referral Wallet History
          </h4>
          {recentWallet.length === 0 ? (
            <p className="text-sm text-gray-400">No referral wallet activity yet.</p>
          ) : (
            <div className="space-y-2">
              {recentWallet.map((tx) => (
                <div key={tx.id} className="bg-black/20 border border-white/5 rounded p-2 text-xs">
                  <div className="flex justify-between items-center gap-2">
                    <span className="text-blue-200">{formatReferralWalletTxType(tx.transaction_type)}</span>
                    <ToneChip tone={String(tx.transaction_type || '').includes('redeem') || String(tx.transaction_type || '').includes('remove') ? 'red' : 'green'}>
                      {fmtMoney(tx.amount)}
                    </ToneChip>
                  </div>
                  <p className="text-gray-400 mt-1">
                    {tx.booking_id ? `Booking #${tx.booking_id} • ` : ''}
                    {tx.referral_id ? `Referral #${tx.referral_id} • ` : ''}
                    {fmtDate(tx.created_at)}
                  </p>
                  <p className="text-gray-500 mt-0.5">
                    After: pending {fmtMoney(tx.pending_balance_after)} • available {fmtMoney(tx.available_balance_after)}
                  </p>
                  {tx.notes && <p className="text-gray-300 mt-1">{tx.notes}</p>}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white/5 border border-white/10 rounded-xl p-4">
          <h4 className="text-lg font-bold text-yellow-400 flex items-center gap-2 mb-3">
            <Users className="h-5 w-5" />
            Referral History
          </h4>
          {recentReferrals.length === 0 ? (
            <p className="text-sm text-gray-400">No referrals yet.</p>
          ) : (
            <div className="space-y-2">
              {recentReferrals.map((ref) => (
                <div key={ref.id} className="bg-black/20 border border-white/5 rounded p-2 text-xs">
                  <div className="flex justify-between items-center gap-2">
                    <span className="font-mono text-blue-200">{ref.referral_code}</span>
                    <ToneChip tone={ref.status === 'rewarded' ? 'green' : ref.status?.includes('pending') ? 'yellow' : 'blue'}>
                      {String(ref.status || 'pending').replace(/_/g, ' ')}
                    </ToneChip>
                  </div>
                  <p className="text-gray-400 mt-1">
                    Pending booking: {ref.pending_booking_id || 'N/A'} • Completed booking: {ref.completed_booking_id || 'N/A'}
                  </p>
                  <p className="text-gray-400">
                    Bonus: {fmtMoney(ref.referrer_bonus_dollars_awarded)} • Created: {fmtDate(ref.created_at)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
