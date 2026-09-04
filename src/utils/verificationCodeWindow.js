const DEADLINE_KEY_PREFIX = 'ufill_verify_code_deadline:';

/** Matches the code lifetime set by the send-verification-email edge function. */
export const VERIFICATION_CODE_WINDOW_MS = 15 * 60 * 1000;

/**
 * The tab that requests the code and the tab opened from the emailed link are
 * different tabs, so this deadline lives in localStorage (shared per origin)
 * rather than the sessionStorage used by the other checkout flags.
 */
function keyFor(pendingId) {
  if (!pendingId) return null;
  return `${DEADLINE_KEY_PREFIX}${pendingId}`;
}

export function saveVerificationDeadline(pendingId, expiresAt) {
  const key = keyFor(pendingId);
  if (!key || typeof window === 'undefined') return null;

  const deadline = expiresAt ? new Date(expiresAt).getTime() : NaN;
  const resolved = Number.isFinite(deadline)
    ? deadline
    : Date.now() + VERIFICATION_CODE_WINDOW_MS;

  try {
    window.localStorage.setItem(key, String(resolved));
  } catch {
    // storage unavailable — countdown just will not show
  }
  return resolved;
}

export function readVerificationDeadline(pendingId) {
  const key = keyFor(pendingId);
  if (!key || typeof window === 'undefined') return null;

  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const deadline = Number(raw);
    return Number.isFinite(deadline) ? deadline : null;
  } catch {
    return null;
  }
}

export function clearVerificationDeadline(pendingId) {
  const key = keyFor(pendingId);
  if (!key || typeof window === 'undefined') return;

  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

/** mm:ss for the on-screen countdown. */
export function formatCountdown(remainingMs) {
  const total = Math.max(0, Math.ceil(Number(remainingMs || 0) / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
