import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from './cors.ts';
const DOMAIN = 'ufilldumpsters.com';
// You can set SUPABASE_PASSWORD_SUFFIX in secrets to enforce complexity, e.g., "Aa!"
// If blank, password will be just the 10-digit phone number.
const ENV_PASSWORD_SUFFIX = (Deno.env.get('SUPABASE_PASSWORD_SUFFIX') ?? '').trim();
function buildPasswordFromPhone(cleanedPhone) {
  // If you want exactly the phone (no suffix), set SUPABASE_PASSWORD_SUFFIX to empty.
  // If policy requires stronger passwords, set SUPABASE_PASSWORD_SUFFIX to something like "Aa!".
  return `${cleanedPhone}${ENV_PASSWORD_SUFFIX}`;
}
Deno.serve(async (req)=>{
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
  }
  try {
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({
        error: 'Method not allowed'
      }), {
        status: 405,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    const body = await req.json().catch(()=>({}));
    const customerIdRaw = String(body.customerId ?? '').trim();
    const phoneRaw = String(body.phone ?? '').trim();
    if (!customerIdRaw || !phoneRaw) {
      return new Response(JSON.stringify({
        error: 'Customer ID and phone number are required.'
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    const cleanedPhone = phoneRaw.replace(/\D/g, '');
    if (cleanedPhone.length !== 10) {
      return new Response(JSON.stringify({
        error: 'Invalid phone number format.'
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
    const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
      console.error('Missing required environment variables.');
      return new Response(JSON.stringify({
        error: 'Server misconfiguration.'
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    // 1) Fetch customer by customer_id_text
    const { data: customer, error: customerError } = await supabaseAdmin.from('customers').select('id, name, email, user_id, customer_id_text, phone').eq('customer_id_text', customerIdRaw).single();
    if (customerError || !customer) {
      return new Response(JSON.stringify({
        error: 'Invalid credentials. Customer not found.'
      }), {
        status: 401,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // 2) Validate phone
    const customerPhoneInDb = String(customer.phone ?? '').replace(/\D/g, '');
    if (customerPhoneInDb !== cleanedPhone) {
      return new Response(JSON.stringify({
        error: 'Invalid credentials. Phone number does not match.'
      }), {
        status: 401,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // 3) Build normalized auth email and password
    const authEmail = `${String(customer.customer_id_text).trim()}@${DOMAIN}`.toLowerCase();
    const password = buildPasswordFromPhone(cleanedPhone);
    // 4) Ensure Auth user exists and is updated
    let authUserId = null;
    // Find exact user by email
    const { data: userList, error: listErr } = await supabaseAdmin.auth.admin.listUsers({
      email: authEmail
    });
    if (listErr) {
      return new Response(JSON.stringify({
        error: `Error checking existing user: ${listErr.message}`
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    const exact = userList?.users?.find((u)=>(u.email ?? '').toLowerCase() === authEmail) ?? null;
    if (exact) {
      authUserId = exact.id;
      // Update password and metadata. Confirm email to allow password sign-in if required.
      const { error: updErr } = await supabaseAdmin.auth.admin.updateUserById(authUserId, {
        password,
        email_confirm: true,
        user_metadata: {
          name: customer.name,
          customer_db_id: customer.id,
          original_email: customer.email
        }
      });
      if (updErr) {
        return new Response(JSON.stringify({
          error: `Failed to update auth user: ${updErr.message}`
        }), {
          status: 500,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
      }
    } else {
      // Create user
      const { data: created, error: crtErr } = await supabaseAdmin.auth.admin.createUser({
        email: authEmail,
        password,
        email_confirm: true,
        user_metadata: {
          name: customer.name,
          customer_db_id: customer.id,
          original_email: customer.email
        }
      });
      if (crtErr || !created?.user) {
        return new Response(JSON.stringify({
          error: `Failed to create auth user: ${crtErr?.message}`
        }), {
          status: 500,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
      }
      authUserId = created.user.id;
    }
    // 5) Link user_id on customers if needed
    if (authUserId && customer.user_id !== authUserId) {
      const { error: linkErr } = await supabaseAdmin.from('customers').update({
        user_id: authUserId
      }).eq('id', customer.id);
      if (linkErr) {
        console.error('Warning: failed to link user to customer', linkErr.message);
      }
    }
    // 6) Re-read exact user to ensure email is correct before sign-in
    const { data: verifyList, error: verifyErr } = await supabaseAdmin.auth.admin.listUsers({
      email: authEmail
    });
    if (verifyErr || !verifyList?.users?.some((u)=>(u.email ?? '').toLowerCase() === authEmail)) {
      return new Response(JSON.stringify({
        error: 'User not found after update/create.'
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // 7) Sign in with anon client
    const supabaseAnon = createClient(SUPABASE_URL, ANON_KEY);
    const { data: signInData, error: signInError } = await supabaseAnon.auth.signInWithPassword({
      email: authEmail,
      password
    });
    if (signInError) {
      // Helpful hints to debug quickly
      const hints = [
        'Ensure SUPABASE_PASSWORD_SUFFIX matches what you intend (empty if you want pure 10-digit phone).',
        'Check Auth > Settings > Password policy; if numeric-only is disallowed, use a suffix.',
        'Check Auth > Settings > Email: if email confirmation is required for password sign-in, keep email_confirm: true.',
        'Confirm the computed email exactly equals customer_id_text@ufilldumpsters.com (lowercase, no spaces).'
      ];
      return new Response(JSON.stringify({
        error: `Failed to sign in user: ${signInError.message}`,
        hints
      }), {
        status: 401,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    return new Response(JSON.stringify({
      message: 'Signed in successfully',
      session: signInData.session,
      user: signInData.user
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (e) {
    console.error('Customer Portal Login Function Error:', e);
    return new Response(JSON.stringify({
      error: e?.message ?? 'Unexpected error'
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
});
