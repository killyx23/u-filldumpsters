import React, { useEffect, useState } from 'react';
import { Gift, History, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useCustomerLoyaltyPoints } from '@/hooks/useCustomerLoyaltyPoints';
import { supabase } from '@/lib/customSupabaseClient';
import { format } from 'date-fns';

export const PortalLoyaltySummary = ({ customerId }) => {
  const { pointsBalance, referralWallet, loading, conversionRates, getPointsBalance } = useCustomerLoyaltyPoints(customerId);
  const [transactions, setTransactions] = useState([]);
  const [loadingTx, setLoadingTx] = useState(true);

  useEffect(() => {
    if (!customerId) return;
    getPointsBalance();
  }, [customerId, getPointsBalance]);

  useEffect(() => {
    if (!customerId) {
      setLoadingTx(false);
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

    loadTransactions();
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
                  className="flex justify-between items-center text-sm border-b border-white/10 pb-2"
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
    </div>
  );
};
