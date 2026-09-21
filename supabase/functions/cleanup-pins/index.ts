import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getCorsHeaders } from "./cors.ts";
import { deletePinVerified } from "../_shared/lockPin.ts";
import { PIN_REVOKE_STATUSES } from "../_shared/pinTiming.ts";
const IGLOOHOME_OAUTH_URL = "https://auth.igloohome.co/oauth2/token";
function makeJsonResponse(corsHeaders) {
  return (body, status = 200) => new Response(JSON.stringify(body), {
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
function sleep(ms) {
  return new Promise((resolve)=>setTimeout(resolve, ms));
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
  console.log("[cleanup-pins] OAuth status:", res.status);
  if (!res.ok || !body.json?.access_token) {
    console.error("[cleanup-pins] OAuth failed:", body.text);
    return null;
  }
  return body.json.access_token;
}
Deno.serve(async (req)=>{
  const corsHeaders = getCorsHeaders(req);
  const jsonResponse = makeJsonResponse(corsHeaders);
  if (req.method === "OPTIONS") return new Response(null, {
    headers: corsHeaders
  });
  try {
    console.log("[cleanup-pins] Started:", new Date().toISOString());
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
    const accessToken = await getOAuthToken(clientId, clientSecret);
    if (!accessToken) return jsonResponse({
      success: false,
      error: "Failed to get OAuth token"
    }, 500);
    const now = new Date().toISOString();
    let jobIndex = 0;
    const results = [];
    // ================================================================
    // STEP 1: Find all active PINs ordered newest-first per order
    // Keep the newest, delete the rest from the lock and expire in DB
    // ================================================================
    console.log("[cleanup-pins] === STEP 1: DUPLICATE CLEANUP ===");
    const { data: allActivePins, error: activePinsError } = await supabase.from("rental_access_codes").select("id, order_id, access_pin, pin_type, created_at").eq("status", "active").order("order_id", {
      ascending: true
    }).order("created_at", {
      ascending: false
    }); // newest first within each order
    if (activePinsError) {
      console.error("[cleanup-pins] Failed to query active PINs:", activePinsError.message);
      return jsonResponse({
        success: false,
        error: activePinsError.message
      }, 500);
    }
    // First entry per order_id is the newest — everything after is a duplicate
    const seenOrders = new Set();
    const duplicates = (allActivePins ?? []).filter((p)=>{
      if (seenOrders.has(p.order_id)) return true;
      seenOrders.add(p.order_id);
      return false;
    });
    console.log(`[cleanup-pins] Found ${duplicates.length} duplicate PIN(s) across ${allActivePins?.length ?? 0} active records`);
    for (const dup of duplicates){
      if (jobIndex > 0) {
        console.log("[cleanup-pins] Waiting 15s...");
        await sleep(15000);
      }
      jobIndex++;
      console.log(`[cleanup-pins] Deleting duplicate for order #${dup.order_id} (pin: ${dup.access_pin}, created: ${dup.created_at})`);
      try {
        if (dup.pin_type === "algopin") {
          await supabase.from("rental_access_codes").update({
            status: "expired",
            notified_at: now
          }).eq("id", dup.id);
          console.log(`[cleanup-pins] ✓ Duplicate AlgoPIN expired in DB for order #${dup.order_id} (lock code remains until natural end)`);
          results.push({
            orderId: dup.order_id,
            recordId: dup.id,
            lockDeleted: false,
            dbExpired: true
          });
          continue;
        }
        const deleteResult = await deletePinVerified(accessToken, lockId, bridgeId, dup.access_pin);
        if (!deleteResult.ok) {
          // Lock deletion failed — PIN may already be gone from the device.
          // Still expire in DB so the portal never shows it.
          console.warn(`[cleanup-pins] Lock delete failed for order #${dup.order_id} (may already be removed): ${deleteResult.error}`);
        }
        // Always expire in DB regardless of lock result
        const dupUpdate = {
          status: "expired",
          notified_at: now
        };
        if (deleteResult.ok) dupUpdate.lock_deleted_at = now;
        await supabase.from("rental_access_codes").update(dupUpdate).eq("id", dup.id);
        console.log(`[cleanup-pins] ✓ Duplicate expired for order #${dup.order_id}`);
        results.push({
          orderId: dup.order_id,
          recordId: dup.id,
          lockDeleted: deleteResult.ok,
          dbExpired: true
        });
      } catch (err) {
        console.error(`[cleanup-pins] Error processing duplicate for order #${dup.order_id}:`, err);
        results.push({
          orderId: dup.order_id,
          recordId: dup.id,
          lockDeleted: false,
          dbExpired: false,
          error: String(err)
        });
      }
    }
    // ================================================================
    // STEP 2: Expire any active PINs belonging to cancelled bookings
    // that the cron may have missed
    // ================================================================
    console.log("[cleanup-pins] === STEP 2: CANCELLED BOOKING CLEANUP ===");
    const { data: cancelledPins, error: cancelledError } = await supabase.from("rental_access_codes").select("id, order_id, access_pin, pin_type, bookings!inner(id, status)").eq("status", "active").in("bookings.status", [
      ...PIN_REVOKE_STATUSES
    ]);
    if (cancelledError) {
      console.error("[cleanup-pins] Failed to query cancelled PINs:", cancelledError.message);
    }
    const cancelResults = [];
    for (const record of cancelledPins ?? []){
      if (jobIndex > 0) {
        console.log("[cleanup-pins] Waiting 15s...");
        await sleep(15000);
      }
      jobIndex++;
      console.log(`[cleanup-pins] Deleting cancelled PIN for order #${record.order_id} (pin: ${record.access_pin})`);
      try {
        if (record.pin_type === "algopin") {
          await supabase.from("rental_access_codes").update({
            status: "expired",
            notified_at: now
          }).eq("id", record.id);
          console.log(`[cleanup-pins] ✓ AlgoPIN expired in DB for order #${record.order_id} (lock code remains until natural end)`);
          cancelResults.push({
            orderId: record.order_id,
            lockDeleted: false,
            dbExpired: true
          });
          continue;
        }
        const deleteResult = await deletePinVerified(accessToken, lockId, bridgeId, record.access_pin);
        if (!deleteResult.ok) {
          console.warn(`[cleanup-pins] Lock delete failed for cancelled order #${record.order_id}: ${deleteResult.error}`);
        }
        const update = {
          status: "expired",
          notified_at: now
        };
        if (deleteResult.ok) update.lock_deleted_at = now;
        await supabase.from("rental_access_codes").update(update).eq("id", record.id);
        console.log(`[cleanup-pins] ✓ Cancelled PIN expired for order #${record.order_id}`);
        cancelResults.push({
          orderId: record.order_id,
          lockDeleted: deleteResult.ok,
          dbExpired: true
        });
      } catch (err) {
        console.error(`[cleanup-pins] Error processing cancelled PIN for order #${record.order_id}:`, err);
        cancelResults.push({
          orderId: record.order_id,
          lockDeleted: false,
          dbExpired: false,
          error: String(err)
        });
      }
    }
    const dupSucceeded = results.filter((r)=>r.dbExpired).length;
    const cancelSucceeded = cancelResults.filter((r)=>r.dbExpired).length;
    console.log(`[cleanup-pins] Done. Duplicates: ${dupSucceeded}/${duplicates.length} | Cancelled: ${cancelSucceeded}/${(cancelledPins ?? []).length}`);
    return jsonResponse({
      success: true,
      duplicates: {
        processed: duplicates.length,
        succeeded: dupSucceeded,
        results
      },
      cancelled: {
        processed: (cancelledPins ?? []).length,
        succeeded: cancelSucceeded,
        results: cancelResults
      }
    });
  } catch (error) {
    console.error("[cleanup-pins] Unhandled exception:", error);
    return jsonResponse({
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }, 500);
  }
});
