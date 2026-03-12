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
    const { bookingId } = await req.json();
    if (!bookingId) {
      throw new Error("Booking ID is required to finalize.");
    }
    // Step 1: Fetch the booking data, it should be in 'awaiting_processing' state
    const { data: booking, error: fetchError } = await supabase.from('bookings').select(`*, customers!inner(*)`).eq('id', bookingId).single();
    if (fetchError || !booking) {
      throw new Error(`Could not fetch booking ${bookingId} for finalization. It may not exist or have been processed already.`);
    }
    if (booking.status !== 'awaiting_processing') {
      // This might happen if the function is called twice. It's safe to just return success.
      console.log(`Booking ${bookingId} is already processed. Current status: ${booking.status}`);
      return new Response(JSON.stringify({
        success: true,
        message: "Booking already finalized."
      }), {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        },
        status: 200
      });
    }
    // Step 2: Determine final booking status based on flags
    let finalStatus = 'Confirmed';
    if (booking.was_verification_skipped) {
      finalStatus = 'pending_verification';
    } else if (booking.addons?.addressVerificationSkipped) {
      finalStatus = 'pending_review';
    }
    // Step 3: Update booking with the final status
    const { data: updatedBooking, error: updateError } = await supabase.from('bookings').update({
      status: finalStatus
    }).eq('id', bookingId).select(`*, customers!inner(*)`).single();
    if (updateError) {
      console.error(`Finalize: Failed to update booking status for ${bookingId}:`, updateError);
      throw updateError;
    }
    // Step 4: Process equipment rental records
    const addons = updatedBooking.addons || {};
    if (addons.equipment && addons.equipment.length > 0) {
      const { data: equipmentList, error: equipmentListError } = await supabase.from('equipment').select('id, name');
      if (equipmentListError) throw equipmentListError;
      const equipmentMap = new Map(equipmentList.map((e)=>[
          e.name.toLowerCase().replace(/ /g, ''),
          e.id
        ]));
      const equipmentToInsert = addons.equipment.map((item)=>{
        const equipmentKey = item.id.toLowerCase().replace(/ /g, '');
        const equipmentId = equipmentMap.get(equipmentKey);
        if (!equipmentId) {
          console.warn(`Finalize: Could not find equipment mapping for addon ID: ${item.id}`);
          return null;
        }
        return {
          booking_id: bookingId,
          equipment_id: equipmentId,
          quantity: item.quantity
        };
      }).filter((item)=>item !== null);
      if (equipmentToInsert.length > 0) {
        const { error: insertError } = await supabase.from('booking_equipment').insert(equipmentToInsert);
        if (insertError) {
          console.error(`Finalize: Failed to insert booking_equipment for booking ${bookingId}`, insertError);
        }
      }
    }
    // Step 5: Send the confirmation email
    let customEmailMessage = null;
    if (finalStatus === 'pending_verification') {
      customEmailMessage = 'Your booking is currently on hold. This is because essential verification information (such as license plate and/or driver’s license photos) was not provided. Our team will manually review your booking. If we cannot complete verification, your booking may be subject to cancellation as per our rental agreement.';
    } else if (finalStatus === 'pending_review') {
      customEmailMessage = 'Your booking is currently on hold for manual review because the provided address could not be automatically verified. Our team will check the details and contact you if there are any issues with servicing your location.';
    }
    console.log("Finalize booking start before send-booking-confirmation", {
      bookingId,
      time: new Date().toISOString()
    });
    await supabase.functions.invoke('send-booking-confirmation', {
      body: {
        booking: updatedBooking,
        customMessage: customEmailMessage
      }
    });
    console.log("Finalize booking start after send-booking-confirmation", {
      bookingId,
      time: new Date().toISOString()
    });
    return new Response(JSON.stringify({
      success: true,
      booking: updatedBooking
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      },
      status: 200
    });
  } catch (error) {
    console.error(`Finalize Booking Error:`, error.message);
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
