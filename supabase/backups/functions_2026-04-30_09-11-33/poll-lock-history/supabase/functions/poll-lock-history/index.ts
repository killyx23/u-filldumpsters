import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.30.0';
import { corsHeaders } from './cors.ts';
const IGLOOHOME_API_KEY = Deno.env.get('IGLOOHOME_API_KEY') || 'lbaznyxkupyz1uy5ais4p0rk07s9vvg1hxptbo9vc48cxblhoyw';
const LOCK_ID = Deno.env.get('IGLOOHOME_LOCK_ID') || 'EB1X095c23a6';
const IGLOOHOME_API_BASE = 'https://connect.igloohome.co/v2';
const BREVO_API_KEY = Deno.env.get('BREVO_API_KEY');
const BREVO_FROM_EMAIL = Deno.env.get('BREVO_FROM_EMAIL');
Deno.serve(async (req)=>{
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
  }
  try {
    const supabaseClient = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
    console.log('[poll-lock-history] Starting lock history poll...');
    // Get all active rentals (status not 'Returned' or 'Cancelled')
    const { data: activeRentals, error: rentalsError } = await supabaseClient
      .from('bookings')
      .select('id, email, phone, drop_off_date, pickup_date, status')
      .not('status', 'in', '("Returned","Cancelled")');
    if (rentalsError) throw rentalsError;
    console.log(`[poll-lock-history] Found ${activeRentals?.length || 0} active rentals`);
    const processedEvents = [];
    const overdueRentals = [];
    for (const rental of activeRentals || []){
      try {
        // Load the latest active access code for this rental (PIN source of truth)
        const { data: accessCode, error: accessCodeError } = await supabaseClient
          .from('rental_access_codes')
          .select('access_pin')
          .eq('order_id', rental.id)
          .eq('status', 'active')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (accessCodeError) {
          console.error(`[poll-lock-history] Error loading access code for order ${rental.id}:`, accessCodeError.message);
          continue;
        }

        if (!accessCode?.access_pin) {
          // No active PIN — nothing to poll for this booking
          continue;
        }

        // Get last sync timestamp for this order
        const { data: lastLog } = await supabaseClient.from('rental_tracking_logs').select('api_sync_timestamp').eq('order_id', rental.id).not('api_sync_timestamp', 'is', null).order('api_sync_timestamp', {
          ascending: false
        }).limit(1).single();
        const lastSyncTime = lastLog?.api_sync_timestamp || new Date(rental.drop_off_date).toISOString();
        // Call Igloohome API for lock history
        const params = new URLSearchParams({
          lock_id: LOCK_ID,
          start_date: lastSyncTime,
          end_date: new Date().toISOString()
        });
        const response = await fetch(`${IGLOOHOME_API_BASE}/locks/${LOCK_ID}/history?${params}`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${IGLOOHOME_API_KEY}`
          }
        });
        if (!response.ok) {
          console.error(`[poll-lock-history] API error for order ${rental.id}`);
          continue;
        }
        const historyData = await response.json();
        const events = historyData.events || [];
        // Filter events for this rental's PIN
        const rentalEvents = events.filter((e)=>e.pin_code === accessCode.access_pin);
        for (const event of rentalEvents){
          const eventType = event.action === 'unlock' ? 'unlock' : 'lock';
          // Save to rental_tracking_logs
          await supabaseClient.from('rental_tracking_logs').insert({
            order_id: rental.id,
            event_type: eventType,
            event_timestamp: event.timestamp,
            api_sync_timestamp: new Date().toISOString(),
            notes: `${eventType} event detected via API poll`
          });
          // Update booking status
          if (eventType === 'unlock' && rental.status !== 'In Progress') {
            await supabaseClient.from('bookings').update({
              status: 'In Progress'
            }).eq('id', rental.id);
          } else if (eventType === 'lock') {
            await supabaseClient.from('bookings').update({
              status: 'Returned - Pending Inspection'
            }).eq('id', rental.id);
          }
          processedEvents.push({
            order_id: rental.id,
            event_type: eventType,
            timestamp: event.timestamp
          });
        }
        // Check for overdue rentals
        const scheduledReturnTime = new Date(rental.pickup_date);
        const overdueThreshold = new Date(scheduledReturnTime.getTime() + 30 * 60 * 1000); // +30 minutes
        const now = new Date();
        if (now > overdueThreshold) {
          // Check if there's a 'lock' event
          const { data: lockEvent } = await supabaseClient.from('rental_tracking_logs').select('id').eq('order_id', rental.id).eq('event_type', 'lock').single();
          if (!lockEvent) {
            // Flag as overdue
            await supabaseClient.from('bookings').update({
              status: 'Overdue/No Sync'
            }).eq('id', rental.id);
            overdueRentals.push(rental);
            // Send admin alert email
            if (BREVO_API_KEY && BREVO_FROM_EMAIL) {
              await fetch('https://api.brevo.com/v3/smtp/email', {
                method: 'POST',
                headers: {
                  'Accept': 'application/json',
                  'Content-Type': 'application/json',
                  'api-key': BREVO_API_KEY
                },
                body: JSON.stringify({
                  sender: {
                    email: BREVO_FROM_EMAIL,
                    name: 'U-Fill Dumpsters - System Alert'
                  },
                  to: [
                    {
                      email: BREVO_FROM_EMAIL,
                      name: 'Admin'
                    }
                  ],
                  subject: `ALERT: Overdue Rental - Order #${rental.id}`,
                  htmlContent: `
                    <h2>Overdue Rental Alert</h2>
                    <p><strong>Order ID:</strong> ${rental.id}</p>
                    <p><strong>Customer:</strong> ${rental.email}</p>
                    <p><strong>Scheduled Return:</strong> ${scheduledReturnTime.toLocaleString()}</p>
                    <p><strong>Current Status:</strong> No lock event detected 30+ minutes past return time</p>
                    <p>Please contact customer immediately.</p>
                  `
                })
              });
            }
          }
        }
      } catch (error) {
        console.error(`[poll-lock-history] Error processing rental ${rental.id}:`, error);
      }
    }
    console.log('[poll-lock-history] ✓ Poll completed:', {
      processed_events: processedEvents.length,
      overdue_rentals: overdueRentals.length
    });
    return new Response(JSON.stringify({
      success: true,
      processed_events: processedEvents,
      overdue_rentals: overdueRentals.length
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('[poll-lock-history] ❌ Error:', error.message);
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
