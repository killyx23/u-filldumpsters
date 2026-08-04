import { format, isValid, parseISO } from 'date-fns';
import { convertTo12Hour } from '@/utils/timeFormatConverter';

/**
 * Format a date value for everyday reading (e.g. "Aug 2, 2026").
 */
export function formatFriendlyDate(value) {
  if (!value) return null;
  if (value instanceof Date && isValid(value)) {
    return format(value, 'MMM d, yyyy');
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed || trimmed === 'N/A') return null;
    // Already friendly (e.g. "Aug 2, 2026")
    if (/^[A-Za-z]{3,9}\s+\d{1,2},\s+\d{4}$/.test(trimmed)) {
      return trimmed;
    }
    // Prefer date-only to avoid UTC day shifts
    const dateOnly = trimmed.match(/^(\d{4}-\d{2}-\d{2})/);
    if (dateOnly) {
      const [y, m, d] = dateOnly[1].split('-').map(Number);
      const local = new Date(y, m - 1, d);
      if (isValid(local)) return format(local, 'MMM d, yyyy');
    }
    const parsed = new Date(trimmed);
    if (isValid(parsed)) return format(parsed, 'MMM d, yyyy');
    return trimmed;
  }
  return String(value);
}

/**
 * Normalize a time slot string to 12-hour AM/PM.
 * Handles "06:00:00", "06:00", "6:00 AM", and ranges "08:00|17:00".
 */
export function formatFriendlyTime(timeValue) {
  if (!timeValue && timeValue !== 0) return null;
  let raw = String(timeValue).trim();
  if (!raw || raw === 'N/A') return null;

  if (raw.includes('|')) {
    const [start, end] = raw.split('|').map((t) => t.trim()).filter(Boolean);
    const startFmt = formatFriendlyTime(start);
    const endFmt = formatFriendlyTime(end);
    if (startFmt && endFmt) return `${startFmt} – ${endFmt}`;
    return startFmt || endFmt || raw;
  }

  // Strip seconds for convertTo12Hour ("06:00:00" → "06:00")
  const withSeconds = raw.match(/^(\d{1,2}):(\d{2}):\d{2}$/);
  if (withSeconds) {
    raw = `${withSeconds[1]}:${withSeconds[2]}`;
  }

  const converted = convertTo12Hour(raw);
  return converted || raw;
}

/**
 * Combine date + time into "Aug 2, 2026 at 6:00 AM".
 */
export function formatFriendlyDateTime(dateValue, timeValue) {
  const datePart = formatFriendlyDate(dateValue);
  const timePart = formatFriendlyTime(timeValue);
  if (datePart && timePart) return `${datePart} at ${timePart}`;
  return datePart || timePart || null;
}

/**
 * Format an ISO / Date timestamp as "Aug 1, 2026 at 11:49 PM".
 */
export function formatFriendlyTimestamp(value) {
  if (!value) return null;
  try {
    const date = typeof value === 'string' ? parseISO(value) : value;
    if (!isValid(date)) return String(value);
    return format(date, "MMM d, yyyy 'at' h:mm a");
  } catch {
    return String(value);
  }
}

/**
 * Parse "2026-08-02 06:00:00" or "2026-08-01 6:00 AM" into { date, time }.
 */
function splitDateAndTime(combined) {
  if (!combined) return { date: null, time: null };
  const trimmed = String(combined).trim();
  const match = trimmed.match(
    /^(\d{4}-\d{2}-\d{2})(?:[T\s]+(.+))?$/
  );
  if (match) {
    return { date: match[1], time: match[2]?.trim() || null };
  }
  return { date: trimmed, time: null };
}

/**
 * Parse "Original dates: DATE TIME – DATE TIME" style lines.
 */
function parseDateRangeLine(line) {
  if (!line) return null;
  const parts = line.split(/\s+[–—-]\s+/);
  if (parts.length < 2) {
    const single = splitDateAndTime(line);
    return {
      startDate: single.date,
      startTime: single.time,
      endDate: null,
      endTime: null,
    };
  }
  const start = splitDateAndTime(parts[0]);
  const end = splitDateAndTime(parts[1]);
  return {
    startDate: start.date,
    startTime: start.time,
    endDate: end.date,
    endTime: end.time,
  };
}

function extractField(lines, prefixes) {
  const list = Array.isArray(prefixes) ? prefixes : [prefixes];
  for (const line of lines) {
    for (const prefix of list) {
      if (line.toLowerCase().startsWith(prefix.toLowerCase())) {
        return line.slice(prefix.length).trim();
      }
    }
  }
  return null;
}

