import { resolveBookingGrandTotal } from '@/utils/resolveBookingGrandTotal';

const round2 = (amount) => Math.round((Number(amount) || 0) * 100) / 100;

/**
 * Purchase-time totals frozen on the booking at checkout.
 * Reschedule / cancel / extend comparisons must use this for the Original side
 * so math matches the customer receipt, emails, and portal — not a fresh catalog reprice.
 */
export function resolvePurchaseReceiptTotals(booking) {
  if (!booking) {
    return {
      subtotal: 0,
      tax: 0,
      total: 0,
      taxRate: 0,
      deliveryFee: 0,
      mileageCharge: 0,
      source: 'empty',
    };
  }

  const addons = booking.addons || {};
  const deliveryFee = round2(
    Number(addons.deliveryFee ?? addons.delivery_fee ?? 0),
  );
  const mileageCharge = round2(
    Number(
      addons.mileageCharge
      ?? addons.distanceInfo?.mileageFee
      ?? 0,
    ),
  );

  const subtotal = round2(Number(booking.subtotal_before_tax || 0));
  const tax = round2(Number(booking.tax_amount || 0));
  const total = round2(resolveBookingGrandTotal(booking));
  const taxRate = Number(booking.tax_rate_used || 0);

  if (total > 0 || subtotal > 0) {
    return {
      subtotal: subtotal > 0 ? subtotal : round2(Math.max(0, total - tax)),
      tax,
      total: total > 0 ? total : round2(subtotal + tax),
      taxRate,
      deliveryFee,
      mileageCharge,
      source: 'booking_receipt',
    };
  }

  return {
    subtotal: 0,
    tax: 0,
    total: 0,
    taxRate,
    deliveryFee,
    mileageCharge,
    source: 'missing',
  };
}
