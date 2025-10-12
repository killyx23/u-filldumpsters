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
    // Generate a magic link for direct login (no email required)
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
    
    // Return the magic link URL to the frontend for immediate redirect
    return new Response(JSON.stringify({
      message: "Login successful.",
      magicLink: linkData.properties.action_link
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
