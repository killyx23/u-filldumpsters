export const REFERRAL_CODE_STORAGE_KEY = 'referral_code';

export function normalizeReferralCode(code) {
  return String(code || '').trim().toUpperCase();
}

export function getStoredReferralCode() {
  if (typeof window === 'undefined') return '';
  return normalizeReferralCode(window.localStorage.getItem(REFERRAL_CODE_STORAGE_KEY));
}

export function setStoredReferralCode(code) {
  if (typeof window === 'undefined') return;
  const normalized = normalizeReferralCode(code);
  if (normalized) {
    window.localStorage.setItem(REFERRAL_CODE_STORAGE_KEY, normalized);
  } else {
    window.localStorage.removeItem(REFERRAL_CODE_STORAGE_KEY);
  }
}
