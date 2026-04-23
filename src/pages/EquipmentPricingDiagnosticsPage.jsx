
import React, { useState, useEffect } from 'react';
import { ArrowLeft, RefreshCw, Download, Copy, Search, CheckCircle, XCircle, AlertTriangle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useNavigate } from 'react-router-dom';
import { diagnoseEquipmentPricing, verifyEquipmentPricingIntegrity, testPriceLookup, exportDiagnosticReport } from '@/utils/equipmentPricingDiagnostics';
import { toast } from '@/components/ui/use-toast';

export function EquipmentPricingDiagnosticsPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [diagnosticData, setDiagnosticData] = useState(null);
  const [integrityData, setIntegrityData] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [testEquipmentId, setTestEquipmentId] = useState('');
  const [testResult, setTestResult] = useState(null);

  const runDiagnostics = async () => {
    setLoading(true);
    try {
      const [diagnostic, integrity] = await Promise.all([
        diagnoseEquipmentPricing(),
        verifyEquipmentPricingIntegrity()
      ]);

      setDiagnosticData(diagnostic);
      setIntegrityData(integrity);

      toast({
        title: 'Diagnostics Complete',
        description: `Scanned ${diagnostic.equipment.total} equipment and ${diagnostic.pricing.total} pricing records`
      });
    } catch (error) {
      console.error('Diagnostics failed:', error);
      toast({
        title: 'Diagnostics Failed',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const handleExport = () => {
    if (!diagnosticData) return;

    const report = exportDiagnosticReport(diagnosticData);
    const blob = new Blob([report], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `equipment-pricing-diagnostics-${new Date().toISOString()}.json`;
    a.click();
    URL.revokeObjectURL(url);

    toast({
      title: 'Report Exported',
      description: 'Diagnostic report downloaded successfully'
    });
  };

  const handleCopyReport = () => {
    if (!diagnosticData) return;

    const report = exportDiagnosticReport(diagnosticData);
    navigator.clipboard.writeText(report);

    toast({
      title: 'Copied to Clipboard',
      description: 'Diagnostic report copied successfully'
    });
  };

  const handleTestPrice = async () => {
    if (!testEquipmentId) return;

    setLoading(true);
    try {
      const result = await testPriceLookup(testEquipmentId);
      setTestResult(result);

      toast({
        title: result.price !== null ? 'Test Passed' : 'Test Failed',
        description: result.price !== null 
          ? `Price: $${result.price}` 
          : result.error || 'Price lookup failed'
      });
    } catch (error) {
      console.error('Price test failed:', error);
      toast({
        title: 'Test Failed',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    runDiagnostics();
  }, []);

  const filteredEquipment = diagnosticData?.equipment.records?.filter(equip =>
    equip.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    equip.id?.includes(searchTerm)
  ) || [];

  return (
    <div className="min-h-screen bg-gray-900 text-white p-8">
      <div className="container mx-auto max-w-6xl">
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
              <h1 className="text-3xl font-bold text-yellow-400">Equipment Pricing Diagnostics</h1>
              <p className="text-gray-400 text-sm">System health and integrity check</p>
            </div>
          </div>

          <div className="flex gap-2">
            <Button
              onClick={runDiagnostics}
              disabled={loading}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
              Refresh
            </Button>
            <Button
              onClick={handleExport}
              disabled={!diagnosticData}
              variant="outline"
              className="border-gray-700 text-white hover:bg-gray-800"
            >
              <Download className="h-4 w-4 mr-2" />
              Export
            </Button>
            <Button
              onClick={handleCopyReport}
              disabled={!diagnosticData}
              variant="outline"
              className="border-gray-700 text-white hover:bg-gray-800"
            >
              <Copy className="h-4 w-4 mr-2" />
              Copy
            </Button>
          </div>
        </div>

        {/* Status Summary */}
        {diagnosticData && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
            <Card className="bg-gray-800 border-gray-700">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-gray-400 text-sm">Equipment</p>
                    <p className="text-2xl font-bold text-white">{diagnosticData.equipment.total}</p>
                  </div>
                  <CheckCircle className="h-8 w-8 text-green-400" />
                </div>
              </CardContent>
            </Card>

            <Card className="bg-gray-800 border-gray-700">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-gray-400 text-sm">Pricing Records</p>
                    <p className="text-2xl font-bold text-white">{diagnosticData.pricing.total}</p>
                  </div>
                  {diagnosticData.pricing.total === diagnosticData.equipment.total ? (
                    <CheckCircle className="h-8 w-8 text-green-400" />
                  ) : (
                    <AlertTriangle className="h-8 w-8 text-yellow-400" />
                  )}
                </div>
              </CardContent>
            </Card>

            <Card className="bg-gray-800 border-gray-700">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-gray-400 text-sm">Issues Found</p>
                    <p className="text-2xl font-bold text-white">{diagnosticData.issues.length}</p>
                  </div>
                  {diagnosticData.issues.length === 0 ? (
                    <CheckCircle className="h-8 w-8 text-green-400" />
                  ) : (
                    <XCircle className="h-8 w-8 text-red-400" />
                  )}
                </div>
              </CardContent>
            </Card>

            <Card className="bg-gray-800 border-gray-700">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-gray-400 text-sm">Test Results</p>
                    <p className="text-2xl font-bold text-white">
                      {diagnosticData.testResults.passed}/{diagnosticData.testResults.tested.length}
                    </p>
                  </div>
                  {diagnosticData.testResults.failed === 0 ? (
                    <CheckCircle className="h-8 w-8 text-green-400" />
                  ) : (
                    <AlertTriangle className="h-8 w-8 text-yellow-400" />
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Main Content */}
        <Tabs defaultValue="equipment" className="w-full">
          <TabsList className="grid w-full grid-cols-5 bg-gray-800">
            <TabsTrigger value="equipment">Equipment</TabsTrigger>
            <TabsTrigger value="pricing">Pricing</TabsTrigger>
            <TabsTrigger value="issues">Issues</TabsTrigger>
            <TabsTrigger value="tests">Tests</TabsTrigger>
            <TabsTrigger value="integrity">Integrity</TabsTrigger>
          </TabsList>

          {/* Equipment Tab */}
          <TabsContent value="equipment">
            <Card className="bg-gray-800 border-gray-700">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-white">Equipment Records</CardTitle>
                  <div className="flex items-center gap-2">
                    <Search className="h-4 w-4 text-gray-400" />
                    <Input
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      placeholder="Search equipment..."
                      className="w-64 bg-gray-900 border-gray-700 text-white"
                    />
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {filteredEquipment.map(equip => {
                    const hasPricing = diagnosticData.pricing.records?.some(p => p.equipment_id === equip.id);
                    return (
                      <div
                        key={equip.id}
                        className={`p-3 rounded border ${
                          hasPricing 
                            ? 'bg-green-900/20 border-green-500/30' 
                            : 'bg-red-900/20 border-red-500/30'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            {hasPricing ? (
                              <CheckCircle className="h-5 w-5 text-green-400" />
                            ) : (
                              <XCircle className="h-5 w-5 text-red-400" />
                            )}
                            <div>
                              <p className="font-medium text-white">{equip.name}</p>
                              <p className="text-xs text-gray-400">{equip.id.substring(0, 8)}...</p>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="text-sm text-gray-400">{equip.type}</p>
                            <p className="text-sm font-medium text-white">
                              ${Number(equip.price || 0).toFixed(2)}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Pricing Tab */}
          <TabsContent value="pricing">
            <Card className="bg-gray-800 border-gray-700">
              <CardHeader>
                <CardTitle className="text-white">Pricing Records</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {diagnosticData?.pricing.records?.map(pricing => (
                    <div
                      key={pricing.id}
                      className="p-3 rounded border bg-gray-900/50 border-gray-700"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm text-gray-400">Equipment ID:</p>
                          <p className="text-xs font-mono text-white">
                            {pricing.equipment_id?.substring(0, 16)}...
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm text-gray-400">Price:</p>
                          <p className="text-lg font-bold text-green-400">
                            ${Number(pricing.base_price || 0).toFixed(2)}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm text-gray-400">Type:</p>
                          <p className="text-sm text-white">{pricing.item_type}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Issues Tab */}
          <TabsContent value="issues">
            <Card className="bg-gray-800 border-gray-700">
              <CardHeader>
                <CardTitle className="text-white">
                  Issues Found ({diagnosticData?.issues.length || 0})
                </CardTitle>
              </CardHeader>
              <CardContent>
                {diagnosticData?.issues.length === 0 ? (
                  <div className="text-center py-8">
                    <CheckCircle className="h-16 w-16 text-green-400 mx-auto mb-4" />
                    <p className="text-lg font-medium text-white">No Issues Found!</p>
                    <p className="text-sm text-gray-400">All equipment pricing checks passed</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {diagnosticData?.issues.map((issue, index) => (
                      <div
                        key={index}
                        className="p-4 rounded border bg-red-900/20 border-red-500/30"
                      >
                        <div className="flex items-start gap-3">
                          <XCircle className="h-5 w-5 text-red-400 mt-0.5 flex-shrink-0" />
                          <p className="text-sm text-white">{issue}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Recommendations */}
            {diagnosticData?.recommendations.length > 0 && (
              <Card className="bg-gray-800 border-gray-700 mt-4">
                <CardHeader>
                  <CardTitle className="text-white">Recommended Actions</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {diagnosticData.recommendations.map((rec, index) => (
                      <div
                        key={index}
                        className="p-3 rounded border bg-blue-900/20 border-blue-500/30"
                      >
                        <div className="flex items-start gap-3">
                          <span className="text-blue-400 font-bold">{index + 1}.</span>
                          <p className="text-sm text-white">{rec}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Tests Tab */}
          <TabsContent value="tests">
            <Card className="bg-gray-800 border-gray-700">
              <CardHeader>
                <CardTitle className="text-white">Price Lookup Tests</CardTitle>
              </CardHeader>
              <CardContent>
                {/* Manual Test */}
                <div className="mb-6 p-4 bg-gray-900/50 rounded border border-gray-700">
                  <h3 className="font-medium text-white mb-3">Test Price Lookup</h3>
                  <div className="flex gap-2">
                    <Input
                      value={testEquipmentId}
                      onChange={(e) => setTestEquipmentId(e.target.value)}
                      placeholder="Enter equipment ID..."
                      className="flex-1 bg-gray-900 border-gray-700 text-white"
                    />
                    <Button
                      onClick={handleTestPrice}
                      disabled={loading || !testEquipmentId}
                      className="bg-blue-600 hover:bg-blue-700"
                    >
                      Test
                    </Button>
                  </div>
                  
                  {testResult && (
                    <div className={`mt-3 p-3 rounded border ${
                      testResult.price !== null 
                        ? 'bg-green-900/20 border-green-500/30' 
                        : 'bg-red-900/20 border-red-500/30'
                    }`}>
                      <p className="text-sm text-white">
                        <strong>Result:</strong> {testResult.price !== null 
                          ? `$${testResult.price}` 
                          : testResult.error || 'Failed'}
                      </p>
                    </div>
                  )}
                </div>

                {/* Automated Test Results */}
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {diagnosticData?.testResults.details?.map((result, index) => (
                    <div
                      key={index}
                      className={`p-3 rounded border ${
                        result.price !== null && result.price !== undefined
                          ? 'bg-green-900/20 border-green-500/30'
                          : 'bg-red-900/20 border-red-500/30'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          {result.price !== null && result.price !== undefined ? (
                            <CheckCircle className="h-5 w-5 text-green-400" />
                          ) : (
                            <XCircle className="h-5 w-5 text-red-400" />
                          )}
                          <div>
                            <p className="text-xs font-mono text-gray-400">
                              {result.equipmentId.substring(0, 16)}...
                            </p>
                            {result.error && (
                              <p className="text-xs text-red-400 mt-1">{result.error}</p>
                            )}
                          </div>
                        </div>
                        <p className="text-sm font-medium text-white">
                          {result.price !== null && result.price !== undefined 
                            ? `$${Number(result.price).toFixed(2)}` 
                            : 'Failed'}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Integrity Tab */}
          <TabsContent value="integrity">
            <Card className="bg-gray-800 border-gray-700">
              <CardHeader>
                <CardTitle className="text-white">Data Integrity Check</CardTitle>
              </CardHeader>
              <CardContent>
                {integrityData ? (
                  <div className="space-y-4">
                    <div className={`p-4 rounded border ${
                      integrityData.valid 
                        ? 'bg-green-900/20 border-green-500/30' 
                        : 'bg-red-900/20 border-red-500/30'
                    }`}>
                      <div className="flex items-center gap-3 mb-3">
                        {integrityData.valid ? (
                          <CheckCircle className="h-6 w-6 text-green-400" />
                        ) : (
                          <XCircle className="h-6 w-6 text-red-400" />
                        )}
                        <h3 className="font-bold text-white">
                          {integrityData.valid ? 'Integrity Check Passed' : 'Integrity Issues Detected'}
                        </h3>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-4 mt-4">
                        <div>
                          <p className="text-sm text-gray-400">Total Records</p>
                          <p className="text-lg font-bold text-white">{integrityData.totalPricingRecords}</p>
                        </div>
                        <div>
                          <p className="text-sm text-gray-400">Valid References</p>
                          <p className="text-lg font-bold text-green-400">{integrityData.validReferences}</p>
                        </div>
                        <div>
                          <p className="text-sm text-gray-400">Invalid References</p>
                          <p className="text-lg font-bold text-red-400">{integrityData.invalidReferences.length}</p>
                        </div>
                        <div>
                          <p className="text-sm text-gray-400">Orphaned Records</p>
                          <p className="text-lg font-bold text-yellow-400">{integrityData.orphanedRecords.length}</p>
                        </div>
                      </div>
                    </div>

                    {/* Details */}
                    {integrityData.missingPricing.length > 0 && (
                      <div className="p-4 bg-yellow-900/20 rounded border border-yellow-500/30">
                        <h4 className="font-medium text-yellow-300 mb-2">
                          Equipment Missing Pricing ({integrityData.missingPricing.length})
                        </h4>
                        <div className="space-y-1">
                          {integrityData.missingPricing.slice(0, 5).map((item, i) => (
                            <p key={i} className="text-sm text-white">
                              • {item.equipment_name} ({item.equipment_id.substring(0, 8)}...)
                            </p>
                          ))}
                        </div>
                      </div>
                    )}

                    {integrityData.orphanedRecords.length > 0 && (
                      <div className="p-4 bg-red-900/20 rounded border border-red-500/30">
                        <h4 className="font-medium text-red-300 mb-2">
                          Orphaned Pricing Records ({integrityData.orphanedRecords.length})
                        </h4>
                        <div className="space-y-1">
                          {integrityData.orphanedRecords.slice(0, 5).map((item, i) => (
                            <p key={i} className="text-sm text-white">
                              • {item.equipment_id.substring(0, 16)}... (${ Number(item.base_price).toFixed(2)})
                            </p>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <Loader2 className="h-8 w-8 animate-spin text-gray-400 mx-auto mb-4" />
                    <p className="text-gray-400">Loading integrity data...</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

export default EquipmentPricingDiagnosticsPage;
