/**
 * Decide which /admin-mfa UI to show.
 * A verified TOTP factor means enroll is done — AAL1 only needs a challenge.
 */
export function decideAdminMfaView({ currentAal, verifiedTotpCount }) {
  const count = Number(verifiedTotpCount) || 0;
  if (count > 0 && currentAal === 'aal2') return 'dashboard';
  if (count > 0) return 'challenge';
  return 'enroll';
}

/** Decode the AAL claim from a Supabase access token. Missing/invalid → aal1. */
export function parseJwtAal(accessToken) {
  if (!accessToken || typeof accessToken !== 'string') return 'aal1';
  try {
    const segment = accessToken.split('.')[1];
    if (!segment) return 'aal1';
    const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    const payload = JSON.parse(atob(padded));
    return payload.aal === 'aal2' ? 'aal2' : 'aal1';
  } catch {
    return 'aal1';
  }
}

export function toQrImageSrc(qrCode) {
  if (!qrCode) return '';
  if (qrCode.startsWith('data:')) return qrCode;
  return `data:image/svg+xml;utf-8,${encodeURIComponent(qrCode)}`;
}

/** True when the browser JWT points at a session Supabase no longer has. */
export function isInvalidSessionError(error) {
  if (!error) return false;
  const message = String(error.message || error).toLowerCase();
  return (
    message.includes('session from session_id claim in jwt does not exist')
    || message.includes('invalid refresh token')
    || message.includes('refresh token not found')
    || message.includes('jwt expired')
    || /session.*not found/i.test(message)
  );
}

function verifiedTotpFromList(data) {
  const fromTotp = (data?.totp ?? []).filter((factor) => factor.status === 'verified');
  if (fromTotp.length > 0) return fromTotp;
  return (data?.all ?? []).filter(
    (factor) => factor.factor_type === 'totp' && factor.status === 'verified',
  );
}

/**
 * List MFA factors without calling getUser first — avoids racing signInWithPassword
 * when a stale session_id is still in local storage.
 */
export async function getVerifiedTotpFactors(supabase) {
  const listed = await supabase.auth.mfa.listFactors();
  if (listed.error) throw listed.error;
  const fromList = verifiedTotpFromList(listed.data);
  if (fromList.length > 0) return fromList;

  const { data: { user }, error } = await supabase.auth.getUser();
  if (error) throw error;
  return (user?.factors ?? []).filter(
    (factor) => factor.factor_type === 'totp' && factor.status === 'verified',
  );
}

export async function unenrollUnverifiedTotpFactors(supabase) {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error) throw error;
  const unverified = (user?.factors ?? []).filter(
    (factor) => factor.factor_type === 'totp' && factor.status === 'unverified',
  );
  for (const factor of unverified) {
    await supabase.auth.mfa.unenroll({ factorId: factor.id });
  }
}

export async function challengeAndVerifyTotp(supabase, factorId, code) {
  const challenge = await supabase.auth.mfa.challenge({ factorId });
  if (challenge.error) return { error: challenge.error };
  return supabase.auth.mfa.verify({
    factorId,
    challengeId: challenge.data.id,
    code,
  });
}
