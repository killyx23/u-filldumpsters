
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';

/**
 * Hook for fetching and caching financial data
 * @param {Object} options - Fetch options
 * @returns {Object} Financial data and methods
 */
export const useFinancialData = (options = {}) => {
  const {
    dateRangeStart = null,
    dateRangeEnd = null,
    autoRefresh = false,
    refreshInterval = 30000, // 30 seconds
  } = options;

  const [data, setData] = useState({
    income: [],
    expenses: [],
    bookings: [],
    equipment: [],
    categories: [],
  });

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // Build date filter
      let dateFilter = {};
      if (dateRangeStart && dateRangeEnd) {
        dateFilter = {
          date: `gte.${dateRangeStart}`,
          date: `lte.${dateRangeEnd}`,
        };
      }

      // Fetch all data in parallel
      const [incomeRes, expensesRes, bookingsRes, equipmentRes, categoriesRes] = 
        await Promise.all([
          supabase
            .from('financial_income')
            .select('*, customers(name), bookings(id)')
            .order('date', { ascending: false }),
          
          supabase
            .from('financial_expenses')
            .select('*, equipment_inventory(name), financial_categories(name)')
            .order('date', { ascending: false }),
          
          supabase
            .from('bookings')
            .select('*, customers(name)')
            .order('created_at', { ascending: false }),
          
          supabase
            .from('equipment_inventory')
            .select('*')
            .order('name'),
          
          supabase
            .from('financial_categories')
            .select('*')
            .order('name'),
        ]);

      // Check for errors
      if (incomeRes.error) throw incomeRes.error;
      if (expensesRes.error) throw expensesRes.error;
      if (bookingsRes.error) throw bookingsRes.error;
      if (equipmentRes.error) throw equipmentRes.error;
      if (categoriesRes.error) throw categoriesRes.error;

      setData({
        income: incomeRes.data || [],
        expenses: expensesRes.data || [],
        bookings: bookingsRes.data || [],
        equipment: equipmentRes.data || [],
        categories: categoriesRes.data || [],
      });

    } catch (err) {
      console.error('Error fetching financial data:', err);
      setError(err.message);
      toast({
        title: 'Error Loading Financial Data',
        description: err.message,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [dateRangeStart, dateRangeEnd]);

  // Initial fetch
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Auto-refresh
  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(fetchData, refreshInterval);
    return () => clearInterval(interval);
  }, [autoRefresh, refreshInterval, fetchData]);

  // Real-time subscriptions
  useEffect(() => {
    const channel = supabase
      .channel('financial-data-changes')
      .on('postgres_changes', { 
        event: '*', 
        schema: 'public', 
        table: 'financial_income' 
      }, () => fetchData())
      .on('postgres_changes', { 
        event: '*', 
        schema: 'public', 
        table: 'financial_expenses' 
      }, () => fetchData())
      .on('postgres_changes', { 
        event: '*', 
        schema: 'public', 
        table: 'bookings' 
      }, () => fetchData())
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchData]);

  return {
    data,
    loading,
    error,
    refresh: fetchData,
  };
};
