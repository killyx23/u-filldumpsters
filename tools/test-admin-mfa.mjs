/**
 * Live local-Auth test: enroll TOTP, verify, prove the factor stays verified
 * after the old "unmount unenroll" bug would have deleted it, then confirm
 * the next password login should show challenge (not a new QR).
 */
import { execSync } from 'node:child_process';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import {
  challengeAndVerifyTotp,
  decideAdminMfaView,
  getVerifiedTotpFactors,
  parseJwtAal,
} from '../src/lib/adminMfa.js';

function parseStatusEnv(output) {
  const values = {};
  for (const rawLine of output.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[line.slice(0, eq).trim()] = value;
  }
  return values;
}

function base32Decode(input) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const cleaned = input.replace(/=+$/, '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = '';
  for (const char of cleaned) {
    const val = alphabet.indexOf(char);
    if (val < 0) continue;
    bits += val.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

function generateTotp(secret, counterOffset = 0) {
  const key = base32Decode(secret);
  const counter = Buffer.alloc(8);
  counter.writeUInt32BE(Math.floor(Date.now() / 1000 / 30) + counterOffset, 4);
  const hmac = crypto.createHmac('sha1', key).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const bin =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(bin % 1_000_000).padStart(6, '0');
}

async function verifyWithWindow(client, factorId, secret) {
  let lastError = null;
  for (const offset of [0, -1, 1]) {
    const { error } = await challengeAndVerifyTotp(client, factorId, generateTotp(secret, offset));
    if (!error) return;
    lastError = error;
  }
  throw lastError;
}

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
}

function pass(message) {
  console.log(`PASS: ${message}`);
}

const status = parseStatusEnv(
  execSync('npx --yes supabase@2.98.2 status -o env', { encoding: 'utf8' }),
);
const url = status.API_URL;
const anonKey = status.ANON_KEY || status.PUBLISHABLE_KEY;
const serviceKey = status.SERVICE_ROLE_KEY || status.SECRET_KEY;

if (!url || !anonKey || !serviceKey) {
  fail('Local Supabase is not running or status keys are missing. Run `npx supabase start`.');
  process.exit(1);
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });

const email = `mfa-test-${Date.now()}@example.com`;
const password = 'Mfa-Test-Passw0rd!';

const { data: created, error: createError } = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
  app_metadata: { is_admin: true },
});
if (createError) {
  fail(`createUser: ${createError.message}`);
  process.exit(1);
}
const userId = created.user.id;

try {
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;

  const { data: enrollData, error: enrollError } = await client.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: 'Authenticator',
  });
  if (enrollError) throw enrollError;

  await verifyWithWindow(client, enrollData.id, enrollData.totp.secret);
  pass('enroll + TOTP verify succeeded');

  const afterVerify = await getVerifiedTotpFactors(client);
  if (afterVerify.length < 1) {
    fail('getVerifiedTotpFactors() empty immediately after verify');
  } else {
    pass(`verified TOTP present after enroll (${afterVerify.length})`);
  }

  // Reproduce the old unmount bug: unenrolling the just-verified factor.
  const { error: unenrollError } = await client.auth.mfa.unenroll({ factorId: enrollData.id });
  if (unenrollError) throw unenrollError;
  const afterUnenroll = await getVerifiedTotpFactors(client);
  if (afterUnenroll.length !== 0) {
    fail('expected unenroll-on-unmount to remove the verified factor');
  } else {
    pass('old unmount unenroll WOULD delete the verified factor (bug confirmed)');
  }

  // Re-enroll as the fixed UI does (cleanup no longer unenrolls).
  const { data: enroll2, error: enroll2Error } = await client.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: 'Authenticator',
  });
  if (enroll2Error) throw enroll2Error;
  await verifyWithWindow(client, enroll2.id, enroll2.totp.secret);

  await client.auth.signOut();
  const { data: secondLogin, error: secondError } = await client.auth.signInWithPassword({
    email,
    password,
  });
  if (secondError) throw secondError;

  const aal = parseJwtAal(secondLogin.session.access_token);
  const verified = await getVerifiedTotpFactors(client);
  const view = decideAdminMfaView({ currentAal: aal, verifiedTotpCount: verified.length });

  if (aal !== 'aal1') fail(`second login AAL should be aal1, got ${aal}`);
  else pass('second password login is AAL1 (MFA not yet verified this session)');

  if (verified.length < 1) fail('second login has no verified TOTP — QR would show again');
  else pass('second login still has a verified TOTP factor');

  if (view !== 'challenge') fail(`second login UI should be challenge, got ${view}`);
  else pass('second login UI is challenge (no QR)');
} catch (err) {
  fail(err.message || String(err));
} finally {
  await admin.auth.admin.deleteUser(userId);
}

if (process.exitCode) {
  console.error('\nAdmin MFA live test failed.');
  process.exit(process.exitCode);
}
console.log('\nAdmin MFA live test passed.');
