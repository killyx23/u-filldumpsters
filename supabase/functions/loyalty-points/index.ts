import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

import { getCorsHeaders } from "./cors.ts";
Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const authHeader = req.headers.get('Authorization');

    if (!supabaseUrl || !serviceRoleKey || !anonKey) {
      return new Response(JSON.stringify({ error: 'Supabase configuration missing' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Authentication required' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const token = authHeader.replace('Bearer ', '').trim();
    const authClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { data: userData, error: userError } = await authClient.auth.getUser();
    if (userError || !userData?.user) {
      return new Response(JSON.stringify({ error: 'Invalid session' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      supabaseUrl,
      serviceRoleKey
    );

    const { action, customerId, points, bookingId, notes } = await req.json();

    if (!action || !customerId) {
      return new Response(JSON.stringify({ error: 'action and customerId are required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const parsedCustomerId = Number(customerId);
    if (!Number.isFinite(parsedCustomerId)) {
      return new Response(JSON.stringify({ error: 'Invalid customerId' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'award') {
      return new Response(JSON.stringify({ error: 'Award action is server-only' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'redeem') {
      const pointsToRedeem = Number(points);
      const parsedBookingId = bookingId ? Number(bookingId) : null;

      if (!pointsToRedeem || pointsToRedeem <= 0) {
        return new Response(JSON.stringify({ error: 'Invalid points amount' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const { data: customerData, error: customerError } = await supabase
        .from('customers')
        .select('id')
        .eq('user_id', userData.user.id)
        .maybeSingle();

      if (customerError || !customerData?.id) {
        return new Response(JSON.stringify({ error: 'Customer account not linked' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (customerData.id !== parsedCustomerId) {
        return new Response(JSON.stringify({ error: 'Cannot redeem points for another account' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const { data: rpcData, error: rpcError } = await supabase.rpc('adjust_loyalty_points', {
        p_customer_id: parsedCustomerId,
        p_points: pointsToRedeem,
        p_transaction_type: 'redeemed',
        p_booking_id: parsedBookingId,
        p_referral_id: null,
        p_notes: notes ?? null,
      });

      if (rpcError) {
        const message = rpcError.message?.toLowerCase().includes('insufficient')
          ? 'Insufficient points'
          : 'Unable to redeem points';
        return new Response(JSON.stringify({ error: message }), {
          status: message === 'Insufficient points' ? 400 : 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const result = Array.isArray(rpcData) ? rpcData[0] : rpcData;
      const newBalance = Number(result?.new_balance ?? 0);

      const { data: settings } = await supabase
        .from('loyalty_settings')
        .select('points_to_dollar')
        .maybeSingle();

      const pointsToDollar = settings?.points_to_dollar ?? 100;
      const discountAmount = Number((pointsToRedeem / pointsToDollar).toFixed(2));

      return new Response(
        JSON.stringify({ success: true, newBalance, discountAmount }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(JSON.stringify({ error: 'Unknown action' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[loyalty-points]', err);
    return new Response(JSON.stringify({ error: err.message ?? 'Internal error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
