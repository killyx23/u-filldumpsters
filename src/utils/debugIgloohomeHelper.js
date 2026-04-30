/**
 * Igloohome PIN Generation Debug Helper
 * Provides logging and debugging utilities for PIN generation flow
 */

import { supabase } from '@/lib/customSupabaseClient';

export const debugLog = (context, message, data = null) => {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] [${context}] ${message}`;
  
  if (data) {
    console.log(logMessage, data);
  } else {
    console.log(logMessage);
  }
};

export const debugError = (context, message, error = null) => {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] [${context}] ERROR: ${message}`;
  
  if (error) {
    console.error(logMessage, {
      message: error.message,
      stack: error.stack,
      fullError: error
    });
  } else {
    console.error(logMessage);
  }
};

/**
 * Check rental_access_codes table for a specific order
 */
export const checkAccessCodeForOrder = async (orderId) => {
  debugLog('debugIgloohomeHelper', 'Checking access code for order:', { orderId });

  try {
    const { data, error } = await supabase
      .from('rental_access_codes')
      .select('*')
      .eq('order_id', orderId);

    if (error) {
      debugError('debugIgloohomeHelper', 'Query error:', error);
      return { success: false, error: error.message };
    }

    debugLog('debugIgloohomeHelper', 'Query result:', {
      recordCount: data?.length || 0,
      records: data
    });

    return { success: true, data, count: data?.length || 0 };
  } catch (err) {
    debugError('debugIgloohomeHelper', 'Unexpected error:', err);
    return { success: false, error: err.message };
  }
};

/**
 * Check booking details
 */
export const checkBookingDetails = async (bookingId) => {
  debugLog('debugIgloohomeHelper', 'Checking booking details:', { bookingId });

  try {
    const { data, error } = await supabase
      .from('bookings')
      .select('id, plan, drop_off_date, pickup_date, access_pin, email, phone, status')
      .eq('id', bookingId)
      .single();

    if (error) {
      debugError('debugIgloohomeHelper', 'Query error:', error);
      return { success: false, error: error.message };
    }

    debugLog('debugIgloohomeHelper', 'Booking details:', {
      id: data.id,
      plan: data.plan,
      serviceName: data.plan?.name,
      dropOffDate: data.drop_off_date,
      pickupDate: data.pickup_date,
      hasAccessPin: !!data.access_pin,
      accessPin: data.access_pin,
      status: data.status
    });

    return { success: true, data };
  } catch (err) {
    debugError('debugIgloohomeHelper', 'Unexpected error:', err);
    return { success: false, error: err.message };
  }
};

/**
 * Extract OAuth endpoint from database function definition
 */
export const extractOAuthEndpoint = async () => {
  debugLog('debugIgloohomeHelper', 'Attempting to extract OAuth endpoint from database function');

  try {
    // Note: This requires service_role permissions
    // For diagnostic purposes, we'll document the expected endpoint
    
    const expectedEndpoint = 'https://api.igloohome.co/v2/oauth/token';
    
    debugLog('debugIgloohomeHelper', 'Expected OAuth endpoint:', { 
      endpoint: expectedEndpoint,
      usesHTTPS: expectedEndpoint.startsWith('https://'),
      isValid: expectedEndpoint.startsWith('https://') && expectedEndpoint.includes('oauth') && expectedEndpoint.includes('token')
    });

    return {
      success: true,
      expectedEndpoint,
      usesHTTPS: true,
      note: 'Direct database function inspection requires service_role access. Use Supabase Dashboard SQL Editor to verify.'
    };
  } catch (err) {
    debugError('debugIgloohomeHelper', 'Unexpected error:', err);
    return { success: false, error: err.message };
  }
};

/**
 * Verify OAuth endpoint security
 */
export const verifyOAuthEndpointSecurity = (endpoint) => {
  debugLog('debugIgloohomeHelper', 'Verifying OAuth endpoint security:', { endpoint });

  const checks = {
    usesHTTPS: endpoint.startsWith('https://'),
    isComplete: endpoint.includes('://') && endpoint.length > 10,
    hasOAuth: endpoint.toLowerCase().includes('oauth'),
    hasToken: endpoint.toLowerCase().includes('token'),
    isIgloohome: endpoint.includes('igloohome'),
    noTrailingSlash: !endpoint.endsWith('/'),
  };

  const isValid = Object.values(checks).every(check => check === true);

  const results = {
    endpoint,
    checks,
    isValid,
    issues: Object.entries(checks)
      .filter(([_, passed]) => !passed)
      .map(([check, _]) => check),
  };

  debugLog('debugIgloohomeHelper', 'Security verification results:', results);

  return results;
};

