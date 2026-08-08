/**
 * Normalize an address from an object, string, or booking-like record
 * into a consistent { street, city, state, zip, formatted_address } shape.
 */
export function normalizeAddress(input) {
  if (!input) return null;

  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!trimmed) return null;
    const parsed = parseAddressString(trimmed);
    return {
      street: parsed.street || trimmed,
      city: parsed.city || '',
      state: parsed.state || '',
      zip: parsed.zip || '',
      formatted_address: trimmed,
    };
  }

  if (typeof input !== 'object') return null;

  const street = (input.street || '').trim();
  const city = (input.city || '').trim();
  const state = (input.state || '').trim();
  const zip = (input.zip || '').trim();
  const formatted =
    (input.formatted_address || '').trim() ||
    formatAddressParts(street, city, state, zip);

  if (!street && !formatted) return null;

  return {
    street: street || formatted,
    city,
    state,
    zip,
    formatted_address: formatted,
    ...(input.isVerified != null ? { isVerified: Boolean(input.isVerified) } : {}),
  };
}

export function formatAddressParts(street, city, state, zip) {
  const line1 = (street || '').trim();
  const line2 = [city, state].filter(Boolean).join(', ');
  const withZip = [line2, (zip || '').trim()].filter(Boolean).join(' ');
  return [line1, withZip].filter(Boolean).join(', ');
}

export function formatAddressDisplay(address) {
  const normalized = normalizeAddress(address);
  return normalized?.formatted_address || '';
}

/** Compare two addresses by normalized formatted string (case-insensitive). */
export function addressesAreEqual(a, b) {
  const left = formatAddressDisplay(a).toLowerCase().replace(/\s+/g, ' ').trim();
  const right = formatAddressDisplay(b).toLowerCase().replace(/\s+/g, ' ').trim();
  if (!left || !right) return false;
  return left === right;
}

/**
 * Best-effort parse of "street, city, state zip" strings.
 * Falls back to putting the whole string in street if parsing fails.
 */
export function parseAddressString(full) {
  const trimmed = (full || '').trim();
  if (!trimmed) return { street: '', city: '', state: '', zip: '' };

  const parts = trimmed.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 3) {
    const street = parts[0];
    const city = parts[1];
    const stateZip = parts.slice(2).join(' ').trim();
    const match = stateZip.match(/^([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/);
    if (match) {
      return { street, city, state: match[1].toUpperCase(), zip: match[2] };
    }
    const loose = stateZip.match(/^([A-Za-z]{2})\s*(.*)$/);
    if (loose) {
      return { street, city, state: loose[1].toUpperCase(), zip: (loose[2] || '').trim() };
    }
    return { street, city, state: stateZip, zip: '' };
  }

  if (parts.length === 2) {
    const street = parts[0];
    const rest = parts[1];
    const match = rest.match(/^(.+?)\s+([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/);
    if (match) {
      return { street, city: match[1].trim(), state: match[2].toUpperCase(), zip: match[3] };
    }
    return { street, city: rest, state: '', zip: '' };
  }

  return { street: trimmed, city: '', state: '', zip: '' };
}

/** Latest pending address_change entry from bookings.reschedule_history */
export function getPendingAddressChange(rescheduleHistory) {
  if (!Array.isArray(rescheduleHistory)) return null;
  for (let i = rescheduleHistory.length - 1; i >= 0; i -= 1) {
    const entry = rescheduleHistory[i];
    if (entry?.type === 'address_change' && entry?.status === 'pending') {
      return entry;
    }
  }
  return null;
}

/** Mark pending address_change entries as approved in a history array copy */
export function markAddressChangesApproved(rescheduleHistory, approvedAt = new Date().toISOString()) {
  if (!Array.isArray(rescheduleHistory)) return [];
  return rescheduleHistory.map((entry) => {
    if (entry?.type === 'address_change' && entry?.status === 'pending') {
      return { ...entry, status: 'approved', approved_at: approvedAt };
    }
    return entry;
  });
}
