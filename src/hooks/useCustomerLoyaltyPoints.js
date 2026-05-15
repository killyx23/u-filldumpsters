import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/customSupabaseClient';

/**
 * Hook for managing customer loyalty points
 * Provides methods to fetch, calculate, and redeem loyalty points
 */
export const useCustomerLoyaltyPoints = (customerId) => {
  const [pointsBalance, setPointsBalance] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Default conversion rates (can be overridden by admin settings)
  const DEFAULT_POINTS_PER_DOLLAR = 10; // $1 = 10 points
  const DEFAULT_POINTS_TO_DOLLAR = 100; // 100 points = $1 discount

  const [conversionRates, setConversionRates] = useState({
    pointsPerDollar: DEFAULT_POINTS_PER_DOLLAR,
    pointsToDollar: DEFAULT_POINTS_TO_DOLLAR,
  });

  // Fetch conversion rates from settings
  const fetchConversionRates = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('loyalty_settings')
        .select('points_per_dollar, points_to_dollar')
        .single();

      if (!error && data) {
        setConversionRates({
          pointsPerDollar: data.points_per_dollar || DEFAULT_POINTS_PER_DOLLAR,
          pointsToDollar: data.points_to_dollar || DEFAULT_POINTS_TO_DOLLAR,
        });
      }
    } catch (err) {
      console.error('[useCustomerLoyaltyPoints] Error fetching conversion rates:', err);
    }
  }, []);

  // Fetch customer's loyalty points balance
  const getPointsBalance = useCallback(async () => {
    if (!customerId) return 0;

    setLoading(true);
    setError(null);

    try {
      const { data, error } = await supabase
        .from('loyalty_points')
        .select('points_balance')
        .eq('customer_id', customerId)
        .maybeSingle();

      if (error) throw error;

      const balance = data?.points_balance || 0;
      setPointsBalance(balance);
      return balance;
    } catch (err) {
      console.error('[useCustomerLoyaltyPoints] Error fetching points:', err);
      setError(err.message);
      return 0;
    } finally {
      setLoading(false);
    }
  }, [customerId]);

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
      // Check if loyalty record exists
      const { data: existingRecord } = await supabase
        .from('loyalty_points')
        .select('id, points_balance, total_points_earned')
        .eq('customer_id', customerId)
        .maybeSingle();

      let result;
      if (existingRecord) {
        // Update existing record
        const { data, error } = await supabase
          .from('loyalty_points')
          .update({
            points_balance: existingRecord.points_balance + points,
            total_points_earned: existingRecord.total_points_earned + points,
            last_updated: new Date().toISOString(),
          })
          .eq('customer_id', customerId)
          .select()
          .single();

        if (error) throw error;
        result = data;
      } else {
        // Create new record
        const { data, error } = await supabase
          .from('loyalty_points')
          .insert({
            customer_id: customerId,
            points_balance: points,
            total_points_earned: points,
            total_points_redeemed: 0,
          })
          .select()
          .single();

        if (error) throw error;
        result = data;
      }

      // Log transaction
      await supabase.from('loyalty_transactions').insert({
        customer_id: customerId,
        transaction_type: 'earned',
        points_amount: points,
        booking_id: bookingId,
      });

      setPointsBalance(result.points_balance);
      return { success: true, newBalance: result.points_balance };
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
      const { data: loyaltyRecord } = await supabase
        .from('loyalty_points')
        .select('points_balance, total_points_redeemed')
        .eq('customer_id', customerId)
        .single();

      if (!loyaltyRecord) {
        return { success: false, error: 'No loyalty account found' };
      }

      if (loyaltyRecord.points_balance < points) {
        return { success: false, error: 'Insufficient points' };
      }

      // Update points balance
      const { data, error } = await supabase
        .from('loyalty_points')
        .update({
          points_balance: loyaltyRecord.points_balance - points,
          total_points_redeemed: loyaltyRecord.total_points_redeemed + points,
          last_updated: new Date().toISOString(),
        })
        .eq('customer_id', customerId)
        .select()
        .single();

      if (error) throw error;

      // Log transaction
      await supabase.from('loyalty_transactions').insert({
        customer_id: customerId,
        transaction_type: 'redeemed',
        points_amount: points,
        booking_id: bookingId,
      });

      const discountAmount = calculateDiscountFromPoints(points);
      setPointsBalance(data.points_balance);

      return {
        success: true,
        newBalance: data.points_balance,
        discountAmount,
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
    if (customerId) {
      getPointsBalance();
    }
  }, [customerId, getPointsBalance]);

  return {
    pointsBalance,
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