import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from './cors.ts';
import * as SibApiV3Sdk from 'https://esm.sh/@getbrevo/brevo@2.2.0';
const BREVO_API_KEY = Deno.env.get('BREVO_API_KEY');
const BREVO_FROM_EMAIL = Deno.env.get('BREVO_FROM_EMAIL');
Deno.serve(async (req)=>{
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
  }
  try {
    const { customerId } = await req.json();
    if (!customerId) {
      return new Response(JSON.stringify({
        error: 'Customer ID is required.'
      }), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        },
        status: 400
      });
    }
    const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
    const { data: customer, error: customerError } = await supabaseAdmin.from('customers').select('name, email, customer_id_text').eq('id', customerId).single();
    if (customerError || !customer) {
      return new Response(JSON.stringify({
        error: 'Customer not found.'
      }), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        },
        status: 404
      });
    }
    const api = new SibApiV3Sdk.TransactionalEmailsApi();
    const apiKey = api.authentications['apiKey'];
    apiKey.apiKey = BREVO_API_KEY;
    const sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail();
    sendSmtpEmail.sender = {
      name: 'U-Fill Dumpsters',
      email: BREVO_FROM_EMAIL
    };
    sendSmtpEmail.to = [
      {
        email: customer.email,
        name: customer.name
      }
    ];
    sendSmtpEmail.subject = 'Your U-Fill Dumpsters Customer ID';
    sendSmtpEmail.htmlContent = `
      <html>
        <body>
          <h1>Hello ${customer.name},</h1>
          <p>As requested, here is your Customer ID for accessing the customer portal.</p>
          <p style="font-size: 24px; font-weight: bold; color: #f59e0b; border: 2px dashed #f59e0b; padding: 20px; text-align: center;">${customer.customer_id_text}</p>
          <p>Keep this ID safe. You will need it along with your phone number to log in to your portal.</p>
          <p>Thank you,<br>The U-Fill Dumpsters Team</p>
        </body>
      </html>
    `;
    await api.sendTransacEmail(sendSmtpEmail);
    return new Response(JSON.stringify({
      success: true,
      message: 'Customer ID sent successfully.'
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 200
    });
  } catch (error) {
    console.error('Error in send-customer-id function:', error);
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
