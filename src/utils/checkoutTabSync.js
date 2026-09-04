const CHANNEL_NAME = 'ufill-checkout-sync';
const STORAGE_KEY = 'ufill_checkout_sync_event';
const TAB_ID_KEY = 'ufill_checkout_tab_id';
export const CHECKOUT_COMPLETED_KEY = 'ufill_checkout_completed';
/** Ignore completed markers older than this so a long-lived tab cannot be haunted. */
const CHECKOUT_COMPLETED_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * Cross-tab checkout events: email verified, payment completed, or another tab
 * claiming the checkout. BroadcastChannel is primary; localStorage is the
 * fallback for older browsers.
 */

let cachedTabId = null;

/** Stable id for this tab, so a tab never reacts to its own broadcast. */
export function getCheckoutTabId() {
  if (cachedTabId) return cachedTabId;
  if (typeof window === 'undefined') return null;

  try {
    const stored = window.sessionStorage.getItem(TAB_ID_KEY);
    if (stored) {
      cachedTabId = stored;
      return cachedTabId;
    }
  } catch {
    // sessionStorage unavailable — fall through to an in-memory id
  }

  const generated =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  cachedTabId = generated;
  try {
    window.sessionStorage.setItem(TAB_ID_KEY, generated);
  } catch {
    // ignore
  }
  return cachedTabId;
}

export function readCheckoutCompletedRecord() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(CHECKOUT_COMPLETED_KEY);
    if (!raw) return null;
    const record = JSON.parse(raw);
    if (!record || typeof record !== 'object') return null;
    const at = typeof record.at === 'number' ? record.at : 0;
    if (!at || Date.now() - at > CHECKOUT_COMPLETED_TTL_MS) {
      clearCheckoutCompletedElsewhere();
      return null;
    }
    return record;
  } catch (err) {
    return null;
  }
}

export function markCheckoutCompletedElsewhere(options) {
  const pendingId = options && options.pendingId ? options.pendingId : null;
  const bookingId = options && options.bookingId != null ? options.bookingId : null;
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(
      CHECKOUT_COMPLETED_KEY,
      JSON.stringify({
        pendingId: pendingId || null,
        bookingId: bookingId || null,
        at: Date.now(),
      }),
    );
  } catch (err) {
    // ignore
  }
}

export function isCheckoutCompletedElsewhere(options) {
  const pendingId = options && options.pendingId ? options.pendingId : null;
  const bookingId = options && options.bookingId != null ? options.bookingId : null;
  const record = readCheckoutCompletedRecord();
  if (!record) return false;
  if (pendingId && record.pendingId === pendingId) return true;
  if (
    bookingId != null &&
    record.bookingId != null &&
    Number(bookingId) === Number(record.bookingId)
  ) {
    return true;
  }
  // No ids supplied — nothing to match; do not treat any leftover record as a hit.
  if (!pendingId && !bookingId) return false;
  return false;
}

export function clearCheckoutCompletedElsewhere() {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(CHECKOUT_COMPLETED_KEY);
  } catch (err) {
    // ignore
  }
}

export function publishCheckoutSyncEvent(options) {
  const type = options && options.type ? options.type : null;
  const pendingId = options && options.pendingId ? options.pendingId : null;
  const bookingId = options && options.bookingId != null ? options.bookingId : null;
  if (typeof window === 'undefined') return;
  if (!type) return;

  const payload = {
    type: type,
    pendingId: pendingId || null,
    bookingId: bookingId ? Number(bookingId) : null,
    email: options && options.email ? String(options.email).toLowerCase() : null,
    tabId: getCheckoutTabId(),
    at: Date.now(),
  };

  try {
    const channel = new BroadcastChannel(CHANNEL_NAME);
    channel.postMessage(payload);
    channel.close();
  } catch (err) {
    // BroadcastChannel unavailable
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (err) {
    // ignore
  }

  if (type === 'completed' || type === 'paid') {
    markCheckoutCompletedElsewhere({
      pendingId: payload.pendingId,
      bookingId: payload.bookingId,
    });
  }
}

/**
 * Announce that this tab has taken over the checkout (legacy helper).
 * Verify-email no longer uses this — Option B keeps the original tab primary.
 */
export function publishCheckoutTabClaim(options) {
  const pendingId = options && options.pendingId ? options.pendingId : null;
  publishCheckoutSyncEvent({ type: 'tab_claimed', pendingId: pendingId });
}

export function subscribeCheckoutSyncEvents(handler, options) {
  const pendingId = options && options.pendingId ? options.pendingId : null;
  if (typeof window === 'undefined' || typeof handler !== 'function') {
    return function unsubscribeNoop() {};
  }

  var channel = null;
  function deliver(event) {
    if (!event || typeof event !== 'object') return;
    if (event.tabId && event.tabId === getCheckoutTabId()) return;
    if (pendingId && event.pendingId && event.pendingId !== pendingId) return;
    handler(event);
  }

  try {
    channel = new BroadcastChannel(CHANNEL_NAME);
    channel.onmessage = function onMessage(msg) {
      deliver(msg.data);
    };
  } catch (err) {
    channel = null;
  }

  function onStorage(evt) {
    if (evt.key !== STORAGE_KEY || !evt.newValue) return;
    try {
      deliver(JSON.parse(evt.newValue));
    } catch (parseErr) {
      // ignore
    }
  }
  window.addEventListener('storage', onStorage);

  return function unsubscribe() {
    try {
      if (channel) channel.close();
    } catch (err) {
      // ignore
    }
    window.removeEventListener('storage', onStorage);
  };
}
