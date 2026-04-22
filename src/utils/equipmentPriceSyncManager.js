import { supabase } from '@/lib/customSupabaseClient';
import { getPriceForEquipment } from './equipmentPricingIntegration';
import { 
  verifyEquipmentTableData, 
  verifyEquipmentPricingTableData,
  testPriceLookupForAllEquipment,
  testPriceUpdateFlow
} from './equipmentDataVerification';

/**
 * Equipment Price Sync Manager
 * Manages real-time price synchronization across all components
 */

// Active subscriptions map
const priceChangeListeners = new Map();

// Connection status
let connectionStatus = 'disconnected';
let realtimeSubscription = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY = 5000;

// Status change listeners
const statusChangeListeners = new Set();

// Price update history (last 100 updates)
const priceUpdateHistory = [];
const MAX_HISTORY_SIZE = 100;

/**
 * Initialize real-time price synchronization
 * @returns {Promise<boolean>} Success status
 */
export async function initialize() {
  console.group('[Price Sync Manager] Initializing...');
  console.log('Timestamp:', new Date().toISOString());
  
  try {
    // Clean up existing subscription
    if (realtimeSubscription) {
      console.log('[Price Sync Manager] Cleaning up existing subscription');
      await supabase.removeChannel(realtimeSubscription);
    }

    // Create new subscription
    console.log('[Price Sync Manager] Creating real-time subscription to equipment_pricing table');
    
    realtimeSubscription = supabase
      .channel('equipment_pricing_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'equipment_pricing'
        },
        handlePriceChange
      )
      .subscribe((status) => {
        console.log('[Price Sync Manager] Subscription status:', status);
        
        if (status === 'SUBSCRIBED') {
          connectionStatus = 'connected';
          reconnectAttempts = 0;
          notifyStatusChange('connected');
          console.log('[Price Sync Manager] ✓ Successfully connected to real-time updates');
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          connectionStatus = 'error';
          notifyStatusChange('error');
          console.error('[Price Sync Manager] ❌ Connection error:', status);
          
          // Attempt reconnection
          handleReconnect();
        }
      });

    console.log('[Price Sync Manager] ✓ Initialization complete');
    console.groupEnd();
    return true;

  } catch (error) {
    console.error('[Price Sync Manager] ❌ Initialization failed:', error);
    connectionStatus = 'error';
    notifyStatusChange('error');
    console.groupEnd();
    
    // Attempt reconnection
    handleReconnect();
    return false;
  }
}

/**
 * Subscribe to all equipment price changes (for monitoring)
 * @returns {object} Supabase channel subscription
 */
export function subscribeToEquipmentPriceChanges() {
  console.log('[Price Sync Manager] Creating monitoring subscription...');
  
  const channel = supabase
    .channel('equipment_pricing_monitor_' + Date.now())
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'equipment_pricing'
      },
      handlePriceChange
    )
    .subscribe();

  return channel;
}

/**
 * Handle reconnection attempts
 */
function handleReconnect() {
  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    console.error('[Price Sync Manager] Max reconnection attempts reached');
    connectionStatus = 'failed';
    notifyStatusChange('failed');
    return;
  }

  reconnectAttempts++;
  console.log(`[Price Sync Manager] Reconnection attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}`);
  
  setTimeout(() => {
    console.log('[Price Sync Manager] Attempting to reconnect...');
    initialize();
  }, RECONNECT_DELAY);
}

/**
 * Handle price change events from Supabase
 * @param {object} payload - Change payload from Supabase
 */
