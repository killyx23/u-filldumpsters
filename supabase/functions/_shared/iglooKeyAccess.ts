/**
 * Booking-level iglooKey issue / extend / revoke.
 */

import { bookingNeedsYardLockPin } from "./deliveryBooking.ts";
import {
  createIglooKey,
  getIglooKeyToken,
  revokeIglooKey,
  updateIglooKey,
} from "./iglooKey.ts";
import {
  addGraceHour,
  buildBookingDateUTC,
  getPinActivationStart,
  PIN_REVOKE_STATUSES,
} from "./pinTiming.ts";

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

const LOG = "[iglooKeyAccess]";

function lockIdFromEnv(): string {
  return Deno.env.get("IGLOOHOME_LOCK_ID") || Deno.env.get("IGLOOHOME_DEVICE_ID") || "";
}

function iglooIso(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function bookingWindow(booking: Record<string, unknown>) {
  const startsAt = getPinActivationStart(booking as never);
  const endsAt = addGraceHour(
    buildBookingDateUTC(String(booking.pickup_date ?? ""), booking.pickup_time_slot as string | null, 5),
  );
  return { startsAt, endsAt };
}

async function accessToken(): Promise<{ token: string } | { error: string }> {
  const clientId = Deno.env.get("IGLOOHOME_CLIENT_ID");
  const clientSecret = Deno.env.get("IGLOOHOME_CLIENT_SECRET");
  if (!clientId || !clientSecret) return { error: "missing_igloo_oauth" };
  const oauth = await getIglooKeyToken(clientId, clientSecret);
  if (!oauth.token) return { error: oauth.reason || "oauth_failed" };
  return { token: oauth.token };
}

export async function ensureIglooKeyForBooking(
  supabase: SupabaseClient,
  booking: Record<string, unknown>,
): Promise<{ action: string; error?: string; url?: string }> {
  if (!bookingNeedsYardLockPin(booking)) return { action: "skipped_not_yard" };
  const status = String(booking.status || "");
  if ((PIN_REVOKE_STATUSES as readonly string[]).includes(status)) {
    return { action: "skipped_revoked_status" };
  }
  if (booking.iglookey_revoked_at) return { action: "skipped_already_revoked" };

  const lockId = lockIdFromEnv();
  if (!lockId) return { action: "skipped", error: "missing_lock_id" };

  const { startsAt, endsAt } = bookingWindow(booking);
  const existingId = typeof booking.iglookey_token_id === "string" ? booking.iglookey_token_id : "";
  const existingUrl = typeof booking.iglookey_shareable_url === "string"
    ? booking.iglookey_shareable_url
    : "";

  const auth = await accessToken();
  if ("error" in auth) return { action: "oauth_failed", error: auth.error };

  if (existingId && existingUrl) {
    const storedEnd = booking.iglookey_ends_at
      ? new Date(String(booking.iglookey_ends_at)).getTime()
      : 0;
    const nextEnd = new Date(endsAt).getTime();
    if (Number.isFinite(nextEnd) && nextEnd - storedEnd > 60_000) {
      const patched = await updateIglooKey(auth.token, existingId, { endsAt: iglooIso(endsAt) });
      if (!patched.ok) {
        console.warn(`${LOG} PATCH failed for #${booking.id}: ${patched.error}`);
        return { action: "update_failed", error: patched.error, url: existingUrl };
      }
      await supabase.from("bookings").update({
        iglookey_ends_at: endsAt,
      }).eq("id", booking.id);
      booking.iglookey_ends_at = endsAt;
      return { action: "updated", url: existingUrl };
    }
    return { action: "already_issued", url: existingUrl };
  }

  const startMs = new Date(startsAt).getTime();
  // Igloohome enforces label length <= 32 characters.
  const label = `Order #${booking.id}`.slice(0, 32);
  const createBody = {
    deviceIds: [lockId],
    label,
    endsAt: iglooIso(endsAt),
    ...(Number.isFinite(startMs) && startMs > Date.now() + 30_000
      ? { startsAt: iglooIso(startsAt) }
      : {}),
  };
  const created = await createIglooKey(auth.token, createBody);
  if (!created.ok) {
    console.warn(`${LOG} CREATE failed for #${booking.id}: ${created.error}`);
    return { action: "create_failed", error: created.error };
  }

  const nowIso = new Date().toISOString();
  await supabase.from("bookings").update({
    iglookey_token_id: created.token.id,
    iglookey_shareable_url: created.token.shareableUrl,
    iglookey_starts_at: created.token.startsAt || startsAt,
    iglookey_ends_at: created.token.endsAt || endsAt,
    iglookey_revoked_at: null,
  }).eq("id", booking.id);

  booking.iglookey_token_id = created.token.id;
  booking.iglookey_shareable_url = created.token.shareableUrl;
  booking.iglookey_starts_at = created.token.startsAt || startsAt;
  booking.iglookey_ends_at = created.token.endsAt || endsAt;

  await supabase.from("rental_tracking_logs").insert({
    order_id: booking.id,
    event_type: "pin_generated",
    event_timestamp: nowIso,
    notes: `iglooKey issued (${created.token.id})`,
  });

  return { action: "created", url: created.token.shareableUrl };
}

export async function extendIglooKeyForBooking(
  supabase: SupabaseClient,
  booking: Record<string, unknown>,
  newPickupDate: string,
): Promise<{ ok: boolean; action: string; error?: string }> {
  const tokenId = typeof booking.iglookey_token_id === "string" ? booking.iglookey_token_id : "";
  if (!tokenId || booking.iglookey_revoked_at) {
    const ensured = await ensureIglooKeyForBooking(supabase, {
      ...booking,
      pickup_date: newPickupDate,
    });
    return {
      ok: !ensured.error || Boolean(ensured.url),
      action: ensured.action,
      error: ensured.error,
    };
  }
  const endsAt = addGraceHour(
    buildBookingDateUTC(newPickupDate, booking.pickup_time_slot as string | null, 5),
  );
  const auth = await accessToken();
  if ("error" in auth) return { ok: false, action: "oauth_failed", error: auth.error };
  const patched = await updateIglooKey(auth.token, tokenId, { endsAt: iglooIso(endsAt) });
  if (!patched.ok) return { ok: false, action: "update_failed", error: patched.error };
  await supabase.from("bookings").update({ iglookey_ends_at: endsAt }).eq("id", booking.id);
  booking.iglookey_ends_at = endsAt;
  return { ok: true, action: "updated" };
}

export async function revokeIglooKeyForBooking(
  supabase: SupabaseClient,
  booking: Record<string, unknown>,
): Promise<{ action: string; error?: string }> {
  const tokenId = typeof booking.iglookey_token_id === "string" ? booking.iglookey_token_id : "";
  if (!tokenId) return { action: "no_token" };
  if (booking.iglookey_revoked_at) return { action: "already_revoked" };

  const auth = await accessToken();
  if ("error" in auth) return { action: "oauth_failed", error: auth.error };
  const revoked = await revokeIglooKey(auth.token, tokenId);
  if (!revoked.ok) return { action: "revoke_failed", error: revoked.error };
  const nowIso = new Date().toISOString();
  await supabase.from("bookings").update({ iglookey_revoked_at: nowIso }).eq("id", booking.id);
  booking.iglookey_revoked_at = nowIso;
  return { action: "revoked" };
}

export async function revokeCancelledIglooKeys(
  supabase: SupabaseClient,
  focusOrderId: number | null,
): Promise<Array<Record<string, unknown>>> {
  let query = supabase
    .from("bookings")
    .select("id, status, iglookey_token_id, iglookey_revoked_at")
    .in("status", [...PIN_REVOKE_STATUSES])
    .not("iglookey_token_id", "is", null)
    .is("iglookey_revoked_at", null);
  if (focusOrderId) query = query.eq("id", focusOrderId);
  const { data, error } = await query;
  if (error) {
    console.error(`${LOG} revoke query failed:`, error.message);
    return [{ action: "query_failed", error: error.message }];
  }
  const results: Array<Record<string, unknown>> = [];
  for (const booking of data ?? []) {
    const result = await revokeIglooKeyForBooking(supabase, booking);
    results.push({ bookingId: booking.id, ...result });
  }
  return results;
}
