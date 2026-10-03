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

const roundMoney = (amount) => Math.round((Number(amount) || 0) * 100) / 100;

const formatMoney = (amount) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(roundMoney(amount));

/**
 * Display totals for a reschedule. The charged amount stays the original total.
 * When the booking total was corrected after approval, show that corrected total.
 */
export function resolveRescheduleApprovalDisplay(booking) {
  const approval = getLatestRescheduleApproval(booking);
  if (!approval) return null;

  const chargedTotal = roundMoney(approval.original_total);
  const frozenNew = roundMoney(approval.new_total);
  const currentTotal = roundMoney(booking?.total_price);
  const newTotal = currentTotal > 0 && Math.abs(currentTotal - frozenNew) >= 0.01
    ? currentTotal
    : frozenNew;

  return {
    ...approval,
    original_total: chargedTotal,
    new_total: newTotal,
    delta: roundMoney(newTotal - chargedTotal),
  };
}

export function formatRescheduleStripeLine(approval) {
  if (!approval) return null;
  const amount = approval.amount_processed ?? Math.abs(Number(approval.delta) || 0);
  if (approval.stripe_type === 'charge') return `Card charged ${formatMoney(amount)}`;
  if (approval.stripe_type === 'refund') return `Refunded to card ${formatMoney(amount)}`;
  const reduction = roundMoney(Number(approval.original_total || 0) - Number(approval.new_total || 0));
  if (approval.stripe_type !== 'refund' && reduction >= 0.01) {
    return `Order reduced by ${formatMoney(reduction)}. Card was not refunded.`;
  }
  return 'No additional charge or refund';
}
