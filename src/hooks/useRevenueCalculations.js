import { useMemo } from 'react';
import { useFinancialData } from './useFinancialData';
import { getPriceFromSnapshotOrCurrent } from '@/utils/equipmentPricingIntegration';

export const useRevenueCalculations = (options = {}) => {
  const { dateRangeStart, dateRangeEnd } = options;
  const { data, loading } = useFinancialData({ dateRangeStart, dateRangeEnd });

  const calculations = useMemo(() => {
    const { bookings, income } = data;

    // Calculate revenue using price snapshots when available
    const calculateBookingRevenue = (booking) => {
      const snapshot = booking.addons?.priceSnapshot;
      let revenue = Number(booking.total_price || 0);
      
      // If we have a snapshot, use it for more accurate historical data
      if (snapshot && typeof snapshot === 'object') {
        // Revenue already calculated and stored in total_price
        // Snapshot is for audit purposes
      }
      
      return revenue;
    };

    const totalRevenue = bookings.reduce((sum, b) => sum + calculateBookingRevenue(b), 0);

    const revenueByService = bookings.reduce((acc, b) => {
      const serviceName = b.plan?.name || 'Unknown';
      acc[serviceName] = (acc[serviceName] || 0) + calculateBookingRevenue(b);
      return acc;
    }, {});

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
      
      acc[customerId].revenue += calculateBookingRevenue(b);
      acc[customerId].bookingCount += 1;
      
      return acc;
    }, {});

    const revenueByMonth = bookings.reduce((acc, b) => {
      const date = new Date(b.created_at);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      acc[monthKey] = (acc[monthKey] || 0) + calculateBookingRevenue(b);
      return acc;
    }, {});

    const additionalIncome = income.reduce((sum, i) => sum + (i.amount || 0), 0);

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