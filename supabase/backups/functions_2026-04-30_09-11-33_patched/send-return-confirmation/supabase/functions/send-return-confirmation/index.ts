import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.30.0';
import { corsHeaders } from './cors.ts';
const BREVO_API_KEY = Deno.env.get('BREVO_API_KEY');
const BREVO_FROM_EMAIL = Deno.env.get('BREVO_FROM_EMAIL');
const SITE_URL = Deno.env.get('SITE_URL') || 'https://your-site.com';
Deno.serve(async (req)=>{
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
  }
  try {
    const { order_id, lock_event_timestamp } = await req.json();
    console.log('[send-return-confirmation] Processing return for order:', order_id);
    const supabaseClient = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
    // Get booking details
    const { data: booking, error: bookingError } = await supabaseClient.from('bookings').select('*, customers(*)').eq('id', order_id).single();
    if (bookingError) throw bookingError;
    // Update booking status to 'Returned'
    await supabaseClient.from('bookings').update({
      status: 'Returned',
      returned_at: lock_event_timestamp
    }).eq('id', order_id);
    // Log the return confirmation
    await supabaseClient.from('rental_tracking_logs').insert({
      order_id,
      event_type: 'lock',
      event_timestamp: lock_event_timestamp,
      api_sync_timestamp: new Date().toISOString(),
      notes: 'Return confirmation email sent'
    });
    // Send customer confirmation email
    if (BREVO_API_KEY && BREVO_FROM_EMAIL) {
      const returnTimestamp = new Date(lock_event_timestamp).toLocaleString();
      const portalLink = `${SITE_URL}/customer-portal/dashboard?order_id=${order_id}`;
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
            name: 'U-Fill Dumpsters'
          },
          to: [
            {
              email: booking.email,
              name: booking.name
            }
          ],
          subject: `Thank you for your rental! (Order #${order_id})`,
          htmlContent: `
            <h2>Thank You for Your Rental!</h2>
            <p>Dear ${booking.name},</p>
            <p>We have confirmed that your Dump Loader Trailer was returned at <strong>${returnTimestamp}</strong>.</p>
            
            <h3>Next Steps:</h3>
            <ul>
              <li>Our team will conduct a final inspection within 24 hours</li>
              <li>Your final invoice will be sent to this email</li>
              <li>Any applicable fees (dump fees, overdue fees, damage fees) will be clearly itemized</li>
            </ul>

            <p><a href="${portalLink}" style="display:inline-block;background:#4F46E5;color:white;padding:12px 24px;text-decoration:none;border-radius:6px;margin:16px 0;">View Rental Details</a></p>

            <p>Thank you for choosing U-Fill Dumpsters!</p>
            <p style="color:#666;font-size:12px;">If you did not return the trailer, please contact us immediately at ${BREVO_FROM_EMAIL}</p>
          `
        })
      });
      // Send admin notification
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
            name: 'U-Fill Dumpsters - System'
          },
          to: [
            {
              email: BREVO_FROM_EMAIL,
              name: 'Admin'
            }
          ],
          subject: `Trailer Returned - Order #${order_id}`,
          htmlContent: `
            <h2>Trailer Return Notification</h2>
            <p><strong>Order ID:</strong> ${order_id}</p>
            <p><strong>Customer:</strong> ${booking.name} (${booking.email})</p>
            <p><strong>Return Time:</strong> ${returnTimestamp}</p>
            <p><strong>Status:</strong> Awaiting Inspection</p>
            <p>Please schedule inspection and finalize billing.</p>
          `
        })
      });
    }
    console.log('[send-return-confirmation] ✓ Return confirmation sent');
    return new Response(JSON.stringify({
      success: true,
      order_id,
      status: 'Returned'
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('[send-return-confirmation] ❌ Error:', error.message);
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
