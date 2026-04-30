import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders } from "./cors.ts";
const IGLOOHOME_OAUTH_URL = "https://auth.igloohome.co/oauth2/token";
// Keep this as your newer API base URL unless iglooaccess docs show a different one
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
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  if (req.method !== "POST") {
    return jsonResponse({
      success: false,
      error: "Method not allowed"
    }, 405);
  }
  try {
    console.log("[generate-igloohome-pin] Function started");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const clientId = Deno.env.get("IGLOOHOME_CLIENT_ID");
    const clientSecret = Deno.env.get("IGLOOHOME_CLIENT_SECRET");
    const lockId = Deno.env.get("IGLOOHOME_LOCK_ID") || Deno.env.get("IGLOOHOME_DEVICE_ID");
    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse({
        success: false,
        error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY"
      }, 500);
    }
    if (!clientId || !clientSecret) {
      return jsonResponse({
        success: false,
        error: "Missing IGLOOHOME_CLIENT_ID or IGLOOHOME_CLIENT_SECRET"
      }, 500);
    }
    if (!lockId) {
      return jsonResponse({
        success: false,
        error: "Missing IGLOOHOME_LOCK_ID or IGLOOHOME_DEVICE_ID"
      }, 500);
    }
    let payload;
    try {
      payload = await req.json();
    } catch  {
      return jsonResponse({
        success: false,
        error: "Invalid or missing JSON body"
      }, 400);
    }
    const { booking_id, order_id, customer_email, customer_phone, start_time, end_time } = payload;
    console.log("[generate-igloohome-pin] Input:", {
      booking_id,
      order_id,
      customer_email,
      customer_phone,
      start_time,
      end_time,
      lockId
    });
    if (!booking_id || !order_id || !customer_email || !start_time || !end_time) {
      return jsonResponse({
        success: false,
        error: "Missing required fields",
        required: [
          "booking_id",
          "order_id",
          "customer_email",
          "start_time",
          "end_time"
        ]
      }, 400);
    }
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
    console.log("[generate-igloohome-pin] Requesting OAuth token:", IGLOOHOME_OAUTH_URL);
    const credentials = btoa(`${clientId}:${clientSecret}`);
    const oauthRes = await fetch(IGLOOHOME_OAUTH_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json"
      },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        scope: "igloohomeapi/algopin-onetime igloohomeapi/get-devices"
      })
    });
    const oauthBody = await readResponse(oauthRes);
    console.log("[generate-igloohome-pin] OAuth status:", oauthRes.status);
    if (!oauthRes.ok) {
      return jsonResponse({
        success: false,
        step: "oauth",
        error: `Igloohome OAuth failed with status ${oauthRes.status}`,
        attempted_url: IGLOOHOME_OAUTH_URL,
        response_text: oauthBody.text,
        response_json: oauthBody.json
      }, 500);
    }
    const accessToken = oauthBody.json?.access_token;
    if (!accessToken) {
      return jsonResponse({
        success: false,
        step: "oauth_token_extraction",
        error: "No access_token in OAuth response",
        response_text: oauthBody.text,
        response_json: oauthBody.json
      }, 500);
    }
    console.log("[generate-igloohome-pin] OAuth token received");
    const devicesUrl = `${IGLOOHOME_API_BASE_URL}/devices`;
    const devicesRes = await fetch(devicesUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json"
      }
    });
    const devicesBody = await readResponse(devicesRes);
    console.log("[generate-igloohome-pin] ALL DEVICES:", {
      status: devicesRes.status,
      devices: devicesBody.json
    });
    const accessCodeUrl = `${IGLOOHOME_API_BASE_URL}/devices/${lockId}/algopin/onetime`;
    const startUnix = Math.floor(new Date(start_time).getTime() / 1000);
    const endUnix = Math.floor(new Date(end_time).getTime() / 1000);
    // variance = rental duration in days, clamped to Igloohome's allowed range of 1–5
    const durationDays = Math.ceil((endUnix - startUnix) / 86400);
    const variance = Math.min(5, Math.max(1, durationDays));
    // Igloohome requires format: YYYY-MM-DDTHH:00:00+hh:mm
    // Minutes and seconds must be zeroed, must include timezone offset
    // Add 60s buffer so the time is never "in the past" by the time Igloohome processes it
    const now = new Date(Date.now() + 60000);
    const pad = (n)=>String(n).padStart(2, "0");
    const utcDate = now.toISOString().split("T")[0];
    const utcHour = now.getUTCHours();
    const startDateISO = `${utcDate}T${pad(utcHour)}:00:00+00:00`;
    const accessCodePayload = {
      accessName: `Dump Loader Rental - Order #${order_id}`,
      startDate: startDateISO,
      variance
    };
    console.log("[generate-igloohome-pin] Creating access code:", {
      accessCodeUrl,
      accessCodePayload
    });
    console.log("[generate-igloohome-pin] FULL DEBUG:", {
      url: accessCodeUrl,
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken.substring(0, 20)}...`,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      payload: accessCodePayload,
      currentTimeISO: new Date().toISOString(),
      startDateISO: accessCodePayload.startDate,
      timeDiffMs: new Date(accessCodePayload.startDate).getTime() - Date.now(),
      lockId,
      oauthScopes: "igloohomeapi/algopin-onetime igloohomeapi/get-devices"
    });
    const accessCodeRes = await fetch(accessCodeUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify(accessCodePayload)
    });
    const accessCodeBody = await readResponse(accessCodeRes);
    console.log("[generate-igloohome-pin] FULL RESPONSE DEBUG:", {
      status: accessCodeRes.status,
      statusText: accessCodeRes.statusText,
      headers: Object.fromEntries(accessCodeRes.headers.entries()),
      bodyText: accessCodeBody.text,
      bodyJson: accessCodeBody.json
    });
    console.log("[generate-igloohome-pin] Access code status:", accessCodeRes.status);
    if (!accessCodeRes.ok && accessCodeRes.status !== 201) {
      return jsonResponse({
        success: false,
        step: "access_code",
        error: `Igloohome access code creation failed with status ${accessCodeRes.status}`,
        attempted_url: accessCodeUrl,
        request_payload: accessCodePayload,
        response_text: accessCodeBody.text,
        response_json: accessCodeBody.json
      }, 500);
    }
    const accessCode = accessCodeBody.json?.pin || // ← Igloohome's actual field
    accessCodeBody.json?.access_code || accessCodeBody.json?.code || accessCodeBody.json?.data?.access_code || accessCodeBody.json?.data?.pin || accessCodeBody.json?.data?.code;
    const codeId = accessCodeBody.json?.pinId || // ← Igloohome's actual field
    accessCodeBody.json?.code_id || accessCodeBody.json?.id || accessCodeBody.json?.data?.code_id || accessCodeBody.json?.data?.id || "";
    if (!accessCode) {
      return jsonResponse({
        success: false,
        step: "access_code_extraction",
        error: "No access code found in Igloohome response",
        response_text: accessCodeBody.text,
        response_json: accessCodeBody.json
      }, 500);
    }
    console.log("[generate-igloohome-pin] Access code created successfully");
    const { error: updateError } = await supabase.from("bookings").update({
      access_pin: accessCode
    }).eq("id", booking_id);
    if (updateError) {
      console.error("[generate-igloohome-pin] Booking update failed:", updateError.message);
    }
    const { data: inserted, error: insertError } = await supabase.from("rental_access_codes").insert({
      order_id,
      customer_email,
      customer_phone: customer_phone || "",
      access_pin: accessCode,
      algo_pin_id: codeId || "",
      start_time,
      end_time,
      created_at: new Date().toISOString(),
      status: "active"
    }).select("id").single();
    if (insertError) {
      return jsonResponse({
        success: false,
        step: "database_insert",
        error: "Access code was created, but database insert failed",
        details: insertError.message,
        access_code: accessCode,
        code_id: codeId
      }, 500);
    }
    return jsonResponse({
      success: true,
      access_code: accessCode,
      code_id: codeId,
      booking_id,
      order_id,
      booking_updated: !updateError,
      rental_access_code_id: inserted?.id ?? null,
      message: "Access code created and saved successfully"
    });
  } catch (error) {
    console.error("[generate-igloohome-pin] Unhandled exception:", error);
    return jsonResponse({
      success: false,
      step: "unknown",
      error: error instanceof Error ? error.message : String(error)
    }, 500);
  }
});