async function handlePriceChange(payload) {
  console.group('[Price Sync Manager] Price change detected');
  console.log('Timestamp:', new Date().toISOString());
  console.log('Event type:', payload.eventType);
  console.log('Payload:', payload);

  const equipmentId = payload.new?.equipment_id || payload.old?.equipment_id;
  const newPrice = payload.new?.base_price;
  const oldPrice = payload.old?.base_price;

  if (!equipmentId) {
    console.warn('[Price Sync Manager] No equipment_id in payload');
    console.groupEnd();
    return;
  }

  // Fetch equipment details
  const { data: equipment } = await supabase
    .from('equipment')
    .select('name, type')
    .eq('id', equipmentId)
    .single();

  const changeData = {
    equipmentId,
    equipmentName: equipment?.name || 'Unknown',
    equipmentType: equipment?.type,
    oldPrice: oldPrice ? Number(oldPrice) : null,
    newPrice: newPrice ? Number(newPrice) : null,
    timestamp: new Date().toISOString(),
    event: payload.eventType
  };

  console.log('[Price Sync Manager] Broadcasting change:', changeData);

  // Add to history
  priceUpdateHistory.unshift(changeData);
  if (priceUpdateHistory.length > MAX_HISTORY_SIZE) {
    priceUpdateHistory.pop();
  }

  // Notify all listeners for this equipment
  if (priceChangeListeners.has(equipmentId)) {
    const listeners = priceChangeListeners.get(equipmentId);
    listeners.forEach(callback => {
      try {
        callback(changeData);
      } catch (error) {
        console.error('[Price Sync Manager] Listener error:', error);
      }
    });
  }

  // Dispatch global event
  const event = new CustomEvent('equipment-price-changed', { detail: changeData });
  window.dispatchEvent(event);

  console.log('[Price Sync Manager] ✓ Change broadcasted to', priceChangeListeners.get(equipmentId)?.size || 0, 'listeners');
  console.groupEnd();
}

/**
 * Subscribe to price updates for specific equipment
 * @param {string} equipmentId - Equipment ID to monitor
 * @param {function} callback - Callback function to handle updates
 * @returns {function} Unsubscribe function
 */
export function subscribeToPriceUpdates(equipmentId, callback) {
  console.log('[Price Sync Manager] New subscription:', equipmentId);

  if (!priceChangeListeners.has(equipmentId)) {
    priceChangeListeners.set(equipmentId, new Set());
  }

  priceChangeListeners.get(equipmentId).add(callback);

  // Return unsubscribe function
  return () => {
    console.log('[Price Sync Manager] Unsubscribing:', equipmentId);
    const listeners = priceChangeListeners.get(equipmentId);
    if (listeners) {
      listeners.delete(callback);
      if (listeners.size === 0) {
        priceChangeListeners.delete(equipmentId);
      }
    }
  };
}

/**
 * Broadcast price update (called after manual price update)
 * @param {string} equipmentId - Equipment ID
 * @param {number} newPrice - New price
 */
export function broadcastPriceUpdate(equipmentId, newPrice) {
  console.log('[Price Sync Manager] Manual broadcast triggered:', {
    equipmentId,
    newPrice
  });

  // This will be handled automatically by Supabase real-time subscription
  // Just log for debugging purposes
  console.log('[Price Sync Manager] Real-time subscription will handle broadcast automatically');
}

/**
 * Subscribe to connection status changes
 * @param {function} callback - Callback function
 * @returns {function} Unsubscribe function
 */
export function onConnectionStatusChange(callback) {
  statusChangeListeners.add(callback);

  // Immediately call with current status
  callback(connectionStatus);

  // Return unsubscribe function
  return () => {
    statusChangeListeners.delete(callback);
  };
}

/**
 * Notify all status listeners
 * @param {string} status - New status
 */
function notifyStatusChange(status) {
  statusChangeListeners.forEach(listener => {
    try {
      listener(status);
    } catch (error) {
      console.error('[Price Sync Manager] Status listener error:', error);
    }
  });
}

/**
 * Get current connection status
 * @returns {string} Connection status
 */
export function getConnectionStatus() {
  return connectionStatus;
}

/**
 * Get active subscription count
 * @returns {number} Number of active subscriptions
 */
export function getActiveSubscriptionCount() {
  return priceChangeListeners.size;
}

/**
 * Get active subscriptions (alias for getActiveSubscriptionCount)
 * @returns {number} Number of active subscriptions
 */
