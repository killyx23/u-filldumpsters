import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from './cors.ts';
import { differenceInCalendarDays } from 'https://esm.sh/date-fns@2.30.0';
// Helper to calculate price based on service and duration
const calculatePrice = (plan, startDate, endDate, isDelivery)=>{
  const dailyRate = plan.daily_rate || 100; // Default daily rate
  const weeklyRate = plan.weekly_rate || 500; // Default weekly rate
  let duration = differenceInCalendarDays(new Date(endDate), new Date(startDate));
  if (duration < 1) duration = 1;
  let total = 0;
  if (plan.id === 2 && !isDelivery) {
    const weeks = Math.floor(duration / 7);
    const days = duration % 7;
    total = weeks * weeklyRate + days * dailyRate;
  } else {
    total = plan.base_price || 0;
    if (duration > 7) {
      const extraDays = duration - 7;
      total += extraDays * 20; // $20 for each extra day
    }
  }
  return total;
};
Deno.serve(async (req)=>{
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
  }
  try {
    const { bookingId, newDropOffDate, newPickupDate, newDropOffTime, newPickupTime, priceDifference, rescheduleFee, newTotalPrice } = await req.json();
    if (!bookingId || !newDropOffDate || !newPickupDate || !newDropOffTime || !newPickupTime) {
      throw new Error("Missing required date/time fields.");
    }
    if (priceDifference === undefined || rescheduleFee === undefined || newTotalPrice === undefined) {
      throw new Error("Missing required pricing fields.");
    }
    const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
    // 1. Fetch the original booking
    const { data: booking, error: bookingError } = await supabaseAdmin.from('bookings').select('*, customers(id, name)').eq('id', bookingId).single();
    if (bookingError) throw bookingError;
    if (!booking) throw new Error("Booking not found.");
    // 2. Prepare reschedule history
    const newHistoryEntry = {
      rescheduled_at: new Date().toISOString(),
      from_drop_off_date: booking.drop_off_date,
      from_pickup_date: booking.pickup_date,
      from_drop_off_time: booking.drop_off_time_slot,
      from_pickup_time: booking.pickup_time_slot,
      to_drop_off_date: newDropOffDate,
      to_pickup_date: newPickupDate,
      to_drop_off_time: newDropOffTime,
      to_pickup_time: newPickupTime,
      price_difference: priceDifference,
      reschedule_fee: rescheduleFee,
      original_total_price: booking.total_price,
      new_total_price: newTotalPrice
    };
    const existingHistory = booking.reschedule_history || [];
    const updatedHistory = [
      ...existingHistory,
      newHistoryEntry
    ];
    // 3. Update the booking with new dates, times, status, and history
    // The status is set to 'pending_review' for admin approval
    const { data: updatedBooking, error: updateError } = await supabaseAdmin.from('bookings').update({
      drop_off_date: newDropOffDate,
      pickup_date: newPickupDate,
      drop_off_time_slot: newDropOffTime,
      pickup_time_slot: newPickupTime,
      status: 'pending_review',
      reschedule_history: updatedHistory
    }).eq('id', bookingId).select().single();
    if (updateError) throw updateError;
    // 4. Create a detailed note for the admin
    let noteContent = `Customer requested to reschedule booking #${bookingId}. This requires your approval.\n\n`;
    noteContent += `Original Dates: ${booking.drop_off_date} -> ${booking.pickup_date}\n`;
    noteContent += `New Dates: ${newDropOffDate} -> ${newPickupDate}\n\n`;
    noteContent += `Original Price: $${booking.total_price.toFixed(2)}\n`;
    noteContent += `New Calculated Price: $${(newTotalPrice - rescheduleFee).toFixed(2)}\n`;
    noteContent += `Reschedule Fee (10%): $${rescheduleFee.toFixed(2)}\n`;
    noteContent += `Price Difference: $${priceDifference.toFixed(2)}\n`;
    noteContent += `New Grand Total: $${newTotalPrice.toFixed(2)}\n\n`;
    noteContent += `ACTION REQUIRED: Please review this change. If approved, you must manually charge the customer $${priceDifference.toFixed(2)} and update the booking's total price to $${newTotalPrice.toFixed(2)}.`;
    const { error: noteError } = await supabaseAdmin.from('customer_notes').insert({
      customer_id: booking.customers.id,
      booking_id: booking.id,
      source: 'Change Request',
      content: noteContent,
      author_type: 'customer',
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
    console.error('Error in reschedule-booking function:', error);
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