function stripServiceId(serviceLine) {
  if (!serviceLine) return null;
  return serviceLine.replace(/\s*\(ID\s*\d+\)\s*$/i, '').trim();
}

/**
 * Detect whether note content is a booking change / reschedule request.
 */
export function isChangeRequestNote(source, content) {
  if (source === 'Change Request') return true;
  if (!content || typeof content !== 'string') return false;
  return (
    /reschedule request/i.test(content) ||
    /--- Structured request ---/i.test(content) ||
    /Admin approval required/i.test(content) ||
    /Scheduling approval required/i.test(content)
  );
}

/**
 * Collect Drop-off / Pickup pairs under section headers like "Current schedule:"
 * or from legacy "Original dates:" range lines / structured blocks.
 */
function collectScheduleSections(lines) {
  const result = {
    originalDropOff: null,
    originalPickup: null,
    requestedDropOff: null,
    requestedPickup: null,
  };

  let section = null; // 'original' | 'requested' | null
  for (const line of lines) {
    const lower = line.toLowerCase();
    if (lower.startsWith('current schedule') || lower.startsWith('original schedule')) {
      section = 'original';
      continue;
    }
    if (lower.startsWith('requested schedule') || lower.startsWith('new schedule')) {
      section = 'requested';
      continue;
    }
    if (lower.startsWith('---') || lower.startsWith('service:') || lower.startsWith('delivery address')) {
      section = null;
    }

    const dropMatch = line.match(/^(?:New\s+)?(?:Drop-off|Delivery)\s*:\s*(.+)$/i);
    const pickMatch = line.match(/^(?:New\s+)?(?:Pickup|Return|Pick-up)\s*:\s*(.+)$/i);

    if (dropMatch) {
      const value = dropMatch[1].trim();
      if (section === 'original' || (!section && !result.originalDropOff && !result.requestedDropOff)) {
        if (section === 'original') result.originalDropOff = value;
        else if (section === 'requested') result.requestedDropOff = value;
        else result.requestedDropOff = value; // structured "New drop-off"
      } else if (section === 'requested') {
        result.requestedDropOff = value;
      } else if (!result.requestedDropOff) {
        result.requestedDropOff = value;
      }
    }
    if (pickMatch) {
      const value = pickMatch[1].trim();
      if (section === 'original') {
        result.originalPickup = value;
      } else if (section === 'requested') {
        result.requestedPickup = value;
      } else if (!result.requestedPickup) {
        result.requestedPickup = value;
      }
    }
  }

  return result;
}

function splitFriendlyOrRawDateTime(value) {
  if (!value) return { date: null, time: null };
  // Already friendly like "Aug 2, 2026 at 6:00 AM"
  const friendly = value.match(/^(.+?)\s+at\s+(.+)$/i);
  if (friendly) {
    return { date: friendly[1].trim(), time: friendly[2].trim(), alreadyFriendly: true };
  }
  return { ...splitDateAndTime(value), alreadyFriendly: false };
}

/**
 * Parse a stored change-request note into structured display fields.
 * Works for both legacy computer-style notes and newer human-readable ones.
 */
