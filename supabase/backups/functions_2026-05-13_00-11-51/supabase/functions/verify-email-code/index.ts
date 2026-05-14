import { corsHeaders } from "./cors.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.30.0';
Deno.serve(async (req)=>{
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
  }
  try {
    const { code } = await req.json();
    // Validate input
    if (!code) {
      console.error('[verify-email-code] Missing code parameter');
      return new Response(JSON.stringify({
        success: false,
        error: 'Verification code is required'
      }), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        },
        status: 400
      });
    }
    const trimmedCode = code.trim();
    if (!trimmedCode || trimmedCode.length !== 6) {
      console.error('[verify-email-code] Invalid code format:', trimmedCode);
      return new Response(JSON.stringify({
        success: false,
        error: 'Invalid code format'
      }), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        },
        status: 400
      });
    }
    console.log('[verify-email-code] Processing code:', trimmedCode);
    // Create Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !supabaseKey) {
      console.error('[verify-email-code] Missing Supabase configuration');
      return new Response(JSON.stringify({
        success: false,
        error: 'Server configuration error'
      }), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        },
        status: 500
      });
    }
    const supabase = createClient(supabaseUrl, supabaseKey);
    // Query email_verifications table
    console.log('[verify-email-code] Querying email_verifications for code:', trimmedCode);
    const { data: verificationRecord, error: queryError } = await supabase.from('email_verifications').select('email, is_verified, code_expires_at').eq('verification_code', trimmedCode).maybeSingle();
    console.log('[verify-email-code] Query result:', {
      verificationRecord,
      queryError
    });
    if (queryError) {
      console.error('[verify-email-code] Database query error:', queryError);
      return new Response(JSON.stringify({
        success: false,
        error: 'Database error: ' + queryError.message
      }), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        },
        status: 500
      });
    }
    // Check if record exists
    if (!verificationRecord) {
      console.warn('[verify-email-code] Code not found:', trimmedCode);
      return new Response(JSON.stringify({
        success: false,
        error: 'Code not found'
      }), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        },
        status: 400
      });
    }
    // Check if already verified
    if (verificationRecord.is_verified) {
      console.warn('[verify-email-code] Code already used:', trimmedCode);
      return new Response(JSON.stringify({
        success: false,
        error: 'Code already used'
      }), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        },
        status: 400
      });
    }
    // Check expiration
    const expiresAt = new Date(verificationRecord.code_expires_at);
    const now = new Date();
    console.log('[verify-email-code] Expiration check:', {
      expiresAt: expiresAt.toISOString(),
      now: now.toISOString(),
      isExpired: now > expiresAt
    });
    if (now > expiresAt) {
      console.warn('[verify-email-code] Code expired:', trimmedCode);
      return new Response(JSON.stringify({
        success: false,
        error: 'Code expired'
      }), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        },
        status: 400
      });
    }
    const email = verificationRecord.email;
    console.log('[verify-email-code] Valid code for email:', email);
    // Update email_verifications
    const { error: updateError } = await supabase.from('email_verifications').update({
      is_verified: true
    }).eq('verification_code', trimmedCode);
    if (updateError) {
      console.error('[verify-email-code] Failed to update email_verifications:', updateError);
      return new Response(JSON.stringify({
        success: false,
        error: 'Failed to verify code'
      }), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        },
        status: 500
      });
    }
    console.log('[verify-email-code] Updated email_verifications');
    // Update pending_customers
    const { error: pendingError } = await supabase.from('pending_customers').update({
      is_verified: true
    }).ilike('email', email);
    if (pendingError) {
      console.error('[verify-email-code] Failed to update pending_customers:', pendingError);
    // Don't fail - just log
    } else {
      console.log('[verify-email-code] Updated pending_customers');
    }
    console.log('[verify-email-code] ✓ Verification complete for:', email);
    return new Response(JSON.stringify({
      success: true,
      email: email
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 200
    });
  } catch (error) {
    console.error('[verify-email-code] Unexpected error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: 'Unexpected error: ' + error.message
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 500
    });
  }
});
