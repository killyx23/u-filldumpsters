import { corsHeaders } from "./cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
const IGLOOHOME_CLIENT_ID = Deno.env.get("IGLOOHOME_CLIENT_ID");
const IGLOOHOME_CLIENT_SECRET = Deno.env.get("IGLOOHOME_CLIENT_SECRET");
const IGLOOHOME_DEVICE_ID = Deno.env.get("IGLOOHOME_DEVICE_ID");
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  try {
    const { booking_id } = await req.json();
    if (!booking_id) {
      return new Response(JSON.stringify({
        error: "booking_id is required"
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    console.log("[generate-pin] Generating PIN for booking:", booking_id);
    // Initialize Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const supabase = createClient(supabaseUrl, supabaseKey);
    // Fetch booking details
    const { data: booking, error: bookingError } = await supabase.from("bookings").select("id, email, phone, drop_off_date, pickup_date, first_name, last_name").eq("id", booking_id).single();
    if (bookingError || !booking) {
      console.error("[generate-pin] Booking not found:", bookingError);
      return new Response(JSON.stringify({
        error: "Booking not found"
      }), {
        status: 404,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    // Check if PIN already exists for this booking
    const { data: existingPin } = await supabase.from("rental_access_codes").select("*").eq("order_id", booking_id).eq("status", "active").single();
    if (existingPin) {
      console.log("[generate-pin] PIN already exists for booking:", booking_id);
      return new Response(JSON.stringify({
        success: true,
        message: "PIN already exists",
        pin: existingPin.access_pin,
        pin_id: existingPin.pin_id
      }), {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    // Generate 4-digit PIN
    const accessPin = Math.floor(1000 + Math.random() * 9000).toString();
    // Calculate start and end times for PIN validity
    const dropOffDate = new Date(booking.drop_off_date);
    const pickupDate = new Date(booking.pickup_date);
    // Set start time to 6 AM on drop-off date
    const startTime = new Date(dropOffDate);
    startTime.setHours(6, 0, 0, 0);
    // Set end time to 8 PM on pickup date
    const endTime = new Date(pickupDate);
    endTime.setHours(20, 0, 0, 0);
    console.log("[generate-pin] PIN validity:", {
      startTime,
      endTime
    });
    // Create PIN in Igloohome (if configured)
    let pinId = `PIN-${booking_id}-${Date.now()}`;
    if (IGLOOHOME_CLIENT_ID && IGLOOHOME_CLIENT_SECRET && IGLOOHOME_DEVICE_ID) {
      try {
        // Get Igloohome access token
        const tokenResponse = await fetch("https://api.igloohome.co/v1/oauth/token", {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded"
          },
          body: new URLSearchParams({
            grant_type: "client_credentials",
            client_id: IGLOOHOME_CLIENT_ID,
            client_secret: IGLOOHOME_CLIENT_SECRET
          })
        });
        if (tokenResponse.ok) {
          const tokenData = await tokenResponse.json();
          const accessToken = tokenData.access_token;
          // Create PIN in Igloohome
          const pinResponse = await fetch("https://api.igloohome.co/v1/pins", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${accessToken}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              lock_id: IGLOOHOME_DEVICE_ID,
              pin_code: accessPin,
              start_date: startTime.toISOString(),
              end_date: endTime.toISOString(),
              name: `${booking.first_name || 'Customer'} - Booking ${booking_id}`
            })
          });
          if (pinResponse.ok) {
            const pinData = await pinResponse.json();
            pinId = pinData.pin_id || pinId;
            console.log("[generate-pin] ✓ PIN created in Igloohome:", pinId);
          } else {
            console.warn("[generate-pin] Failed to create PIN in Igloohome, using local PIN only");
          }
        }
      } catch (igloohomeError) {
        console.warn("[generate-pin] Igloohome integration error (continuing with local PIN):", igloohomeError);
      }
    } else {
      console.log("[generate-pin] Igloohome not configured, using local PIN only");
    }
    // Store PIN in rental_access_codes table
    const { data: accessCode, error: insertError } = await supabase.from("rental_access_codes").insert({
      order_id: booking_id,
      customer_email: booking.email,
      customer_phone: booking.phone || "",
      access_pin: accessPin,
      pin_id: pinId,
      start_time: startTime.toISOString(),
      end_time: endTime.toISOString(),
      status: "active",
      pin_type: "duration",
      lock_id: IGLOOHOME_DEVICE_ID || "local",
      created_at: new Date().toISOString()
    }).select().single();
    if (insertError) {
      console.error("[generate-pin] Insert error:", insertError);
      throw new Error("Failed to store access PIN");
    }
    // Update booking with PIN generation timestamp
    await supabase.from("bookings").update({
      pin_generated_at: new Date().toISOString()
    }).eq("id", booking_id);
    console.log("[generate-pin] ✓ PIN generated and stored successfully");
    return new Response(JSON.stringify({
      success: true,
      message: "PIN generated successfully",
      pin: accessPin,
      pin_id: pinId,
      start_time: startTime.toISOString(),
      end_time: endTime.toISOString()
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  } catch (error) {
    console.error("[generate-pin] Error:", error);
    return new Response(JSON.stringify({
      error: error.message || "Failed to generate PIN"
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
});
