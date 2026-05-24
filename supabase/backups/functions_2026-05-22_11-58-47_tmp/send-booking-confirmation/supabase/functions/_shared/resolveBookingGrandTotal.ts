export function resolveBookingGrandTotal(booking) {
  const subtotal = Number(booking.subtotal_before_tax ?? 0);
  const tax = Number(booking.tax_amount ?? 0);
  const stored = Number(booking.total_price ?? 0);
  const computed = Math.round((subtotal + tax) * 100) / 100;
  if (subtotal > 0 && tax > 0 && Math.abs(stored - subtotal) < 0.02) {
    return computed;
  }
  return stored > 0 ? stored : computed;
}
