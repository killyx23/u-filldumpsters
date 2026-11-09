import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getCorsHeaders } from "./cors.ts";
import { getJwtAal } from "../_shared/jwtAal.ts";
import { revokeYardCredentials } from "../_shared/revokeYardCredentials.ts";
function makeJsonResponse(corsHeaders) {
  return (body, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
}
Deno.serve(async (req)=>{
  const corsHeaders = getCorsHeaders(req);
  const jsonResponse = makeJsonResponse(corsHeaders);
  if (req.method === "OPTIONS") return new Response(null, {
    headers: corsHeaders
  });
  if (req.method !== "POST") return jsonResponse({
    success: false,
    error: "Method not allowed"
  }, 405);
  try {
    console.log("[delete-pin] Started:", new Date().toISOString());
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse({
        success: false,
        error: "Missing required environment variables"
      }, 500);
    }
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
    // ----------------------------------------------------------------
    // Parse body
    // ----------------------------------------------------------------
    let bookingId = null;
    let callerType = "admin";
    try {
      const body = await req.json();
      bookingId = body.bookingId ?? body.booking_id ?? null;
      callerType = body.callerType ?? "admin";
    } catch  {
      return jsonResponse({
        success: false,
        error: "Invalid or missing JSON body"
      }, 400);
    }
    if (!bookingId) {
      return jsonResponse({
        success: false,
        error: "bookingId is required"
      }, 400);
    }
    console.log("[delete-pin] Caller:", callerType, "BookingId:", bookingId);
    // ----------------------------------------------------------------
    // Auth check
    // ----------------------------------------------------------------
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({
        success: false,
        error: "Missing Authorization header"
      }, 401);
    }
    const token = authHeader.replace("Bearer ", "");
    const userSupabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY"), {
      global: {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    });
    const { data: { user }, error: authError } = await userSupabase.auth.getUser();
    if (authError || !user) {
      return jsonResponse({
        success: false,
        error: "Unauthorized"
      }, 401);
    }
    if (callerType === "admin") {
      if (user.app_metadata?.is_admin !== true) {
        return jsonResponse({
          success: false,
          error: "Admin access required"
        }, 403);
      }
      if (getJwtAal(token) !== "aal2") {
        return jsonResponse({
          success: false,
          error: "Admin MFA required"
        }, 403);
      }
    }
    if (callerType === "customer") {
      const { data: customer } = await supabase.from("customers").select("id").eq("user_id", user.id).single();
      if (!customer) {
        return jsonResponse({
          success: false,
          error: "Customer not found"
        }, 403);
      }
      // Verify booking belongs to this customer
      const { data: ownerCheck } = await supabase.from("bookings").select("id").eq("id", bookingId).eq("customer_id", customer.id).single();
      if (!ownerCheck) {
        return jsonResponse({
          success: false,
          error: "Booking does not belong to this customer"
        }, 403);
      }
    }
    const { data: booking } = await supabase.from("bookings").select("*").eq("id", bookingId).maybeSingle();
    const revoked = await revokeYardCredentials(supabase, booking || Number(bookingId), {
      clearBookingPinFlags: false,
      attemptBridgeDelete: true,
    });
    const touched = revoked.iglooKeysRevoked + revoked.pinsExpired;
    if (!touched) {
      console.log(`[delete-pin] No active credentials for booking #${bookingId}`);
      return jsonResponse({
        success: true,
        message: "No active credentials found for this booking — nothing to delete",
        lockDeleted: false,
        dbExpired: false,
        revoked,
      });
    }
    console.log(`[delete-pin] Revoked credentials for booking #${bookingId}`, revoked);
    return jsonResponse({
      success: true,
      bookingId,
      lockDeleted: revoked.bridgeDeletesConfirmed > 0,
      dbExpired: true,
      revoked,
      message: revoked.bridgeDeletesPending > 0
        ? "Credentials expired in DB — portal access revoked. Bridge delete will retry via cron if needed."
        : "All yard credentials revoked (iglooKey + PINs).",
    });
  } catch (error) {
    console.error("[delete-pin] Unhandled exception:", error);
    return jsonResponse({
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }, 500);
  }
});
