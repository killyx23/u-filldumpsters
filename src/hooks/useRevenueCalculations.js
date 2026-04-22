
import { useMemo } from 'react';
import { useFinancialData } from './useFinancialData';

/**
 * Hook for revenue calculations by service type, customer, date range
 * @param {Object} options - Calculation options
 * @returns {Object} Revenue calculations
 */
export const useRevenueCalculations = (options = {}) => {
  const { dateRangeStart, dateRangeEnd } = options;
  const { data, loading } = useFinancialData({ dateRangeStart, dateRangeEnd });

  const calculations = useMemo(() => {
    const { bookings, income } = data;

    // Total revenue from bookings
    const totalRevenue = bookings.reduce((sum, b) => sum + (b.total_price || 0), 0);

    // Revenue by service type (from plan data)
    const revenueByService = bookings.reduce((acc, b) => {
      const serviceName = b.plan?.name || 'Unknown';
      acc[serviceName] = (acc[serviceName] || 0) + (b.total_price || 0);
      return acc;
    }, {});

    // Revenue by customer
    const revenueByCustomer = bookings.reduce((acc, b) => {
      const customerName = b.customers?.name || 'Unknown';
      const customerId = b.customer_id;
      
      if (!acc[customerId]) {
        acc[customerId] = {
          name: customerName,
          revenue: 0,
          bookingCount: 0,
        };
      }
      
      acc[customerId].revenue += b.total_price || 0;
      acc[customerId].bookingCount += 1;
      
      return acc;
    }, {});

    // Revenue by month
    const revenueByMonth = bookings.reduce((acc, b) => {
      const date = new Date(b.created_at);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      acc[monthKey] = (acc[monthKey] || 0) + (b.total_price || 0);
      return acc;
    }, {});

    // Additional income (non-booking revenue)
    const additionalIncome = income.reduce((sum, i) => sum + (i.amount || 0), 0);

    // Average revenue per booking
    const avgRevenuePerBooking = bookings.length > 0 
      ? totalRevenue / bookings.length 
      : 0;

    return {
      totalRevenue,
      additionalIncome,
      grandTotal: totalRevenue + additionalIncome,
      avgRevenuePerBooking,
      revenueByService: Object.entries(revenueByService).map(([name, amount]) => ({
        name,
        amount,
      })),
      revenueByCustomer: Object.values(revenueByCustomer).sort((a, b) => b.revenue - a.revenue),
      revenueByMonth: Object.entries(revenueByMonth)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([month, amount]) => ({ month, amount })),
    };
  }, [data]);

  return {
    ...calculations,
    loading,
  };
};
