import { useState, useMemo, useCallback } from 'react';
import { useFinancialData } from './useFinancialData';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';

/**
 * Hook for financial projections and forecasting
 * @returns {Object} Projection data and methods
 */
export const useProjections = () => {
  const { data, loading: dataLoading } = useFinancialData();
  const [savedProjections, setSavedProjections] = useState([]);
  const [loading, setLoading] = useState(false);

  // Calculate projections based on historical data
  const calculateProjections = useCallback((months = 12, growthRate = 0) => {
    const { bookings, expenses } = data;

    // Calculate monthly averages
    const revenueByMonth = {};
    const expensesByMonth = {};

    bookings.forEach(b => {
      const date = new Date(b.created_at);
      const monthKey = `${date.getFullYear()}-${date.getMonth()}`;
      revenueByMonth[monthKey] = (revenueByMonth[monthKey] || 0) + (b.total_price || 0);
    });

    expenses.forEach(e => {
      const date = new Date(e.date);
      const monthKey = `${date.getFullYear()}-${date.getMonth()}`;
      expensesByMonth[monthKey] = (expensesByMonth[monthKey] || 0) + (e.amount || 0);
    });

    const avgMonthlyRevenue = Object.values(revenueByMonth).reduce((sum, val) => sum + val, 0) / 
      (Object.keys(revenueByMonth).length || 1);
    
    const avgMonthlyExpenses = Object.values(expensesByMonth).reduce((sum, val) => sum + val, 0) / 
      (Object.keys(expensesByMonth).length || 1);

    // Generate projections
    const projections = [];
    const startDate = new Date();
    
    for (let i = 1; i <= months; i++) {
      const projectedDate = new Date(startDate);
      projectedDate.setMonth(projectedDate.getMonth() + i);

      // Apply growth rate
      const growthMultiplier = Math.pow(1 + (growthRate / 100), i);
      
      const projectedRevenue = avgMonthlyRevenue * growthMultiplier;
      const projectedExpenses = avgMonthlyExpenses * growthMultiplier;
      const projectedProfit = projectedRevenue - projectedExpenses;

      projections.push({
        month: projectedDate.toISOString().substring(0, 7),
        revenue: projectedRevenue,
        expenses: projectedExpenses,
        profit: projectedProfit,
        cumulativeProfit: projections.reduce((sum, p) => sum + p.profit, 0) + projectedProfit,
      });
    }

    return {
      projections,
      avgMonthlyRevenue,
      avgMonthlyExpenses,
      avgMonthlyProfit: avgMonthlyRevenue - avgMonthlyExpenses,
    };
  }, [data]);

  // Save projection to database
  const saveProjection = useCallback(async (projectionData) => {
    try {
      setLoading(true);

      const { data: saved, error } = await supabase
        .from('financial_projections')
        .insert([{
          projection_type: projectionData.type,
          start_date: projectionData.startDate,
          end_date: projectionData.endDate,
          data: projectionData.data,
          confidence_level: projectionData.confidenceLevel || 75,
        }])
        .select()
        .single();

      if (error) throw error;

      setSavedProjections(prev => [...prev, saved]);

      toast({
        title: 'Projection Saved',
        description: 'Financial projection saved successfully.',
      });

      return saved;
    } catch (error) {
      console.error('Error saving projection:', error);
      toast({
        title: 'Error Saving Projection',
        description: error.message,
        variant: 'destructive',
      });
      throw error;
    } finally {
      setLoading(false);
    }
  }, []);

  // Load saved projections
  const loadProjections = useCallback(async () => {
    try {
      const { data: projections, error } = await supabase
        .from('financial_projections')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;

      setSavedProjections(projections || []);
    } catch (error) {
      console.error('Error loading projections:', error);
    }
  }, []);

  return {
    calculateProjections,
    saveProjection,
    loadProjections,
    savedProjections,
    loading: loading || dataLoading,
  };
};