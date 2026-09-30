import { getCorsHeaders } from "./cors.ts";
import { createClient } from 'npm:@supabase/supabase-js@2';

const supabase = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }
  try {
    let startDate: string | null = null;
    let endDate: string | null = null;
    let excludeBookingId: number | null = null;
    if (req.method !== "GET") {
      try {
        const body = await req.json();
        startDate = body?.startDate || body?.start_date || null;
        endDate = body?.endDate || body?.end_date || startDate;
        const rawExclude = body?.excludeBookingId ?? body?.exclude_booking_id;
        if (rawExclude != null && rawExclude !== '' && Number.isFinite(Number(rawExclude))) {
          excludeBookingId = Number(rawExclude);
        }
      } catch {
        // Inventory can be requested with an empty body.
      }
    }

    const { data: snapshot, error: snapshotError } = await supabase.rpc('equipment_inventory_snapshot', {
      p_start: startDate,
      p_end: endDate,
      p_exclude_booking_id: excludeBookingId,
    });

    if (!snapshotError && Array.isArray(snapshot)) {
      const inventory = snapshot.map((row) => {
        const onHand = Number(row.total_quantity ?? 0);
        const dateAware = Number(row.available_quantity ?? onHand);
        const isRental = String(row.type || '').toLowerCase() === 'rental';
        // Payment holds still decrement on-hand stock. Until holds are date-aware,
        // rentals can only promise the stricter of date-aware and on-hand.
        const bookable = isRental ? Math.min(dateAware, onHand) : dateAware;
        return {
          id: row.id,
          name: row.name,
          type: row.type,
          on_hand_quantity: onHand,
          available_quantity: bookable,
          // Callers treat total_quantity as "can be booked".
          total_quantity: bookable,
        };
      });
      return new Response(JSON.stringify({ inventory }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    if (snapshotError) {
      console.warn("[get-equipment-inventory] snapshot unavailable, using on-hand stock:", snapshotError.message);
    }

    const { data: equipment, error: equipmentError } = await supabase.from('equipment').select('id, name, total_quantity, type');
    if (equipmentError) throw equipmentError;
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
