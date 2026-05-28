import { getCorsHeaders } from "./cors.ts";
import { createClient } from 'npm:@supabase/supabase-js@2';

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

    if (!supabaseUrl || !serviceRoleKey || !anonKey) {
      throw new Error('Supabase configuration missing');
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Authentication required' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 401,
      });
    }

    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!token || token === anonKey) {
      return new Response(JSON.stringify({ error: 'Invalid session' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 401,
      });
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
    const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError || !userData?.user) {
      console.error('Get customer details auth error:', userError?.message);
      return new Response(JSON.stringify({ error: 'Invalid session' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 401,
      });
    }

    const { customerId } = await req.json();
    if (!customerId) {
      throw new Error('Customer ID is required.');
    }

    const parsedCustomerId = Number.parseInt(String(customerId), 10);
    if (!Number.isFinite(parsedCustomerId)) {
      throw new Error('Invalid customer ID.');
    }

    const { data: customer, error: customerError } = await supabaseAdmin
      .from('customers')
      .select('*')
      .eq('id', parsedCustomerId)
      .single();

    if (customerError) throw customerError;
    if (!customer) {
      return new Response(JSON.stringify({ error: 'Customer not found' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 404,
      });
    }

    const caller = userData.user;
    const isAdmin = caller.app_metadata?.is_admin === true;
    const ownsCustomer =
      customer.user_id === caller.id ||
      Number.parseInt(String(caller.user_metadata?.customer_db_id), 10) === parsedCustomerId;

    if (!isAdmin && !ownsCustomer) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 403,
      });
    }

    const { data: bookings, error: bookingsError } = await supabaseAdmin
      .from('bookings')
      .select('*, reviews(*)')
      .eq('customer_id', parsedCustomerId)
      .order('drop_off_date', { ascending: false });

    if (bookingsError) throw bookingsError;

    const { data: notes, error: notesError } = await supabaseAdmin
      .from('customer_notes')
      .select('*')
      .eq('customer_id', parsedCustomerId)
      .order('created_at', { ascending: true });

    if (notesError) throw notesError;

    return new Response(JSON.stringify({ customer, bookings, notes }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (error) {
    console.error('Get customer details error:', error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});
