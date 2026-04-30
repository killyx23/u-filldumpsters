import { corsHeaders } from "./cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.30.0";
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [generate-igloohome-pin] Edge Function invoked`);
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const supabase = createClient(supabaseUrl, supabaseKey);
    const requestBody = await req.json();
    console.log(`[${timestamp}] [generate-igloohome-pin] Edge Function called with:`, {
      booking_id: requestBody.booking_id,
      order_id: requestBody.order_id,
      service_type: requestBody.service_type,
      has_customer_email: !!requestBody.customer_email,
      has_customer_phone: !!requestBody.customer_phone,
      start_time: requestBody.start_time,
      end_time: requestBody.end_time
    });
    const { booking_id, order_id, customer_email, customer_phone, start_time, end_time, service_type, customer_name } = requestBody;
    // STEP 1: Validate service type
    console.log(`[${timestamp}] [generate-igloohome-pin] Validating service type: ${service_type}`);
    const isDumpLoaderRental = service_type?.toLowerCase().includes('dump loader') || service_type?.toLowerCase().includes('trailer');
    if (!isDumpLoaderRental) {
      console.log(`[${timestamp}] [generate-igloohome-pin] Service type not eligible for PIN: ${service_type}`);
      return new Response(JSON.stringify({
        success: false,
        error: "This service does not require an access code",
        service_type
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    // Validate required fields
    if (!order_id || !start_time || !end_time) {
      console.error(`[${timestamp}] [generate-igloohome-pin] Missing required fields`);
      return new Response(JSON.stringify({
        success: false,
        error: "Missing required fields: order_id, start_time, end_time"
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    // Format dates for Igloohome API (ISO 8601 format)
    const startDate = new Date(start_time).toISOString();
    const endDate = new Date(end_time).toISOString();
    const pinName = customer_name || `Dump Loader Rental - Order #${order_id}`;
    console.log(`[${timestamp}] [generate-igloohome-pin] Formatted dates:`, {
      start_date: startDate,
      end_date: endDate,
      pin_name: pinName
    });
    // STEP 2: Get OAuth Access Token
    console.log(`[${timestamp}] [generate-igloohome-pin] STEP 1: Getting OAuth access token...`);
    const oauthParams = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: "bhortmwb5bvr9uw3qqi904hgrf",
      client_secret: "lbaznyxkupyz1uy5ais4p0rk07s9vvg1hxptbo9vc48cxblhoyw"
    });
    console.log(`[${timestamp}] [generate-igloohome-pin] OAuth request params:`, {
      grant_type: "client_credentials",
      client_id: "bhortmwb5bvr9uw3qqi904hgrf",
      client_secret: "[REDACTED]"
    });
    const oauthResponse = await fetch("https://api.igloohome.co/v2/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: oauthParams.toString()
    });
    const oauthText = await oauthResponse.text();
    console.log(`[${timestamp}] [generate-igloohome-pin] OAuth response status: ${oauthResponse.status}`);
    console.log(`[${timestamp}] [generate-igloohome-pin] OAuth raw response:`, oauthText);
    if (!oauthResponse.ok) {
      console.error(`[${timestamp}] [generate-igloohome-pin] OAuth token request failed:`, {
        status: oauthResponse.status,
        response: oauthText
      });
      return new Response(JSON.stringify({
        success: false,
        error: `OAuth authentication failed: ${oauthResponse.status}`,
        details: oauthText
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    let oauthData;
    try {
      oauthData = JSON.parse(oauthText);
      console.log(`[${timestamp}] [generate-igloohome-pin] OAuth response parsed:`, {
        has_access_token: !!oauthData.access_token,
        token_type: oauthData.token_type,
        expires_in: oauthData.expires_in
      });
    } catch (parseError) {
      console.error(`[${timestamp}] [generate-igloohome-pin] Failed to parse OAuth response:`, parseError);
      return new Response(JSON.stringify({
        success: false,
        error: "Invalid OAuth response format",
        raw_response: oauthText
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const accessToken = oauthData.access_token;
    if (!accessToken) {
      console.error(`[${timestamp}] [generate-igloohome-pin] No access token in OAuth response:`, oauthData);
      return new Response(JSON.stringify({
        success: false,
        error: "No access token returned from OAuth",
        oauth_response: oauthData
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    console.log(`[${timestamp}] [generate-igloohome-pin] ✓ Got access token from Igloohome`);
    // STEP 3: Create Access Code using OAuth token
    console.log(`[${timestamp}] [generate-igloohome-pin] STEP 2: Creating access code with OAuth token...`);
    console.log(`[${timestamp}] [generate-igloohome-pin] Lock ID: SK3E124fc82a`);
    const igloohomePayload = {
      name: pinName,
      start_date: startDate,
      end_date: endDate,
      access_type: "time_bound"
    };
    console.log(`[${timestamp}] [generate-igloohome-pin] Access code request payload:`, igloohomePayload);
    const igloohomeResponse = await fetch("https://api.igloohome.co/v2/locks/SK3E124fc82a/access-codes", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(igloohomePayload)
    });
    const responseText = await igloohomeResponse.text();
    console.log(`[${timestamp}] [generate-igloohome-pin] Access code API response status: ${igloohomeResponse.status}`);
    console.log(`[${timestamp}] [generate-igloohome-pin] Access code API raw response:`, responseText);
    if (!igloohomeResponse.ok) {
      console.error(`[${timestamp}] [generate-igloohome-pin] Access code API error:`, {
        status: igloohomeResponse.status,
        body: responseText
      });
      return new Response(JSON.stringify({
        success: false,
        error: `Igloohome API error: ${igloohomeResponse.status}`,
        details: responseText,
        api_status: igloohomeResponse.status
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    let apiData;
    try {
      apiData = JSON.parse(responseText);
      console.log(`[${timestamp}] [generate-igloohome-pin] Access code API response parsed:`, apiData);
    } catch (parseError) {
      console.error(`[${timestamp}] [generate-igloohome-pin] Failed to parse access code API response:`, parseError);
      return new Response(JSON.stringify({
        success: false,
        error: "Invalid API response format",
        raw_response: responseText
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    // Extract access code and ID from response
    const accessCode = apiData.access_code || apiData.pin || apiData.code || apiData.pin_code;
    const codeId = apiData.code_id || apiData.id || apiData.access_code_id;
    console.log(`[${timestamp}] [generate-igloohome-pin] Extracted from API response:`, {
      access_code: accessCode,
      code_id: codeId
    });
    if (!accessCode) {
      console.error(`[${timestamp}] [generate-igloohome-pin] No access code in response:`, apiData);
      return new Response(JSON.stringify({
        success: false,
        error: "No access code returned from API",
        api_response: apiData
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    console.log(`[${timestamp}] [generate-igloohome-pin] ✓ Created access code: ${accessCode}`);
    // STEP 4: Save to Database
    console.log(`[${timestamp}] [generate-igloohome-pin] STEP 3: Saving access code to database...`);
    const dbRecord = {
      order_id: order_id,
      customer_email: customer_email || "",
      customer_phone: customer_phone || "",
      access_pin: accessCode,
      algo_pin_id: codeId || "",
      start_time: startDate,
      end_time: endDate,
      status: "active"
    };
    console.log(`[${timestamp}] [generate-igloohome-pin] Database record to insert:`, {
      order_id: dbRecord.order_id,
      has_customer_email: !!dbRecord.customer_email,
      has_customer_phone: !!dbRecord.customer_phone,
      access_pin: dbRecord.access_pin,
      algo_pin_id: dbRecord.algo_pin_id,
      start_time: dbRecord.start_time,
      end_time: dbRecord.end_time,
      status: dbRecord.status
    });
    const { data: insertData, error: insertError } = await supabase.from("rental_access_codes").insert(dbRecord).select().single();
    if (insertError) {
      console.error(`[${timestamp}] [generate-igloohome-pin] Database insert error:`, insertError);
      return new Response(JSON.stringify({
        success: false,
        error: "Failed to save access code to database",
        db_error: insertError.message,
        access_code: accessCode,
        code_id: codeId
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    console.log(`[${timestamp}] [generate-igloohome-pin] ✓ Saved access code to database`);
    console.log(`[${timestamp}] [generate-igloohome-pin] Inserted record ID: ${insertData.id}`);
    // STEP 5: Update Booking
    console.log(`[${timestamp}] [generate-igloohome-pin] STEP 4: Updating booking with access_pin...`);
    console.log(`[${timestamp}] [generate-igloohome-pin] Booking ID: ${order_id}`);
    const { error: updateError } = await supabase.from("bookings").update({
      access_pin: accessCode
    }).eq("id", order_id);
    if (updateError) {
      console.error(`[${timestamp}] [generate-igloohome-pin] Booking update error:`, updateError);
    } else {
      console.log(`[${timestamp}] [generate-igloohome-pin] ✓ Updated booking with access_pin`);
    }
    console.log(`[${timestamp}] [generate-igloohome-pin] ✓ PIN generation complete - SUCCESS`);
    console.log(`[${timestamp}] [generate-igloohome-pin] Final access code: ${accessCode}`);
    return new Response(JSON.stringify({
      success: true,
      access_code: accessCode,
      code_id: codeId,
      start_time: startDate,
      end_time: endDate,
      message: "PIN generated successfully",
      api_response: apiData,
      database_record: insertData
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  } catch (error) {
    const errorTimestamp = new Date().toISOString();
    console.error(`[${errorTimestamp}] [generate-igloohome-pin] Unhandled error:`, {
      message: error.message,
      stack: error.stack,
      name: error.name
    });
    return new Response(JSON.stringify({
      success: false,
      error: error.message || "Internal server error",
      error_name: error.name,
      stack: error.stack
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
});
