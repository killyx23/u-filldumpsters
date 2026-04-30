import { supabase } from '@/lib/customSupabaseClient';

const IGLOOHOME_API_KEY = 'lbaznyxkupyz1uy5ais4p0rk07s9vvg1hxptbo9vc48cxblhoyw';
const LOCK_ID = 'EB1X095c23a6';
const IGLOOHOME_API_BASE = 'https://api.igloohome.co/v2';

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
export const generateDurationPIN = async (startTime, endTime, customerEmail, customerPhone, orderId, customerName = null) => {
  const timestamp = new Date().toISOString();
  
  console.log(`[${timestamp}] [IgloohomeService] generateDurationPIN called with:`, {
    lock_id: LOCK_ID,
    start_date: startTime,
    end_date: endTime,
    name: customerName || `Order-${orderId}`,
    orderId,
    customerEmail,
    customerPhone
  });

  try {
    console.log(`[${timestamp}] [IgloohomeService] Calling Igloohome API...`);
    
    const result = await retryWithBackoff(async () => {
      const payload = {
        name: customerName || `Order-${orderId}`,
        start_date: new Date(startTime).toISOString(),
        end_date: new Date(endTime).toISOString(),
        type: 'duration'
      };

      console.log(`[${timestamp}] [IgloohomeService] API request payload:`, payload);

      const response = await fetch(`${IGLOOHOME_API_BASE}/locks/${LOCK_ID}/algopins`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${IGLOOHOME_API_KEY}`
        },
        body: JSON.stringify(payload)
      });

      console.log(`[${timestamp}] [IgloohomeService] API response status:`, response.status);

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[${timestamp}] [IgloohomeService] API error response:`, errorText);
        throw new Error(`Igloohome API error (${response.status}): ${errorText}`);
      }

      const data = await response.json();
      console.log(`[${timestamp}] [IgloohomeService] API response:`, data);
      
      return data;
    });

    console.log(`[${timestamp}] [IgloohomeService] PIN extracted:`, {
      pin: result.pin_code,
      id: result.id
    });

    // Save to database
    console.log(`[${timestamp}] [IgloohomeService] Saving to database...`);
    
    const { data: accessCodeData, error: dbError } = await supabase
      .from('rental_access_codes')
      .insert({
        order_id: orderId,
        customer_email: customerEmail,
        customer_phone: customerPhone,
        access_pin: result.pin_code,
        pin_id: result.id,
        pin_type: 'algopin',
        lock_id: LOCK_ID,
        start_time: startTime,
        end_time: endTime,
        status: 'active'
      })
      .select()
      .single();

    if (dbError) {
      console.error(`[${timestamp}] [IgloohomeService] Database save error:`, dbError);
      throw new Error(`Failed to save access code: ${dbError.message}`);
    }

    console.log(`[${timestamp}] [IgloohomeService] Database record created:`, accessCodeData);

    // Log PIN generation event
    console.log(`[${timestamp}] [IgloohomeService] Creating tracking log...`);
    
    await supabase.from('rental_tracking_logs').insert({
      order_id: orderId,
      event_type: 'pin_generated',
      event_timestamp: new Date().toISOString(),
      api_sync_timestamp: new Date().toISOString(),
      notes: `PIN ${result.pin_code} generated for order ${orderId}`
    });

    console.log(`[${timestamp}] [IgloohomeService] ✓ PIN generated successfully:`, {
      pin: result.pin_code,
      pin_id: result.id,
      record_id: accessCodeData.id
    });

    return {
      access_pin: result.pin_code,
      pin_id: result.id,
      start_time: startTime,
      end_time: endTime,
      record_id: accessCodeData.id
    };

  } catch (error) {
    const errorTimestamp = new Date().toISOString();
    console.error(`[${errorTimestamp}] [IgloohomeService] ❌ Failed to generate PIN:`, {
      error: error.message,
      stack: error.stack,
      orderId
    });
    
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
export const checkLockHistory = async (lastSyncTime, orderId = null) => {
  const timestamp = new Date().toISOString();
  
  console.log(`[${timestamp}] [IgloohomeService] Checking lock history for order:`, orderId);
  console.log(`[${timestamp}] [IgloohomeService] Query params:`, {
    lock_id: LOCK_ID,
    since: lastSyncTime
  });

  try {
    const result = await retryWithBackoff(async () => {
      const params = new URLSearchParams({
        lock_id: LOCK_ID,
        start_date: new Date(lastSyncTime).toISOString(),
        end_date: new Date().toISOString()
      });

      console.log(`[${timestamp}] [IgloohomeService] Fetching lock history from API...`);

      const response = await fetch(`${IGLOOHOME_API_BASE}/locks/${LOCK_ID}/history?${params}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${IGLOOHOME_API_KEY}`
        }
      });

      console.log(`[${timestamp}] [IgloohomeService] Lock history API response status:`, response.status);

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[${timestamp}] [IgloohomeService] Lock history API error:`, errorText);
        throw new Error(`Igloohome API error (${response.status}): ${errorText}`);
      }

      const data = await response.json();
      console.log(`[${timestamp}] [IgloohomeService] Lock history raw response:`, data);
      
      return data;
    });

    // Parse and format events
    const events = (result.events || []).map(event => ({
      event_type: event.action === 'unlock' ? 'unlock' : 'lock',
      event_timestamp: event.timestamp,
      pin_used: event.pin_code,
      user_name: event.user_name
    }));

    console.log(`[${timestamp}] [IgloohomeService] ✓ Retrieved lock history:`, {
      events_count: events.length,
      events
    });

    return events;

  } catch (error) {
    const errorTimestamp = new Date().toISOString();
    console.error(`[${errorTimestamp}] [IgloohomeService] ❌ Failed to check lock history:`, {
      error: error.message,
      stack: error.stack,
      orderId
    });
    
    throw error;
  }
};

// Validate PIN is within valid time window
export const validatePIN = async (pin, currentTime = new Date()) => {
  const timestamp = new Date().toISOString();
  
  console.log(`[${timestamp}] [IgloohomeService] Validating PIN:`, {
    pin,
    currentTime: currentTime.toISOString()
  });

  try {
    console.log(`[${timestamp}] [IgloohomeService] Querying database for PIN...`);
    
    const { data, error } = await supabase
      .from('rental_access_codes')
      .select('*')
      .eq('access_pin', pin)
      .eq('status', 'active')
      .single();

    if (error || !data) {
      console.warn(`[${timestamp}] [IgloohomeService] PIN not found or inactive:`, {
        pin,
        error: error?.message
      });
      
      console.log(`[${timestamp}] [IgloohomeService] PIN valid: false (not found)`);
      
      return { valid: false, reason: 'PIN not found or expired' };
    }

    console.log(`[${timestamp}] [IgloohomeService] PIN record found:`, {
      order_id: data.order_id,
      start_time: data.start_time,
      end_time: data.end_time,
      status: data.status
    });

    const now = new Date(currentTime);
    const startTime = new Date(data.start_time);
    const endTime = new Date(data.end_time);

    if (now < startTime) {
      console.warn(`[${timestamp}] [IgloohomeService] PIN not yet valid:`, {
        pin,
        currentTime: now.toISOString(),
        startTime: startTime.toISOString()
      });
      
      console.log(`[${timestamp}] [IgloohomeService] PIN valid: false (not yet active)`);
      
      return { 
        valid: false, 
        reason: 'PIN not yet active',
        start_time: data.start_time
      };
    }

    if (now > endTime) {
      console.warn(`[${timestamp}] [IgloohomeService] PIN expired:`, {
        pin,
        currentTime: now.toISOString(),
        endTime: endTime.toISOString()
      });
      
      // Mark as expired
      await supabase
        .from('rental_access_codes')
        .update({ status: 'expired' })
        .eq('id', data.id);

      console.log(`[${timestamp}] [IgloohomeService] PIN marked as expired in database`);
      console.log(`[${timestamp}] [IgloohomeService] PIN valid: false (expired)`);
      
      return { 
        valid: false, 
        reason: 'PIN expired',
        end_time: data.end_time
      };
    }

    console.log(`[${timestamp}] [IgloohomeService] ✓ PIN is valid`);
    console.log(`[${timestamp}] [IgloohomeService] PIN valid: true`);
    
    return { 
      valid: true, 
      access_code: data,
      order_id: data.order_id
    };

  } catch (error) {
    const errorTimestamp = new Date().toISOString();
    console.error(`[${errorTimestamp}] [IgloohomeService] ❌ PIN validation error:`, {
      error: error.message,
      stack: error.stack,
      pin
    });
    
    throw error;
  }
};

// Delete PIN from Igloohome system
export const deletePIN = async (algoPinId, orderId = null) => {
  const timestamp = new Date().toISOString();
  
  console.log(`[${timestamp}] [IgloohomeService] Deleting PIN:`, {
    algoPinId,
    orderId
  });

  try {
    console.log(`[${timestamp}] [IgloohomeService] Calling Igloohome delete API...`);
    
    await retryWithBackoff(async () => {
      const response = await fetch(`${IGLOOHOME_API_BASE}/locks/${LOCK_ID}/algopins/${algoPinId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${IGLOOHOME_API_KEY}`
        }
      });

      console.log(`[${timestamp}] [IgloohomeService] Delete API response status:`, response.status);

      if (!response.ok && response.status !== 404) {
        const errorText = await response.text();
        console.error(`[${timestamp}] [IgloohomeService] Delete API error:`, errorText);
        throw new Error(`Igloohome API error (${response.status}): ${errorText}`);
      }
    });

    console.log(`[${timestamp}] [IgloohomeService] ✓ PIN deleted successfully from Igloohome`);
    
    return { success: true };

  } catch (error) {
    const errorTimestamp = new Date().toISOString();
    console.error(`[${errorTimestamp}] [IgloohomeService] ❌ Failed to delete PIN:`, {
      error: error.message,
      stack: error.stack,
      algoPinId,
      orderId
    });
    
    throw error;
  }
};