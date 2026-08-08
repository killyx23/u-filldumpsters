import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/customSupabaseClient';

/**
 * Hook for managing customer loyalty points
 * Provides methods to fetch, calculate, and redeem loyalty points
 */
export const useCustomerLoyaltyPoints = (customerId, verifiedEmail = null) => {
  const [pointsBalance, setPointsBalance] = useState(0);
  const [referralWallet, setReferralWallet] = useState({ pendingBalance: 0, availableBalance: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Default conversion rates (can be overridden by admin settings)
  const DEFAULT_POINTS_PER_DOLLAR = 10; // $1 = 10 points
  const DEFAULT_POINTS_TO_DOLLAR = 100; // 100 points = $1 discount

  const [conversionRates, setConversionRates] = useState({
    pointsPerDollar: DEFAULT_POINTS_PER_DOLLAR,
    pointsToDollar: DEFAULT_POINTS_TO_DOLLAR,
    referralBonusDollars: 25,
  });

  // Fetch conversion rates from settings
  const fetchConversionRates = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('loyalty_settings')
        .select('points_per_dollar, points_to_dollar')
        .maybeSingle();

      if (!error && data) {
        setConversionRates({
          pointsPerDollar: data.points_per_dollar || DEFAULT_POINTS_PER_DOLLAR,
          pointsToDollar: data.points_to_dollar || DEFAULT_POINTS_TO_DOLLAR,
          referralBonusDollars: Number(data.referral_bonus_dollars || 25),
        });
      }
    } catch (err) {
      console.error('[useCustomerLoyaltyPoints] Error fetching conversion rates:', err);
    }
  }, []);

  // Fetch customer's loyalty points balance
  const getPointsBalance = useCallback(async () => {
    if (!customerId && !verifiedEmail) return 0;

    setLoading(true);
    setError(null);

    try {
      const loadVerifiedRewards = async () => {
        if (!verifiedEmail) return null;
        const { data, error } = await supabase.functions.invoke('get-returning-customer-rewards', {
          body: { email: verifiedEmail },
        });
        if (error || !data?.success) return null;
        if (data?.conversionRates) {
          setConversionRates({
            pointsPerDollar: Number(data.conversionRates.pointsPerDollar || DEFAULT_POINTS_PER_DOLLAR),
            pointsToDollar: Number(data.conversionRates.pointsToDollar || DEFAULT_POINTS_TO_DOLLAR),
            referralBonusDollars: Number(data.conversionRates.referralBonusDollars || 25),
          });
        }
        if (data?.referralWallet) {
          setReferralWallet({
            pendingBalance: Number(data.referralWallet.pendingBalance || 0),
            availableBalance: Number(data.referralWallet.availableBalance || 0),
          });
        }
        return Number(data?.pointsBalance || 0);
      };

      const { data, error } = await supabase
        .from('loyalty_points')
        .select('points_balance')
        .eq('customer_id', customerId)
        .maybeSingle();

      if (error) {
        const fallbackBalance = await loadVerifiedRewards();
        if (fallbackBalance !== null) {
          setPointsBalance(fallbackBalance);
          return fallbackBalance;
        }
        throw error;
      }

      const balance = data?.points_balance ?? (await loadVerifiedRewards()) ?? 0;
      setPointsBalance(balance);
      if (customerId) {
        const { data: walletData } = await supabase
          .from('customer_referral_wallets')
          .select('pending_balance, available_balance')
          .eq('customer_id', customerId)
          .maybeSingle();
        setReferralWallet({
          pendingBalance: Number(walletData?.pending_balance || 0),
          availableBalance: Number(walletData?.available_balance || 0),
        });
      }
      return balance;
    } catch (err) {
      console.error('[useCustomerLoyaltyPoints] Error fetching points:', err);
      setError(err.message);
      return 0;
    } finally {
      setLoading(false);
    }
  }, [customerId, verifiedEmail]);

  // Calculate points earned from booking amount
  const calculatePointsEarned = useCallback((amount) => {
    if (!amount || amount <= 0) return 0;
    return Math.floor(amount * conversionRates.pointsPerDollar);
  }, [conversionRates.pointsPerDollar]);

  // Calculate discount value from points
  const calculateDiscountFromPoints = useCallback((points) => {
    if (!points || points <= 0) return 0;
    return Number((points / conversionRates.pointsToDollar).toFixed(2));
  }, [conversionRates.pointsToDollar]);

  // Award points to customer (after successful booking)
  const awardPoints = useCallback(async (points, bookingId) => {
    if (!customerId || !points || points <= 0) return { success: false, error: 'Invalid parameters' };

    try {
      const { data, error } = await supabase.functions.invoke('loyalty-points', {
        body: {
          action: 'award',
          customerId,
          points,
          bookingId,
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      if (data?.newBalance !== undefined) {
        setPointsBalance(data.newBalance);
      }

      return {
        success: true,
        newBalance: data?.newBalance,
        alreadyAwarded: data?.alreadyAwarded,
      };
    } catch (err) {
      console.error('[useCustomerLoyaltyPoints] Error awarding points:', err);
      return { success: false, error: err.message };
    }
  }, [customerId]);

  // Redeem points for discount
  const redeemPoints = useCallback(async (points, bookingId) => {
    if (!customerId || !points || points <= 0) {
      return { success: false, error: 'Invalid parameters' };
    }

    try {
      const { data, error } = await supabase.functions.invoke('loyalty-points', {
        body: {
          action: 'redeem',
          customerId,
          points,
          bookingId,
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      if (data?.newBalance !== undefined) {
        setPointsBalance(data.newBalance);
      }

      return {
        success: true,
        newBalance: data?.newBalance,
        discountAmount: data?.discountAmount ?? calculateDiscountFromPoints(points),
      };
    } catch (err) {
      console.error('[useCustomerLoyaltyPoints] Error redeeming points:', err);
      return { success: false, error: err.message };
    }
  }, [customerId, calculateDiscountFromPoints]);

  // Fetch conversion rates on mount
  useEffect(() => {
    fetchConversionRates();
  }, [fetchConversionRates]);

  // Fetch points balance when customerId changes
  useEffect(() => {
    if (customerId || verifiedEmail) {
      getPointsBalance();
    }
  }, [customerId, verifiedEmail, getPointsBalance]);

  return {
    pointsBalance,
    referralWallet,
    loading,
    error,
    conversionRates,
    getPointsBalance,
    calculatePointsEarned,
    calculateDiscountFromPoints,
    awardPoints,
    redeemPoints,
  };
};