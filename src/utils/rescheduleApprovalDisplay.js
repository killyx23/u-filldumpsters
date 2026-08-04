/**
 * Resolve the latest approved reschedule receipt entry from a booking.
 */
export function getLatestRescheduleApproval(booking) {
  if (!booking) return null;

  const history = Array.isArray(booking.receipt_status_history)
    ? booking.receipt_status_history
    : [];
  const fromReceipt = [...history]
    .reverse()
    .find((e) => e?.action === 'reschedule_approved');
  if (fromReceipt) return fromReceipt;

  const rescheduleHistory = Array.isArray(booking.reschedule_history)
    ? booking.reschedule_history
    : [];
  const fromReschedule = [...rescheduleHistory]
    .reverse()
    .find(
      (e) =>
        e?.type === 'reschedule_request' &&
        (e?.status === 'approved' || e?.approved_at)
    );
  if (fromReschedule) {
    return {
      action: 'reschedule_approved',
      at: fromReschedule.approved_at || fromReschedule.requested_at,
      original_total: fromReschedule.original_total,
      new_total: fromReschedule.new_total,
      delta:
        fromReschedule.amount_due ??
        (Number(fromReschedule.new_total || 0) - Number(fromReschedule.original_total || 0)),
      stripe_type: fromReschedule.stripe_type || 'none',
      stripe_transaction_id: fromReschedule.stripe_transaction_id || null,
      amount_processed: fromReschedule.amount_processed,
      original_address: fromReschedule.original_address,
      new_address: fromReschedule.new_address,
      address_changed: fromReschedule.address_changed,
      original_service_name: fromReschedule.original_service_name,
      new_service_name: fromReschedule.new_service_name,
      original_drop_off_date: fromReschedule.original_drop_off_date,
      original_pickup_date: fromReschedule.original_pickup_date,
      original_drop_off_time: fromReschedule.original_drop_off_time,
      original_pickup_time: fromReschedule.original_pickup_time,
      new_drop_off_date: fromReschedule.new_drop_off_date,
      new_pickup_date: fromReschedule.new_pickup_date,
      new_drop_off_time: fromReschedule.new_drop_off_time,
      new_pickup_time: fromReschedule.new_pickup_time,
    };
  }

  const delta = booking.payment_delta_details;
  if (delta && (delta.state === 'settled' || delta.state === 'approved') && delta.stripe_type) {
    return {
      action: 'reschedule_approved',
      at: delta.settled_at || delta.last_updated_at,
      original_total: delta.original_total_price,
      new_total: delta.new_total_price,
      delta: delta.amount_due,
      stripe_type: delta.stripe_type,
      stripe_transaction_id: delta.stripe_transaction_id,
      amount_processed: delta.amount_processed,
    };
  }

  return null;
}

export function formatRescheduleStripeLine(approval) {
  if (!approval) return null;
  const money = (n) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(n) || 0);
  const amount = approval.amount_processed ?? Math.abs(Number(approval.delta) || 0);
  if (approval.stripe_type === 'charge') return `Card charged ${money(amount)}`;
  if (approval.stripe_type === 'refund') return `Refunded to card ${money(amount)}`;
  return 'No additional charge or refund';
}
