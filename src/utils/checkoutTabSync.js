const CHANNEL_NAME = 'ufill-checkout-sync';
const STORAGE_KEY = 'ufill_checkout_sync_event';
export const CHECKOUT_COMPLETED_KEY = 'ufill_checkout_completed';

/**
 * Cross-tab checkout events: email verified or payment completed.
 * BroadcastChannel is primary; localStorage is the fallback for older browsers.
 */

export function readCheckoutCompletedRecord() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(CHECKOUT_COMPLETED_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
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
  if (!pendingId && !bookingId) return true;
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

export function subscribeCheckoutSyncEvents(handler, options) {
  const pendingId = options && options.pendingId ? options.pendingId : null;
  if (typeof window === 'undefined' || typeof handler !== 'function') {
    return function unsubscribeNoop() {};
  }

  var channel = null;
  function deliver(event) {
    if (!event || typeof event !== 'object') return;
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
