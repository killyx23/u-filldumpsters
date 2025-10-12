import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from './cors.ts';
const brevoApiKey = Deno.env.get('BREVO_API_KEY');
const fromEmail = Deno.env.get('BREVO_FROM_EMAIL');
const siteUrl = Deno.env.get('SITE_URL');
Deno.serve(async (req)=>{
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
  }
  try {
    const { customerId, phone } = await req.json();
    if (!customerId || !phone) {
      throw new Error('Customer ID and phone number are required.');
    }
    const cleanedPhone = String(phone).replace(/\D/g, '');
    const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
    const { data: customer, error: customerError } = await supabaseAdmin.from('customers').select('id, name, email, user_id').eq('customer_id_text', customerId).like('phone', `%${cleanedPhone}%`).single();
    if (customerError || !customer) {
      throw new Error('Invalid credentials. Please check your Customer ID and phone number.');
    }
    let authUser = null;
    if (customer.user_id) {
      const { data } = await supabaseAdmin.auth.admin.getUserById(customer.user_id);
      authUser = data.user;
    }
    if (!authUser) {
      const { data, error } = await supabaseAdmin.auth.admin.createUser({
        email: customer.email,
        email_confirm: true,
        user_metadata: {
          name: customer.name,
          customer_db_id: customer.id
        }
      });
      if (error) throw new Error(`Failed to create auth user: ${error.message}`);
      authUser = data.user;
      await supabaseAdmin.from('customers').update({
        user_id: authUser.id
      }).eq('id', customer.id);
    }
    const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
      type: 'magiclink',
      email: customer.email,
      options: {
        redirectTo: `${siteUrl}/portal`
      }
    });
    if (linkError) {
      throw new Error(`Failed to generate login link: ${linkError.message}`);
    }
    const magicLink = linkData.properties.action_link;
    const emailHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: sans-serif; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 5px; }
            .header { font-size: 24px; font-weight: bold; color: #003366; }
            .button { background-color: #f59e0b; color: #000; padding: 15px 25px; text-decoration: none; border-radius: 5px; display: inline-block; font-weight: bold; }
            .footer { font-size: 12px; color: #777; margin-top: 20px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">Your Secure Login Link</div>
            <p>Hello ${customer.name},</p>
            <p>Click the button below to securely access your U-Fill Dumpsters customer portal. This link is valid for 24 hours and can only be used once.</p>
            <p style="text-align: center; margin: 30px 0;">
              <a href="${magicLink}" class="button">Log in to Customer Portal</a>
            </p>
            <p>If you did not request this email, please ignore it.</p>
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
      subject: 'Your U-Fill Dumpsters Customer Portal Login Link',
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
      console.error("Brevo API Error:", errorBody);
      throw new Error(`Brevo API Error: ${errorBody.message || 'Failed to send email.'}`);
    }
    return new Response(JSON.stringify({
      message: "Login email sent successfully."
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 200
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
