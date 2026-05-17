import { format } from 'date-fns';

function formatDateValue(value) {
  if (!value) return 'N/A';
  if (value instanceof Date && !isNaN(value.getTime())) {
    return format(value, 'yyyy-MM-dd');
  }
  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!isNaN(parsed.getTime())) return format(parsed, 'yyyy-MM-dd');
    return value;
  }
  return String(value);
}

function formatAddonList(addons) {
  if (!Array.isArray(addons) || addons.length === 0) return 'None';
  return addons
    .map((a) => {
      const name = a?.name || 'Add-on';
      const qty = Number(a?.quantity || 1);
      return `${name} (qty ${qty})`;
    })
    .join(', ');
}

/**
 * Build a non-empty reason string for request-booking-change.
 */
export function buildRescheduleReason({
  bookingId,
  originalBooking,
  originalService,
  newService,
  newDropOffDate,
  newPickupDate,
  newDropOffTime,
  newPickupTime,
  originalAddonsList,
  selectedAddonsList,
  verifiedAddress,
  distanceMiles,
  isManualAddress,
  comments,
  inventoryChanges,
}) {
  const lines = [
    `Customer portal reschedule request for booking #${bookingId}.`,
    '',
    `Service: ${originalService?.name || 'Original'} → ${newService?.name || 'New'} (ID ${newService?.id ?? 'N/A'})`,
    `Original dates: ${formatDateValue(originalBooking?.drop_off_date)} ${originalBooking?.drop_off_time_slot || ''} – ${formatDateValue(originalBooking?.pickup_date)} ${originalBooking?.pickup_time_slot || ''}`,
    `Requested dates: ${formatDateValue(newDropOffDate)} ${newDropOffTime || ''} – ${formatDateValue(newPickupDate)} ${newPickupTime || ''}`,
  ];

  if (verifiedAddress) {
    lines.push(`Delivery address: ${verifiedAddress}${isManualAddress ? ' (pending manual verification)' : ''}`);
    if (distanceMiles) lines.push(`Distance: ${distanceMiles} miles`);
  }

  lines.push(`Original add-ons: ${formatAddonList(originalAddonsList)}`);
  lines.push(`Requested add-ons: ${formatAddonList(selectedAddonsList)}`);

  if (inventoryChanges) {
    const { to_return, to_allocate, unchanged } = inventoryChanges;
    if (to_return?.length) lines.push(`Equipment to return: ${formatAddonList(to_return)}`);
    if (to_allocate?.length) lines.push(`Equipment to allocate: ${formatAddonList(to_allocate)}`);
    if (unchanged?.length) lines.push(`Unchanged equipment: ${formatAddonList(unchanged)}`);
  }

  const trimmedComments = (comments || '').trim();
  if (trimmedComments) {
    lines.push('', `Customer comments: ${trimmedComments}`);
  }

  const text = lines.join('\n').trim();
  return text || `Reschedule request for booking #${bookingId}.`;
}

/**
 * Extract a readable message from a Supabase edge function invoke error.
 */
export async function extractEdgeFunctionError(invokeError, responseData) {
  if (responseData?.error) return String(responseData.error);

  const ctx = invokeError?.context;
  if (ctx && typeof ctx.json === 'function') {
    try {
      const body = await ctx.json();
      if (body?.error) return String(body.error);
      if (body?.message) return String(body.message);
    } catch {
      /* ignore parse errors */
    }
  }

  if (invokeError?.message && !invokeError.message.includes('non-2xx')) {
    return invokeError.message;
  }
  if (invokeError?.message) {
    return 'The server rejected this request. Please try again or contact support.';
  }
  return 'Could not submit reschedule request. Please try again.';
}
