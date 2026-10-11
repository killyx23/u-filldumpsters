import { isAdminHostname, resolveCrossHostRedirect, resolveSiteOrigins } from '@/utils/hostSplit';

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function readSiteOrigins() {
  const envAdminOrigin = import.meta.env.VITE_ADMIN_ORIGIN || '';
  if (typeof window === 'undefined') {
    return resolveSiteOrigins({
      hostname: 'localhost',
      port: '3000',
      protocol: 'http:',
      envAdminOrigin,
    });
  }
  return resolveSiteOrigins({
    hostname: window.location.hostname,
    port: window.location.port,
    protocol: window.location.protocol,
    envAdminOrigin,
  });
}

/** Customer-facing origin. On the staff address this is the public site, not the staff host. */
function customerLinkOrigin() {
  const fromEnv = normalizeOrigin(import.meta.env.VITE_SITE_URL);
  if (fromEnv && !isAdminHostname(hostnameOf(fromEnv))) return fromEnv;
  const sites = readSiteOrigins();
  if (sites.isAdminHost) return sites.publicOrigin;
  if (typeof window !== 'undefined' && window.location?.origin) return window.location.origin;
  return sites.publicOrigin || 'http://localhost:3000';
}

function hostnameOf(origin) {
  try {
    return new URL(origin).hostname;
  } catch {
    return '';
  }
}

const normalizeOrigin = (value) => {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    return new URL(value.trim()).origin;
  } catch {
    return value.trim().replace(/\/$/, '');
  }
};

const isLocalOrigin = (origin) => {
  if (!origin) return false;
  try {
    const parsed = new URL(origin);
    return LOCAL_HOSTNAMES.has(parsed.hostname);
  } catch {
    return origin.includes('localhost') || origin.includes('127.0.0.1');
  }
};

/**
 * App origin for links rendered inside the browser app.
 */
export function getAppOrigin() {
  return customerLinkOrigin();
}

export function isCurrentAdminHost() {
  return readSiteOrigins().isAdminHost;
}

/** Where the staff dot sends this browser. Admin login stays on the staff address. */
export function getStaffEntryUrl() {
  const sites = readSiteOrigins();
  if (sites.isAdminHost) return `${sites.publicOrigin}/`;
  if (sites.split) return `${sites.adminOrigin}/admin`;
  return '/admin';
}

export function getCrossHostRedirect(location) {
  return resolveCrossHostRedirect({
    origins: readSiteOrigins(),
    pathname: location?.pathname || '/',
    search: location?.search || '',
    hash: location?.hash || '',
  });
}

/**
 * QR target origin.
 * Priority:
 * 1) VITE_QR_BASE_URL
 * 2) VITE_SITE_URL
 * 3) window.location.origin when not localhost
 * 4) fallback localhost (with warning)
 */
const ensureHttpOrigin = (origin) => {
  if (!origin) return origin;
  if (/^https?:\/\//i.test(origin)) return origin;
  return `http://${origin.replace(/^\/\//, '')}`;
};

const warnLikelyWslOrigin = (origin, source) => {
  if (typeof window === 'undefined' || !origin) return;
  try {
    const hostname = new URL(origin).hostname;
    if (hostname.startsWith('172.')) {
      console.warn(
        `[QR] ${source} resolved to "${origin}". 172.x addresses are often WSL/Docker-private and may time out on phones. Use your Windows/Wi-Fi LAN IP instead.`,
      );
    }
  } catch {
    // no-op
  }
};

export function getQrCodeOrigin() {
  const rawQrEnv = import.meta.env.VITE_QR_BASE_URL;
  const rawSiteEnv = import.meta.env.VITE_SITE_URL;
  const fromQrEnv = normalizeOrigin(rawQrEnv);
  if (fromQrEnv && !isAdminHostname(hostnameOf(fromQrEnv))) {
    const origin = ensureHttpOrigin(fromQrEnv);
    warnLikelyWslOrigin(origin, 'VITE_QR_BASE_URL');
    return origin;
  }

  const fromSiteEnv = normalizeOrigin(rawSiteEnv);
  if (fromSiteEnv && !isAdminHostname(hostnameOf(fromSiteEnv))) {
    const origin = ensureHttpOrigin(fromSiteEnv);
    warnLikelyWslOrigin(origin, 'VITE_SITE_URL');
    return origin;
  }

  const windowOrigin = customerLinkOrigin();
  if (windowOrigin && !isLocalOrigin(windowOrigin)) {
    const origin = ensureHttpOrigin(windowOrigin);
    warnLikelyWslOrigin(origin, 'window.location.origin');
    return origin;
  }

  if (typeof window !== 'undefined') {
    console.warn('[QR] Using localhost origin for QR links. Set VITE_SITE_URL or VITE_QR_BASE_URL to a LAN URL for phone scanning.');
  }
  const fallback = ensureHttpOrigin(windowOrigin || 'http://localhost:3000');
  warnLikelyWslOrigin(fallback, 'fallback origin');
  return fallback;
}
