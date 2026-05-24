import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

import { getCorsHeaders } from "./cors.ts";
Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
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
      const pointsToAward = Number(points);
      const parsedBookingId = bookingId ? Number(bookingId) : null;

      if (!pointsToAward || pointsToAward <= 0) {
        return new Response(JSON.stringify({ error: 'Invalid points amount' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (parsedBookingId) {
        const { data: existing } = await supabase
          .from('loyalty_transactions')
          .select('id')
          .eq('booking_id', parsedBookingId)
          .eq('transaction_type', 'earned')
          .maybeSingle();

        if (existing) {
          return new Response(
            JSON.stringify({ success: true, alreadyAwarded: true }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }

      const { data: existingRecord } = await supabase
        .from('loyalty_points')
        .select('id, points_balance, total_points_earned')
        .eq('customer_id', parsedCustomerId)
        .maybeSingle();

      let result;
      if (existingRecord) {
        const { data, error } = await supabase
          .from('loyalty_points')
          .update({
            points_balance: existingRecord.points_balance + pointsToAward,
            total_points_earned: existingRecord.total_points_earned + pointsToAward,
            last_updated: new Date().toISOString(),
          })
          .eq('customer_id', parsedCustomerId)
          .select()
          .single();
        if (error) throw error;
        result = data;
      } else {
        const { data, error } = await supabase
          .from('loyalty_points')
          .insert({
            customer_id: parsedCustomerId,
            points_balance: pointsToAward,
            total_points_earned: pointsToAward,
            total_points_redeemed: 0,
          })
          .select()
          .single();
        if (error) throw error;
        result = data;
      }

      const { error: txError } = await supabase.from('loyalty_transactions').insert({
        customer_id: parsedCustomerId,
        transaction_type: 'earned',
        points_amount: pointsToAward,
        booking_id: parsedBookingId,
        notes: notes ?? null,
      });

      if (txError) throw txError;

      return new Response(
        JSON.stringify({ success: true, newBalance: result.points_balance }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
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

      const { data: loyaltyRecord, error: fetchError } = await supabase
        .from('loyalty_points')
        .select('points_balance, total_points_redeemed')
        .eq('customer_id', parsedCustomerId)
        .single();

      if (fetchError || !loyaltyRecord) {
        return new Response(JSON.stringify({ error: 'No loyalty account found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (loyaltyRecord.points_balance < pointsToRedeem) {
        return new Response(JSON.stringify({ error: 'Insufficient points' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const { data, error } = await supabase
        .from('loyalty_points')
        .update({
          points_balance: loyaltyRecord.points_balance - pointsToRedeem,
          total_points_redeemed: loyaltyRecord.total_points_redeemed + pointsToRedeem,
          last_updated: new Date().toISOString(),
        })
        .eq('customer_id', parsedCustomerId)
        .select()
        .single();

      if (error) throw error;

      const { error: txError } = await supabase.from('loyalty_transactions').insert({
        customer_id: parsedCustomerId,
        transaction_type: 'redeemed',
        points_amount: pointsToRedeem,
        booking_id: parsedBookingId,
        notes: notes ?? null,
      });

      if (txError) throw txError;

      const { data: settings } = await supabase
        .from('loyalty_settings')
        .select('points_to_dollar')
        .maybeSingle();

      const pointsToDollar = settings?.points_to_dollar ?? 100;
      const discountAmount = Number((pointsToRedeem / pointsToDollar).toFixed(2));

      return new Response(
        JSON.stringify({ success: true, newBalance: data.points_balance, discountAmount }),
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
