const SESSION_VERIFIED_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function normalizePendingId(pendingId) {
  const id = pendingId == null ? '' : String(pendingId).trim();
  return id || null;
}

function emailOnlyKey(normalizedEmail) {
  return `verified_email_${normalizedEmail}`;
}

function pendingScopedKey(normalizedEmail, pendingId) {
  return `verified_email_${normalizedEmail}_${pendingId}`;
}

function readFreshTimestamp(raw) {
  if (raw == null || raw === '') return false;
  const verifiedAt = Number(raw);
  if (!Number.isFinite(verifiedAt)) return true;
  return Date.now() - verifiedAt < SESSION_VERIFIED_TTL_MS;
}

/**
 * Portal / returning-customer sign-in: email-only session flag.
 * Checkout OTP must use pendingId — bare email flags must not skip a new booking.
 */
export function hasVerifiedEmailSession(email, pendingId = null) {
  if (typeof window === 'undefined') return false;
  const normalized = normalizeEmail(email);
  if (!normalized) return false;

  const scopedPending = normalizePendingId(pendingId);
  if (scopedPending) {
    return readFreshTimestamp(
      window.sessionStorage.getItem(pendingScopedKey(normalized, scopedPending)),
    );
  }

  return readFreshTimestamp(window.sessionStorage.getItem(emailOnlyKey(normalized)));
}

/**
 * @param {string} email
 * @param {string|null} [pendingId] — when set, scopes verification to this checkout pending row
 */
export function markVerifiedEmailSession(email, pendingId = null) {
  if (typeof window === 'undefined') return;
  const normalized = normalizeEmail(email);
  if (!normalized) return;

  const now = String(Date.now());
  const scopedPending = normalizePendingId(pendingId);
  if (scopedPending) {
    window.sessionStorage.setItem(pendingScopedKey(normalized, scopedPending), now);
    return;
  }
  window.sessionStorage.setItem(emailOnlyKey(normalized), now);
}

/**
 * Remove legacy email-only flag and optional pending-scoped flags for this email.
 * Used when starting over so a prior checkout cannot skip OTP.
 */
export function clearVerifiedEmailSession(email, pendingId = null) {
  if (typeof window === 'undefined') return;
  const normalized = normalizeEmail(email);
  if (!normalized) return;

  try {
    window.sessionStorage.removeItem(emailOnlyKey(normalized));
    const scopedPending = normalizePendingId(pendingId);
    if (scopedPending) {
      window.sessionStorage.removeItem(pendingScopedKey(normalized, scopedPending));
    }
  } catch {
    // ignore
  }
}

/**
 * Synchronous check: booking flag or pending-scoped session storage.
 * Bare email-only portal flags do NOT count for checkout skip.
 */
export function isCheckoutEmailVerifiedSync(email, bookingData = {}) {
  if (bookingData?.returningCustomerVerified === true) return true;
  const pendingId =
    bookingData?.pendingToken ||
    bookingData?.pending_token ||
    bookingData?.pendingId ||
    null;
  if (!pendingId) return false;
  return hasVerifiedEmailSession(email, pendingId);
}

/**
 * Async alias for callers that historically awaited a DB check.
 * Relies on session flag / booking flag; server-side edge functions enforce
 * email_verifications.is_verified (or verified pending_token) for writes.
 */
export async function isCheckoutEmailVerified(email, bookingData = {}) {
  return isCheckoutEmailVerifiedSync(email, bookingData);
}
