import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from './cors.ts';
const brevoApiKey = Deno.env.get('BREVO_API_KEY');
const fromEmail = Deno.env.get('BREVO_FROM_EMAIL');
Deno.serve(async (req)=>{
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
  }
  try {
    const { booking, customMessage } = await req.json();
    if (!booking) {
      throw new Error('Booking data is required.');
    }
    const { email, name } = booking.customers;
    if (!brevoApiKey || !fromEmail) {
      throw new Error('Missing Brevo API Key or From Email environment variables.');
    }
    const defaultMessage = "Thank you for your booking with U-Fill Dumpsters! Your service is confirmed.";
    const message = customMessage || defaultMessage;
    const emailHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: sans-serif; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 5px; }
          .header { font-size: 24px; font-weight: bold; color: #003366; }
          .footer { font-size: 12px; color: #777; margin-top: 20px; }
          .portal-note { background-color: #f0f8ff; border: 1px solid #cce5ff; padding: 15px; border-radius: 5px; margin-top: 20px; }
          .custom-message { background-color: #fffbe6; border: 1px solid #ffe58f; padding: 15px; border-radius: 5px; margin-top: 20px; color: #8a6d3b; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">Booking Confirmation</div>
          <p>Hello ${name},</p>
          ${customMessage ? `<div class="custom-message">${message}</div>` : `<p>${message}</p>`}
          <p>A detailed receipt has been attached to this email. You can also view the full details of your booking and rental agreement at any time through our customer portal.</p>
          
          <div class="portal-note">
            <strong>Access Your Customer Portal:</strong><br>
            To view your booking, add notes, or reprint your receipt, please visit our <a href="${Deno.env.get('SITE_URL')}/login">Customer Portal</a> and log in using your Customer ID and phone number provided on your receipt.
          </div>
          
          <p>We look forward to serving you!</p>
          <p>Sincerely,<br>The U-Fill Dumpsters Team</p>
          <div class="footer">
            U-Fill Dumpsters LLC | Saratoga Springs, UT | (801) 810-8832
          </div>
        </div>
      </body>
      </html>
    `;
    const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
    const { data: receiptData, error: receiptError } = await supabaseAdmin.functions.invoke('generate-receipt-pdf', {
      body: {
        booking
      }
    });
    if (receiptError || !receiptData.pdf) {
      throw new Error(receiptError?.message || 'Failed to generate PDF receipt.');
    }
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
      subject: `Booking Confirmed: U-Fill Dumpsters Service #${booking.id}`,
      htmlContent: emailHtml,
      attachment: [
        {
          name: `U-Fill-Receipt-${booking.id}.pdf`,
          content: receiptData.pdf
        }
      ]
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
      throw new Error(`Brevo API Error: ${errorBody.message}`);
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
