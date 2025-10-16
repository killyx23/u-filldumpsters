import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from './cors.ts';
const DOMAIN = 'ufilldumpsters.com';
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
    if (cleanedPhone.length !== 10) {
      throw new Error('Invalid phone number format.');
    }
    const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
    const { data: customer, error: customerError } = await supabaseAdmin.from('customers').select('id, name, email, user_id, customer_id_text').eq('customer_id_text', customerId).single();
    if (customerError || !customer) {
      throw new Error('Invalid credentials. Customer not found.');
    }
    const customerPhone = (await supabaseAdmin.from('customers').select('phone').eq('id', customer.id).single()).data?.phone?.replace(/\D/g, '');
    if (customerPhone !== cleanedPhone) {
      throw new Error('Invalid credentials. Phone number does not match.');
    }
    const authEmail = `${customer.customer_id_text}@${DOMAIN}`;
    let authUser;
    if (customer.user_id) {
      const { data, error } = await supabaseAdmin.auth.admin.getUserById(customer.user_id);
      if (error && error.message !== 'User not found') throw error;
      authUser = data?.user;
    }
    if (!authUser) {
      const { data: existingUser, error: existingUserError } = await supabaseAdmin.auth.admin.getUserByEmail(authEmail);
      if (existingUserError && existingUserError.message !== 'User not found') {
        throw new Error(`Error checking for existing user: ${existingUserError.message}`);
      }
      authUser = existingUser?.user;
    }
    if (authUser) {
      const { error: updateUserError } = await supabaseAdmin.auth.admin.updateUserById(authUser.id, {
        password: cleanedPhone,
        user_metadata: {
          name: customer.name,
          customer_db_id: customer.id,
          original_email: customer.email
        }
      });
      if (updateUserError) throw new Error(`Failed to update auth user: ${updateUserError.message}`);
    } else {
      const { data: newUser, error: createUserError } = await supabaseAdmin.auth.admin.createUser({
        email: authEmail,
        password: cleanedPhone,
        email_confirm: true,
        user_metadata: {
          name: customer.name,
          customer_db_id: customer.id,
          original_email: customer.email
        }
      });
      if (createUserError) throw new Error(`Failed to create auth user: ${createUserError.message}`);
      authUser = newUser.user;
      const { error: updateCustomerError } = await supabaseAdmin.from('customers').update({
        user_id: authUser.id
      }).eq('id', customer.id);
      if (updateCustomerError) console.error("Failed to link user_id to customer:", updateCustomerError.message);
    }
    return new Response(JSON.stringify({
      message: "Auth user created/updated successfully."
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 200
    });
  } catch (error) {
    console.error('Customer Portal Login Function Error:', error);
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
