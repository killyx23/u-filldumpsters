// Supabase Edge Function: igloohome-generate-pin
// Expects JSON body: { booking_id, order_id, service_type, start_time, end_time }
// Returns: { success: boolean, access_code?: string, code_id?: string, error?: string }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
function toUtcIsoZ(d) {
  const pad = (n)=>String(n).padStart(2, "0");
  const y = d.getUTCFullYear();
  const m = pad(d.getUTCMonth() + 1);
  const day = pad(d.getUTCDate());
  const hh = pad(d.getUTCHours());
  const mm = pad(d.getUTCMinutes());
  const ss = pad(d.getUTCSeconds());
  return `${y}-${m}-${day}T${hh}:${mm}:${ss}Z`;
}
Deno.serve(async (req)=>{
  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({
        success: false,
        error: "Method not allowed"
      }), {
        status: 405,
        headers: {
          "Content-Type": "application/json"
        }
      });
    }
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      return new Response(JSON.stringify({
        success: false,
        error: "Missing Supabase env vars"
      }), {
        status: 500,
        headers: {
          "Content-Type": "application/json"
        }
      });
    }
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false
      }
    });
    const body = await req.json();
    const { booking_id, order_id } = body;
    const start = new Date(body.start_time);
    const end = new Date(body.end_time);
    const v_start_date = toUtcIsoZ(start);
    const v_end_date = toUtcIsoZ(end);
    const client_id = Deno.env.get("IGLOOHOME_CLIENT_ID");
    const client_secret = Deno.env.get("IGLOOHOME_CLIENT_SECRET");
    const bluetooth_id = Deno.env.get("IGLOOHOME_BLUETOOTH_ID") ?? "SK3E124fc82a";
    if (!client_id || !client_secret) {
      return new Response(JSON.stringify({
        success: false,
        error: "Missing IGLOOHOME_CLIENT_ID / IGLOOHOME_CLIENT_SECRET secrets in Supabase"
      }), {
        status: 500,
        headers: {
          "Content-Type": "application/json"
        }
      });
    }
    // 1) OAuth token
    const tokenRes = await fetch("https://api.igloohome.co/v2/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id,
        client_secret
      })
    });
    const tokenJson = await tokenRes.json().catch(()=>null);
    if (!tokenRes.ok) {
      return new Response(JSON.stringify({
        success: false,
        error: `OAuth token request failed with status ${tokenRes.status}`,
        response: tokenJson
      }), {
        status: 500,
        headers: {
          "Content-Type": "application/json"
        }
      });
    }
    const accessToken = tokenJson?.access_token;
    if (!accessToken) {
      return new Response(JSON.stringify({
        success: false,
        error: "No access_token in OAuth response"
      }), {
        status: 500,
        headers: {
          "Content-Type": "application/json"
        }
      });
    }
    // 2) Create access code
    const requestBody = {
      name: `Dump Loader Rental - Order #${order_id}`,
      start_date: v_start_date,
      end_date: v_end_date,
      access_type: "time_bound"
    };
    const accessRes = await fetch(`https://api.igloohome.co/v2/locks/${bluetooth_id}/access-codes`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(requestBody)
    });
    const accessJson = await accessRes.json().catch(()=>null);
    if (!accessRes.ok && accessRes.status !== 201) {
      return new Response(JSON.stringify({
        success: false,
        error: `Access code creation failed with status ${accessRes.status}`,
        response: accessJson
      }), {
        status: 500,
        headers: {
          "Content-Type": "application/json"
        }
      });
    }
    const access_code = accessJson?.access_code ?? accessJson?.pin ?? accessJson?.code;
    const code_id = accessJson?.code_id ?? accessJson?.id;
    if (!access_code) {
      return new Response(JSON.stringify({
        success: false,
        error: "No access_code in response",
        response: accessJson
      }), {
        status: 500,
        headers: {
          "Content-Type": "application/json"
        }
      });
    }
    // 3) Persist to DB
    const { data: booking, error: bookingErr } = await supabase.from("bookings").select("email, phone").eq("id", booking_id).maybeSingle();
    if (bookingErr) {
      return new Response(JSON.stringify({
        success: false,
        error: "Failed to load booking",
        details: bookingErr.message
      }), {
        status: 500,
        headers: {
          "Content-Type": "application/json"
        }
      });
    }
    if (!booking) {
      return new Response(JSON.stringify({
        success: false,
        error: "Booking not found"
      }), {
        status: 404,
        headers: {
          "Content-Type": "application/json"
        }
      });
    }
    const email = booking.email;
    const phone = booking.phone ?? "";
    const { error: insertErr } = await supabase.from("rental_access_codes").insert({
      order_id,
      customer_email: email,
      customer_phone: phone,
      access_pin: access_code,
      algo_pin_id: code_id ?? "",
      start_time: body.start_time,
      end_time: body.end_time,
      created_at: new Date().toISOString(),
      status: "active"
    });
    if (insertErr) {
      return new Response(JSON.stringify({
        success: false,
        error: "Database insert failed",
        details: insertErr.message
      }), {
        status: 500,
        headers: {
          "Content-Type": "application/json"
        }
      });
    }
    await supabase.from("bookings").update({
      access_pin: access_code
    }).eq("id", booking_id);
    return new Response(JSON.stringify({
      success: true,
      access_code,
      code_id: code_id ?? null
    }), {
      headers: {
        "Content-Type": "application/json"
      }
    });
  } catch (e) {
    return new Response(JSON.stringify({
      success: false,
      error: e.message
    }), {
      status: 500,
      headers: {
        "Content-Type": "application/json"
      }
    });
  }
});
