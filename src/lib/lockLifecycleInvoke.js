import { supabase } from '@/lib/customSupabaseClient';

/** Actions that do not require a booking ID. */
export const BOOKING_OPTIONAL_ACTIONS = new Set([
  'oauth_diagnose',
  'remote_unlock',
  'remote_lock',
]);

export async function formatLockLifecycleInvokeError(error, data) {
  if (data?.success === false && data?.error) {
    return String(data.error);
  }

  let status = null;
  let bodyText = '';
  let bodyJson = null;

  try {
    const ctx = error?.context;
    if (ctx) {
      status = ctx.status ?? ctx.statusCode ?? null;
      if (typeof ctx.json === 'function') {
        bodyJson = await ctx.json().catch(() => null);
      } else if (typeof ctx.text === 'function') {
        bodyText = await ctx.text().catch(() => '');
      }
    }
  } catch {
    // ignore parse failures
  }

  const nestedError =
    bodyJson?.error ||
    bodyJson?.message ||
    bodyJson?.msg ||
    (typeof bodyJson === 'string' ? bodyJson : null) ||
    bodyText ||
    null;

  if (status === 404) {
    if (nestedError) {
      return status ? `HTTP ${status}: ${nestedError}` : String(nestedError);
    }
    return (
      'Function not found (HTTP 404). Local: restart with ' +
      '`npx --yes supabase@2.98.2 functions serve --env-file supabase/functions/.env`. ' +
      'You are still on localhost — the project-ref in older toasts was only deploy help text.'
    );
  }

  if (nestedError) {
    return status ? `HTTP ${status}: ${nestedError}` : String(nestedError);
  }

  const base = error?.message || 'Edge function error';
  if (base.includes('non-2xx') && status) {
    return `HTTP ${status}: ${base}`;
  }
  return base;
}

/**
 * Invoke the admin-only test-lock-lifecycle edge function.
 * @param {string} action
 * @param {{ bookingId?: number|string, [key: string]: unknown }} [extra]
 */
export async function invokeLockLifecycle(action, extra = {}) {
  const body = { action, ...extra };
  if (!BOOKING_OPTIONAL_ACTIONS.has(action)) {
    body.bookingId = Number(extra.bookingId);
  }

  const { data, error } = await supabase.functions.invoke('test-lock-lifecycle', { body });
  if (error) {
    const message = await formatLockLifecycleInvokeError(error, data);
    const err = new Error(message);
    err.payload = data || null;
    throw err;
  }
  if (data?.success === false) {
    const err = new Error(data.error || 'Request failed');
    err.payload = data;
    throw err;
  }
  return data;
}
