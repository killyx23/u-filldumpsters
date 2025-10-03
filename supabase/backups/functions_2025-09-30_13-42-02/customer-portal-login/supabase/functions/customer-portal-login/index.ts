import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from './cors.ts';
Deno.serve(async (req)=>{
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
  }
  try {
    const { customerId, phone } = await req.json();
    if (!customerId || !phone) {
      return new Response(JSON.stringify({
        error: 'Customer ID and phone number are required.'
      }), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        },
        status: 400
      });
    }
    const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
    const { data: customer, error: customerError } = await supabaseAdmin.from('customers').select('id, email, phone, user_id').eq('customer_id_text', customerId).single();
    if (customerError || !customer) {
      return new Response(JSON.stringify({
        error: 'Invalid Customer ID or Phone Number.'
      }), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        },
        status: 404
      });
    }
    const normalizedInputPhone = phone.replace(/\D/g, '');
    const normalizedDbPhone = customer.phone ? customer.phone.replace(/\D/g, '') : '';
    if (normalizedInputPhone !== normalizedDbPhone) {
      return new Response(JSON.stringify({
        error: 'Invalid Customer ID or Phone Number.'
      }), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        },
        status: 401
      });
    }
    let userId = customer.user_id;
    const tempPassword = Math.random().toString(36).slice(-8);
    if (userId) {
      const { error: updateUserError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
        password: tempPassword
      });
      if (updateUserError) {
        // If user not found in auth, it might have been deleted. Try creating a new one.
        if (updateUserError.message.toLowerCase().includes('not found')) {
          userId = null;
        } else {
          throw updateUserError;
        }
      }
    }
    if (!userId) {
      const { data: newUser, error: createUserError } = await supabaseAdmin.auth.admin.createUser({
        email: customer.email,
        password: tempPassword,
        email_confirm: true,
        user_metadata: {
          customer_db_id: customer.id
        }
      });
      if (createUserError) {
        // Handle race condition where user might exist now
        if (createUserError.message.includes('already registered')) {
          const { data: existingUser, error: getUserError } = await supabaseAdmin.auth.admin.getUserByEmail(customer.email);
          if (getUserError || !existingUser) throw new Error('Failed to retrieve existing user after sign-up conflict.');
          userId = existingUser.user.id;
          // Since user exists, update them with the temp password to sign in
          const { error: updateUserError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
            password: tempPassword
          });
          if (updateUserError) throw updateUserError;
        } else {
          throw createUserError;
        }
      } else {
        userId = newUser.user.id;
      }
      await supabaseAdmin.from('customers').update({
        user_id: userId
      }).eq('id', customer.id);
    }
    const { data: sessionResponse, error: signInError } = await supabaseAdmin.auth.signInWithPassword({
      email: customer.email,
      password: tempPassword
    });
    if (signInError) throw signInError;
    if (!sessionResponse.session) throw new Error("Failed to create a session.");
    return new Response(JSON.stringify({
      session: sessionResponse.session
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 200
    });
  } catch (error) {
    console.error('Edge function error:', error);
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