export function getActiveSubscriptions() {
  return getActiveSubscriptionCount();
}

/**
 * Get price update history
 * @returns {Array} Recent price updates
 */
export function getPriceUpdateHistory() {
  return [...priceUpdateHistory];
}

/**
 * Cleanup all subscriptions
 */
export async function cleanup() {
  console.log('[Price Sync Manager] Cleaning up...');

  if (realtimeSubscription) {
    await supabase.removeChannel(realtimeSubscription);
    realtimeSubscription = null;
  }

  priceChangeListeners.clear();
  statusChangeListeners.clear();
  connectionStatus = 'disconnected';

  console.log('[Price Sync Manager] ✓ Cleanup complete');
}

// ============================
// Browser Console Tools
// ============================

/**
 * Run full integration test
 * @returns {Promise<object>} Test results
 */
async function runFullIntegrationTest() {
  console.group('🧪 [Full Integration Test] Starting comprehensive test suite...');
  console.log('Timestamp:', new Date().toISOString());

  const results = {
    timestamp: new Date().toISOString(),
    overall_status: 'unknown',
    tests: {
      equipment_data: null,
      pricing_data: null,
      price_lookups: null,
      price_update_flow: null,
      realtime_sync: null
    },
    total_tests: 0,
    passed_tests: 0,
    failed_tests: 0,
    errors: []
  };

  try {
    // Test 1: Verify Equipment Data
    console.log('\n[Test 1/5] Verifying equipment data...');
    results.tests.equipment_data = await verifyEquipmentTableData();
    results.total_tests++;
    if (results.tests.equipment_data.passed) {
      results.passed_tests++;
      console.log('✅ Test 1 PASSED');
    } else {
      results.failed_tests++;
      console.error('❌ Test 1 FAILED');
    }

    // Test 2: Verify Pricing Data
    console.log('\n[Test 2/5] Verifying pricing data...');
    results.tests.pricing_data = await verifyEquipmentPricingTableData();
    results.total_tests++;
    if (results.tests.pricing_data.passed) {
      results.passed_tests++;
      console.log('✅ Test 2 PASSED');
    } else {
      results.failed_tests++;
      console.error('❌ Test 2 FAILED');
    }

    // Test 3: Test Price Lookups
    console.log('\n[Test 3/5] Testing price lookups for all equipment...');
    results.tests.price_lookups = await testPriceLookupForAllEquipment();
    results.total_tests++;
    if (results.tests.price_lookups.failed === 0) {
      results.passed_tests++;
      console.log('✅ Test 3 PASSED');
    } else {
      results.failed_tests++;
      console.error('❌ Test 3 FAILED');
    }

    // Test 4: Test Price Update Flow
    console.log('\n[Test 4/5] Testing price update flow...');
    results.tests.price_update_flow = await testPriceUpdateFlow();
    results.total_tests++;
    if (results.tests.price_update_flow.passed) {
      results.passed_tests++;
      console.log('✅ Test 4 PASSED');
    } else {
      results.failed_tests++;
      console.error('❌ Test 4 FAILED');
    }

    // Test 5: Test Real-time Sync
    console.log('\n[Test 5/5] Testing real-time sync...');
    const syncTest = {
      status: connectionStatus,
      active_subscriptions: getActiveSubscriptionCount(),
      subscription_exists: !!realtimeSubscription,
      passed: connectionStatus === 'connected' && !!realtimeSubscription
    };
    results.tests.realtime_sync = syncTest;
    results.total_tests++;
    if (syncTest.passed) {
      results.passed_tests++;
      console.log('✅ Test 5 PASSED - Real-time sync active');
    } else {
      results.failed_tests++;
      console.error('❌ Test 5 FAILED - Real-time sync not connected');
    }

    // Determine overall status
    results.overall_status = results.failed_tests === 0 ? 'PASSED' : 'FAILED';

    console.log('\n' + '='.repeat(60));
    console.log('📊 INTEGRATION TEST RESULTS');
    console.log('='.repeat(60));
    console.log(`Overall Status: ${results.overall_status === 'PASSED' ? '✅ PASSED' : '❌ FAILED'}`);
    console.log(`Tests Run: ${results.total_tests}`);
    console.log(`Passed: ${results.passed_tests}`);
    console.log(`Failed: ${results.failed_tests}`);
    console.log(`Success Rate: ${((results.passed_tests / results.total_tests) * 100).toFixed(1)}%`);
    console.log('='.repeat(60));

    if (results.failed_tests > 0) {
      console.warn('\n⚠️ Some tests failed. Check individual test results for details.');
    }

  } catch (error) {
    console.error('❌ Integration test suite error:', error);
    results.errors.push(error.message);
    results.overall_status = 'ERROR';
  }

  console.groupEnd();
  return results;
}

