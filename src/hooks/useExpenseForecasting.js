
import { useMemo } from 'react';
import { useFinancialData } from './useFinancialData';

/**
 * Hook for expense trend analysis and forecasting
 * @returns {Object} Expense forecasts and trends
 */
export const useExpenseForecasting = () => {
  const { data, loading } = useFinancialData();

  const forecast = useMemo(() => {
    const { expenses } = data;

    if (!expenses || expenses.length === 0) {
      return {
        monthlyAverage: 0,
        trendDirection: 'stable',
        nextMonthForecast: 0,
        byCategory: [],
      };
    }

    // Group by month
    const expensesByMonth = expenses.reduce((acc, exp) => {
      const date = new Date(exp.date);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      acc[monthKey] = (acc[monthKey] || 0) + (exp.amount || 0);
      return acc;
    }, {});

    const monthlyTotals = Object.values(expensesByMonth);
    const monthlyAverage = monthlyTotals.reduce((sum, val) => sum + val, 0) / monthlyTotals.length;

    // Calculate trend (simple linear regression)
    const recentMonths = monthlyTotals.slice(-6); // Last 6 months
    if (recentMonths.length < 2) {
      return {
        monthlyAverage,
        trendDirection: 'stable',
        nextMonthForecast: monthlyAverage,
        byCategory: [],
      };
    }

    const avgRecent = recentMonths.reduce((sum, val) => sum + val, 0) / recentMonths.length;
    const trendDirection = avgRecent > monthlyAverage ? 'increasing' : avgRecent < monthlyAverage ? 'decreasing' : 'stable';

    // Simple forecast: average of recent months
    const nextMonthForecast = avgRecent;

    // Forecast by category
    const byCategory = expenses.reduce((acc, exp) => {
      const categoryName = exp.financial_categories?.name || 'Uncategorized';
      
      if (!acc[categoryName]) {
        acc[categoryName] = {
          name: categoryName,
          total: 0,
          count: 0,
        };
      }
      
      acc[categoryName].total += exp.amount || 0;
      acc[categoryName].count += 1;
      
      return acc;
    }, {});

    const categoryForecasts = Object.values(byCategory).map(cat => ({
      category: cat.name,
      monthlyAverage: cat.total / (monthlyTotals.length || 1),
      forecast: cat.total / (monthlyTotals.length || 1),
    }));

    return {
      monthlyAverage,
      trendDirection,
      nextMonthForecast,
      byCategory: categoryForecasts,
    };
  }, [data]);

  return {
    ...forecast,
    loading,
  };
};
