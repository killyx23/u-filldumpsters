import { corsHeaders } from "./cors.ts";
import { createClient } from 'npm:@supabase/supabase-js@2';
const supabase = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_ANON_KEY'));
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }
  try {
    const { data: equipment, error: equipmentError } = await supabase.from('equipment').select('id, name, total_quantity');
    if (equipmentError) throw equipmentError;
    // total_quantity in the equipment table now represents the current available stock,
    // so we don't need to manually calculate rented items anymore.
    return new Response(JSON.stringify({
      inventory: equipment
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      },
      status: 200
    });
  } catch (error) {
    console.error("Get equipment inventory error:", error.message);
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
