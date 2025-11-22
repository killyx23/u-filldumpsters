import { corsHeaders } from "./cors.ts";
import { createClient } from 'npm:@supabase/supabase-js@2';
const supabase = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }
  try {
    const { customerId } = await req.json();
    if (!customerId) {
      throw new Error("Customer ID is required.");
    }
    const { data: customer, error: customerError } = await supabase.from('customers').select('*').eq('id', customerId).single();
    if (customerError) throw customerError;
    if (!customer) {
      return new Response(JSON.stringify({
        error: "Customer not found"
      }), {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        },
        status: 404
      });
    }
    const { data: bookings, error: bookingsError } = await supabase.from('bookings').select('*, reviews(*)').eq('customer_id', customerId).order('drop_off_date', {
      ascending: false
    });
    if (bookingsError) throw bookingsError;
    const { data: notes, error: notesError } = await supabase.from('customer_notes').select('*').eq('customer_id', customerId).order('created_at', {
      ascending: true
    });
    if (notesError) throw notesError;
    return new Response(JSON.stringify({
      customer,
      bookings,
      notes
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      },
      status: 200
    });
  } catch (error) {
    console.error("Get customer details error:", error.message);
    return new Response(JSON.stringify({
      error: error.message
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      },
      status: 500
    });
  }
});
