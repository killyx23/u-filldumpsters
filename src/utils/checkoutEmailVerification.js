const SESSION_VERIFIED_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

/**
 * Session flag set after OTP verification in this browser session.
 */
export function hasVerifiedEmailSession(email) {
  if (typeof window === 'undefined') return false;
  const normalized = normalizeEmail(email);
  if (!normalized) return false;

  const raw = window.sessionStorage.getItem(`verified_email_${normalized}`);
  if (!raw) return false;

  const verifiedAt = Number(raw);
  if (!Number.isFinite(verifiedAt)) return true;

  return Date.now() - verifiedAt < SESSION_VERIFIED_TTL_MS;
}

export function markVerifiedEmailSession(email) {
  if (typeof window === 'undefined') return;
  const normalized = normalizeEmail(email);
  if (!normalized) return;
  window.sessionStorage.setItem(`verified_email_${normalized}`, String(Date.now()));
}

/**
 * Synchronous check: booking flag or session storage.
 * email_verifications is service-role only (anon/authenticated grants revoked),
 * so client DB lookups are not used here.
 */
export function isCheckoutEmailVerifiedSync(email, bookingData = {}) {
  if (bookingData?.returningCustomerVerified === true) return true;
  return hasVerifiedEmailSession(email);
}

/**
 * Async alias for callers that historically awaited a DB check.
 * Relies on session flag / booking flag; server-side edge functions enforce
 * email_verifications.is_verified (or verified pending_token) for writes.
 */
export async function isCheckoutEmailVerified(email, bookingData = {}) {
  return isCheckoutEmailVerifiedSync(email, bookingData);
}
