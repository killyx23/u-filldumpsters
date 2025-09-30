import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from './cors.ts';
Deno.serve(async (req)=>{
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
  }
  try {
    const { email } = await req.json();
    if (!email) {
      throw new Error('Email is required.');
    }
    const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
    const { data: customer, error: customerError } = await supabaseAdmin.from('customers').select('name, email, customer_id_text').eq('email', email).single();
    if (customerError || !customer || !customer.customer_id_text) {
      return new Response(JSON.stringify({
        message: 'If a matching account was found, an email has been sent.'
      }), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        },
        status: 200
      });
    }
    const brevoApiKey = Deno.env.get('BREVO_API_KEY');
    const fromEmail = Deno.env.get('BREVO_FROM_EMAIL');
    if (!brevoApiKey || !fromEmail) {
      throw new Error("Email service is not configured.");
    }
    const emailBody = {
      sender: {
        name: 'U-Fill Dumpsters LLC',
        email: fromEmail
      },
      to: [
        {
          email: customer.email,
          name: customer.name
        }
      ],
      subject: 'Your Customer ID Recovery',
      htmlContent: `
        <html>
          <body style="font-family: sans-serif; color: #333;">
            <h1>Customer ID Recovery</h1>
            <p>Hello ${customer.name},</p>
            <p>You requested to recover your Customer ID. Please use the ID below to log in to the customer portal.</p>
            <p style="font-size: 24px; font-weight: bold; letter-spacing: 2px; background-color: #f0f0f0; padding: 10px 20px; border-radius: 5px; display: inline-block;">${customer.customer_id_text}</p>
            <p>If you did not request this, you can safely ignore this email.</p>
            <p>Thank you,<br/>U-Fill Dumpsters LLC</p>
            <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
            <p style="font-size: 12px; color: #777;">
              This email and any attachments are confidential and intended solely for the use of the individual to whom it is addressed. If you have received this email in error, please notify the sender immediately and delete this email from your system. Any unauthorized use, dissemination, forwarding, printing, or copying of this email is strictly prohibited.
            </p>
          </body>
        </html>
      `
    };
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': brevoApiKey,
        'Content-Type': 'application/json',
        'accept': 'application/json'
      },
      body: JSON.stringify(emailBody)
    });
    if (!response.ok) {
      const errorData = await response.json();
      console.error('Brevo API Error:', errorData);
      throw new Error('Failed to send recovery email.');
    }
    return new Response(JSON.stringify({
      message: 'Recovery email sent successfully.'
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 200
    });
  } catch (error) {
    console.error(error);
    return new Response(JSON.stringify({
      error: error.message
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 500
    });
  }
});
