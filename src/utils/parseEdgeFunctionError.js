/**
 * Extract a user-facing message from a Supabase edge function invoke failure.
 */
export async function parseEdgeFunctionError(invokeError, data) {
  if (data?.error) return String(data.error);
  if (data?.message) return String(data.message);

  const ctx = invokeError?.context;
  if (ctx && typeof ctx.json === 'function') {
    try {
      const body = await ctx.json();
      if (body?.error) return String(body.error);
      if (body?.message) return String(body.message);
    } catch {
      /* ignore parse errors */
    }
  }

  if (invokeError?.message && !invokeError.message.includes('non-2xx')) {
    return invokeError.message;
  }

  return 'The server rejected this request. Please try again or contact support.';
}