/**
 * Verify magic link token
 */
export const verifyMagicLinkToken = async (token) => {
  debugLog('debugIgloohomeHelper', 'Verifying magic link token:', { token });

  try {
    const { data, error } = await supabase
      .from('magic_link_tokens')
      .select('*')
      .eq('token', token)
      .single();

    if (error) {
      debugError('debugIgloohomeHelper', 'Token not found:', error);
      return { success: false, error: error.message, valid: false };
    }

    const isExpired = new Date(data.expires_at) < new Date();
    const isUsed = !!data.used_at;

    debugLog('debugIgloohomeHelper', 'Token status:', {
      found: true,
      isExpired,
      isUsed,
      expiresAt: data.expires_at,
      usedAt: data.used_at,
      customerId: data.customer_id
    });

    return { 
      success: true, 
      data, 
      valid: !isExpired && !isUsed,
      isExpired,
      isUsed
    };
  } catch (err) {
    debugError('debugIgloohomeHelper', 'Unexpected error:', err);
    return { success: false, error: err.message, valid: false };
  }
};

/**
 * Test PIN generation for an order
 */
export const testPinGeneration = async (orderId) => {
  debugLog('debugIgloohomeHelper', 'Testing PIN generation for order:', { orderId });

  try {
    // Get booking details first
    const bookingCheck = await checkBookingDetails(orderId);
    if (!bookingCheck.success) {
      return { success: false, error: 'Booking not found' };
    }

    const booking = bookingCheck.data;

    // Prepare payload for PIN generation
    const payload = {
      booking_id: booking.id,
      order_id: booking.id,
      customer_email: booking.email,
      customer_phone: booking.phone,
      start_time: booking.drop_off_date,
      end_time: booking.pickup_date,
      service_type: booking.plan?.name || 'Unknown'
    };

    debugLog('debugIgloohomeHelper', 'Calling generate-igloohome-pin with payload:', payload);

    const { data, error } = await supabase.functions.invoke('generate-igloohome-pin', {
      body: payload
    });

    if (error) {
      debugError('debugIgloohomeHelper', 'Edge function error:', error);
      return { success: false, error: error.message, response: data };
    }

    debugLog('debugIgloohomeHelper', 'PIN generation response:', data);

    return { success: true, data };
  } catch (err) {
    debugError('debugIgloohomeHelper', 'Unexpected error:', err);
    return { success: false, error: err.message };
  }
};

/**
 * Browser console utility - attach to window for easy debugging
 */
if (typeof window !== 'undefined') {
  window.debugIgloohome = {
    checkAccessCode: checkAccessCodeForOrder,
    checkBooking: checkBookingDetails,
    verifyToken: verifyMagicLinkToken,
    testPinGeneration,
    extractOAuthEndpoint,
    verifyEndpointSecurity: verifyOAuthEndpointSecurity,
    help: () => {
      console.log(`
Igloohome Debug Utilities:
  
  window.debugIgloohome.checkAccessCode(orderId)
    - Check rental_access_codes table for a specific order
    - Example: window.debugIgloohome.checkAccessCode(1195)
  
  window.debugIgloohome.checkBooking(bookingId)
    - Check booking details and PIN status
    - Example: window.debugIgloohome.checkBooking(1195)
  
  window.debugIgloohome.extractOAuthEndpoint()
    - Get expected OAuth endpoint and security info
    - Example: window.debugIgloohome.extractOAuthEndpoint()
  
  window.debugIgloohome.verifyEndpointSecurity(url)
    - Verify an OAuth endpoint URL is secure
    - Example: window.debugIgloohome.verifyEndpointSecurity('https://api.igloohome.co/v2/oauth/token')
  
  window.debugIgloohome.verifyToken(token)
    - Verify magic link token validity
    - Example: window.debugIgloohome.verifyToken('abc-123-def')
  
  window.debugIgloohome.testPinGeneration(orderId)
    - Manually trigger PIN generation for an order
    - Example: window.debugIgloohome.testPinGeneration(1195)
  
  window.debugIgloohome.help()
    - Show this help message
      `);
    }
  };

  console.log('✓ Igloohome debug utilities loaded. Type window.debugIgloohome.help() for usage.');
}