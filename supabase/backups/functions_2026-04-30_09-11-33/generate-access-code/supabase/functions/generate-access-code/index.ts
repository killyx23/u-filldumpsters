import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.30.0';
import { corsHeaders } from './cors.ts';
const IGLOOHOME_API_KEY = Deno.env.get('IGLOOHOME_API_KEY') || 'lbaznyxkupyz1uy5ais4p0rk07s9vvg1hxptbo9vc48cxblhoyw';
const LOCK_ID = Deno.env.get('IGLOOHOME_LOCK_ID') || 'EB1X095c23a6';
const IGLOOHOME_API_BASE = 'https://connect.igloohome.co/v2';
Deno.serve(async (req)=>{
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
  }
  try {
    const { booking_id, customer_email, customer_phone, rental_start_time, rental_end_time } = await req.json();
    console.log('[generate-access-code] Processing request:', {
      booking_id,
      customer_email,
      rental_start_time,
      rental_end_time
    });
    if (!booking_id || !customer_email || !rental_start_time || !rental_end_time) {
      throw new Error('Missing required parameters');
    }
    // Initialize Supabase client
    const supabaseClient = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
    // Add 1 hour buffer to end time
    const endTimeWithBuffer = new Date(rental_end_time);
    endTimeWithBuffer.setHours(endTimeWithBuffer.getHours() + 1);
    // Call Igloohome API to generate PIN
    const igloohomeResponse = await fetch(`${IGLOOHOME_API_BASE}/locks/${LOCK_ID}/algopins`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${IGLOOHOME_API_KEY}`
      },
      body: JSON.stringify({
        name: `Order-${booking_id}`,
        start_date: new Date(rental_start_time).toISOString(),
        end_date: endTimeWithBuffer.toISOString(),
        type: 'duration'
      })
    });
    if (!igloohomeResponse.ok) {
      const errorText = await igloohomeResponse.text();
      throw new Error(`Igloohome API error: ${errorText}`);
    }
    const pinData = await igloohomeResponse.json();
    // Save to rental_access_codes table (single source of truth for PIN)
    const { data: accessCodeData, error: accessCodeError } = await supabaseClient.from('rental_access_codes').insert({
      order_id: booking_id,
      customer_email,
      customer_phone: customer_phone || '',
      access_pin: pinData.pin_code,
      pin_id: pinData.id,
      pin_type: 'algopin',
      lock_id: LOCK_ID,
      start_time: rental_start_time,
      end_time: endTimeWithBuffer.toISOString(),
      status: 'active'
    }).select().single();
    if (accessCodeError) {
      console.error('[generate-access-code] Database error:', accessCodeError);
      throw new Error(`Database error: ${accessCodeError.message}`);
    }
    // Update booking PIN tracking columns (no PIN stored on bookings anymore)
    const { error: updateError } = await supabaseClient.from('bookings').update({
      pin_generated_at: new Date().toISOString()
    }).eq('id', booking_id);
    if (updateError) {
      console.error('[generate-access-code] Booking update error:', updateError);
    }
    // Log PIN generation event
    await supabaseClient.from('rental_tracking_logs').insert({
      order_id: booking_id,
      event_type: 'pin_generated',
      event_timestamp: new Date().toISOString(),
      api_sync_timestamp: new Date().toISOString(),
      notes: `Automated PIN generation for order ${booking_id}`
    });
    console.log('[generate-access-code] ✓ Success:', {
      pin: pinData.pin_code,
      pin_id: pinData.id
    });
    return new Response(JSON.stringify({
      success: true,
      access_pin: pinData.pin_code,
      pin_id: pinData.id,
      start_time: rental_start_time,
      end_time: endTimeWithBuffer.toISOString()
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('[generate-access-code] ❌ Error:', error.message);
    return new Response(JSON.stringify({
      error: error.message
    }), {
      status: 400,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
});
