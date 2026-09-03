import { supabase, supabaseUrl, supabaseAnonKey } from '@/lib/customSupabaseClient';
import {
  getRememberedPaymentHoldBookingId,
  clearRememberedPaymentEquipmentHold,
} from '@/utils/pendingBookingEquipmentHold';
import { isCheckoutCompletedElsewhere, markCheckoutCompletedElsewhere } from '@/utils/checkoutTabSync';

export const PAYMENT_IN_FLIGHT_KEY = 'ufill_payment_in_flight';
export const IDLE_PROMPT_FLAG_KEY = 'ufill_idle_prompt_shown';
export const TEARDOWN_DONE_KEY = 'ufill_checkout_teardown_done';
export const BOOKING_FLOW_STORAGE_KEY = 'ufill_booking_flow';

const CHECKOUT_TOKEN_PATHS = ['/verify-email', '/payment'];

function readUrlCheckoutToken() {
  if (typeof window === 'undefined') return null;
  const path = window.location.pathname;
  if (!CHECKOUT_TOKEN_PATHS.some((p) => path.startsWith(p))) return null;
  const params = new URLSearchParams(window.location.search);
  return params.get('token') || params.get('bookingId') || null;
}

function readStoredFlowMeta() {
  try {
    const raw = sessionStorage.getItem(BOOKING_FLOW_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function readStoredPendingToken() {
  return readStoredFlowMeta()?.pendingToken || null;
}

function readStoredFlowStep() {
  return Number(readStoredFlowMeta()?.currentStep) || 0;
}

/**
 * Resolve checkout IDs from flow meta, sessionStorage, and URL (verify-email / payment).
 */
export function resolveCheckoutContext({ pendingToken = null, flowMeta = null } = {}) {
  const bookingId = getRememberedPaymentHoldBookingId() || null;
  const urlToken = readUrlCheckoutToken();
  const pendingId =
    pendingToken ||
    flowMeta?.pendingToken ||
    readStoredPendingToken() ||
    urlToken ||
    null;

  const currentStep = Number(flowMeta?.currentStep) || readStoredFlowStep();
  const storedActive = Boolean(readStoredFlowMeta()?.isActive && readStoredFlowStep() > 0);
  const onTokenRoute = Boolean(urlToken);

  const isProtectedCheckout =
    currentStep >= 5 || Boolean(pendingId) || Boolean(bookingId) || onTokenRoute;

  const isInCheckoutFlow =
    (flowMeta?.isActive && flowMeta?.currentStep > 0) || onTokenRoute || storedActive;

  return {
    bookingId,
    pendingId,
    currentStep,
    isProtectedCheckout,
    isInCheckoutFlow,
  };
}

function isOnPaymentRoute() {
  if (typeof window === 'undefined') return false;
  return window.location.pathname.startsWith('/payment');
}

/**
 * Resolve booking/pending IDs for teardown invokes.
 * Steps 5–8 usually have only pendingId; omit stale payment-hold bookingId so
 * end-unfinished-checkout promotes from pending instead of finalizing the wrong row.
 */
export function resolveTeardownTarget({ pendingToken = null, flowMeta = null, reason = 'left_early' } = {}) {
  const ctx = resolveCheckoutContext({ pendingToken, flowMeta });
  const pendingId = ctx.pendingId;
  const rememberedHoldId = getRememberedPaymentHoldBookingId();
  const onPaymentRoute = isOnPaymentRoute();

  let bookingId = null;

  if (rememberedHoldId) {
    if (onPaymentRoute || ctx.currentStep >= 9) {
      bookingId = rememberedHoldId;
    } else if (!pendingId) {
      bookingId = rememberedHoldId;
    }
  }

  void reason; // reserved for future reason-specific targeting

  return {
    bookingId,
    pendingId,
    currentStep: ctx.currentStep,
    isProtectedCheckout: ctx.isProtectedCheckout,
    isInCheckoutFlow: ctx.isInCheckoutFlow,
  };
}

function readTeardownDoneRecord() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(TEARDOWN_DONE_KEY);
    if (!raw) return null;
    if (raw === '1') return { legacy: true, reason: 'left_early' };
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function getEndUnfinishedCheckoutUrl() {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}/functions/v1/end-unfinished-checkout`;
  }
  return `${supabaseUrl}/functions/v1/end-unfinished-checkout`;
}

function parseTeardownResult(data, error, bookingId) {
  if (error) {
    return {
      success: false,
      error: error.message || String(error),
      bookingId,
      emailSent: false,
      crmUpdated: false,
    };
  }

  if (data?.ok === false) {
    return {
      success: false,
      error: data.error || 'Teardown failed',
      bookingId: data?.booking_id || bookingId,
      emailSent: false,
      crmUpdated: false,
      data,
    };
  }

  const emailSent = Boolean(data?.email_sent);
  const crmUpdated = Boolean(data?.abandoned_checkout_id);
  const skipped = Boolean(
    data?.skipped ||
      data?.skip_email ||
      data?.skipped_reason === 'already_converted' ||
      data?.email_skipped === 'already_converted',
  );
  const emailSkipped = Boolean(data?.email_skipped);

  return {
    success: true,
    emailSent,
    crmUpdated,
    skipped,
    emailSkipped,
    skippedReason: data?.skipped_reason || (skipped ? data?.email_skipped : null) || null,
    convertedBookingId: data?.converted_booking_id || null,
    bookingId: data?.booking_id || bookingId,
    warning: !emailSent && !skipped && !emailSkipped ? 'email_not_sent' : null,
    data,
  };
}

export function markCheckoutTeardownDone({
  reason = 'left_early',
  bookingId = null,
  pendingId = null,
} = {}) {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(
      TEARDOWN_DONE_KEY,
      JSON.stringify({
        reason,
        bookingId: bookingId || null,
        pendingId: pendingId || null,
        at: Date.now(),
      }),
    );
  } catch {
    // ignore
  }
}

export function isCheckoutTeardownDone({
  reason = 'left_early',
  bookingId = null,
  pendingId = null,
} = {}) {
  const record = readTeardownDoneRecord();
  if (!record) return false;

  if (record.reason === 'converted') {
    return true;
  }

  if ((reason === 'reminded' || reason === 'expired') && record.reason === 'left_early') {
    return false;
  }

  if (record.legacy) {
    return reason === 'left_early';
  }

  if (record.reason !== reason) return false;

  const sameBooking =
    bookingId != null &&
    record.bookingId != null &&
    Number(bookingId) === Number(record.bookingId);
  const samePending =
    pendingId != null && record.pendingId != null && pendingId === record.pendingId;

  return sameBooking || samePending;
}

export function clearCheckoutTeardownDone() {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(TEARDOWN_DONE_KEY);
  } catch {
    // ignore
  }
}

export const IDLE_MS = 10 * 60 * 1000;
export const COUNTDOWN_MS = 5 * 60 * 1000;
export const MORE_TIME_MS = 5 * 60 * 1000;
export const CEILING_MS = 30 * 60 * 1000;
export const HEARTBEAT_MS = 60 * 1000;

export function setPaymentInFlight(active) {
  if (typeof window === 'undefined') return;
  try {
    if (active) {
      window.sessionStorage.setItem(PAYMENT_IN_FLIGHT_KEY, '1');
    } else {
      window.sessionStorage.removeItem(PAYMENT_IN_FLIGHT_KEY);
    }
  } catch {
    // ignore
  }
}

export function isPaymentInFlight() {
  if (typeof window === 'undefined') return false;
  try {
    return window.sessionStorage.getItem(PAYMENT_IN_FLIGHT_KEY) === '1';
  } catch {
    return false;
  }
}

export function markIdlePromptShownLocal() {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(IDLE_PROMPT_FLAG_KEY, '1');
  } catch {
    // ignore
  }
}

export function wasIdlePromptShownLocal() {
  if (typeof window === 'undefined') return false;
  try {
    return window.sessionStorage.getItem(IDLE_PROMPT_FLAG_KEY) === '1';
  } catch {
    return false;
  }
}

export function clearIdlePromptShownLocal() {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(IDLE_PROMPT_FLAG_KEY);
  } catch {
    // ignore
  }
}

/**
 * Persist idle_prompt_shown on the booking addons so finalize-booking can mark converted.
 */
export async function markIdlePromptShownOnBooking(bookingId) {
  const id = Number(bookingId);
  if (!Number.isFinite(id) || id <= 0) return { success: false };

  markIdlePromptShownLocal();

  const { data: booking, error } = await supabase
    .from('bookings')
    .select('id, addons, status')
    .eq('id', id)
    .maybeSingle();

  if (error || !booking) return { success: false, error: error?.message };
  if (String(booking.status) !== 'pending_payment') return { success: true, skipped: true };
  if (booking.addons?.idle_prompt_shown === true) return { success: true, skipped: true };

  const { error: updateError } = await supabase
    .from('bookings')
    .update({
      addons: {
        ...(booking.addons || {}),
        idle_prompt_shown: true,
      },
    })
    .eq('id', id);

  if (updateError) return { success: false, error: updateError.message };
  return { success: true };
}

export async function touchCheckoutPresence({ bookingId = null, pendingId = null } = {}) {
  const payload = {
    p_booking_id: bookingId ? Number(bookingId) : null,
    p_pending_id: pendingId || null,
  };
  if (!payload.p_booking_id && !payload.p_pending_id) {
    return { success: false, skipped: true };
  }

  try {
    const { data, error } = await supabase.rpc('touch_checkout_presence', payload);
    if (error) {
      console.warn('[touchCheckoutPresence]', error.message);
      return { success: false, error: error.message };
    }
    return { success: true, data };
  } catch (err) {
    console.warn('[touchCheckoutPresence] exception:', err);
    return { success: false, error: err?.message || String(err) };
  }
}

/**
 * Fire-and-forget teardown. Uses keepalive fetch so it works during pagehide.
 */
export function beaconEndUnfinishedCheckout({
  bookingId = null,
  pendingId = null,
  reason = 'left_early',
  siteUrl = null,
  flowMeta = null,
} = {}) {
  const target = resolveTeardownTarget({
    pendingToken: pendingId,
    flowMeta,
    reason,
  });
  const id = bookingId ? Number(bookingId) : target.bookingId;
  const pending = pendingId || target.pendingId;

  if (
    isCheckoutCompletedElsewhere({ bookingId: id, pendingId: pending }) ||
    isCheckoutTeardownDone({
      reason,
      bookingId: id,
      pendingId: pending,
    })
  ) {
    return { success: true, skipped: true };
  }

  const body = {
    bookingId: Number.isFinite(Number(id)) && Number(id) > 0 ? Number(id) : null,
    pendingId: pending || null,
    reason,
    siteUrl: siteUrl || (typeof window !== 'undefined' ? window.location.origin : null),
  };

  if (!body.bookingId && !body.pendingId) {
    return { success: false, skipped: true };
  }

  const url = getEndUnfinishedCheckoutUrl();

  try {
    void fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${supabaseAnonKey}`,
      },
      body: JSON.stringify(body),
      keepalive: true,
    })
      .then(async (res) => {
        if (res.ok) {
          markCheckoutTeardownDone({
            reason,
            bookingId: body.bookingId,
            pendingId: body.pendingId,
          });
          clearRememberedPaymentEquipmentHold();
        } else {
          console.warn('[beaconEndUnfinishedCheckout] non-ok response:', res.status);
        }
      })
      .catch((err) => {
        console.warn('[beaconEndUnfinishedCheckout] fetch failed:', err);
      });
    return { success: true, beamed: true };
  } catch (err) {
    console.warn('[beaconEndUnfinishedCheckout] exception:', err);
    return { success: false, error: err?.message || String(err) };
  }
}

