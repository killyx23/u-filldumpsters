import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders } from "./cors.ts";
const IGLOOHOME_OAUTH_URL = "https://auth.igloohome.co/oauth2/token";
const IGLOOHOME_API_BASE_URL = "https://api.igloodeveloper.co/igloohome";
function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
}
async function readResponse(res) {
  const text = await res.text();
  try {
    return {
      text,
      json: text ? JSON.parse(text) : null
    };
  } catch  {
    return {
      text,
      json: null
    };
  }
}
async function getOAuthToken(clientId, clientSecret) {
  const credentials = btoa(`${clientId}:${clientSecret}`);
  const res = await fetch(IGLOOHOME_OAUTH_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json"
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: [
        "igloohomeapi/delete-pin-bridge-proxied-job",
        "igloohomeapi/get-devices",
        "igloohomeapi/get-job-status"
      ].join(" ")
    })
  });
  const body = await readResponse(res);
  console.log("[delete-pin] OAuth status:", res.status);
  if (!res.ok || !body.json?.access_token) {
    console.error("[delete-pin] OAuth failed:", body.text);
    return null;
  }
  return body.json.access_token;
}
async function deletePinFromLock(accessToken, lockId, bridgeId, pin) {
  const url = `${IGLOOHOME_API_BASE_URL}/devices/${lockId}/jobs/bridges/${bridgeId}`;
  const payload = {
    jobType: 5,
    jobData: {
      pin
    }
  };
  console.log("[delete-pin] Sending delete job to lock:", {
    url,
    pin
  });
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify(payload)
  });
  const body = await readResponse(res);
  console.log("[delete-pin] Lock delete response:", {
    status: res.status,
    body: body.json
  });
  if (!res.ok && res.status !== 201) {
    return {
      success: false,
      error: `Lock delete failed with status ${res.status}: ${body.json?.error ?? body.text}`
    };
  }
  return {
    success: true
  };
}
Deno.serve(async (req)=>{
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
    const clientId = Deno.env.get("IGLOOHOME_CLIENT_ID");
    const clientSecret = Deno.env.get("IGLOOHOME_CLIENT_SECRET");
    const lockId = Deno.env.get("IGLOOHOME_LOCK_ID") || Deno.env.get("IGLOOHOME_DEVICE_ID");
    const bridgeId = Deno.env.get("IGLOOHOME_BRIDGE_ID");
    if (!supabaseUrl || !serviceRoleKey || !clientId || !clientSecret || !lockId || !bridgeId) {
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
      const { data: adminCheck } = await supabase.from("admin_users").select("id").eq("user_id", user.id).single();
      if (!adminCheck) {
        return jsonResponse({
          success: false,
          error: "Admin access required"
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
    // ----------------------------------------------------------------
    // Find active PIN for this booking
    // ----------------------------------------------------------------
    const { data: activePin, error: pinFetchError } = await supabase.from("rental_access_codes").select("id, access_pin, pin_type").eq("order_id", bookingId).eq("status", "active").single();
    if (pinFetchError || !activePin) {
      console.log(`[delete-pin] No active PIN found for booking #${bookingId}`);
      return jsonResponse({
        success: true,
        message: "No active PIN found for this booking — nothing to delete",
        lockDeleted: false,
        dbExpired: false
      });
    }
    const now = new Date().toISOString();
    // ----------------------------------------------------------------
    // Step 1: Expire in DB immediately regardless of bridge status.
    // Customer portal loses access right away.
    // ----------------------------------------------------------------
    const { error: expireError } = await supabase.from("rental_access_codes").update({
      status: "expired",
      notified_at: now,
      lock_deleted_at: null
    }).eq("id", activePin.id);
    if (expireError) {
      console.error(`[delete-pin] Failed to expire PIN in DB for booking #${bookingId}:`, expireError.message);
      return jsonResponse({
        success: false,
        error: "Failed to expire PIN in database"
      }, 500);
    }
    console.log(`[delete-pin] ✓ PIN expired in DB for booking #${bookingId} — portal access revoked`);
    // ----------------------------------------------------------------
    // Step 2: Try to delete from lock via bridge.
    // Non-fatal if bridge is offline — cron Phase 1 will retry.
    // AlgoPINs cannot be deleted via bridge, so skip the lock call.
    // ----------------------------------------------------------------
    if (activePin.pin_type === "algopin") {
      console.log(`[delete-pin] PIN is algopin type — cannot delete from lock, will expire naturally`);
      return jsonResponse({
        success: true,
        bookingId,
        lockDeleted: false,
        dbExpired: true,
        message: "AlgoPIN expired in DB. It cannot be remotely deleted — it will expire naturally at its scheduled end time."
      });
    }
    const accessToken = await getOAuthToken(clientId, clientSecret);
    if (!accessToken) {
      console.error("[delete-pin] Failed to get OAuth token — DB already expired, lock will retry via cron");
      return jsonResponse({
        success: true,
        bookingId,
        lockDeleted: false,
        dbExpired: true,
        message: "PIN expired in DB. Lock deletion will be retried on the next cron run."
      });
    }
    const lockResult = await deletePinFromLock(accessToken, lockId, bridgeId, activePin.access_pin);
    if (lockResult.success) {
      // Mark lock deletion confirmed
      await supabase.from("rental_access_codes").update({
        lock_deleted_at: now
      }).eq("id", activePin.id);
      console.log(`[delete-pin] ✓ PIN deleted from lock for booking #${bookingId}`);
      return jsonResponse({
        success: true,
        bookingId,
        lockDeleted: true,
        dbExpired: true,
        message: "PIN fully deleted — portal access revoked and lock cleared."
      });
    }
    // Bridge offline — DB is already expired, cron will retry lock deletion
    console.warn(`[delete-pin] Bridge offline for booking #${bookingId} — lock deletion will retry via cron. Error: ${lockResult.error}`);
    return jsonResponse({
      success: true,
      bookingId,
      lockDeleted: false,
      dbExpired: true,
      message: "PIN expired in DB — portal access revoked. Lock deletion will be retried on the next cron run."
    });
  } catch (error) {
    console.error("[delete-pin] Unhandled exception:", error);
    return jsonResponse({
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }, 500);
  }
});
