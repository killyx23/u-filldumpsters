import { corsHeaders } from "./cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
Deno.serve(async (req)=>{
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
  }
  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
    const { email, code, pending_customer_id } = await req.json();
    if (!email || !code || !pending_customer_id) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Missing required fields'
      }), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        },
        status: 400
      });
    }
    const emailLower = email.trim().toLowerCase();
    // Verify code
    const { data: verifications, error: verifyError } = await supabase.from('email_verifications').select('*').eq('email', emailLower).eq('verification_code', code).gte('code_expires_at', new Date().toISOString()).order('created_at', {
      ascending: false
    }).limit(1);
    if (verifyError || !verifications || verifications.length === 0) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Invalid or expired code'
      }), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        },
        status: 400
      });
    }
    // Update pending customer
    const { error: updateError } = await supabase.from('pending_customers').update({
      is_verified: true,
      verified_at: new Date().toISOString()
    }).eq('id', pending_customer_id);
    if (updateError) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Failed to update verification status'
      }), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        },
        status: 500
      });
    }
    // Mark verification code as used
    await supabase.from('email_verifications').update({
      is_verified: true
    }).eq('email', emailLower).eq('verification_code', code);
    return new Response(JSON.stringify({
      success: true,
      pending_customer_id
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (err) {
    return new Response(JSON.stringify({
      success: false,
      error: err.message
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 500
    });
  }
});
