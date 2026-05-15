import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/customSupabaseClient';

export const useReturningCustomerDetection = (email) => {
  const [customerData, setCustomerData] = useState(null);
  const [isReturning, setIsReturning] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pastBookingsCount, setPastBookingsCount] = useState(0);
  const [lastOrderDate, setLastOrderDate] = useState(null);

  const checkReturningCustomer = useCallback(async (emailToCheck) => {
    if (!emailToCheck || !emailToCheck.includes('@')) {
      setCustomerData(null);
      setIsReturning(false);
      setPastBookingsCount(0);
      setLastOrderDate(null);
      return;
    }

    const normalizedEmail = emailToCheck.toLowerCase().trim();
    console.log('[useReturningCustomerDetection] Checking email:', normalizedEmail);
    setLoading(true);

    try {
      // Check if customer exists
      const { data: customer, error: customerError } = await supabase
        .from('customers')
        .select('*')
        .eq('email', normalizedEmail)
        .maybeSingle();

      if (customerError) {
        console.error('[useReturningCustomerDetection] Error fetching customer:', customerError);
        setCustomerData(null);
        setIsReturning(false);
        return;
      }

      if (customer) {
        console.log('[useReturningCustomerDetection] ✓ Returning customer found:', customer.id);
        
        // Fetch booking history
        const { data: bookings, error: bookingsError } = await supabase
          .from('bookings')
          .select('id, created_at, status')
          .eq('customer_id', customer.id)
          .order('created_at', { ascending: false });

        if (bookingsError) {
          console.error('[useReturningCustomerDetection] Error fetching bookings:', bookingsError);
        }

        const completedBookings = bookings?.filter(b => 
          b.status && !['cancelled', 'pending_payment'].includes(b.status.toLowerCase())
        ) || [];

        setCustomerData(customer);
        setIsReturning(true);
        setPastBookingsCount(completedBookings.length);
        setLastOrderDate(bookings && bookings.length > 0 ? bookings[0].created_at : null);

        console.log('[useReturningCustomerDetection] Customer stats:', {
          totalBookings: bookings?.length,
          completedBookings: completedBookings.length,
          lastOrder: bookings?.[0]?.created_at
        });
      } else {
        console.log('[useReturningCustomerDetection] New customer detected');
        setCustomerData(null);
        setIsReturning(false);
        setPastBookingsCount(0);
        setLastOrderDate(null);
      }
    } catch (error) {
      console.error('[useReturningCustomerDetection] Unexpected error:', error);
      setCustomerData(null);
      setIsReturning(false);
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
    recheckCustomer: checkReturningCustomer
  };
};