/**
 * App origin for QR codes and deep links on receipts and portal pages.
 * Set VITE_SITE_URL in .env.local (e.g. http://localhost:3000) when testing locally.
 */
export function getAppOrigin() {
  const fromEnv = import.meta.env.VITE_SITE_URL;
  if (typeof fromEnv === 'string' && fromEnv.trim()) {
    try {
      return new URL(fromEnv.trim()).origin;
    } catch {
      return fromEnv.trim().replace(/\/$/, '');
    }
  }
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }
  return 'http://localhost:3000';
}
