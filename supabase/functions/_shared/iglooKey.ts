/**
 * IglooKey (Layer 1): shareable Bluetooth digital key via Access API /home/pass.
 * No bridge required. Stored as rental_access_codes rows with pin_type = "iglookey".
 */

import {
  getIglooKeyToken,
  IGLOOKEY_API_BASE_URL,
} from "./iglooAuth.ts";
import {
  addGraceHour,
  buildBookingDateUTC,
  getPinActivationStart,
} from "./pinTiming.ts";

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

export type IglooKeyWindow = { start: string; end: string };

export type IglooKeyRow = {
  id: string;
  order_id: number;
  pin_id: string;
  shareable_url: string | null;
  start_time: string;
  end_time: string;
  status: string;
};

async function readResponse(res: Response) {
  const text = await res.text();
  try {
    return { text, json: text ? JSON.parse(text) : null };
  } catch {
    return { text, json: null };
  }
}

function toIglooIso(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toISOString().replace(/\.\d{3}Z$/, "+00:00");
}

export function bookingIglooKeyWindow(
  booking: Record<string, unknown>,
  opts?: { startOverride?: string; endOverride?: string },
): IglooKeyWindow {
  if (opts?.startOverride && opts?.endOverride) {
    return { start: toIglooIso(opts.startOverride), end: toIglooIso(opts.endOverride) };
  }
  const start = opts?.startOverride
    ? toIglooIso(opts.startOverride)
    : getPinActivationStart(booking as never);
  const end = opts?.endOverride
    ? toIglooIso(opts.endOverride)
    : addGraceHour(
      buildBookingDateUTC(
        String(booking.pickup_date ?? ""),
        booking.pickup_time_slot as string | null,
        5,
      ),
    );
  return { start, end };
}

async function createPassOnIgloo(
  accessToken: string,
  deviceId: string,
  label: string,
  startsAt: string,
  endsAt: string,
): Promise<{ ok: true; id: string; shareableUrl: string } | { ok: false; error: string }> {
  const res = await fetch(`${IGLOOKEY_API_BASE_URL}/home/pass`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      deviceIds: [deviceId],
      label,
      startsAt,
      endsAt,
      offlineAccessSeconds: 24 * 60 * 60,
    }),
  });
  const body = await readResponse(res);
  if (!res.ok && res.status !== 201) {
    return {
      ok: false,
      error: `iglooKey create HTTP ${res.status}: ${body.json?.message || body.json?.error || body.text}`,
    };
  }
  const id = String(body.json?.id || "");
  const shareableUrl = String(body.json?.shareableUrl || body.json?.shareable_url || "");
  if (!id || !shareableUrl) {
    return { ok: false, error: "iglooKey create succeeded but missing id/shareableUrl" };
  }
  return { ok: true, id, shareableUrl };
}