/**
 * Export equipment and pricing data as JSON
 * @returns {Promise<void>}
 */
async function exportData() {
  console.log('[Export Data] Fetching equipment and pricing data...');

  const [equipmentResult, pricingResult] = await Promise.all([
    supabase.from('equipment').select('*').order('name'),
    supabase.from('equipment_pricing').select('*').order('equipment_id')
  ]);

  const data = {
    timestamp: new Date().toISOString(),
    equipment: equipmentResult.data || [],
    pricing: pricingResult.data || [],
    equipment_count: equipmentResult.data?.length || 0,
    pricing_count: pricingResult.data?.length || 0
  };

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `equipment-data-export-${new Date().toISOString()}.json`;
  a.click();
  URL.revokeObjectURL(url);

  console.log('[Export Data] ✓ Data exported successfully');
  console.log('Equipment count:', data.equipment_count);
  console.log('Pricing count:', data.pricing_count);

  return data;
}

/**
 * Get list of all equipment
 * @returns {Promise<Array>} Equipment list
 */
async function getEquipmentList() {
  console.log('[Get Equipment List] Fetching all equipment...');

  const { data, error } = await supabase
    .from('equipment')
    .select('id, name, type, price')
    .order('name');

  if (error) {
    console.error('❌ Error fetching equipment:', error);
    return [];
  }

  console.log(`✓ Loaded ${data.length} equipment items`);
  console.table(data);

  return data;
}

/**
 * Get list of all pricing records
 * @returns {Promise<Array>} Pricing list
 */
async function getPricingList() {
  console.log('[Get Pricing List] Fetching all pricing records...');

  const { data, error } = await supabase
    .from('equipment_pricing')
    .select('*')
    .order('equipment_id');

  if (error) {
    console.error('❌ Error fetching pricing:', error);
    return [];
  }

  console.log(`✓ Loaded ${data.length} pricing records`);
  console.table(data);

  return data;
}

/**
 * Test price lookup for specific equipment
 * @param {string} equipmentId - Equipment ID
 * @returns {Promise<number>} Price
 */
async function testPriceLookup(equipmentId) {
  console.log('[Test Price Lookup] Equipment ID:', equipmentId);

  const startTime = Date.now();
  const price = await getPriceForEquipment(equipmentId);
  const endTime = Date.now();

  console.log(`✓ Price: $${price.toFixed(2)} (${endTime - startTime}ms)`);

  return price;
}

/**
 * Test price update with real-time sync monitoring
 * @param {string} equipmentId - Equipment ID
 * @param {number} newPrice - New price
 * @returns {Promise<object>} Test results
 */
