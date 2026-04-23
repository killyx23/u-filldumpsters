
import React, { useState, useEffect } from 'react';
import { ArrowLeft, Activity, CheckCircle, XCircle, AlertTriangle, Loader2, Play, Download, Trash2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';
import { updateEquipmentPrice, getPriceForEquipment } from '@/utils/equipmentPricingIntegration';
import { 
  subscribeToEquipmentPriceChanges, 
  getActiveSubscriptions,
  getPriceUpdateHistory,
  onConnectionStatusChange,
  getConnectionStatus
} from '@/utils/equipmentPriceSyncManager';
import { format } from 'date-fns';

export function EquipmentPriceSyncPage() {
  const navigate = useNavigate();
  const [syncStatus, setSyncStatus] = useState('disconnected');
  const [equipment, setEquipment] = useState([]);
  const [priceHistory, setPriceHistory] = useState([]);
  const [selectedEquipment, setSelectedEquipment] = useState('');
  const [testPrice, setTestPrice] = useState('');
  const [testingUpdate, setTestingUpdate] = useState(false);
  const [updateLatency, setUpdateLatency] = useState(null);
  const [subscription, setSubscription] = useState(null);
  const [metrics, setMetrics] = useState({
    totalEvents: 0,
    activeSubscriptions: 0,
    averageLatency: 0,
    lastSync: null
  });

  // Load equipment
  useEffect(() => {
    const loadEquipment = async () => {
      console.log('[Equipment Price Sync] Loading equipment...');
      const { data, error } = await supabase
        .from('equipment')
        .select('id, name, type, price')
        .order('name');
      
      if (!error && data) {
        setEquipment(data);
        console.log('[Equipment Price Sync] ✓ Loaded', data.length, 'equipment items');
      } else {
        console.error('[Equipment Price Sync] ❌ Failed to load equipment:', error);
      }
    };
    
    loadEquipment();
  }, []);

  // Monitor connection status
  useEffect(() => {
    const unsubscribe = onConnectionStatusChange((status) => {
      console.log('[Equipment Price Sync] Connection status changed:', status);
      setSyncStatus(status);
    });

    return unsubscribe;
  }, []);

  // Initialize real-time subscription
  useEffect(() => {
    console.log('[Equipment Price Sync] Initializing real-time subscription...');
    
    const sub = subscribeToEquipmentPriceChanges();
    setSubscription(sub);

    // Listen for price change events
    const handlePriceChange = (event) => {
      const { equipmentId, equipmentName, oldPrice, newPrice, timestamp } = event.detail;
      
      console.log('[Price Change Event]', event.detail);
      
      // Add to history
      setPriceHistory(prev => [{
        equipmentId,
        equipmentName,
        oldPrice,
        newPrice,
        timestamp,
        status: 'synced'
      }, ...prev].slice(0, 50)); // Keep last 50 updates
      
      // Update metrics
      setMetrics(prev => ({
        ...prev,
        totalEvents: prev.totalEvents + 1,
        lastSync: timestamp,
        activeSubscriptions: getActiveSubscriptions()
      }));
    };

    window.addEventListener('equipment-price-changed', handlePriceChange);

    // Update active subscriptions count
    setMetrics(prev => ({
      ...prev,
      activeSubscriptions: getActiveSubscriptions()
    }));

    return () => {
      console.log('[Equipment Price Sync] Cleaning up subscription...');
      window.removeEventListener('equipment-price-changed', handlePriceChange);
      if (sub) {
        supabase.removeChannel(sub);
      }
    };
  }, []);

  const handleRefreshSubscription = () => {
    console.log('[Equipment Price Sync] Refreshing subscription...');
    
    if (subscription) {
      supabase.removeChannel(subscription);
    }
    
    const newSub = subscribeToEquipmentPriceChanges();
    setSubscription(newSub);
    
    toast({
      title: 'Subscription Refreshed',
      description: 'Real-time sync reconnected successfully'
    });

    // Update metrics
    setMetrics(prev => ({
      ...prev,
      activeSubscriptions: getActiveSubscriptions()
    }));
  };

  const handleTestPriceUpdate = async () => {
    if (!selectedEquipment || !testPrice) {
      toast({
        title: 'Incomplete Test',
        description: 'Please select equipment and enter a price',
        variant: 'destructive'
      });
      return;
    }

    setTestingUpdate(true);
    const startTime = Date.now();

    const selectedItem = equipment.find(e => e.id === selectedEquipment);
    const oldPrice = await getPriceForEquipment(selectedEquipment);

    const itemType = selectedItem.type === 'consumable' 
      ? 'consumable_item' 
      : selectedItem.type === 'service' 
      ? 'service_item' 
      : 'rental_equipment';

    console.log('[Equipment Price Sync] Testing price update:', {
      equipmentId: selectedEquipment,
      oldPrice,
      newPrice: testPrice,
      itemType
    });

    const result = await updateEquipmentPrice(
      selectedEquipment,
      Number(testPrice),
      itemType,
      'test-admin',
      'Real-time sync test'
    );

    const endTime = Date.now();
    const latency = endTime - startTime;

    if (result.success) {
      setUpdateLatency(latency);
      
      toast({
        title: 'Test Update Successful',
        description: `Update propagated in ${latency}ms`
      });

      // Add test to history
      setPriceHistory(prev => [{
        equipmentId: selectedEquipment,
        equipmentName: selectedItem.name,
        oldPrice,
        newPrice: Number(testPrice),
        timestamp: new Date().toISOString(),
        status: 'synced',
        latency
      }, ...prev]);

      console.log('[Equipment Price Sync] ✓ Test completed successfully');
    } else {
      console.error('[Equipment Price Sync] ❌ Test failed:', result.error);
      toast({
        title: 'Test Update Failed',
        description: result.error,
        variant: 'destructive'
      });
    }

    setTestingUpdate(false);
  };

  const handleClearHistory = () => {
    setPriceHistory([]);
    toast({
      title: 'History Cleared',
      description: 'Price update history has been cleared'
    });
  };

  const handleExportHistory = () => {
    const data = JSON.stringify(priceHistory, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `price-sync-history-${new Date().toISOString()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    
    toast({
      title: 'History Exported',
      description: 'Price sync history downloaded'
    });
  };

  const handleLoadStoredHistory = () => {
    const storedHistory = getPriceUpdateHistory();
    if (storedHistory.length > 0) {
      setPriceHistory(storedHistory);
      toast({
        title: 'History Loaded',
        description: `Loaded ${storedHistory.length} updates from sync manager`
      });
    } else {
      toast({
        title: 'No Stored History',
        description: 'No price updates found in sync manager',
        variant: 'destructive'
      });
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white p-8">
      <div className="container mx-auto max-w-7xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <Button
              onClick={() => navigate('/admin')}
              variant="ghost"
              size="icon"
              className="text-white hover:bg-white/20"
            >
              <ArrowLeft className="h-6 w-6" />
            </Button>
            <div>
              <h1 className="text-3xl font-bold text-yellow-400">Equipment Price Sync Monitor</h1>
              <p className="text-gray-400 text-sm">Real-time price synchronization dashboard</p>
            </div>
          </div>

          <div className="flex gap-2">
            <Button
              onClick={handleLoadStoredHistory}
              variant="outline"
              className="border-gray-700 text-white hover:bg-gray-800"
            >
              <Download className="h-4 w-4 mr-2" />
              Load History
            </Button>
            <Button
              onClick={handleRefreshSubscription}
              variant="outline"
              className="border-gray-700 text-white hover:bg-gray-800"
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh Connection
            </Button>
          </div>
        </div>

        {/* Sync Status */}
        <Card className="bg-gray-800 border-gray-700 mb-6">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className={`h-4 w-4 rounded-full ${
                  syncStatus === 'connected' ? 'bg-green-500' : 
                  syncStatus === 'error' ? 'bg-red-500' : 
                  'bg-yellow-500'
                } animate-pulse`} />
                <div>
                  <h3 className="font-bold text-white text-lg">
                    {syncStatus === 'connected' ? 'Connected & Syncing' : 
                     syncStatus === 'error' ? 'Connection Error' :
                     syncStatus === 'failed' ? 'Connection Failed' :
                     'Disconnected'}
                  </h3>
                  <p className="text-sm text-gray-400">
                    Real-time subscription status
                  </p>
                </div>
              </div>
              
              <div className="grid grid-cols-4 gap-6 text-center">
                <div>
                  <p className="text-sm text-gray-400">Active Subscriptions</p>
                  <p className="text-2xl font-bold text-white">{metrics.activeSubscriptions}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-400">Events Processed</p>
                  <p className="text-2xl font-bold text-green-400">{metrics.totalEvents}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-400">Avg Latency</p>
                  <p className="text-2xl font-bold text-blue-400">
                    {priceHistory.length > 0 
                      ? Math.round(priceHistory.reduce((sum, h) => sum + (h.latency || 0), 0) / priceHistory.filter(h => h.latency).length)
                      : 0}ms
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-400">Last Sync</p>
                  <p className="text-sm font-bold text-white">
                    {metrics.lastSync 
                      ? format(new Date(metrics.lastSync), 'h:mm:ss a')
                      : 'Never'}
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          {/* Test Sync Section */}
          <Card className="bg-gray-800 border-gray-700">
            <CardHeader>
              <CardTitle className="text-white flex items-center">
                <Play className="h-5 w-5 mr-2 text-blue-400" />
                Test Real-Time Sync
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="text-sm text-gray-400 mb-2 block">Select Equipment</label>
                <Select value={selectedEquipment} onValueChange={setSelectedEquipment}>
                  <SelectTrigger className="bg-gray-900 border-gray-700 text-white">
                    <SelectValue placeholder="Choose equipment..." />
                  </SelectTrigger>
                  <SelectContent>
                    {equipment.map(item => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.name} (${Number(item.price || 0).toFixed(2)})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-sm text-gray-400 mb-2 block">New Price</label>
                <Input
                  type="number"
                  step="0.01"
                  value={testPrice}
                  onChange={(e) => setTestPrice(e.target.value)}
                  placeholder="Enter new price..."
                  className="bg-gray-900 border-gray-700 text-white"
                />
              </div>

              <Button
                onClick={handleTestPriceUpdate}
                disabled={testingUpdate || !selectedEquipment || !testPrice}
                className="w-full bg-blue-600 hover:bg-blue-700"
              >
                {testingUpdate ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Testing...
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4 mr-2" />
                    Test Update
                  </>
                )}
              </Button>

              {updateLatency !== null && (
                <div className="bg-green-900/20 border border-green-500/30 rounded-lg p-3">
                  <p className="text-sm text-green-300">
                    ✓ Update propagated successfully in <strong>{updateLatency}ms</strong>
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Subscribed Components */}
          <Card className="bg-gray-800 border-gray-700">
            <CardHeader>
              <CardTitle className="text-white flex items-center">
                <Activity className="h-5 w-5 mr-2 text-green-400" />
                Subscribed Components
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <ComponentStatus name="BookingForm" status="subscribed" />
                <ComponentStatus name="OrderSummary" status="subscribed" />
                <ComponentStatus name="ProtectionSection" status="subscribed" />
                <ComponentStatus name="EquipmentManager" status="subscribed" />
              </div>
              <div className="mt-4 p-3 bg-blue-900/20 border border-blue-500/30 rounded">
                <p className="text-xs text-blue-300">
                  <strong>Active Subscriptions:</strong> {metrics.activeSubscriptions}
                </p>
                <p className="text-xs text-gray-400 mt-1">
                  Components automatically subscribe when equipment is selected
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Price Update History */}
        <Card className="bg-gray-800 border-gray-700">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-white">Price Update History</CardTitle>
              <div className="flex gap-2">
                <Button
                  onClick={handleExportHistory}
                  size="sm"
                  variant="outline"
                  className="border-gray-700 text-white hover:bg-gray-700"
                  disabled={priceHistory.length === 0}
                >
                  <Download className="h-4 w-4 mr-2" />
                  Export
                </Button>
                <Button
                  onClick={handleClearHistory}
                  size="sm"
                  variant="outline"
                  className="border-gray-700 text-white hover:bg-gray-700"
                  disabled={priceHistory.length === 0}
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Clear
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {priceHistory.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-gray-400 mb-4">No price updates recorded yet</p>
                <p className="text-xs text-gray-500">
                  Make a test update or load stored history to see updates
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-900">
                    <tr>
                      <th className="p-3 text-left text-gray-400">Equipment</th>
                      <th className="p-3 text-left text-gray-400">Old Price</th>
                      <th className="p-3 text-left text-gray-400">New Price</th>
                      <th className="p-3 text-left text-gray-400">Updated At</th>
                      <th className="p-3 text-left text-gray-400">Latency</th>
                      <th className="p-3 text-center text-gray-400">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {priceHistory.map((update, i) => (
                      <tr key={i} className="border-b border-gray-700">
                        <td className="p-3 text-white">{update.equipmentName}</td>
                        <td className="p-3 text-gray-400">${Number(update.oldPrice || 0).toFixed(2)}</td>
                        <td className="p-3 text-green-400 font-semibold">${Number(update.newPrice || 0).toFixed(2)}</td>
                        <td className="p-3 text-gray-400">
                          {update.timestamp ? format(new Date(update.timestamp), 'MMM d, h:mm:ss a') : 'N/A'}
                        </td>
                        <td className="p-3 text-blue-400">
                          {update.latency ? `${update.latency}ms` : '-'}
                        </td>
                        <td className="p-3 text-center">
                          <Badge className={update.status === 'synced' ? 'bg-green-600' : 'bg-yellow-600'}>
                            {update.status}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

const ComponentStatus = ({ name, status }) => (
  <div className="flex items-center justify-between bg-gray-900/50 p-3 rounded">
    <span className="text-white">{name}</span>
    <Badge className={status === 'subscribed' ? 'bg-green-600' : 'bg-gray-600'}>
      {status === 'subscribed' ? (
        <>
          <CheckCircle className="h-3 w-3 mr-1" />
          Subscribed
        </>
      ) : (
        <>
          <XCircle className="h-3 w-3 mr-1" />
          Not Subscribed
        </>
      )}
    </Badge>
  </div>
);

export default EquipmentPriceSyncPage;
