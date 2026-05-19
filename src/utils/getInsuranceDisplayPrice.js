/**
 * Resolve Premium Insurance display price for receipts and breakdowns.
 * Prefers the amount charged at booking time, then live services-table price.
 */
export function getInsuranceDisplayPrice(booking, liveInsurancePrice = 0) {
  if (booking?.addons?.insurance !== 'accept') return 0;

  const snap = Number(booking.addons.insurancePriceApplied);
  if (snap > 0) return snap;

  return Number(liveInsurancePrice) || 0;
}