async function testPriceUpdate(equipmentId, newPrice) {
  console.group('[Test Price Update] Starting...');
  console.log('Equipment ID:', equipmentId);
  console.log('New Price:', newPrice);

  const results = {
    equipmentId,
    newPrice,
    latency: null,
    syncReceived: false,
    error: null
  };

  try {
    // Set up listener for real-time update
    let syncReceived = false;
    const syncStartTime = Date.now();

    const unsubscribe = subscribeToPriceUpdates(equipmentId, (changeData) => {
      if (!syncReceived) {
        syncReceived = true;
        const latency = Date.now() - syncStartTime;
        results.latency = latency;
        results.syncReceived = true;
        console.log(`✓ Real-time sync received in ${latency}ms`);
      }
    });

    // Simulate price update by calling the update function
    // Note: This would normally be done through the admin UI
    console.log('⚠️ This test requires manual price update through admin UI');
    console.log('Please update the price in Equipment Inventory Manager and observe the sync');

    // Clean up
    setTimeout(() => {
      unsubscribe();
    }, 10000);

  } catch (error) {
    console.error('❌ Test failed:', error);
    results.error = error.message;
  }

  console.groupEnd();
  return results;
}

/**
 * Monitor sync events
 */
function monitorSync() {
  console.log('[Monitor Sync] Starting real-time monitoring...');
  console.log('Press Ctrl+C to stop monitoring');

  const unsubscribe = window.addEventListener('equipment-price-changed', (event) => {
    console.group('📡 [Price Change Event]');
    console.log('Timestamp:', new Date().toISOString());
    console.log('Equipment:', event.detail.equipmentName);
    console.log('Old Price:', event.detail.oldPrice ? `$${event.detail.oldPrice.toFixed(2)}` : 'N/A');
    console.log('New Price:', event.detail.newPrice ? `$${event.detail.newPrice.toFixed(2)}` : 'N/A');
    console.log('Type:', event.detail.equipmentType);
    console.groupEnd();
  });

  return () => {
    window.removeEventListener('equipment-price-changed', unsubscribe);
    console.log('[Monitor Sync] Monitoring stopped');
  };
}

/**
 * Verify all equipment data
 * @returns {Promise<object>} Verification results
 */
async function verifyEquipmentData() {
  console.group('[Verify Equipment Data] Running full verification...');

  const [equipmentData, pricingData] = await Promise.all([
    verifyEquipmentTableData(),
    verifyEquipmentPricingTableData()
  ]);

  const results = {
    timestamp: new Date().toISOString(),
    equipment: equipmentData,
    pricing: pricingData,
    overall_valid: equipmentData.passed && pricingData.passed
  };

  console.log('Overall Status:', results.overall_valid ? '✅ VALID' : '❌ ISSUES FOUND');
  console.groupEnd();

  return results;
}

// Make tools available in browser console
if (typeof window !== 'undefined') {
  window.equipmentPricingTools = {
    verifyEquipmentData,
    testPriceLookup,
    testPriceUpdate,
    monitorSync,
    getEquipmentList,
    getPricingList,
    exportData,
    runFullIntegrationTest,
    // Utility methods
    getConnectionStatus,
    getActiveSubscriptionCount,
    getActiveSubscriptions,
    getPriceUpdateHistory,
    initialize,
    cleanup
  };

  console.log('💡 Equipment Pricing Tools available at: window.equipmentPricingTools');
  console.log('📚 Available methods:');
  console.log('  • verifyEquipmentData() - Run full data verification');
  console.log('  • testPriceLookup(equipmentId) - Test price lookup');
  console.log('  • testPriceUpdate(equipmentId, newPrice) - Test price update');
  console.log('  • monitorSync() - Monitor real-time sync events');
  console.log('  • getEquipmentList() - Get all equipment');
  console.log('  • getPricingList() - Get all pricing records');
  console.log('  • exportData() - Export data as JSON');
  console.log('  • runFullIntegrationTest() - Run complete test suite');
  console.log('  • getPriceUpdateHistory() - Get recent price updates');
}

export default {
  initialize,
  cleanup,
  subscribeToPriceUpdates,
  subscribeToEquipmentPriceChanges,
  broadcastPriceUpdate,
  onConnectionStatusChange,
  getConnectionStatus,
  getActiveSubscriptionCount,
  getActiveSubscriptions,
  getPriceUpdateHistory,
  runFullIntegrationTest
};