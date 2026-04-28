
import { supabase } from '@/lib/customSupabaseClient';

const IGLOOHOME_API_KEY = 'lbaznyxkupyz1uy5ais4p0rk07s9vvg1hxptbo9vc48cxblhoyw';
const LOCK_ID = 'EB1X095c23a6';
const IGLOOHOME_API_BASE = 'https://connect.igloohome.co/v2';

// Exponential backoff retry logic
const retryWithBackoff = async (fn, maxRetries = 3, baseDelay = 1000) => {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxRetries - 1) throw error;
      
      const delay = baseDelay * Math.pow(2, attempt);
      console.warn(`[IgloohomeService] Retry attempt ${attempt + 1} after ${delay}ms:`, error.message);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
};

// Generate Duration-based algoPIN
export const generateDurationPIN = async (startTime, endTime, customerEmail, customerPhone, orderId) => {
  console.log('[IgloohomeService] Generating duration PIN', {
    orderId,
    startTime,
    endTime,
    customerEmail
  });

  try {
    const result = await retryWithBackoff(async () => {
      const response = await fetch(`${IGLOOHOME_API_BASE}/locks/${LOCK_ID}/algopins`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${IGLOOHOME_API_KEY}`
        },
        body: JSON.stringify({
          name: `Order-${orderId}`,
          start_date: new Date(startTime).toISOString(),
          end_date: new Date(endTime).toISOString(),
          type: 'duration'
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Igloohome API error (${response.status}): ${errorText}`);
      }

      return await response.json();
    });

    // Save to database
    const { data: accessCodeData, error: dbError } = await supabase
      .from('rental_access_codes')
      .insert({
        order_id: orderId,
        customer_email: customerEmail,
        customer_phone: customerPhone,
        access_pin: result.pin_code,
        algo_pin_id: result.id,
        start_time: startTime,
        end_time: endTime,
        status: 'active'
      })
      .select()
      .single();

    if (dbError) {
      console.error('[IgloohomeService] Database save error:', dbError);
      throw new Error(`Failed to save access code: ${dbError.message}`);
    }

    // Log PIN generation event
    await supabase.from('rental_tracking_logs').insert({
      order_id: orderId,
      event_type: 'pin_generated',
      event_timestamp: new Date().toISOString(),
      api_sync_timestamp: new Date().toISOString(),
      notes: `PIN generated for order ${orderId}`
    });

    console.log('[IgloohomeService] ✓ PIN generated successfully:', {
      pin: result.pin_code,
      algo_pin_id: result.id
    });

    return {
      access_pin: result.pin_code,
      algo_pin_id: result.id,
      start_time: startTime,
      end_time: endTime,
      record_id: accessCodeData.id
    };

  } catch (error) {
    console.error('[IgloohomeService] ❌ Failed to generate PIN:', error);
    
    // Log error
    await supabase.from('rental_tracking_logs').insert({
      order_id: orderId,
      event_type: 'sync_error',
      event_timestamp: new Date().toISOString(),
      notes: `PIN generation failed: ${error.message}`
    });

    throw error;
  }
};

// Check lock history for unlock/lock events
export const checkLockHistory = async (lastSyncTime) => {
  console.log('[IgloohomeService] Checking lock history since:', lastSyncTime);

  try {
    const result = await retryWithBackoff(async () => {
      const params = new URLSearchParams({
        lock_id: LOCK_ID,
        start_date: new Date(lastSyncTime).toISOString(),
        end_date: new Date().toISOString()
      });

      const response = await fetch(`${IGLOOHOME_API_BASE}/locks/${LOCK_ID}/history?${params}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${IGLOOHOME_API_KEY}`
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Igloohome API error (${response.status}): ${errorText}`);
      }

      return await response.json();
    });

    // Parse and format events
    const events = (result.events || []).map(event => ({
      event_type: event.action === 'unlock' ? 'unlock' : 'lock',
      event_timestamp: event.timestamp,
      pin_used: event.pin_code,
      user_name: event.user_name
    }));

    console.log('[IgloohomeService] ✓ Retrieved lock history:', {
      events_count: events.length,
      events
    });

    return events;

  } catch (error) {
    console.error('[IgloohomeService] ❌ Failed to check lock history:', error);
    throw error;
  }
};

// Validate PIN is within valid time window
export const validatePIN = async (pin, currentTime = new Date()) => {
  console.log('[IgloohomeService] Validating PIN:', { pin, currentTime });

  try {
    const { data, error } = await supabase
      .from('rental_access_codes')
      .select('*')
      .eq('access_pin', pin)
      .eq('status', 'active')
      .single();

    if (error || !data) {
      console.warn('[IgloohomeService] PIN not found or inactive:', pin);
      return { valid: false, reason: 'PIN not found or expired' };
    }

    const now = new Date(currentTime);
    const startTime = new Date(data.start_time);
    const endTime = new Date(data.end_time);

    if (now < startTime) {
      console.warn('[IgloohomeService] PIN not yet valid:', {
        pin,
        currentTime: now.toISOString(),
        startTime: startTime.toISOString()
      });
      return { 
        valid: false, 
        reason: 'PIN not yet active',
        start_time: data.start_time
      };
    }

    if (now > endTime) {
      console.warn('[IgloohomeService] PIN expired:', {
        pin,
        currentTime: now.toISOString(),
        endTime: endTime.toISOString()
      });
      
      // Mark as expired
      await supabase
        .from('rental_access_codes')
        .update({ status: 'expired' })
        .eq('id', data.id);

      return { 
        valid: false, 
        reason: 'PIN expired',
        end_time: data.end_time
      };
    }

    console.log('[IgloohomeService] ✓ PIN is valid');
    return { 
      valid: true, 
      access_code: data,
      order_id: data.order_id
    };

  } catch (error) {
    console.error('[IgloohomeService] ❌ PIN validation error:', error);
    throw error;
  }
};

// Delete PIN from Igloohome system
export const deletePIN = async (algoPinId) => {
  console.log('[IgloohomeService] Deleting PIN:', algoPinId);

  try {
    await retryWithBackoff(async () => {
      const response = await fetch(`${IGLOOHOME_API_BASE}/locks/${LOCK_ID}/algopins/${algoPinId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${IGLOOHOME_API_KEY}`
        }
      });

      if (!response.ok && response.status !== 404) {
        const errorText = await response.text();
        throw new Error(`Igloohome API error (${response.status}): ${errorText}`);
      }
    });

    console.log('[IgloohomeService] ✓ PIN deleted successfully');
    return { success: true };

  } catch (error) {
    console.error('[IgloohomeService] ❌ Failed to delete PIN:', error);
    throw error;
  }
};
