import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from './cors.ts';
const brevoApiKey = Deno.env.get('BREVO_API_KEY');
const fromEmail = Deno.env.get('BREVO_FROM_EMAIL');
const generateEmailHtml = (name, subject, message, portalInfo)=>`
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; color: #333; line-height: 1.6; }
          .container { max-width: 600px; margin: 20px auto; padding: 20px; border: 1px solid #ddd; border-radius: 8px; background-color: #f9f9f9; }
          .header { font-size: 24px; font-weight: bold; color: #003366; text-align: center; margin-bottom: 20px; }
          .footer { font-size: 12px; color: #777; margin-top: 20px; text-align: center; }
          .portal-note { background-color: #eef7ff; border: 1px solid #b3d7ff; padding: 15px; border-radius: 5px; margin-top: 20px; }
          .custom-message { background-color: #fffbe6; border: 1px solid #ffe58f; padding: 15px; border-radius: 5px; margin-top: 20px; color: #8a6d3b; }
          strong { color: #003366; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">${subject}</div>
          <p>Hello ${name},</p>
          <div class="custom-message">${message}</div>
          ${portalInfo}
          <p>We look forward to serving you!</p>
          <p>Sincerely,<br>The U-Fill Dumpsters Team</p>
          <div class="footer">
            U-Fill Dumpsters LLC | Saratoga Springs, UT | (801) 810-8832
          </div>
        </div>
      </body>
      </html>
    `;
Deno.serve(async (req)=>{
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
  }
  try {
    const { bookingId } = await req.json();
    if (!bookingId) throw new Error('Booking ID is required.');
    if (!brevoApiKey || !fromEmail) throw new Error('Missing environment variables.');
    const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
    const { data: booking, error: bookingError } = await supabaseAdmin.from('bookings').select(`*, customers(*)`).eq('id', bookingId).single();
    if (bookingError || !booking) throw new Error(bookingError?.message || 'Booking not found.');
    const { email, name, customer_id_text, phone } = booking.customers;
    const rawPhone = phone ? phone.replace(/\D/g, '') : '';
    const serviceName = booking.plan?.name + (booking.addons?.isDelivery ? ' with Delivery' : '');
    const isPending = booking.status === 'pending_review' || booking.status === 'pending_verification';
    let subject, message, portalInfo, attachment = [];
    // Only try to generate and attach the receipt for confirmed bookings
    if (!isPending) {
      const { data: receiptData, error: receiptError } = await supabaseAdmin.functions.invoke('get-receipt-pdf', {
        body: {
          bookingId: booking.id
        }
      });
      if (receiptError || !receiptData.pdf) {
        console.error('Failed to generate PDF receipt for attachment:', receiptError?.message || receiptData?.error || 'PDF data missing.');
      } else {
        attachment.push({
          name: `U-Fill-Receipt-${booking.id}.pdf`,
          content: receiptData.pdf
        });
      }
    }
    const customerPortalLink = `https://www.u-filldumpsters.com/login?cid=${encodeURIComponent(customer_id_text)}&phone=${encodeURIComponent(rawPhone)}`;
    if (isPending) {
      subject = `Action Required: Your Booking for ${serviceName} is On Hold`;
      message = `Thank you for your rental request for the <strong>${serviceName}</strong>. Your booking (#${booking.id}) is currently on hold and requires manual review by our team. This is a standard procedure for certain bookings to ensure accuracy and availability. We will process it shortly.`;
      portalInfo = `
            <div class="portal-note">
              <strong>Please check your Customer Portal for updates.</strong><br>
              You can view the status of your booking and any required actions by logging into the <a href="${customerPortalLink}">Customer Portal</a>.
              <br><br>
              <strong>Login with:</strong><br>
              Customer ID: <strong>${customer_id_text}</strong><br>
              Phone Number: <strong>${phone}</strong>
            </div>
          `;
    } else {
      subject = `Booking Confirmed: Your ${serviceName}`;
      message = `Thank you for your booking with U-Fill Dumpsters! Your <strong>${serviceName}</strong> service (Booking #${booking.id}) is confirmed. A detailed receipt has been attached to this email. If you cannot view the attachment, you can log in to your Customer Portal to download it at any time.`;
      portalInfo = `
            <div class="portal-note">
              <strong>Access Your Customer Portal:</strong><br>
              To view your booking details, add notes, or manage your rental, please visit our <a href="${customerPortalLink}">Customer Portal</a>.
              <br><br>
              <strong>Login with:</strong><br>
              Customer ID: <strong>${customer_id_text}</strong><br>
              Phone Number (as password): <strong>${phone}</strong>
            </div>
          `;
    }
    const emailHtml = generateEmailHtml(name, subject, message, portalInfo);
    const emailPayload = {
      sender: {
        email: fromEmail,
        name: 'U-Fill Dumpsters'
      },
      to: [
        {
          email,
          name
        }
      ],
      subject,
      htmlContent: emailHtml,
      attachment
    };
    const brevoResponse = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': brevoApiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(emailPayload)
    });
    if (!brevoResponse.ok) {
      const errorBody = await brevoResponse.json();
      throw new Error(`Brevo API Error: ${brevoResponse.status} ${errorBody.message}`);
    }
    return new Response(JSON.stringify({
      message: "Confirmation email sent successfully."
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error("Send Confirmation Email Error:", error);
    return new Response(JSON.stringify({
      error: error.message
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
});
