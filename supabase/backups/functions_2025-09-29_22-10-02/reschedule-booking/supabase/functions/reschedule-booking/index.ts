import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from './cors.ts';
Deno.serve(async (req)=>{
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
  }
  try {
    const { bookingId, newDropOffDate, newPickupDate, newDropOffTime, newPickupTime } = await req.json();
    if (!bookingId || !newDropOffDate || !newPickupDate || !newDropOffTime || !newPickupTime) {
      throw new Error("Missing required fields: bookingId, newDropOffDate, newPickupDate, newDropOffTime, newPickupTime");
    }
    const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
    // 1. Fetch the original booking
    const { data: booking, error: bookingError } = await supabaseAdmin.from('bookings').select('*, customers(id, name)').eq('id', bookingId).single();
    if (bookingError) throw bookingError;
    if (!booking) throw new Error("Booking not found.");
    const originalDropOff = booking.drop_off_date;
    const originalPickup = booking.pickup_date;
    const originalDropOffTime = booking.drop_off_time_slot;
    const originalPickupTime = booking.pickup_time_slot;
    // 2. Prepare reschedule history
    const newHistoryEntry = {
      rescheduled_at: new Date().toISOString(),
      from_drop_off_date: originalDropOff,
      from_pickup_date: originalPickup,
      from_drop_off_time: originalDropOffTime,
      from_pickup_time: originalPickupTime,
      to_drop_off_date: newDropOffDate,
      to_pickup_date: newPickupDate,
      to_drop_off_time: newDropOffTime,
      to_pickup_time: newPickupTime
    };
    const existingHistory = booking.reschedule_history || [];
    const updatedHistory = [
      ...existingHistory,
      newHistoryEntry
    ];
    // 3. Update the booking with new dates, times, status, and history
    const { data: updatedBooking, error: updateError } = await supabaseAdmin.from('bookings').update({
      drop_off_date: newDropOffDate,
      pickup_date: newPickupDate,
      drop_off_time_slot: newDropOffTime,
      pickup_time_slot: newPickupTime,
      status: 'Rescheduled',
      reschedule_history: updatedHistory
    }).eq('id', bookingId).select().single();
    if (updateError) throw updateError;
    // 4. Create a note for the admin
    const noteContent = `Customer rescheduled booking #${bookingId}.\nOriginal: ${originalDropOff} @ ${originalDropOffTime} -> ${originalPickup} @ ${originalPickupTime}\nNew: ${newDropOffDate} @ ${newDropOffTime} -> ${newPickupDate} @ ${newPickupTime}`;
    const { error: noteError } = await supabaseAdmin.from('customer_notes').insert({
      customer_id: booking.customers.id,
      booking_id: booking.id,
      source: 'System (Reschedule)',
      content: noteContent,
      author_type: 'system',
      is_read: false
    });
    if (noteError) {
      console.error('Failed to create reschedule note:', noteError);
    }
    return new Response(JSON.stringify({
      success: true,
      booking: updatedBooking
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 200
    });
  } catch (error) {
    console.error(error);
    return new Response(JSON.stringify({
      error: error.message
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 400
    });
  }
});
