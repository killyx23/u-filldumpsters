/** Customer site and staff site are different browser addresses so logins stay separate. */

export const PRODUCTION_PUBLIC_HOSTS = new Set([
  'u-filldumpsters.com',
  'www.u-filldumpsters.com',
]);

export const PRODUCTION_ADMIN_HOST = 'admin.u-filldumpsters.com';
export const LOCAL_ADMIN_HOST = 'admin.localhost';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export function isAdminHostname(hostname) {
  const host = String(hostname || '').toLowerCase();
  return host === PRODUCTION_ADMIN_HOST || host === LOCAL_ADMIN_HOST;
}

export function isProductionCustomerHostname(hostname) {
  return PRODUCTION_PUBLIC_HOSTS.has(String(hostname || '').toLowerCase());
}

export function isLoopbackCustomerHostname(hostname) {
  return LOOPBACK_HOSTS.has(String(hostname || '').toLowerCase());
}

export function isAdminPath(pathname) {
  const path = pathname || '/';
  return (
    path === '/admin'
    || path.startsWith('/admin/')
    || path === '/admin-login'
    || path === '/admin-mfa'
  );
}

function toOrigin(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    return new URL(value.trim()).origin;
  } catch {
    return '';
  }
}

function originFromParts(protocol, hostname, port) {
  const proto = protocol || 'http:';
  const defaultPort = proto === 'https:' ? '443' : '80';
  const portSuffix = port && port !== defaultPort ? `:${port}` : '';
  return `${proto}//${hostname}${portSuffix}`;
}

/**
 * @param {{
 *   hostname?: string,
 *   port?: string,
 *   protocol?: string,
 *   envAdminOrigin?: string,
 * }} input
 */
export function resolveSiteOrigins(input = {}) {
  const hostname = String(input.hostname || '').toLowerCase();
  const protocol = input.protocol || 'http:';
  const port = input.port || '';
  const currentOrigin = originFromParts(protocol, hostname, port);
  const envAdmin = toOrigin(input.envAdminOrigin);
  const adminHost = isAdminHostname(hostname);
  const pairedProduction = hostname === PRODUCTION_ADMIN_HOST || isProductionCustomerHostname(hostname);
  const pairedLocal = hostname === LOCAL_ADMIN_HOST || isLoopbackCustomerHostname(hostname);

  let publicOrigin = currentOrigin;
  let adminOrigin = currentOrigin;

  if (pairedProduction) {
    publicOrigin = 'https://u-filldumpsters.com';
    adminOrigin = `https://${PRODUCTION_ADMIN_HOST}`;
  } else if (pairedLocal) {
    const localPort = port || '3000';
    publicOrigin = isLoopbackCustomerHostname(hostname)
      ? originFromParts(protocol, hostname, localPort)
      : `http://localhost:${localPort}`;
    adminOrigin = `http://${LOCAL_ADMIN_HOST}:${localPort}`;
  }

  if (envAdmin && (pairedProduction || pairedLocal) && envAdmin !== publicOrigin) {
    adminOrigin = envAdmin;
  }

  return {
    currentOrigin,
    publicOrigin,
    adminOrigin,
    split: publicOrigin !== adminOrigin,
    isAdminHost: adminHost,
  };
}

/**
 * Full page URL when this address should hand off to the other site.
 * Returns null when the current address should render the page.
 */
export function resolveCrossHostRedirect({ origins, pathname, search = '', hash = '' }) {
  if (!origins?.split) return null;
  const suffix = `${pathname || '/'}${search || ''}${hash || ''}`;
  if (origins.isAdminHost) {
    if (isAdminPath(pathname)) return null;
    return `${origins.publicOrigin}${suffix}`;
  }
  if (isAdminPath(pathname)) {
    return `${origins.adminOrigin}${suffix}`;
  }
  return null;
}
