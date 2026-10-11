import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveCrossHostRedirect, resolveSiteOrigins } from './hostSplit.js';

test('local customer admin routes move to the staff address', () => {
  const origins = resolveSiteOrigins({
    hostname: 'localhost',
    port: '3000',
    protocol: 'http:',
  });
  assert.equal(origins.split, true);
  assert.equal(
    resolveCrossHostRedirect({ origins, pathname: '/admin/dashboard' }),
    'http://admin.localhost:3000/admin/dashboard',
  );
  assert.equal(resolveCrossHostRedirect({ origins, pathname: '/customer-portal', search: '?tab=dashboard' }), null);
});

test('local staff address keeps admin and sends customer pages home', () => {
  const origins = resolveSiteOrigins({
    hostname: 'admin.localhost',
    port: '3000',
    protocol: 'http:',
  });
  assert.equal(resolveCrossHostRedirect({ origins, pathname: '/admin-login' }), null);
  assert.equal(
    resolveCrossHostRedirect({ origins, pathname: '/customer-portal', search: '?token=abc' }),
    'http://localhost:3000/customer-portal?token=abc',
  );
});

test('127.0.0.1 stays the customer site and still uses the staff address for admin', () => {
  const origins = resolveSiteOrigins({
    hostname: '127.0.0.1',
    port: '3000',
    protocol: 'http:',
  });
  assert.equal(origins.publicOrigin, 'http://127.0.0.1:3000');
  assert.equal(
    resolveCrossHostRedirect({ origins, pathname: '/admin-mfa' }),
    'http://admin.localhost:3000/admin-mfa',
  );
});

test('production customer and staff addresses stay paired', () => {
  const customer = resolveSiteOrigins({
    hostname: 'www.u-filldumpsters.com',
    protocol: 'https:',
  });
  assert.equal(
    resolveCrossHostRedirect({ origins: customer, pathname: '/admin' }),
    'https://admin.u-filldumpsters.com/admin',
  );

  const staff = resolveSiteOrigins({
    hostname: 'admin.u-filldumpsters.com',
    protocol: 'https:',
  });
  assert.equal(resolveCrossHostRedirect({ origins: staff, pathname: '/admin/customer/4' }), null);
  assert.equal(
    resolveCrossHostRedirect({ origins: staff, pathname: '/' }),
    'https://u-filldumpsters.com/',
  );
});

test('preview hosts keep admin on the same address', () => {
  const origins = resolveSiteOrigins({
    hostname: 'u-filldumpsters-git-preview.vercel.app',
    protocol: 'https:',
  });
  assert.equal(origins.split, false);
  assert.equal(resolveCrossHostRedirect({ origins, pathname: '/admin' }), null);
});
