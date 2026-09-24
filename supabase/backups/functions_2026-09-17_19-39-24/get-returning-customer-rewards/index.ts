import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { getCorsHeaders } from './cors.ts';
Deno.serve(async (req)=>{
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
  }
  try {
    const { email } = await req.json();
    const normalizedEmail = String(email || '').trim().toLowerCase();
    if (!normalizedEmail || !normalizedEmail.includes('@')) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Valid email is required'
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    if (!supabaseUrl || !serviceRoleKey) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Server configuration error'
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const { data: verification, error: verificationError } = await supabase.from('email_verifications').select('email, is_verified, code_expires_at').eq('email', normalizedEmail).maybeSingle();
    if (verificationError) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Failed to validate verification'
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    const isVerified = Boolean(verification?.is_verified);
    const expiresAt = verification?.code_expires_at ? new Date(verification.code_expires_at) : null;
    const isExpired = expiresAt ? new Date() > expiresAt : true;
    if (!isVerified || isExpired) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Email verification is required before loading rewards'
      }), {
        status: 403,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    const { data: customer, error: customerError } = await supabase.from('customers').select('id, first_name, last_name, email, phone, street, city, state, zip').eq('email', normalizedEmail).maybeSingle();
    if (customerError) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Failed to load customer profile'
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    let pointsBalance = 0;
    let referralPendingBalance = 0;
    let referralAvailableBalance = 0;
    if (customer?.id) {
      const { data: pointsRow, error: pointsError } = await supabase.from('loyalty_points').select('points_balance').eq('customer_id', customer.id).maybeSingle();
      if (!pointsError && pointsRow?.points_balance) {
        pointsBalance = Number(pointsRow.points_balance || 0);
      }
      const { data: walletRow, error: walletError } = await supabase.from('customer_referral_wallets').select('pending_balance, available_balance').eq('customer_id', customer.id).maybeSingle();
      if (!walletError && walletRow) {
        referralPendingBalance = Number(walletRow.pending_balance || 0);
        referralAvailableBalance = Number(walletRow.available_balance || 0);
      }
    }
    const { data: settings } = await supabase.from('loyalty_settings').select('points_per_dollar, points_to_dollar, referral_bonus_dollars').maybeSingle();
    return new Response(JSON.stringify({
      success: true,
      customer,
      customerId: customer?.id || null,
      pointsBalance,
      referralWallet: {
        pendingBalance: referralPendingBalance,
        availableBalance: referralAvailableBalance
      },
      conversionRates: {
        pointsPerDollar: Number(settings?.points_per_dollar || 10),
        pointsToDollar: Number(settings?.points_to_dollar || 100),
        referralBonusDollars: Number(settings?.referral_bonus_dollars || 25)
      }
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to load rewards'
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
});
