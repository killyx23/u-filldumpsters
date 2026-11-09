/**
 * Immediately cut portal access for all three yard credential layers and
 * queue bridge deletes for custom PINs. Used by cancel, reschedule, return+1h
 * expiry, and extension Case A.
 */

import { bookingNeedsYardLockPin } from "./deliveryBooking.ts";
import { BRIDGE_PIN_SCOPES, getOAuthToken } from "./iglooAuth.ts";
import { revokeIglooKeysForOrder } from "./iglooKey.ts";
import { deletePinVerified } from "./lockPin.ts";

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

export type RevokeYardCredentialsOptions = {
  /** Also clear booking PIN delivery / failsafe stamps so Flow 1 can re-run. */
  clearBookingPinFlags?: boolean;
  /** Attempt bridge delete now (best-effort). Cron retries if lock_deleted_at stays null. */
  attemptBridgeDelete?: boolean;
};

export type RevokeYardCredentialsResult = {
  skipped?: boolean;
  iglooKeysRevoked: number;
  pinsExpired: number;
  bridgeDeletesConfirmed: number;
  bridgeDeletesPending: number;
  errors: string[];
};

export async function revokeYardCredentials(
  supabase: SupabaseClient,
  booking: Record<string, unknown> | number,
  opts: RevokeYardCredentialsOptions = {},
): Promise<RevokeYardCredentialsResult> {
  const clearFlags = opts.clearBookingPinFlags === true;
  const attemptBridge = opts.attemptBridgeDelete !== false;

  let bookingRow: Record<string, unknown> | null = null;
  let orderId: number;
  if (typeof booking === "number") {
    orderId = booking;
    const { data } = await supabase.from("bookings").select("*").eq("id", orderId).maybeSingle();
    bookingRow = data;
  } else {
    orderId = Number(booking.id);
    bookingRow = booking;
  }

  if (!Number.isFinite(orderId)) {
    return {
      iglooKeysRevoked: 0,
      pinsExpired: 0,
      bridgeDeletesConfirmed: 0,
      bridgeDeletesPending: 0,
      errors: ["invalid order id"],
    };
  }

  if (bookingRow && !bookingNeedsYardLockPin(bookingRow)) {
    return {
      skipped: true,
      iglooKeysRevoked: 0,
      pinsExpired: 0,
      bridgeDeletesConfirmed: 0,
      bridgeDeletesPending: 0,
      errors: [],
    };
  }

  const errors: string[] = [];
  const keyResult = await revokeIglooKeysForOrder(supabase, orderId);
  errors.push(...keyResult.errors);

  const { data: activePins } = await supabase
    .from("rental_access_codes")
    .select("id, access_pin, pin_type, lock_deleted_at")
    .eq("order_id", orderId)
    .eq("status", "active")
    .neq("pin_type", "iglookey");

  const pins = activePins || [];
  if (pins.length) {
    await supabase
      .from("rental_access_codes")
      .update({ status: "expired" })
      .eq("order_id", orderId)
      .eq("status", "active")
      .neq("pin_type", "iglookey");
  }

  // AlgoPIN: mark lock_deleted_at so we do not keep trying remote delete.
  await supabase
    .from("rental_access_codes")
    .update({ lock_deleted_at: new Date().toISOString() })
    .eq("order_id", orderId)
    .eq("pin_type", "algopin")
    .is("lock_deleted_at", null);

  let bridgeDeletesConfirmed = 0;
  let bridgeDeletesPending = 0;

  const customPins = pins.filter((p: { pin_type: string; access_pin?: string }) =>
    p.pin_type === "bridge_proxied" && p.access_pin
  );

  if (attemptBridge && customPins.length) {
    const clientId = Deno.env.get("IGLOOHOME_CLIENT_ID") || "";
    const clientSecret = Deno.env.get("IGLOOHOME_CLIENT_SECRET") || "";
    const lockId = Deno.env.get("IGLOOHOME_LOCK_ID") || Deno.env.get("IGLOOHOME_DEVICE_ID") || "";
    const bridgeId = Deno.env.get("IGLOOHOME_BRIDGE_ID") || "";
    if (clientId && clientSecret && lockId && bridgeId) {
      const oauth = await getOAuthToken(clientId, clientSecret, BRIDGE_PIN_SCOPES);
      if (oauth.token) {
        for (const row of customPins) {
          const result = await deletePinVerified(
            oauth.token,
            lockId,
            bridgeId,
            String(row.access_pin),
            20_000,
          );
          if (result.ok) {
            await supabase
              .from("rental_access_codes")
              .update({ lock_deleted_at: new Date().toISOString() })
              .eq("id", row.id);
            bridgeDeletesConfirmed += 1;
          } else {
            bridgeDeletesPending += 1;
            if (result.error) errors.push(result.error);
          }
        }
      } else {
        bridgeDeletesPending += customPins.length;
        if (oauth.reason) errors.push(oauth.reason);
      }
    } else {
      bridgeDeletesPending += customPins.length;
    }
  } else if (customPins.length) {
    bridgeDeletesPending += customPins.length;
  }

  if (clearFlags) {
    await supabase
      .from("bookings")
      .update({
        pin_generated_at: null,
        pin_notification_sent_at: null,
        pin_reminder_sent_at: null,
        pin_failsafe_at: null,
        pin_failsafe_note: null,
        pin_unavailable_notified_at: null,
      })
      .eq("id", orderId);
  }

  return {
    iglooKeysRevoked: keyResult.revoked,
    pinsExpired: pins.length,
    bridgeDeletesConfirmed,
    bridgeDeletesPending,
    errors,
  };
}
