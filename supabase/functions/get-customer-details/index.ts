import { corsHeaders } from "./cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
Deno.serve(async (req)=>{
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
  }
  try {
    const supabaseClient = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
      global: {
        headers: {
          Authorization: req.headers.get('Authorization')
        }
      }
    });
    const body = await req.json().catch(()=>({}));
    const raw = body?.customerId;
    const customerId = typeof raw === 'number' ? raw : Number.parseInt(String(raw), 10);
    if (!Number.isFinite(customerId)) {
      return new Response(JSON.stringify({
        error: "Invalid customer ID"
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    const { data: customer, error: customerError } = await supabaseClient.from('customers').select('*').eq('id', customerId).single();
    if (customerError) {
      return new Response(JSON.stringify({
        error: customerError.message
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    const { data: bookings } = await supabaseClient.from('bookings').select('*, plan, addons, stripe_payment_info(*)').eq('customer_id', customerId).order('created_at', {
      ascending: false
    });
    const { data: notes } = await supabaseClient.from('customer_notes').select('*').eq('customer_id', customerId).order('created_at', {
      ascending: true
    });
    return new Response(JSON.stringify({
      customer,
      bookings: bookings || [],
      notes: notes || []
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
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