/**
 * Awaitable invoke for in-app teardown (idle countdown / leave dialog).
 */
export async function endUnfinishedCheckout({
  bookingId = null,
  pendingId = null,
  reason = 'left_early',
  siteUrl = null,
  flowMeta = null,
} = {}) {
  const target = resolveTeardownTarget({
    pendingToken: pendingId,
    flowMeta,
    reason,
  });
  const id = bookingId || target.bookingId;
  const pending = pendingId || target.pendingId;

  if (
    isCheckoutCompletedElsewhere({ bookingId: id, pendingId: pending }) ||
    isCheckoutTeardownDone({
      reason,
      bookingId: id,
      pendingId: pending,
    })
  ) {
    return { success: true, skipped: true, emailSent: false, crmUpdated: false, reason };
  }

  const body = {
    bookingId: Number.isFinite(Number(id)) && Number(id) > 0 ? Number(id) : null,
    pendingId: pending || null,
    reason,
    siteUrl: siteUrl || (typeof window !== 'undefined' ? window.location.origin : null),
  };

  if (!body.bookingId && !body.pendingId) {
    return { success: false, skipped: true, emailSent: false, crmUpdated: false, reason };
  }

  try {
    const { data, error } = await supabase.functions.invoke('end-unfinished-checkout', { body });
    const result = {
      ...parseTeardownResult(data, error, body.bookingId),
      reason,
    };

    if (result.success) {
      const converted = result.skippedReason === 'already_converted';
      markCheckoutTeardownDone({
        reason: converted ? 'converted' : reason,
        bookingId: result.convertedBookingId || result.bookingId || body.bookingId,
        pendingId: body.pendingId,
      });
      if (converted) {
        markCheckoutCompletedElsewhere({
          pendingId: body.pendingId,
          bookingId: result.convertedBookingId || result.bookingId,
        });
      }
      clearRememberedPaymentEquipmentHold();
    }

    return result;
  } catch (err) {
    console.warn('[endUnfinishedCheckout] exception:', err);
    return {
      success: false,
      error: err?.message || String(err),
      bookingId: body.bookingId,
      emailSent: false,
      crmUpdated: false,
      reason,
    };
  }
}
