import { supabase } from '@/lib/customSupabaseClient';

/**
 * Comprehensive Igloohome Integration Diagnostics
 * 
 * This utility helps diagnose issues with the Igloohome PIN generation system.
 */

/**
 * Test the Igloohome RPC function with comprehensive logging
 */
export async function testIgloohomeRPC(bookingId) {
  console.log("=== Igloohome RPC Diagnostic Test ===");
  console.log("Testing with booking ID:", bookingId);

  try {
    // Fetch booking details first
    console.log("Fetching booking details...");
    const { data: booking, error: fetchError } = await supabase
      .from('bookings')
      .select('*')
      .eq('id', bookingId)
      .single();

    if (fetchError) {
      console.error("Error fetching booking:", fetchError);
      return {
        success: false,
        step: 'fetch_booking',
        error: fetchError,
      };
    }

    console.log("Booking details:", {
      id: booking.id,
      email: booking.email,
      phone: booking.phone,
      drop_off_date: booking.drop_off_date,
      pickup_date: booking.pickup_date,
      access_pin: booking.access_pin,
    });

    // Prepare RPC parameters
    const startTime = new Date(booking.drop_off_date + 'T00:00:00Z').toISOString();
    const endTime = new Date(booking.pickup_date + 'T23:59:59Z').toISOString();

    const rpcParams = {
      p_booking_id: booking.id,
      p_order_id: booking.id,
      p_customer_email: booking.email,
      p_customer_phone: booking.phone || '',
      p_start_time: startTime,
      p_end_time: endTime,
    };

    console.log("RPC Parameters:", rpcParams);

    // Call the RPC function
    console.log("Calling generate_igloohome_pin_rpc...");
    const { data: rpcResponse, error: rpcError } = await supabase.rpc(
      'generate_igloohome_pin_rpc',
      rpcParams
    );

    if (rpcError) {
      console.error("RPC Error:", rpcError);
      return {
        success: false,
        step: 'rpc_call',
        error: rpcError,
        error_code: rpcError.code,
        error_message: rpcError.message,
        error_details: rpcError.details,
      };
    }

    console.log("RPC Response:", rpcResponse);

    // Verify the booking was updated
    console.log("Verifying booking update...");
    const { data: updatedBooking, error: verifyError } = await supabase
      .from('bookings')
      .select('access_pin')
      .eq('id', bookingId)
      .single();

    if (verifyError) {
      console.error("Error verifying booking update:", verifyError);
    } else {
      console.log("Updated booking access_pin:", updatedBooking.access_pin);
    }

    // Check rental_access_codes table
    console.log("Checking rental_access_codes table...");
    const { data: accessCodes, error: codesError } = await supabase
      .from('rental_access_codes')
      .select('*')
      .eq('order_id', bookingId);

    if (codesError) {
      console.error("Error fetching access codes:", codesError);
    } else {
      console.log("Access codes found:", accessCodes?.length || 0);
      if (accessCodes && accessCodes.length > 0) {
        console.log("Latest access code:", accessCodes[accessCodes.length - 1]);
      }
    }

    return {
      success: rpcResponse?.success || false,
      rpc_response: rpcResponse,
      booking_updated: updatedBooking?.access_pin !== null,
      access_codes_created: accessCodes?.length || 0,
    };

  } catch (error) {
    console.error("Exception in diagnostic test:", error);
    return {
      success: false,
      step: 'exception',
      error: error.message,
      stack: error.stack,
    };
  }
}

/**
 * Check Postgres logs for RPC execution
 * Note: This requires service_role access to pg_stat_statements
 */
export async function checkPostgresLogs() {
  console.log("=== Checking Postgres Logs ===");
  console.log("Note: Logs are best viewed in Supabase Dashboard → Logs → Postgres Logs");
  console.log("Filter for: [generate_igloohome_pin_rpc]");
  
  return {
    message: "Check Supabase Dashboard → Logs → Postgres Logs for detailed execution logs",
    search_term: "[generate_igloohome_pin_rpc]",
  };
}

