/** Equipment IDs that are rented and must be returned / dispositioned. */
export const RENTAL_EQUIPMENT_IDS = new Set([1, 2]);

/** Equipment IDs that are purchased (not inventory-returned). */
export const PURCHASE_EQUIPMENT_IDS = new Set([3]);

/** Equipment IDs that are one-way disposal services (not returned). */
export const DISPOSAL_EQUIPMENT_IDS = new Set([4, 5, 6]);

/** Friendly checkout labels keyed by equipment id or addon string id. */
export const EQUIPMENT_FRIENDLY_LABELS = {
  1: 'Wheelbarrow',
  2: 'Hand Truck',
  3: 'Working Gloves (Pair)',
  4: 'Mattress Disposal',
  5: 'TV Disposal',
  6: 'Appliance Disposal',
  wheelbarrow: 'Wheelbarrow',
  handTruck: 'Hand Truck',
  gloves: 'Working Gloves (Pair)',
  mattress: 'Mattress Disposal',
  tv: 'TV Disposal',
  appliance: 'Appliance Disposal',
};

/** DB / catalog names that map to rental ids (for return_issues lookup). */
const EQUIPMENT_NAME_ALIASES = {
  1: ['Wheelbarrow', 'Gorilla Heavy-Duty Dump Cart'],
  2: ['Hand Truck', '3-in-1 Convertible Hand Truck'],
  3: ['Working Gloves (Pair)', 'Gloves'],
};

export function isRentalEquipmentId(id) {
  const n = Number(id);
  return Number.isFinite(n) && RENTAL_EQUIPMENT_IDS.has(n);
}

export function isPurchaseEquipmentId(id) {
  const n = Number(id);
  return Number.isFinite(n) && PURCHASE_EQUIPMENT_IDS.has(n);
}

export function isDisposalEquipmentId(id) {
  const n = Number(id);
  return Number.isFinite(n) && DISPOSAL_EQUIPMENT_IDS.has(n);
}

export function resolveEquipmentId(item = {}) {
  const raw = item.equipment_id ?? item.dbId ?? item.equipment?.id ?? item.id;
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) return n;
  if (typeof raw === 'string') {
    const slug = raw.toLowerCase().replace(/[\s_-]/g, '');
    if (slug === 'wheelbarrow') return 1;
    if (slug === 'handtruck') return 2;
    if (slug === 'gloves') return 3;
    if (slug === 'mattress' || slug === 'mattressdisposal') return 4;
    if (slug === 'tv' || slug === 'tvdisposal') return 5;
    if (slug === 'appliance' || slug === 'appliancedisposal') return 6;
  }
  return null;
}

export function formatReturnIssueStatus(status) {
  if (!status) return 'Unknown';
  if (status === 'lost_stolen') return 'Lost / stolen (not returned)';
  if (status === 'damaged') return 'Damaged (not restocked)';
  if (status === 'not_returned_fee_charged') return 'Not returned (fee charged)';
  if (status === 'not_returned') return 'Not returned';
  if (status === 'not_clean') return 'Not cleaned';
  return String(status).replace(/_/g, ' ');
}

/**
 * Find a return_issues entry for an equipment item by DB name, friendly label, or aliases.
 */
export function findReturnIssueForEquipment({
  equipmentId,
  equipmentName,
  friendlyName,
  returnIssues,
} = {}) {
  if (!returnIssues || typeof returnIssues !== 'object') return null;

  const candidates = new Set();
  if (equipmentName) candidates.add(String(equipmentName));
  if (friendlyName) candidates.add(String(friendlyName));

  const id = Number(equipmentId);
  if (Number.isFinite(id) && EQUIPMENT_FRIENDLY_LABELS[id]) {
    candidates.add(EQUIPMENT_FRIENDLY_LABELS[id]);
  }
  for (const alias of EQUIPMENT_NAME_ALIASES[id] || []) {
    candidates.add(alias);
  }

  for (const key of candidates) {
    if (key && returnIssues[key]) return returnIssues[key];
  }
  return null;
}

/**
 * @returns {{ kind: 'issue'|'returned'|'pending', label: string, tone: 'red'|'green'|'orange' }}
 */
export function getEquipmentReturnDisplay({
  equipmentId,
  equipmentName,
  friendlyName,
  returnedAt,
  returnIssues,
  bookingStatus,
} = {}) {
  const issue = findReturnIssueForEquipment({
    equipmentId,
    equipmentName,
    friendlyName,
    returnIssues,
  });

  if (issue?.status) {
    return {
      kind: 'issue',
      label: formatReturnIssueStatus(issue.status),
      tone: 'red',
      status: issue.status,
    };
  }

  if (returnedAt) {
    return { kind: 'returned', label: 'Returned', tone: 'green', status: 'returned' };
  }

  const status = String(bookingStatus || '');
  if (status === 'Completed' || status === 'flagged') {
    // Checklist finalized with no issue and no returned_at still means good return for history.
    return { kind: 'returned', label: 'Returned', tone: 'green', status: 'returned' };
  }

  return { kind: 'pending', label: 'Pending return', tone: 'orange', status: 'pending' };
}

