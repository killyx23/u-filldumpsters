import React, { useState, useEffect } from 'react';
import { ArrowLeft, RefreshCw, Download, ExternalLink, CheckCircle, XCircle, AlertTriangle, Activity, Database, Zap, Shield, Loader2, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { useNavigate } from 'react-router-dom';
import { runHealthCheck, exportHealthReport } from '@/utils/equipmentPricingHealthCheck';
import { toast } from '@/components/ui/use-toast';
import { format } from 'date-fns';

export function SystemHealthCheckPage() {
  const navigate = useNavigate();
  const [healthData, setHealthData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [secondsSinceUpdate, setSecondsSinceUpdate] = useState(0);

  const performHealthCheck = async (showLoading = true) => {
    if (showLoading) setLoading(true);
    
    try {
      const results = await runHealthCheck();
      setHealthData(results);
      setLastUpdate(new Date());
      setSecondsSinceUpdate(0);
      
      if (results.overall_status === 'critical') {
        toast({
          title: 'Critical Issues Detected',
          description: `${results.summary.failed} health checks failed`,
          variant: 'destructive'
        });
      }
    } catch (error) {
      console.error('Health check error:', error);
      toast({
        title: 'Health Check Failed',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  // Initial health check
  useEffect(() => {
    performHealthCheck();
  }, []);

  // Auto-refresh every 30 seconds
  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      performHealthCheck(false);
    }, 30000);

    return () => clearInterval(interval);
  }, [autoRefresh]);

  // Update "seconds since update" counter
  useEffect(() => {
    if (!lastUpdate) return;

    const interval = setInterval(() => {
      const seconds = Math.floor((new Date() - lastUpdate) / 1000);
      setSecondsSinceUpdate(seconds);
    }, 1000);

    return () => clearInterval(interval);
  }, [lastUpdate]);

  const handleExportReport = async () => {
    try {
      await exportHealthReport();
      toast({
        title: 'Report Exported',
        description: 'Health report downloaded successfully'
      });
    } catch (error) {
      toast({
        title: 'Export Failed',
        description: error.message,
        variant: 'destructive'
      });
    }
  };

  const getStatusBadge = (status) => {
    const configs = {
      healthy: { color: 'bg-green-600', icon: CheckCircle, label: 'HEALTHY' },
      warning: { color: 'bg-yellow-600', icon: AlertTriangle, label: 'WARNING' },
      critical: { color: 'bg-red-600', icon: XCircle, label: 'CRITICAL' }
    };

    const config = configs[status] || configs.critical;
    const Icon = config.icon;

    return (
      <Badge className={`${config.color} text-white px-3 py-1`}>
        <Icon className="h-4 w-4 mr-1" />
        {config.label}
      </Badge>
    );
  };

  const getCheckIcon = (passed) => {
    return passed ? (
      <CheckCircle className="h-5 w-5 text-green-400" />
    ) : (
      <XCircle className="h-5 w-5 text-red-400" />
    );
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 text-white p-8 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-16 w-16 animate-spin text-yellow-400 mx-auto mb-4" />
          <p className="text-gray-400">Running system health check...</p>
        </div>
      </div>
    );
  }

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
              <h1 className="text-3xl font-bold text-yellow-400">System Health Check</h1>
              <p className="text-gray-400 text-sm">Equipment pricing system diagnostics</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-400">Auto-refresh</span>
              <Switch
                checked={autoRefresh}
                onCheckedChange={setAutoRefresh}
              />
            </div>
            <Button
              onClick={() => performHealthCheck()}
              variant="outline"
              className="border-gray-700 text-white hover:bg-gray-800"
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh Now
            </Button>
          </div>
        </div>

        {/* Overall Status Card */}
        <Card className="bg-gray-800 border-gray-700 mb-6">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-bold text-white mb-2">
                  Overall System Health
                </h2>
                {healthData && (
                  <div className="flex items-center gap-4">
                    {getStatusBadge(healthData.overall_status)}
                    <span className="text-sm text-gray-400">
                      Last updated: {lastUpdate ? `${secondsSinceUpdate}s ago` : 'Never'}
                    </span>
                  </div>
                )}
              </div>

              {healthData && (
                <div className="grid grid-cols-3 gap-8 text-center">
                  <div>
                    <p className="text-sm text-gray-400">Passed</p>
                    <p className="text-3xl font-bold text-green-400">{healthData.summary.passed}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-400">Warnings</p>
                    <p className="text-3xl font-bold text-yellow-400">{healthData.summary.warnings}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-400">Failed</p>
                    <p className="text-3xl font-bold text-red-400">{healthData.summary.failed}</p>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Health Status Cards Grid */}
        {healthData && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-6">
            {/* Equipment Data Status */}
            <Card className="bg-gray-800 border-gray-700">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-white flex items-center">
                    <Database className="h-5 w-5 mr-2 text-blue-400" />
                    Equipment Data
                  </CardTitle>
                  {getCheckIcon(healthData.checks.equipment_data.passed)}
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-gray-400">Records</span>
                    <span className="text-white font-semibold">
                      {healthData.checks.equipment_data.count}/7
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Valid UUIDs</span>
                    <span className="text-white font-semibold">
                      {healthData.checks.equipment_data.valid_uuids}/7
                    </span>
                  </div>
                  {healthData.checks.equipment_data.issues.length > 0 && (
                    <div className="mt-3 p-2 bg-red-900/20 border border-red-500/30 rounded">
                      {healthData.checks.equipment_data.issues.map((issue, i) => (
                        <p key={i} className="text-xs text-red-300">• {issue}</p>
                      ))}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Pricing Data Status */}
            <Card className="bg-gray-800 border-gray-700">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-white flex items-center">
                    <Shield className="h-5 w-5 mr-2 text-green-400" />
                    Pricing Data
                  </CardTitle>
                  {getCheckIcon(healthData.checks.pricing_data.passed)}
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-gray-400">Records</span>
                    <span className="text-white font-semibold">
                      {healthData.checks.pricing_data.count}/7
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Orphaned</span>
                    <span className={`font-semibold ${healthData.checks.pricing_data.orphaned_count > 0 ? 'text-red-400' : 'text-green-400'}`}>
                      {healthData.checks.pricing_data.orphaned_count}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Missing</span>
                    <span className={`font-semibold ${healthData.checks.pricing_data.missing_count > 0 ? 'text-red-400' : 'text-green-400'}`}>
                      {healthData.checks.pricing_data.missing_count}
                    </span>
                  </div>
                  {healthData.checks.pricing_data.issues.length > 0 && (
                    <div className="mt-3 p-2 bg-red-900/20 border border-red-500/30 rounded">
                      {healthData.checks.pricing_data.issues.map((issue, i) => (
                        <p key={i} className="text-xs text-red-300">• {issue}</p>
                      ))}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Equipment ID Validation */}
            <Card className="bg-gray-800 border-gray-700">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-white flex items-center">
                    <Shield className="h-5 w-5 mr-2 text-purple-400" />
                    ID Validation
                  </CardTitle>
                  {getCheckIcon(healthData.checks.equipment_ids.passed)}
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-gray-400">Hardcoded IDs</span>
                    <span className={`font-semibold ${healthData.checks.equipment_ids.hardcoded_count > 0 ? 'text-red-400' : 'text-green-400'}`}>
                      {healthData.checks.equipment_ids.hardcoded_count}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Invalid UUIDs</span>
                    <span className={`font-semibold ${healthData.checks.equipment_ids.invalid_count > 0 ? 'text-red-400' : 'text-green-400'}`}>
                      {healthData.checks.equipment_ids.invalid_count}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Numeric IDs</span>
                    <span className={`font-semibold ${healthData.checks.equipment_ids.numeric_count > 0 ? 'text-yellow-400' : 'text-green-400'}`}>
                      {healthData.checks.equipment_ids.numeric_count}
                    </span>
                  </div>
                  {healthData.checks.equipment_ids.issues.length > 0 && (
                    <div className="mt-3 p-2 bg-red-900/20 border border-red-500/30 rounded">
                      {healthData.checks.equipment_ids.issues.map((issue, i) => (
                        <p key={i} className="text-xs text-red-300">• {issue}</p>
                      ))}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Price Lookup Tests */}
            <Card className="bg-gray-800 border-gray-700">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-white flex items-center">
                    <Play className="h-5 w-5 mr-2 text-indigo-400" />
                    Price Lookups
                  </CardTitle>
                  {getCheckIcon(healthData.checks.price_lookups.passed)}
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-gray-400">Tests Run</span>
                    <span className="text-white font-semibold">
                      {healthData.checks.price_lookups.total_tests}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Passed</span>
                    <span className="text-green-400 font-semibold">
                      {healthData.checks.price_lookups.success_count}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Failed</span>
                    <span className={`font-semibold ${healthData.checks.price_lookups.failure_count > 0 ? 'text-red-400' : 'text-green-400'}`}>
                      {healthData.checks.price_lookups.failure_count}
                    </span>
                  </div>
                  {healthData.checks.price_lookups.issues.length > 0 && (
                    <div className="mt-3 p-2 bg-red-900/20 border border-red-500/30 rounded">
                      {healthData.checks.price_lookups.issues.map((issue, i) => (
                        <p key={i} className="text-xs text-red-300">• {issue}</p>
                      ))}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Real-Time Sync Status */}
            <Card className="bg-gray-800 border-gray-700">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-white flex items-center">
                    <Zap className="h-5 w-5 mr-2 text-yellow-400" />
                    Real-Time Sync
                  </CardTitle>
                  {getCheckIcon(healthData.checks.realtime_sync.passed)}
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-gray-400">Status</span>
                    <span className={`font-semibold ${healthData.checks.realtime_sync.connected ? 'text-green-400' : 'text-red-400'}`}>
                      {healthData.checks.realtime_sync.connection_status}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Subscriptions</span>
                    <span className="text-white font-semibold">
                      {healthData.checks.realtime_sync.subscription_count}
                    </span>
                  </div>
                  {healthData.checks.realtime_sync.issues.length > 0 && (
                    <div className="mt-3 p-2 bg-yellow-900/20 border border-yellow-500/30 rounded">
                      {healthData.checks.realtime_sync.issues.map((issue, i) => (
                        <p key={i} className="text-xs text-yellow-300">• {issue}</p>
                      ))}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Database Connection */}
            <Card className="bg-gray-800 border-gray-700">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-white flex items-center">
                    <Activity className="h-5 w-5 mr-2 text-cyan-400" />
                    Database
                  </CardTitle>
                  {getCheckIcon(healthData.checks.database_connection.passed)}
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-gray-400">Status</span>
                    <span className={`font-semibold ${healthData.checks.database_connection.connected ? 'text-green-400' : 'text-red-400'}`}>
                      {healthData.checks.database_connection.connected ? 'Connected' : 'Disconnected'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Latency</span>
                    <span className="text-white font-semibold">
                      {healthData.checks.database_connection.latency}ms
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Tables</span>
                    <span className={`font-semibold ${healthData.checks.database_connection.tables_exist ? 'text-green-400' : 'text-red-400'}`}>
                      {healthData.checks.database_connection.tables_exist ? 'OK' : 'Missing'}
                    </span>
                  </div>
                  {healthData.checks.database_connection.issues && healthData.checks.database_connection.issues.length > 0 && (
                    <div className="mt-3 p-2 bg-yellow-900/20 border border-yellow-500/30 rounded">
                      {healthData.checks.database_connection.issues.map((issue, i) => (
                        <p key={i} className="text-xs text-yellow-300">• {issue}</p>
                      ))}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Equipment Items List */}
        {healthData && healthData.checks.equipment_data.equipment_list && (
          <Card className="bg-gray-800 border-gray-700 mb-6">
            <CardHeader>
              <CardTitle className="text-white">Equipment Items</CardTitle>
              <CardDescription className="text-gray-400">
                All equipment records in the system
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-900">
                    <tr>
                      <th className="p-3 text-left text-gray-400">Status</th>
                      <th className="p-3 text-left text-gray-400">Name</th>
                      <th className="p-3 text-left text-gray-400">Type</th>
                      <th className="p-3 text-left text-gray-400">Equipment ID</th>
                      <th className="p-3 text-right text-gray-400">Price</th>
                    </tr>
                  </thead>
                  <tbody>
                    {healthData.checks.equipment_data.equipment_list.map((item) => {
                      const priceResult = healthData.checks.price_lookups.results.find(r => r.equipment_id === item.id);
                      const hasValidId = healthData.checks.equipment_ids.invalid_ids.findIndex(inv => inv.id === item.id) === -1;

                      return (
                        <tr key={item.id} className="border-b border-gray-700">
                          <td className="p-3">
                            {hasValidId && priceResult?.success ? (
                              <CheckCircle className="h-5 w-5 text-green-400" />
                            ) : (
                              <XCircle className="h-5 w-5 text-red-400" />
                            )}
                          </td>
                          <td className="p-3 text-white font-semibold">{item.name}</td>
                          <td className="p-3 text-gray-400 capitalize">{item.type}</td>
                          <td className="p-3 text-gray-400 font-mono text-xs">{item.id}</td>
                          <td className="p-3 text-right text-white font-semibold">
                            ${priceResult?.price ? Number(priceResult.price).toFixed(2) : '0.00'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Recommendations */}
        {healthData && healthData.recommendations.length > 0 && (
          <Card className="bg-orange-900/20 border-orange-500/30 mb-6">
            <CardHeader>
              <CardTitle className="text-orange-300 flex items-center">
                <AlertTriangle className="h-5 w-5 mr-2" />
                Recommendations
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {healthData.recommendations.map((rec, i) => (
                  <li key={i} className="text-orange-200 flex items-start">
                    <span className="mr-2">•</span>
                    <span>{rec}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {/* Action Buttons */}
        <div className="flex gap-4 justify-center">
          <Button
            onClick={handleExportReport}
            className="bg-blue-600 hover:bg-blue-700"
          >
            <Download className="h-4 w-4 mr-2" />
            Export Report
          </Button>
          <Button
            onClick={() => navigate('/admin/equipment-verification')}
            variant="outline"
            className="border-gray-700 text-white hover:bg-gray-800"
          >
            <ExternalLink className="h-4 w-4 mr-2" />
            Data Verification
          </Button>
          <Button
            onClick={() => navigate('/admin/equipment-sync')}
            variant="outline"
            className="border-gray-700 text-white hover:bg-gray-800"
          >
            <ExternalLink className="h-4 w-4 mr-2" />
            Sync Monitor
          </Button>
        </div>
      </div>
    </div>
  );
}

export default SystemHealthCheckPage;