export function parseChangeRequestNote(content) {
  if (!content || typeof content !== 'string') return null;

  const lines = content.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const bookingMatch = content.match(/booking\s*#?\s*(\d+)/i);
  const bookingId = bookingMatch ? bookingMatch[1] : null;

  const serviceRaw = extractField(lines, ['Service:']);
  let serviceFrom = null;
  let serviceTo = null;
  if (serviceRaw) {
    const arrowParts = serviceRaw.split(/\s*→\s*|\s*->\s*/);
    if (arrowParts.length >= 2) {
      serviceFrom = stripServiceId(arrowParts[0]);
      serviceTo = stripServiceId(arrowParts[1]);
    } else {
      serviceTo = stripServiceId(serviceRaw);
    }
  }

  const originalRange = parseDateRangeLine(extractField(lines, ['Original dates:', 'Original Dates:']));
  const requestedRange = parseDateRangeLine(extractField(lines, ['Requested dates:', 'Requested Dates:', 'New Dates:']));
  const sections = collectScheduleSections(lines);

  const origDrop = splitFriendlyOrRawDateTime(sections.originalDropOff);
  const origPick = splitFriendlyOrRawDateTime(sections.originalPickup);
  const reqDrop = splitFriendlyOrRawDateTime(sections.requestedDropOff);
  const reqPick = splitFriendlyOrRawDateTime(sections.requestedPickup);

  const deliveryAddress =
    extractField(lines, ['Delivery address:', 'Delivery Address:']) ||
    extractField(lines, ['Contact address:', 'Contact Address:']);

  const distance =
    extractField(lines, ['Distance:', 'Distance (miles):']);

  const originalAddons = extractField(lines, [
    'Original add-ons:',
    'Original Add-ons:',
    'Current add-ons:',
    'Current Add-ons:',
  ]);
  const requestedAddons = extractField(lines, ['Requested add-ons:', 'Requested Add-ons:']);
  const equipmentReturn = extractField(lines, ['Equipment to return:']);
  const equipmentAllocate = extractField(lines, ['Equipment to allocate:']);
  const equipmentUnchanged = extractField(lines, ['Unchanged equipment:']);

  const comments = extractField(lines, ['Customer comments:', 'Customer Comments:', 'Comments:']);

  const submittedRaw = extractField(lines, ['Submitted at:', 'Submitted:']);
  const addressFlagged = lines.some((l) => /manual verification|needs address verification/i.test(l));

  const emptyInventoryJson = (v) => !v || v === 'None' || v === '[]' || /^\[\]$/.test(v);
  const hasMeaningfulInventory =
    !emptyInventoryJson(equipmentReturn) ||
    !emptyInventoryJson(equipmentAllocate) ||
    !emptyInventoryJson(equipmentUnchanged);

  return {
    bookingId,
    needsSchedulingApproval: true,
    serviceFrom,
    serviceTo,
    originalDropOffDate: origDrop.alreadyFriendly ? origDrop.date : (origDrop.date || originalRange?.startDate || null),
    originalDropOffTime: origDrop.alreadyFriendly ? origDrop.time : (origDrop.time || originalRange?.startTime || null),
    originalPickupDate: origPick.alreadyFriendly ? origPick.date : (origPick.date || originalRange?.endDate || null),
    originalPickupTime: origPick.alreadyFriendly ? origPick.time : (origPick.time || originalRange?.endTime || null),
    requestedDropOffDate: reqDrop.alreadyFriendly ? reqDrop.date : (reqDrop.date || requestedRange?.startDate || null),
    requestedDropOffTime: reqDrop.alreadyFriendly ? reqDrop.time : (reqDrop.time || requestedRange?.startTime || null),
    requestedPickupDate: reqPick.alreadyFriendly ? reqPick.date : (reqPick.date || requestedRange?.endDate || null),
    requestedPickupTime: reqPick.alreadyFriendly ? reqPick.time : (reqPick.time || requestedRange?.endTime || null),
    // When already friendly, date field holds full "Aug 2, 2026" and time is separate —
    // formatFriendlyDateTime will join them. Pass through friendly strings as date with time.
    _friendlyOriginalDropOff: origDrop.alreadyFriendly ? sections.originalDropOff : null,
    _friendlyOriginalPickup: origPick.alreadyFriendly ? sections.originalPickup : null,
    _friendlyRequestedDropOff: reqDrop.alreadyFriendly ? sections.requestedDropOff : null,
    _friendlyRequestedPickup: reqPick.alreadyFriendly ? sections.requestedPickup : null,
    deliveryAddress: deliveryAddress
      ?.replace(/\s*\((pending manual verification|needs address verification)\)\s*$/i, '')
      .trim() || null,
    addressNeedsVerification:
      addressFlagged || /\(pending manual verification|needs address verification\)/i.test(deliveryAddress || ''),
    distance: distance ? distance.replace(/\s*miles?/i, '').trim() : null,
    originalAddons: originalAddons && originalAddons !== 'None' ? originalAddons : null,
    requestedAddons: requestedAddons && requestedAddons !== 'None' ? requestedAddons : null,
    equipmentReturn: hasMeaningfulInventory && !emptyInventoryJson(equipmentReturn) ? equipmentReturn : null,
    equipmentAllocate: hasMeaningfulInventory && !emptyInventoryJson(equipmentAllocate) ? equipmentAllocate : null,
    equipmentUnchanged: hasMeaningfulInventory && !emptyInventoryJson(equipmentUnchanged) ? equipmentUnchanged : null,
    comments,
    submittedAt: submittedRaw,
  };
}

/**
 * Build a clean, human-readable reason string for new reschedule requests.
 * Chronological order: drop-off (delivery) first, then pickup.
 */
export function buildFriendlyRescheduleReason({
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
  const formatAddonList = (addons) => {
    if (!Array.isArray(addons) || addons.length === 0) return 'None';
    return addons
      .map((a) => {
        const name = a?.name || 'Add-on';
        const qty = Number(a?.quantity || 1);
        return `${name} (qty ${qty})`;
      })
      .join(', ');
  };

  const lines = [
    `Reschedule request for booking #${bookingId}.`,
    `Needs scheduling approval.`,
    '',
    `Service: ${originalService?.name || 'Original'} → ${newService?.name || 'New'}`,
    '',
    'Current schedule:',
    `Drop-off: ${formatFriendlyDateTime(originalBooking?.drop_off_date, originalBooking?.drop_off_time_slot) || 'N/A'}`,
    `Pickup: ${formatFriendlyDateTime(originalBooking?.pickup_date, originalBooking?.pickup_time_slot) || 'N/A'}`,
    '',
    'Requested schedule:',
    `Drop-off: ${formatFriendlyDateTime(newDropOffDate, newDropOffTime) || 'N/A'}`,
    `Pickup: ${formatFriendlyDateTime(newPickupDate, newPickupTime) || 'N/A'}`,
  ];

  if (verifiedAddress) {
    lines.push(
      '',
      `Delivery address: ${verifiedAddress}${isManualAddress ? ' (needs address verification)' : ''}`
    );
    if (distanceMiles != null && distanceMiles !== '') {
      lines.push(`Distance: ${distanceMiles} miles`);
    }
  }

  lines.push('', `Current add-ons: ${formatAddonList(originalAddonsList)}`);
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

function formatAddonListForChat(addons) {
  if (!Array.isArray(addons) || addons.length === 0) return 'None';
  return addons
    .map((a) => {
      const name = a?.name || 'Add-on';
      const qty = Number(a?.quantity || 1);
      return `${name} (qty ${qty})`;
    })
    .join(', ');
}

function addonListsEqual(a, b) {
  const normalize = (list) =>
    (Array.isArray(list) ? list : [])
      .map((item) => `${item?.id ?? item?.name ?? ''}:${Number(item?.quantity || 1)}`)
      .sort()
      .join('|');
  return normalize(a) === normalize(b);
}

/**
 * Build a professional Direct Chat summary for a customer reschedule request.
 * Always shows current vs requested schedules; only appends changed details.
 */
export function buildRescheduleRequestChatMessage({
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
  originalAddress,
  newAddress,
  addressChanged = false,
  isManualAddress = false,
  comments,
}) {
  const lines = [
    `Reschedule request for Booking #${bookingId}`,
    'Status: Pending scheduling approval',
    '',
    'CURRENT SCHEDULE',
    `Drop-off: ${formatFriendlyDateTime(originalBooking?.drop_off_date, originalBooking?.drop_off_time_slot) || 'N/A'}`,
    `Pickup:   ${formatFriendlyDateTime(originalBooking?.pickup_date, originalBooking?.pickup_time_slot) || 'N/A'}`,
    '',
    'REQUESTED SCHEDULE',
    `Drop-off: ${formatFriendlyDateTime(newDropOffDate, newDropOffTime) || 'N/A'}`,
    `Pickup:   ${formatFriendlyDateTime(newPickupDate, newPickupTime) || 'N/A'}`,
  ];

  const fromService = originalService?.name || null;
  const toService = newService?.name || null;
  if (fromService && toService && fromService !== toService) {
    lines.push('', `Service: ${fromService} → ${toService}`);
  } else if (toService && !fromService) {
    lines.push('', `Service: ${toService}`);
  }

  if (addressChanged) {
    const fromAddr = (originalAddress || '').trim() || 'N/A';
    const toAddr = (newAddress || '').trim() || 'N/A';
    const toSuffix = isManualAddress ? ' (needs address verification)' : '';
    lines.push('', 'Delivery address:', `  From: ${fromAddr}`, `  To: ${toAddr}${toSuffix}`);
  }

  if (!addonListsEqual(originalAddonsList, selectedAddonsList)) {
    lines.push(
      '',
      `Add-ons: ${formatAddonListForChat(originalAddonsList)} → ${formatAddonListForChat(selectedAddonsList)}`
    );
  }

  const trimmedComments = (comments || '').trim();
  if (trimmedComments) {
    lines.push('', `Comments: ${trimmedComments}`);
  }

  return lines.join('\n').trim();
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
