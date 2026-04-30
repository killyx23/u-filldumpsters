import { corsHeaders } from "./cors.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
Deno.serve(async (req)=>{
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
  }
  try {
    const { email, code } = await req.json();
    if (!code) {
      throw new Error("Verification code is required");
    }
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    // Scenario 1: Email and code provided (from login form)
    if (email) {
      const { data: record, error: fetchErr } = await supabase.from('email_verifications').select('*').eq('email', email).single();
      if (fetchErr || !record) {
        throw new Error("Email not found or no pending verification.");
      }
      if (record.is_verified) {
        return new Response(JSON.stringify({
          success: true,
          message: "Email already verified."
        }), {
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }
      if (record.attempts >= 5) {
        throw new Error("Too many attempts. Please request a new verification code.");
      }
      if (new Date(record.code_expires_at) < new Date()) {
        throw new Error("Verification code has expired. Please request a new one.");
      }
      if (record.verification_code !== code) {
        // Increment attempts
        await supabase.from('email_verifications').update({
          attempts: record.attempts + 1
        }).eq('email', email);
        throw new Error("Invalid verification code.");
      }
      // Success
      await supabase.from('email_verifications').update({
        is_verified: true
      }).eq('email', email);
      return new Response(JSON.stringify({
        success: true,
        message: "Email verified successfully."
      }), {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        },
        status: 200
      });
    } else {
      const { data: records, error: fetchErr } = await supabase.from('email_verifications').select('*').eq('verification_code', code).eq('is_verified', false);
      if (fetchErr || !records || records.length === 0) {
        throw new Error("Invalid or already verified link.");
      }
      // Take the first active matching record
      const record = records[0];
      if (record.attempts >= 5) {
        throw new Error("Too many failed attempts on this account. Link blocked.");
      }
      if (new Date(record.code_expires_at) < new Date()) {
        throw new Error("This verification link has expired.");
      }
      // Success
      await supabase.from('email_verifications').update({
        is_verified: true
      }).eq('email', record.email);
      return new Response(JSON.stringify({
        success: true,
        message: "Email verified successfully.",
        email: record.email
      }), {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        },
        status: 200
      });
    }
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      },
      status: 400
    });
  }
});