async function revokePassOnIgloo(
  accessToken: string,
  keyId: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!keyId) return { ok: true };
  const res = await fetch(`${IGLOOKEY_API_BASE_URL}/home/pass/${encodeURIComponent(keyId)}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });
  if (res.ok || res.status === 404) return { ok: true };
  const body = await readResponse(res);
  return {
    ok: false,
    error: `iglooKey revoke HTTP ${res.status}: ${body.json?.message || body.json?.error || body.text}`,
  };
}

export async function getActiveIglooKey(
  supabase: SupabaseClient,
  orderId: number,
): Promise<IglooKeyRow | null> {
  const { data } = await supabase
    .from("rental_access_codes")
    .select("id, order_id, pin_id, shareable_url, start_time, end_time, status")
    .eq("order_id", orderId)
    .eq("pin_type", "iglookey")
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data || null;
}

export async function getActiveIglooKeyUrl(
  supabase: SupabaseClient,
  orderId: number,
): Promise<string | null> {
  const row = await getActiveIglooKey(supabase, orderId);
  return row?.shareable_url || null;
}

/**
 * Create (or reuse) an active iglooKey for the booking window.
 * Does not email the customer.
 */
export async function createIglooKeyForBooking(
  supabase: SupabaseClient,
  booking: Record<string, unknown>,
  opts?: { startOverride?: string; endOverride?: string; forceNew?: boolean },
): Promise<
  | { ok: true; reused: boolean; url: string; keyId: string; rowId: string; start: string; end: string }
  | { ok: false; error: string }
> {
  const orderId = Number(booking.id);
  if (!Number.isFinite(orderId)) return { ok: false, error: "invalid booking id" };

  if (!opts?.forceNew) {
    const existing = await getActiveIglooKey(supabase, orderId);
    if (existing?.shareable_url) {
      return {
        ok: true,
        reused: true,
        url: existing.shareable_url,
        keyId: existing.pin_id,
        rowId: existing.id,
        start: existing.start_time,
        end: existing.end_time,
      };
    }
  } else {
    await revokeIglooKeysForOrder(supabase, orderId);
  }

  const clientId = Deno.env.get("IGLOOHOME_CLIENT_ID") || "";
  const clientSecret = Deno.env.get("IGLOOHOME_CLIENT_SECRET") || "";
  const lockId = Deno.env.get("IGLOOHOME_LOCK_ID") || Deno.env.get("IGLOOHOME_DEVICE_ID") || "";
  if (!clientId || !clientSecret || !lockId) {
    return { ok: false, error: "Missing IGLOOHOME_CLIENT_ID / SECRET / LOCK_ID" };
  }

  const window = bookingIglooKeyWindow(booking, opts);
  const oauth = await getIglooKeyToken(clientId, clientSecret);
  if (!oauth.token) return { ok: false, error: oauth.reason || "iglooKey OAuth failed" };

  const created = await createPassOnIgloo(
    oauth.token,
    lockId,
    `Dump Trailer Rental - Order #${orderId}`,
    window.start,
    window.end,
  );
  if (!created.ok) return created;

  const { data: inserted, error: insertError } = await supabase
    .from("rental_access_codes")
    .insert({
      order_id: orderId,
      customer_email: booking.email || "",
      customer_phone: booking.phone || "",
      access_pin: "",
      pin_id: created.id,
      pin_type: "iglookey",
      shareable_url: created.shareableUrl,
      lock_id: lockId,
      start_time: window.start,
      end_time: window.end,
      status: "active",
      lock_confirmed_at: new Date().toISOString(),
      lock_deleted_at: null,
      confirm_attempts: 0,
    })
    .select("id")
    .single();

  if (insertError) {
    await revokePassOnIgloo(oauth.token, created.id);
    return { ok: false, error: insertError.message };
  }

  return {
    ok: true,
    reused: false,
    url: created.shareableUrl,
    keyId: created.id,
    rowId: inserted?.id || "",
    start: window.start,
    end: window.end,
  };
}

/** Revoke all active iglooKeys for an order (API + DB). */
export async function revokeIglooKeysForOrder(
  supabase: SupabaseClient,
  orderId: number,
): Promise<{ revoked: number; errors: string[] }> {
  const { data: rows } = await supabase
    .from("rental_access_codes")
    .select("id, pin_id")
    .eq("order_id", orderId)
    .eq("pin_type", "iglookey")
    .eq("status", "active");

  if (!rows?.length) return { revoked: 0, errors: [] };

  const clientId = Deno.env.get("IGLOOHOME_CLIENT_ID") || "";
  const clientSecret = Deno.env.get("IGLOOHOME_CLIENT_SECRET") || "";
  let token: string | null = null;
  if (clientId && clientSecret) {
    const oauth = await getIglooKeyToken(clientId, clientSecret);
    token = oauth.token;
  }

  const errors: string[] = [];
  let revoked = 0;
  for (const row of rows) {
    if (token && row.pin_id) {
      const result = await revokePassOnIgloo(token, String(row.pin_id));
      if (!result.ok && result.error) errors.push(result.error);
    }
    await supabase
      .from("rental_access_codes")
      .update({
        status: "expired",
        lock_deleted_at: new Date().toISOString(),
      })
      .eq("id", row.id);
    revoked += 1;
  }
  return { revoked, errors };
}
