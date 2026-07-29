import { useMemo } from 'react';
import { useFinancialData } from './useFinancialData';

/**
 * Sales tax collected from paid (non-cancelled) bookings.
 * Prefer booking.tax_amount; fall back to total_price - subtotal_before_tax.
 */
export const useTaxCalculations = () => {
  const { data, loading } = useFinancialData({ autoRefresh: true });

  const calculations = useMemo(() => {
    const bookings = data.bookings || [];

    const taxForBooking = (booking) => {
      const explicit = Number(booking.tax_amount);
      if (Number.isFinite(explicit) && explicit >= 0) return explicit;
      const subtotal = Number(booking.subtotal_before_tax);
      const total = Number(booking.total_price);
      if (Number.isFinite(subtotal) && Number.isFinite(total) && total >= subtotal) {
        return total - subtotal;
      }
      return 0;
    };

    const netForBooking = (booking) => {
      const subtotal = Number(booking.subtotal_before_tax);
      if (Number.isFinite(subtotal) && subtotal >= 0) return subtotal;
      const total = Number(booking.total_price || 0);
      return Math.max(0, total - taxForBooking(booking));
    };

    const totalTaxCollected = bookings.reduce((sum, b) => sum + taxForBooking(b), 0);
    const totalTaxableSubtotal = bookings.reduce((sum, b) => {
      const taxable = Number(b.addons?.taxableSubtotal);
      if (Number.isFinite(taxable)) return sum + taxable;
      return sum + netForBooking(b);
    }, 0);
    const totalNonTaxableSubtotal = bookings.reduce((sum, b) => {
      const n = Number(b.addons?.nonTaxableSubtotal);
      return sum + (Number.isFinite(n) ? n : 0);
    }, 0);
    const netRevenueExTax = bookings.reduce((sum, b) => sum + netForBooking(b), 0);

    const taxByMonth = bookings.reduce((acc, b) => {
      const date = new Date(b.created_at);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      acc[monthKey] = (acc[monthKey] || 0) + taxForBooking(b);
      return acc;
    }, {});

    const taxByBooking = bookings
      .map((b) => ({
        bookingId: b.id,
        customerName: b.customers?.name || 'Unknown',
        customerEmail: b.customers?.email || '',
        status: b.status,
        createdAt: b.created_at,
        taxAmount: taxForBooking(b),
        taxRate: Number(b.tax_rate_used || 0),
        subtotalBeforeTax: netForBooking(b),
        taxableSubtotal: Number(b.addons?.taxableSubtotal ?? netForBooking(b)),
        nonTaxableSubtotal: Number(b.addons?.nonTaxableSubtotal || 0),
        jurisdiction: b.tax_jurisdiction || b.addons?.taxJurisdiction || '—',
        totalPrice: Number(b.total_price || 0),
      }))
      .filter((row) => row.taxAmount > 0 || row.taxRate > 0)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    return {
      totalTaxCollected,
      totalTaxableSubtotal,
      totalNonTaxableSubtotal,
      netRevenueExTax,
      taxedBookingCount: taxByBooking.length,
      taxByMonth: Object.entries(taxByMonth)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([month, amount]) => ({ month, amount })),
      taxByBooking,
    };
  }, [data]);

  return {
    ...calculations,
    loading,
    bookings: data.bookings || [],
  };
};