/**
 * Verify booking and rental_access_codes state
 */
export async function verifyBookingState(bookingId) {
  console.log("=== Verifying Booking State ===");
  console.log("Booking ID:", bookingId);

  try {
    // Check bookings table
    const { data: booking, error: bookingError } = await supabase
      .from('bookings')
      .select('id, status, payment_intent, access_pin, created_at, email, phone')
      .eq('id', bookingId)
      .single();

    if (bookingError) {
      console.error("Error fetching booking:", bookingError);
      return { success: false, error: bookingError };
    }

    console.log("Booking state:", booking);

    // Check rental_access_codes table
    const { data: accessCodes, error: codesError } = await supabase
      .from('rental_access_codes')
      .select('*')
      .eq('order_id', bookingId)
      .order('created_at', { ascending: false });

    if (codesError) {
      console.error("Error fetching access codes:", codesError);
    } else {
      console.log("Access codes found:", accessCodes?.length || 0);
      if (accessCodes && accessCodes.length > 0) {
        console.log("Access codes:", accessCodes);
      }
    }

    return {
      success: true,
      booking: booking,
      access_codes: accessCodes || [],
      has_access_pin: booking.access_pin !== null,
      has_rental_codes: (accessCodes?.length || 0) > 0,
    };

  } catch (error) {
    console.error("Exception verifying booking state:", error);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Manual test of the entire flow
 */
export async function testCompleteFlow(bookingId) {
  console.log("=== Testing Complete Igloohome Flow ===");
  
  const results = {
    timestamp: new Date().toISOString(),
    booking_id: bookingId,
    steps: [],
  };

  // Step 1: Verify initial state
  console.log("\nStep 1: Verify initial booking state");
  const initialState = await verifyBookingState(bookingId);
  results.steps.push({
    step: 'initial_state',
    success: initialState.success,
    data: initialState,
  });

  // Step 2: Test RPC function
  console.log("\nStep 2: Test RPC function");
  const rpcTest = await testIgloohomeRPC(bookingId);
  results.steps.push({
    step: 'rpc_test',
    success: rpcTest.success,
    data: rpcTest,
  });

  // Step 3: Verify final state
  console.log("\nStep 3: Verify final booking state");
  const finalState = await verifyBookingState(bookingId);
  results.steps.push({
    step: 'final_state',
    success: finalState.success,
    data: finalState,
  });

  // Summary
  console.log("\n=== Test Summary ===");
  console.log("All steps completed:", results.steps.every(s => s.success));
  console.log("Access PIN created:", finalState.has_access_pin);
  console.log("Rental codes created:", finalState.has_rental_codes);

  results.overall_success = results.steps.every(s => s.success) && 
                            finalState.has_access_pin && 
                            finalState.has_rental_codes;

  return results;
}

/**
 * Quick diagnostic for troubleshooting
 */
export async function quickDiagnostic(bookingId) {
  const state = await verifyBookingState(bookingId);
  
  if (!state.success) {
    return { error: "Failed to fetch booking state", details: state.error };
  }

  const issues = [];

  if (!state.booking) {
    issues.push("Booking not found");
  } else {
    if (!state.booking.access_pin) {
      issues.push("access_pin is NULL in bookings table");
    }
    if (!state.booking.email) {
      issues.push("Customer email is missing");
    }
    if (!state.booking.payment_intent) {
      issues.push("Payment intent is missing - payment may not have completed");
    }
  }

  if (state.access_codes.length === 0) {
    issues.push("No records in rental_access_codes table");
  }

  return {
    booking_id: bookingId,
    has_issues: issues.length > 0,
    issues: issues,
    booking_state: state.booking,
    access_codes_count: state.access_codes.length,
    recommendations: issues.length > 0 ? [
      "Check Supabase Dashboard → Logs → Postgres Logs for RPC execution logs",
      "Search for: [generate_igloohome_pin_rpc]",
      "Verify payment was completed before PIN generation",
      "Run testIgloohomeRPC() to test the RPC function directly",
    ] : [
      "System appears to be working correctly",
    ],
  };
}