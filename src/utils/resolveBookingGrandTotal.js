/**
 * Resolve the tax-inclusive grand total for a booking.
 * Legacy bookings stored subtotal in total_price while tax_amount was set separately.
 */
export function resolveBookingGrandTotal({ total_price, subtotal_before_tax, tax_amount }) {
  const subtotal = Number(subtotal_before_tax ?? 0);
  const tax = Number(tax_amount ?? 0);
  const stored = Number(total_price ?? 0);
  const computed = Math.round((subtotal + tax) * 100) / 100;

  if (subtotal > 0 && tax > 0 && Math.abs(stored - subtotal) < 0.02) {
    return computed;
  }

  return stored > 0 ? stored : computed;
}
