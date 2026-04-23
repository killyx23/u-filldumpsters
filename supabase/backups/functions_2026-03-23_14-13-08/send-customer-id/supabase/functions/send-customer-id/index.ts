import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from './cors.ts';
const brevoApiKey = Deno.env.get('BREVO_API_KEY');
const fromEmail = Deno.env.get('BREVO_FROM_EMAIL');
const siteUrl = 'https://www.u-filldumpsters.com';
Deno.serve(async (req)=>{
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
  }
  try {
    const { email } = await req.json();
    if (!email) {
      throw new Error('Email address is required.');
    }
    const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
    const { data: customer, error: customerError } = await supabaseAdmin.from('customers').select('name, email, phone, customer_id_text').eq('email', email).single();
    if (customerError || !customer) {
      return new Response(JSON.stringify({
        message: "Request processed."
      }), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        },
        status: 200
      });
    }
    await supabaseAdmin.functions.invoke('customer-portal-login', {
      body: {
        customerId: customer.customer_id_text,
        phone: customer.phone
      }
    });
    const rawPhone = customer.phone.replace(/\D/g, '');
    const loginUrl = `${siteUrl}/login?cid=${encodeURIComponent(customer.customer_id_text)}&phone=${encodeURIComponent(rawPhone)}`;
    const emailHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: sans-serif; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 5px; }
          .header { font-size: 24px; font-weight: bold; color: #003366; }
          .credentials { background-color: #f0f8ff; border: 1px solid #cce5ff; padding: 15px; border-radius: 5px; margin-top: 20px; font-family: monospace; }
          .button { display: inline-block; padding: 12px 24px; margin-top: 20px; background-color: #f59e0b; color: #000 !important; text-decoration: none; border-radius: 5px; font-weight: bold; }
          .footer { font-size: 12px; color: #777; margin-top: 20px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">Your Customer Portal Login Details</div>
          <p>Hello ${customer.name},</p>
          <p>As requested, here are your login credentials for the U-Fill Dumpsters customer portal. You will use your Customer ID as the username and your 10-digit phone number as the password.</p>
          
          <div class="credentials">
            <strong>Customer ID:</strong> ${customer.customer_id_text}<br>
            <strong>Phone Number (Password):</strong> ${customer.phone}
          </div>
          
          <p>Click the button below to go to the login page with your details pre-filled. You will just need to click the "Login" button.</p>
          <a href="${loginUrl}" class="button">Go to Customer Portal</a>
          
          <div class="footer">
            U-Fill Dumpsters LLC | Saratoga Springs, UT | (801) 810-8832
          </div>
        </div>
      </body>
      </html>
    `;
    const emailPayload = {
      sender: {
        email: fromEmail,
        name: 'U-Fill Dumpsters'
      },
      to: [
        {
          email: customer.email,
          name: customer.name
        }
      ],
      subject: 'Your U-Fill Dumpsters Login Information',
      htmlContent: emailHtml
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
      message: "Request processed."
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 200
    });
  } catch (error) {
    console.error('Send Customer ID Error:', error);
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
