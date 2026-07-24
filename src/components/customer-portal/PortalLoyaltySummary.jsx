import React, { useEffect, useState } from 'react';
import { Gift, History, Loader2, Wallet } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useCustomerLoyaltyPoints } from '@/hooks/useCustomerLoyaltyPoints';
import { supabase } from '@/lib/customSupabaseClient';
import { format } from 'date-fns';
import { formatReferralWalletTxType, isReferralWalletDebit } from '@/utils/referralWalletLabels';

export const PortalLoyaltySummary = ({ customerId }) => {
  const { pointsBalance, referralWallet, loading, conversionRates, getPointsBalance } = useCustomerLoyaltyPoints(customerId);
  const [transactions, setTransactions] = useState([]);
  const [referralTransactions, setReferralTransactions] = useState([]);
  const [loadingTx, setLoadingTx] = useState(true);
  const [loadingReferralTx, setLoadingReferralTx] = useState(true);

  useEffect(() => {
    if (!customerId) return;
    getPointsBalance();
  }, [customerId, getPointsBalance]);

  useEffect(() => {
    if (!customerId) {
      setLoadingTx(false);
      setLoadingReferralTx(false);
      return;
    }

    const loadTransactions = async () => {
      setLoadingTx(true);
      try {
        const { data, error } = await supabase
          .from('loyalty_transactions')
          .select('id, transaction_type, points_amount, booking_id, notes, created_at')
          .eq('customer_id', customerId)
          .order('created_at', { ascending: false })
          .limit(10);

        if (!error) setTransactions(data || []);
      } catch (err) {
        console.error('[PortalLoyaltySummary] Error loading transactions:', err);
      } finally {
        setLoadingTx(false);
      }
    };

    const loadReferralTransactions = async () => {
      setLoadingReferralTx(true);
      try {
        const { data, error } = await supabase
          .from('referral_wallet_transactions')
          .select('id, transaction_type, amount, booking_id, notes, created_at, pending_balance_after, available_balance_after')
          .eq('customer_id', customerId)
          .order('created_at', { ascending: false })
          .limit(10);

        if (!error) setReferralTransactions(data || []);
      } catch (err) {
        console.error('[PortalLoyaltySummary] Error loading referral wallet transactions:', err);
      } finally {
        setLoadingReferralTx(false);
      }
    };

    loadTransactions();
    loadReferralTransactions();
  }, [customerId]);

  const dollarValue = Number((pointsBalance / conversionRates.pointsToDollar).toFixed(2));
  const availableReferral = Number(referralWallet?.availableBalance || 0);
  const pendingReferral = Number(referralWallet?.pendingBalance || 0);

  return (
    <div className="space-y-4 mb-6">
      <Card className="bg-purple-900/30 border-purple-500/40">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Gift className="h-5 w-5 text-purple-300" />
            Your Loyalty Points
          </CardTitle>
          <CardDescription className="text-purple-100/80">
            Earn {conversionRates.pointsPerDollar} points per $1 spent. Redeem {conversionRates.pointsToDollar} points for $1 off. Referral dollars are tracked separately.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center gap-2 text-gray-300">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading balance...
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-6">
                <div>
                  <p className="text-3xl font-bold text-yellow-400">{pointsBalance}</p>
                  <p className="text-sm text-gray-300">Points available</p>
                </div>
                <div>
                  <p className="text-3xl font-bold text-green-400">${dollarValue}</p>
                  <p className="text-sm text-gray-300">Redeemable value</p>
                </div>
                <div>
                  <p className="text-3xl font-bold text-emerald-300">${availableReferral.toFixed(2)}</p>
                  <p className="text-sm text-gray-300">Referral dollars available</p>
                </div>
                <div>
                  <p className="text-3xl font-bold text-orange-300">${pendingReferral.toFixed(2)}</p>
                  <p className="text-sm text-gray-300">Referral dollars pending</p>
                </div>
              </div>
              <p className="text-xs text-gray-400">
                Available and pending above are your current balances. Activity lists below are a history of changes (not extra balances).
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="bg-white/5 border-white/10">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2 text-lg">
            <History className="h-5 w-5" />
            Recent Activity
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loadingTx ? (
            <p className="text-sm text-gray-400">Loading history...</p>
          ) : transactions.length === 0 ? (
            <p className="text-sm text-gray-400">
              No loyalty activity yet. Complete a booking to start earning points.
            </p>
          ) : (
            <ul className="space-y-2">
              {transactions.map((tx) => (
                <li
                  key={tx.id}
                  className="flex justify-between items-center text-sm border-b border-white/10 pb-2 gap-2"
                >
                  <span className="text-gray-200 capitalize">
                    {tx.transaction_type.replace(/_/g, ' ')}
                    {tx.booking_id ? ` (#${tx.booking_id})` : ''}
                  </span>
                  <span className={tx.transaction_type.includes('redeem') || tx.transaction_type.includes('remove') ? 'text-red-300' : 'text-green-300'}>
                    {tx.transaction_type.includes('redeem') || tx.transaction_type.includes('remove') ? '-' : '+'}
                    {tx.points_amount}
                  </span>
                  <span className="text-xs text-gray-500">
                    {format(new Date(tx.created_at), 'MMM d, yyyy')}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {transactions.some((tx) => tx.transaction_type.includes('redeem')) && (
            <p className="text-xs text-gray-500 mt-3">
              Redeemed points are marked as no longer available after use.
            </p>
          )}
        </CardContent>
      </Card>

      <Card className="bg-emerald-950/30 border-emerald-500/30">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2 text-lg">
            <Wallet className="h-5 w-5 text-emerald-300" />
            Referral dollar activity
          </CardTitle>
          <CardDescription className="text-emerald-100/70">
            History of referral wallet changes. “Accrued (held pending)” becomes “Activated” when the referred booking is completed; available dollars drop when redeemed at checkout.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loadingReferralTx ? (
            <p className="text-sm text-gray-400">Loading referral history...</p>
          ) : referralTransactions.length === 0 ? (
            <p className="text-sm text-gray-400">
              No referral dollar activity yet. Activity appears when a referred booking is registered, completed, or when you redeem referral dollars.
            </p>
          ) : (
            <ul className="space-y-3">
              {referralTransactions.map((tx) => {
                const debit = isReferralWalletDebit(tx.transaction_type);
                const laterActivated = tx.transaction_type === 'pending_accrual' && referralTransactions.some(
                  (other) =>
                    other.booking_id === tx.booking_id &&
                    other.transaction_type === 'activated' &&
                    new Date(other.created_at) >= new Date(tx.created_at)
                );
                const laterRedeemed = tx.transaction_type === 'activated' && referralTransactions.some(
                  (other) =>
                    other.transaction_type === 'redeemed' &&
                    new Date(other.created_at) >= new Date(tx.created_at)
                );
                const settledNote = laterActivated
                  ? 'No longer pending — already activated (and may have been redeemed).'
                  : laterRedeemed
                    ? 'No longer available — already redeemed at checkout.'
                    : null;
                return (
                  <li
                    key={tx.id}
                    className={`text-sm border-b border-white/10 pb-2 ${settledNote ? 'opacity-70' : ''}`}
                  >
                    <div className="flex justify-between items-center gap-2">
                      <span className="text-gray-200">
                        {formatReferralWalletTxType(tx.transaction_type)}
                        {tx.booking_id ? ` (#${tx.booking_id})` : ''}
                      </span>
                      <span className={debit ? 'text-red-300' : 'text-emerald-300'}>
                        {debit ? '-' : '+'}${Number(tx.amount || 0).toFixed(2)}
                      </span>
                      <span className="text-xs text-gray-500">
                        {format(new Date(tx.created_at), 'MMM d, yyyy')}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      Balance after: pending ${Number(tx.pending_balance_after || 0).toFixed(2)} · available ${Number(tx.available_balance_after || 0).toFixed(2)}
                    </p>
                    {settledNote && (
                      <p className="text-xs text-amber-200/80 mt-1">{settledNote}</p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <p className="text-xs text-gray-400 mt-3">
            Current pending balance: <span className="text-orange-300 font-semibold">${pendingReferral.toFixed(2)}</span>
            {' · '}
            Current available: <span className="text-emerald-300 font-semibold">${availableReferral.toFixed(2)}</span>
          </p>
        </CardContent>
      </Card>
    </div>
  );
};
