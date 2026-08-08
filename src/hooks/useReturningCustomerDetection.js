import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/customSupabaseClient';

export const useReturningCustomerDetection = (email) => {
  const [customerData, setCustomerData] = useState(null);
  const [isReturning, setIsReturning] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pastBookingsCount, setPastBookingsCount] = useState(0);
  const [lastOrderDate, setLastOrderDate] = useState(null);
  const [detectionError, setDetectionError] = useState(null);

  const checkReturningCustomer = useCallback(async (emailToCheck) => {
    if (!emailToCheck || !emailToCheck.includes('@')) {
      setCustomerData(null);
      setIsReturning(false);
      setPastBookingsCount(0);
      setLastOrderDate(null);
      setDetectionError(null);
      return;
    }

    const normalizedEmail = emailToCheck.toLowerCase().trim();
    setLoading(true);
    setDetectionError(null);

    try {
      const { data, error } = await supabase.functions.invoke('check-returning-customer', {
        body: { email: normalizedEmail },
      });

      if (error) {
        console.error('[useReturningCustomerDetection] edge function error:', error);
        setCustomerData(null);
        setIsReturning(false);
        setPastBookingsCount(0);
        setLastOrderDate(null);
        setDetectionError('Could not check account history. You can continue booking.');
        return;
      }

      if (!data?.success) {
        console.error('[useReturningCustomerDetection] check failed:', data?.error);
        setCustomerData(null);
        setIsReturning(false);
        setPastBookingsCount(0);
        setLastOrderDate(null);
        setDetectionError('Could not check account history. You can continue booking.');
        return;
      }

      setIsReturning(Boolean(data.isReturning));
      setPastBookingsCount(data.pastBookingsCount ?? 0);
      setCustomerData(data.customer ?? null);
      setLastOrderDate(null);
      setDetectionError(null);
    } catch (error) {
      console.error('[useReturningCustomerDetection] Unexpected error:', error);
      setCustomerData(null);
      setIsReturning(false);
      setPastBookingsCount(0);
      setLastOrderDate(null);
      setDetectionError('Could not check account history. You can continue booking.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (email) {
      const debounceTimer = setTimeout(() => {
        checkReturningCustomer(email);
      }, 500);

      return () => clearTimeout(debounceTimer);
    }
  }, [email, checkReturningCustomer]);

  return {
    customerData,
    isReturning,
    loading,
    pastBookingsCount,
    lastOrderDate,
    detectionError,
    recheckCustomer: checkReturningCustomer,
  };
};
