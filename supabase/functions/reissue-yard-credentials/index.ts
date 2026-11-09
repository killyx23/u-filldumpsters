/**
 * After admin approves a reschedule (or reinstates a yard booking to Confirmed),
 * revoke any leftover credentials and reserve a fresh custom PIN for the new window.
 * iglooKey + customer delivery still wait until T_drop − 12h (notify pass).
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getCorsHeaders } from "./cors.ts";
import { bookingNeedsYardLockPin } from "../_shared/deliveryBooking.ts";
import { getJwtAal } from "../_shared/jwtAal.ts";
import { pushReservedPinForOrder } from "../_shared/lockPin.ts";
import { reserveYardPinForBooking } from "../_shared/reserveYardPin.ts";
import { revokeYardCredentials } from "../_shared/revokeYardCredentials.ts";

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    if (!supabaseUrl || !serviceRoleKey) {
      return json({ success: false, error: "Server misconfigured" }, 500);
    }

    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    const isService = token === serviceRoleKey;
    if (!isService) {
      if (!token || !anonKey) return json({ success: false, error: "Unauthorized" }, 401);
      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: `Bearer ${token}` } },
      });
      const { data: { user }, error: userError } = await userClient.auth.getUser();
      if (userError || !user) return json({ success: false, error: "Unauthorized" }, 401);
      if (user.app_metadata?.is_admin !== true) {
        return json({ success: false, error: "Admin only" }, 403);
      }
      if (getJwtAal(token) !== "aal2") {
        return json({ success: false, error: "Admin MFA required" }, 403);
      }
    }

    const body = await req.json().catch(() => ({}));
    const bookingId = Number(body.bookingId || body.booking_id);
    if (!Number.isFinite(bookingId)) {
      return json({ success: false, error: "bookingId required" }, 400);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: booking, error } = await supabase
      .from("bookings")
      .select("*")
      .eq("id", bookingId)
      .single();
    if (error || !booking) {
      return json({ success: false, error: error?.message || "Booking not found" }, 404);
    }
    if (!bookingNeedsYardLockPin(booking)) {
      return json({ success: true, skipped: true, reason: "not_yard_pickup" });
    }

    const revoked = await revokeYardCredentials(supabase, booking, {
      clearBookingPinFlags: true,
      attemptBridgeDelete: true,
    });

    if (String(booking.status) !== "Confirmed") {
      return json({
        success: true,
        revoked,
        reserved: null,
        note: "Credentials revoked; PIN reserve waits until status is Confirmed",
      });
    }

    const lockId = Deno.env.get("IGLOOHOME_LOCK_ID") || Deno.env.get("IGLOOHOME_DEVICE_ID") || "";
    const reserved = await reserveYardPinForBooking(supabase, booking, lockId);
    let pushed: { action: string; error?: string } | null = null;
    if (reserved.action === "reserved" || reserved.action === "exists") {
      pushed = await pushReservedPinForOrder(supabase, bookingId);
    }

    return json({
      success: true,
      revoked,
      reserved,
      pushed,
    });
  } catch (err) {
    console.error("[reissue-yard-credentials]", err);
    return json({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    }, 500);
  }
});
