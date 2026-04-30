import { corsHeaders } from "./cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [finalize-booking] Function invoked.`);
  try {
    const { booking_id } = await req.json();
    console.log(`[${timestamp}] [finalize-booking] Input parameters received: booking_id=${booking_id}`);
    if (!booking_id) {
      console.error(`[${timestamp}] [finalize-booking] Missing booking_id.`);
      return new Response(JSON.stringify({
        error: "Missing booking_id"
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    console.log(`[${timestamp}] [finalize-booking] Updating database to set status = 'confirmed'.`);
    const { data: updateData, error: updateError } = await supabase.from("bookings").update({
      status: "confirmed"
    }).eq("id", booking_id).select().single();
    if (updateError) {
      console.error(`[${timestamp}] [finalize-booking] Database update failed:`, updateError);
      throw new Error(`Database update failed: ${updateError.message}`);
    }
    console.log(`[${timestamp}] [finalize-booking] Database update successful. Status is now 'confirmed'.`);
    console.log(`[${timestamp}] [finalize-booking] Invoking send-booking-confirmation function.`);
    const { data: emailData, error: emailError } = await supabase.functions.invoke('send-booking-confirmation', {
      body: {
        booking_id
      }
    });
    if (emailError) {
      console.error(`[${timestamp}] [finalize-booking] Email sending operation failed:`, emailError);
    } else {
      console.log(`[${timestamp}] [finalize-booking] Email sending operation successful:`, emailData);
    }
    return new Response(JSON.stringify({
      success: true,
      booking: updateData,
      email_status: emailError ? 'failed' : 'sent'
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  } catch (error) {
    console.error(`[${timestamp}] [finalize-booking] CRITICAL ERROR:`, error.message);
    return new Response(JSON.stringify({
      error: error.message
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
});
