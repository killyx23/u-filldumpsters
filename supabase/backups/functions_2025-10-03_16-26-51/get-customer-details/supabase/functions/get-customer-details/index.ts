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
    const customerPromise = supabase.from('customers').select('*').eq('id', customerId).single();
    const bookingsPromise = supabase.from('bookings').select('*').eq('customer_id', customerId).order('drop_off_date', {
      ascending: false
    });
    const equipmentPromise = supabase.from('booking_equipment').select('*, equipment(name)').in('booking_id', (await bookingsPromise).data.map((b)=>b.id));
    const [{ data: customer, error: customerError }, { data: bookings, error: bookingsError }, { data: equipment, error: equipmentError }] = await Promise.all([
      customerPromise,
      bookingsPromise,
      equipmentPromise
    ]);
    if (customerError) throw customerError;
    if (bookingsError) throw bookingsError;
    if (equipmentError) throw equipmentError;
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
    return new Response(JSON.stringify({
      customer,
      bookings,
      equipment
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