export function splitBookingEquipmentRows(rows = []) {
  const rentals = [];
  const purchases = [];
  for (const row of rows || []) {
    const id = resolveEquipmentId(row);
    if (isPurchaseEquipmentId(id)) purchases.push(row);
    else if (isRentalEquipmentId(id)) rentals.push(row);
  }
  return { rentals, purchases };
}

export function splitAddonEquipmentList(addonEquipment = []) {
  const rentals = [];
  const purchases = [];
  for (const item of addonEquipment || []) {
    const id = resolveEquipmentId(item);
    if (isPurchaseEquipmentId(id)) purchases.push(item);
    else if (isRentalEquipmentId(id)) rentals.push(item);
  }
  return { rentals, purchases };
}

function addonEquipmentDisplayName(item, equipmentId) {
  return (
    item?.name ||
    item?.label ||
    EQUIPMENT_FRIENDLY_LABELS[equipmentId] ||
    EQUIPMENT_FRIENDLY_LABELS[item?.id] ||
    (equipmentId != null ? `Equipment #${equipmentId}` : 'Add-on')
  );
}

function classifyBookingAddonEquipment(item) {
  const equipmentId = resolveEquipmentId(item);
  const type = String(item?.type || '').toLowerCase();
  const name = addonEquipmentDisplayName(item, equipmentId);
  const quantity = Math.max(1, Number(item?.quantity || 1) || 1);
  const key = `eq-${equipmentId ?? item?.id ?? name}`;

  if (isRentalEquipmentId(equipmentId) || type === 'rental') {
    return { key, name, quantity, returnable: true, kind: 'rental' };
  }
  if (isPurchaseEquipmentId(equipmentId) || type === 'purchase' || type === 'consumable') {
    return { key, name, quantity, returnable: false, kind: 'purchase' };
  }
  if (isDisposalEquipmentId(equipmentId) || type === 'service' || type === 'disposal') {
    return { key, name, quantity, returnable: false, kind: 'disposal' };
  }

  return { key, name, quantity, returnable: false, kind: 'other' };
}

/**
 * Flatten booking.addons into display rows for admin rental detail.
 * @returns {Array<{ key: string, name: string, quantity: number, returnable: boolean, kind: string }>}
 */
export function listBookingAddonItems(booking) {
  const addons = booking?.addons && typeof booking.addons === 'object' ? booking.addons : {};
  const items = [];

  if (addons.insurance === 'accept') {
    items.push({
      key: 'insurance',
      name: 'Premium Insurance (HPP)',
      quantity: 1,
      returnable: false,
      kind: 'protection',
    });
  }

  if (addons.drivewayProtection === 'accept') {
    items.push({
      key: 'driveway',
      name: 'Driveway Protection',
      quantity: 1,
      returnable: false,
      kind: 'protection',
    });
  }

  const equipment = Array.isArray(addons.equipment) ? addons.equipment : [];
  for (const item of equipment) {
    if (!item) continue;
    items.push(classifyBookingAddonEquipment(item));
  }

  return items;
}

/** Booking statuses that do not count as physically holding rental equipment. */
export const NON_LIVE_RENTAL_BOOKING_STATUSES = new Set([
  'Cancelled',
  'Rescheduled',
  'pending_payment',
  'booking_not_finished',
]);

/**
 * True when a booking still holds rental equipment out in the field
 * (or awaiting checklist return). Rows with returned_at set are filtered separately.
 */
export function isLiveRentalBookingStatus(status) {
  if (!status) return false;
  return !NON_LIVE_RENTAL_BOOKING_STATUSES.has(String(status));
}

/**
 * Group open booking_equipment rows by equipment_id for inventory display.
 * Expects rows shaped like:
 * { equipment_id, quantity, returned_at, booking_id, bookings: { ... customers } }
 */
export function groupLiveEquipmentAssignments(rows = []) {
  const byEquipmentId = new Map();

  for (const row of rows || []) {
    if (row.returned_at) continue;
    const booking = row.bookings || row.booking || null;
    if (!booking || !isLiveRentalBookingStatus(booking.status)) continue;

    const equipmentId = Number(row.equipment_id);
    if (!Number.isFinite(equipmentId) || equipmentId <= 0) continue;

    const list = byEquipmentId.get(equipmentId) || [];
    list.push({
      bookingEquipmentId: row.id,
      equipmentId,
      quantity: Number(row.quantity || 1) || 1,
      bookingId: booking.id || row.booking_id,
      bookingStatus: booking.status,
      customerId: booking.customer_id || booking.customers?.id || null,
      customerName: booking.customers?.name || booking.name || 'Unknown customer',
      plan: booking.plan || null,
      dropOffDate: booking.drop_off_date || null,
      pickupDate: booking.pickup_date || null,
      returnIssues: booking.return_issues || null,
      equipmentName: row.equipment?.name || null,
    });
    byEquipmentId.set(equipmentId, list);
  }

  return byEquipmentId;
}
