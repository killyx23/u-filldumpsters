import { useState, useEffect } from 'react';
import { supabase } from '@/lib/customSupabaseClient';

export const useFinancialData = ({ autoRefresh = false, refreshInterval = 30000 } = {}) => {
  const [data, setData] = useState({
    bookings: [],
    expenses: [],
    income: [],
    equipment: [],
    categories: []
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchFinancialData = async () => {
    try {
      setLoading(true);
      setError(null);

      // Fetch bookings with customer and service information
      const { data: bookingsData, error: bookingsError } = await supabase
        .from('bookings')
        .select(`
          *,
          customers (
            id,
            name,
            email,
            customer_id_text
          )
        `)
        .in('status', ['Confirmed', 'Completed', 'Delivered', 'Picked Up']);

      if (bookingsError) throw bookingsError;

      // Fetch service details separately to avoid relationship issues
      const { data: servicesData, error: servicesError } = await supabase
        .from('services')
        .select('*');

      if (servicesError) throw servicesError;

      // Map service data to bookings
      const bookingsWithServices = (bookingsData || []).map(booking => {
        const planData = booking.plan || {};
        const serviceId = planData.service_id || planData.id;
        const service = servicesData?.find(s => s.id === serviceId);

        return {
          ...booking,
          service_name: service?.name || planData.name || 'Unknown Service',
          service_type: service?.service_type || 'unknown'
        };
      });

      // Fetch expenses
      const { data: expensesData, error: expensesError } = await supabase
        .from('financial_expenses')
        .select('*, financial_categories(*), equipment_inventory(name)')
        .order('date', { ascending: false });

      if (expensesError) throw expensesError;

      // Fetch income
      const { data: incomeData, error: incomeError } = await supabase
        .from('financial_income')
        .select('*, customers(name, email), bookings(id)')
        .order('date', { ascending: false });

      if (incomeError) throw incomeError;

      // Fetch equipment
      const { data: equipmentData, error: equipmentError } = await supabase
        .from('equipment_inventory')
        .select('*')
        .order('created_at', { ascending: false });

      if (equipmentError) throw equipmentError;

      // Fetch categories
      const { data: categoriesData, error: categoriesError } = await supabase
        .from('financial_categories')
        .select('*')
        .order('name');

      if (categoriesError) throw categoriesError;

      setData({
        bookings: bookingsWithServices || [],
        expenses: expensesData || [],
        income: incomeData || [],
        equipment: equipmentData || [],
        categories: categoriesData || []
      });
    } catch (err) {
      console.error('[useFinancialData] Error fetching data:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFinancialData();

    if (autoRefresh) {
      const interval = setInterval(fetchFinancialData, refreshInterval);
      return () => clearInterval(interval);
    }
  }, [autoRefresh, refreshInterval]);

  return {
    data,
    loading,
    error,
    refetch: fetchFinancialData
  };
};