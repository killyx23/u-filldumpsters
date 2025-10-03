import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import * as SibApiV3Sdk from 'https://esm.sh/@getbrevo/brevo@2.2.0';
// Inline CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const BREVO_API_KEY = Deno.env.get('BREVO_API_KEY');
const BREVO_FROM_EMAIL = Deno.env.get('BREVO_FROM_EMAIL');
const SITE_URL = Deno.env.get('SITE_URL');
function hasJsonBody(req) {
  const ct = req.headers.get('content-type')?.toLowerCase() ?? '';
  // Accept JSON with or without content-length; only require correct content-type
  return ct.includes('application/json');
}
async function readSafeJson(req) {
  if (!hasJsonBody(req)) return null;
  try {
    return await req.json();
  } catch  {
    return null;
  }
}
Deno.serve(async (req)=>{
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({
      error: 'Method not allowed'
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 405
    });
  }
  try {
    // Safe body parsing (supports both JSON and form-encoded)
    let customerId;
    let phone;
    const ct = req.headers.get('content-type')?.toLowerCase() ?? '';
    if (ct.includes('application/json')) {
      const body = await readSafeJson(req);
      customerId = body?.customerId;
      phone = body?.phone;
    } else if (ct.includes('application/x-www-form-urlencoded')) {
      const form = await req.formData();
      customerId = String(form.get('customerId') ?? '');
      phone = String(form.get('phone') ?? '');
    } else {
      // Try to parse URLSearchParams from query as a last resort
      const url = new URL(req.url);
      customerId = url.searchParams.get('customerId') ?? undefined;
      phone = url.searchParams.get('phone') ?? undefined;
    }
    if (!customerId || !phone) {
      return new Response(JSON.stringify({
        error: 'Customer ID and Phone Number are required.'
      }), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        },
        status: 400
      });
    }
    const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
    const cleanedPhone = phone.replace(/\D/g, '');
    const { data: customer, error: customerError } = await supabaseAdmin.from('customers').select('id, name, email, user_id, customer_id_text, phone').eq('customer_id_text', customerId).eq('phone', cleanedPhone).single();
    if (customerError || !customer) {
      console.error('Customer lookup failed:', customerError);
      return new Response(JSON.stringify({
        error: 'Invalid credentials. Please check your Customer ID and phone number.'
      }), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        },
        status: 404
      });
    }
    let authUser = null;
    if (customer.user_id) {
      const { data, error } = await supabaseAdmin.auth.admin.getUserById(customer.user_id);
      if (!error) {
        authUser = data.user;
      }
    }
    // Try to find existing user by email if not found by id
    if (!authUser) {
      const { data: byEmail, error: byEmailError } = await supabaseAdmin.auth.admin.listUsers({
        page: 1,
        perPage: 1,
        email: customer.email
      });
      if (!byEmailError && byEmail?.users?.length) {
        authUser = byEmail.users[0];
        await supabaseAdmin.from('customers').update({
          user_id: authUser.id
        }).eq('id', customer.id);
      }
    }
    // Fallback: create user or link if already exists
    if (!authUser) {
      const { data: newUser, error: newUserError } = await supabaseAdmin.auth.admin.createUser({
        email: customer.email,
        email_confirm: true,
        user_metadata: {
          customer_db_id: customer.id,
          customer_id_text: customer.customer_id_text,
          name: customer.name
        }
      });
      if (newUserError) {
        if (newUserError.message?.toLowerCase().includes('already') || newUserError.status === 422) {
          const { data: found, error: findErr } = await supabaseAdmin.auth.admin.listUsers({
            page: 1,
            perPage: 1,
            email: customer.email
          });
          if (!findErr && found?.users?.length) {
            authUser = found.users[0];
            await supabaseAdmin.from('customers').update({
              user_id: authUser.id
            }).eq('id', customer.id);
          } else {
            throw new Error(`Failed to link existing auth user: ${findErr?.message ?? 'not found'}`);
          }
        } else {
          throw new Error(`Failed to create auth user: ${newUserError.message}`);
        }
      } else {
        authUser = newUser.user;
        await supabaseAdmin.from('customers').update({
          user_id: authUser.id
        }).eq('id', customer.id);
      }
    }
    const { data: magicLinkData, error: magicLinkError } = await supabaseAdmin.auth.admin.generateLink({
      type: 'magiclink',
      email: customer.email,
      options: {
        redirectTo: `${SITE_URL}/portal`
      }
    });
    if (magicLinkError) {
      throw new Error(`Magic link generation failed: ${magicLinkError.message}`);
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
    sendSmtpEmail.subject = 'Your Secure U-Fill Customer Portal Login Link';
    sendSmtpEmail.htmlContent = `
      <html>
        <body>
          <h1>Hello ${customer.name},</h1>
          <p>Click the link below to securely sign in to your customer portal. This link is valid for one-time use and will expire in 24 hours.</p>
          <a href="${magicLinkData.properties.action_link}" style="background-color: #f59e0b; color: black; padding: 14px 25px; text-align: center; text-decoration: none; display: inline-block; border-radius: 8px; font-size: 16px; font-weight: bold;">Sign In to Customer Portal</a>
          <p>If you did not request this link, you can safely ignore this email.</p>
          <p>Thank you,<br>The U-Fill Dumpsters Team</p>
        </body>
      </html>
    `;
    await api.sendTransacEmail(sendSmtpEmail);
    return new Response(JSON.stringify({
      success: true,
      message: 'Login link sent successfully.'
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 200
    });
  } catch (error) {
    console.error('Error in customer-portal-login function:', error);
    return new Response(JSON.stringify({
      error: error?.message ?? 'Unexpected error'
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 500
    });
  }
});
