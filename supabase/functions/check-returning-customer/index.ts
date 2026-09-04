import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { getCorsHeaders } from '../_shared/cors.ts';

const QUALIFYING_STATUSES = new Set(['completed', 'returned', 'flagged']);

function isQualifyingBooking(booking: { status?: string; returned_at?: string | null }) {
  if (!booking) return false;
  if (booking.returned_at) return true;
  const status = String(booking.status || '').trim().toLowerCase();
  return status.length > 0 && QUALIFYING_STATUSES.has(status);
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { email } = await req.json();
    const normalizedEmail = String(email || '').trim().toLowerCase();

    if (!normalizedEmail || !normalizedEmail.includes('@')) {
      return new Response(JSON.stringify({ success: false, error: 'Valid email is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    if (!supabaseUrl || !serviceRoleKey) {
      return new Response(JSON.stringify({ success: false, error: 'Server configuration error' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Historic data can hold more than one row per email (differing case), so
    // read them all and treat them as the same person rather than erroring.
    const { data: customerMatches, error: customerError } = await supabase
      .from('customers')
      .select('id, email, first_name, last_name')
      .ilike('email', normalizedEmail)
      .order('id', { ascending: true });

    if (customerError) {
      console.error('[check-returning-customer] customer lookup error:', customerError);
      return new Response(JSON.stringify({ success: false, error: 'Failed to check customer' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const customer = customerMatches?.[0] ?? null;
    const customerIds = (customerMatches || []).map((row) => row.id);

    if (!customer) {
      return new Response(
        JSON.stringify({
          success: true,
          isReturning: false,
          pastBookingsCount: 0,
          customer: null,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const { data: bookings, error: bookingsError } = await supabase
      .from('bookings')
      .select('id, created_at, status, returned_at')
      .in('customer_id', customerIds)
      .order('created_at', { ascending: false });

    if (bookingsError) {
      console.error('[check-returning-customer] bookings lookup error:', bookingsError);
      return new Response(JSON.stringify({ success: false, error: 'Failed to check bookings' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const qualifying = (bookings || []).filter(isQualifyingBooking);
    const isReturning = qualifying.length > 0;

    return new Response(
      JSON.stringify({
        success: true,
        isReturning,
        pastBookingsCount: qualifying.length,
        customer: isReturning
          ? {
              id: customer.id,
              email: customer.email,
              first_name: customer.first_name,
              last_name: customer.last_name,
            }
          : null,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    console.error('[check-returning-customer] unexpected error:', error);
    return new Response(JSON.stringify({ success: false, error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
