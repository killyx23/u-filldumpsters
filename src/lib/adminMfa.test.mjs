import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decideAdminMfaView, parseJwtAal, toQrImageSrc } from './adminMfa.js';

test('aal1 with no verified TOTP shows enroll QR', () => {
  assert.equal(decideAdminMfaView({ currentAal: 'aal1', verifiedTotpCount: 0 }), 'enroll');
});

test('aal1 with a verified TOTP shows challenge, not a new QR', () => {
  assert.equal(decideAdminMfaView({ currentAal: 'aal1', verifiedTotpCount: 1 }), 'challenge');
});

test('aal2 with verified TOTP goes to dashboard', () => {
  assert.equal(decideAdminMfaView({ currentAal: 'aal2', verifiedTotpCount: 1 }), 'dashboard');
});

test('parseJwtAal reads aal from a JWT payload', () => {
  const payload = Buffer.from(JSON.stringify({ aal: 'aal2' })).toString('base64url');
  const token = `eyJhbGciOiJub25lIn0.${payload}.x`;
  assert.equal(parseJwtAal(token), 'aal2');
  assert.equal(parseJwtAal('not-a-jwt'), 'aal1');
});

test('toQrImageSrc prefixes SVG QR codes', () => {
  assert.equal(toQrImageSrc('data:image/svg+xml;utf-8,abc'), 'data:image/svg+xml;utf-8,abc');
  assert.match(toQrImageSrc('<svg></svg>'), /^data:image\/svg\+xml/);
});
