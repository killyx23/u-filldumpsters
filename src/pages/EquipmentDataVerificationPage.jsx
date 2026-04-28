import React, { useState } from 'react';
import { ArrowLeft, CheckCircle, XCircle, Loader2, Download, Play, FileJson, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { useNavigate } from 'react-router-dom';
import {
  verifyEquipmentTableData,
  verifyEquipmentPricingTableData,
  testPriceLookupForAllEquipment,
  testPriceUpdateFlow,
  runAllVerificationTests
} from '@/utils/equipmentDataVerification';
import { toast } from '@/components/ui/use-toast';

export function EquipmentDataVerificationPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [equipmentResults, setEquipmentResults] = useState(null);
  const [pricingResults, setPricingResults] = useState(null);
  const [lookupResults, setLookupResults] = useState(null);
  const [updateResults, setUpdateResults] = useState(null);
  const [fullResults, setFullResults] = useState(null);

  const runEquipmentTest = async () => {
    setLoading(true);
    try {
      const results = await verifyEquipmentTableData();
      setEquipmentResults(results);
      
      toast({
        title: results.passed ? 'Equipment Verification Passed' : 'Equipment Verification Failed',
        description: `${results.valid_records.length} valid, ${results.invalid_records.length} invalid`,
        variant: results.passed ? 'default' : 'destructive'
      });
    } catch (error) {
      console.error('Equipment test error:', error);
      toast({
        title: 'Test Failed',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const runPricingTest = async () => {
    setLoading(true);
    try {
      const results = await verifyEquipmentPricingTableData();
      setPricingResults(results);
      
      toast({
        title: results.passed ? 'Pricing Verification Passed' : 'Pricing Verification Failed',
        description: `${results.valid_references.length} valid, ${results.issues.length} issues`,
        variant: results.passed ? 'default' : 'destructive'
      });
    } catch (error) {
      console.error('Pricing test error:', error);
      toast({
        title: 'Test Failed',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const runLookupTest = async () => {
    setLoading(true);
    try {
      const results = await testPriceLookupForAllEquipment();
      setLookupResults(results);
      
      toast({
        title: 'Price Lookup Tests Complete',
        description: `${results.passed} passed, ${results.failed} failed`,
        variant: results.failed === 0 ? 'default' : 'destructive'
      });
    } catch (error) {
      console.error('Lookup test error:', error);
      toast({
        title: 'Test Failed',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const runUpdateTest = async () => {
    setLoading(true);
    try {
      const results = await testPriceUpdateFlow();
      setUpdateResults(results);
      
      toast({
        title: results.passed ? 'Update Flow Test Passed' : 'Update Flow Test Failed',
        description: results.passed ? 'All update steps verified' : 'Some steps failed',
        variant: results.passed ? 'default' : 'destructive'
      });
    } catch (error) {
      console.error('Update test error:', error);
      toast({
        title: 'Test Failed',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const runFullVerification = async () => {
    setLoading(true);
    try {
      const results = await runAllVerificationTests();
      setFullResults(results);
      setEquipmentResults(results.equipment_table);
      setPricingResults(results.pricing_table);
      setLookupResults(results.price_lookups);
      setUpdateResults(results.price_update_flow);
      
      toast({
        title: results.overall_passed ? 'All Tests Passed' : 'Some Tests Failed',
        description: results.overall_passed ? 'System integrity verified' : 'Check results for details',
        variant: results.overall_passed ? 'default' : 'destructive'
      });
    } catch (error) {
      console.error('Full verification error:', error);
      toast({
        title: 'Verification Failed',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const exportResults = () => {
    const data = {
      equipment: equipmentResults,
      pricing: pricingResults,
      lookups: lookupResults,
      update: updateResults,
      full: fullResults,
      exported_at: new Date().toISOString()
    };
    
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `equipment-verification-${new Date().toISOString()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    
    toast({
      title: 'Results Exported',
      description: 'Verification report downloaded successfully'
    });
  };

  const getOverallStatus = () => {
    const allPassed = 
      equipmentResults?.passed &&
      pricingResults?.passed &&
      (lookupResults?.failed === 0 || lookupResults === null) &&
      (updateResults?.passed || updateResults === null);
    
    const hasResults = equipmentResults || pricingResults || lookupResults || updateResults;
    
    if (!hasResults) return { text: 'No tests run', color: 'bg-gray-600' };
    if (allPassed) return { text: 'All Tests Passed', color: 'bg-green-600' };
    return { text: 'Issues Detected', color: 'bg-red-600' };
  };

  const status = getOverallStatus();

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
              <h1 className="text-3xl font-bold text-yellow-400">Equipment Data Verification</h1>
              <p className="text-gray-400 text-sm">Comprehensive system integrity testing</p>
            </div>
          </div>

          <div className="flex gap-2">
            <Button
              onClick={runFullVerification}
              disabled={loading}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Play className="h-4 w-4 mr-2" />
              )}
              Run All Tests
            </Button>
            <Button
              onClick={exportResults}
              disabled={!equipmentResults && !pricingResults && !lookupResults && !updateResults}
              variant="outline"
              className="border-gray-700 text-white hover:bg-gray-800"
            >
              <Download className="h-4 w-4 mr-2" />
              Export
            </Button>
          </div>
        </div>

        {/* Status Summary */}
        <Card className="bg-gray-800 border-gray-700 mb-6">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className={`h-12 w-12 rounded-full ${status.color} flex items-center justify-center`}>
                  {status.text === 'All Tests Passed' ? (
                    <CheckCircle className="h-6 w-6 text-white" />
                  ) : status.text === 'Issues Detected' ? (
                    <XCircle className="h-6 w-6 text-white" />
                  ) : (
                    <AlertTriangle className="h-6 w-6 text-white" />
                  )}
                </div>
                <div>
                  <h2 className="text-xl font-bold text-white">{status.text}</h2>
                  <p className="text-sm text-gray-400">
                    {equipmentResults && `Equipment: ${equipmentResults.total_records} records | `}
                    {pricingResults && `Pricing: ${pricingResults.total_pricing_records} records | `}
                    {lookupResults && `Lookups: ${lookupResults.passed}/${lookupResults.total_tests} passed`}
                  </p>
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="text-center">
                  <p className="text-sm text-gray-400">Equipment</p>
                  {equipmentResults ? (
                    <Badge className={equipmentResults.passed ? 'bg-green-600' : 'bg-red-600'}>
                      {equipmentResults.passed ? '✓ Pass' : '✗ Fail'}
                    </Badge>
                  ) : (
                    <Badge className="bg-gray-600">Not Run</Badge>
                  )}
                </div>
                <div className="text-center">
                  <p className="text-sm text-gray-400">Pricing</p>
                  {pricingResults ? (
                    <Badge className={pricingResults.passed ? 'bg-green-600' : 'bg-red-600'}>
                      {pricingResults.passed ? '✓ Pass' : '✗ Fail'}
                    </Badge>
                  ) : (
                    <Badge className="bg-gray-600">Not Run</Badge>
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Main Content */}
        <Tabs defaultValue="equipment" className="w-full">
          <TabsList className="grid w-full grid-cols-4 bg-gray-800">
            <TabsTrigger value="equipment">Equipment Data</TabsTrigger>
            <TabsTrigger value="pricing">Pricing Data</TabsTrigger>
            <TabsTrigger value="tests">Test Scenarios</TabsTrigger>
            <TabsTrigger value="results">Verification Results</TabsTrigger>
          </TabsList>

          {/* Equipment Data Tab */}
          <TabsContent value="equipment">
            <Card className="bg-gray-800 border-gray-700">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-white">Equipment Table Data</CardTitle>
                  <Button
                    onClick={runEquipmentTest}
                    disabled={loading}
                    className="bg-green-600 hover:bg-green-700"
                  >
                    {loading ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Play className="h-4 w-4 mr-2" />
                    )}
                    Verify Equipment
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {equipmentResults ? (
                  <div className="space-y-4">
                    <div className="grid grid-cols-3 gap-4">
                      <StatCard
                        label="Total Records"
                        value={equipmentResults.total_records}
                        icon={<FileJson className="h-5 w-5" />}
                      />
                      <StatCard
                        label="Valid"
                        value={equipmentResults.valid_records.length}
                        icon={<CheckCircle className="h-5 w-5 text-green-400" />}
                      />
                      <StatCard
                        label="Invalid"
                        value={equipmentResults.invalid_records.length}
                        icon={<XCircle className="h-5 w-5 text-red-400" />}
                      />
                    </div>

                    {/* Equipment Table */}
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-900">
                          <tr>
                            <th className="p-3 text-left text-gray-400">ID (UUID)</th>
                            <th className="p-3 text-left text-gray-400">Name</th>
                            <th className="p-3 text-left text-gray-400">Type</th>
                            <th className="p-3 text-left text-gray-400">Price</th>
                            <th className="p-3 text-left text-gray-400">Service Assoc.</th>
                            <th className="p-3 text-center text-gray-400">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {equipmentResults.valid_records.map((item, i) => (
                            <tr key={i} className="border-b border-gray-700">
                              <td className="p-3 font-mono text-xs text-gray-400">{item.id.substring(0, 8)}...</td>
                              <td className="p-3 text-white">{item.name}</td>
                              <td className="p-3"><Badge>{item.type}</Badge></td>
                              <td className="p-3 text-green-400">${Number(item.price || 0).toFixed(2)}</td>
                              <td className="p-3 text-gray-400">{item.service_id_association || '-'}</td>
                              <td className="p-3 text-center">
                                <CheckCircle className="h-4 w-4 text-green-400 inline" />
                              </td>
                            </tr>
                          ))}
                          {equipmentResults.invalid_records.map((item, i) => (
                            <tr key={`invalid-${i}`} className="border-b border-gray-700 bg-red-900/20">
                              <td className="p-3 font-mono text-xs text-red-400">{item.id}</td>
                              <td className="p-3 text-white">{item.name}</td>
                              <td className="p-3"><Badge className="bg-red-600">{item.type}</Badge></td>
                              <td className="p-3 text-gray-400">${Number(item.price || 0).toFixed(2)}</td>
                              <td className="p-3 text-gray-400">{item.service_id_association || '-'}</td>
                              <td className="p-3 text-center">
                                <XCircle className="h-4 w-4 text-red-400 inline" />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* Issues */}
                    {equipmentResults.issues.length > 0 && (
                      <div className="bg-red-900/20 border border-red-500/30 rounded-lg p-4">
                        <h3 className="font-bold text-red-300 mb-2">Issues Found</h3>
                        <ul className="space-y-1">
                          {equipmentResults.issues.map((issue, i) => (
                            <li key={i} className="text-sm text-red-200">• {issue}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-gray-400 text-center py-8">
                    Click "Verify Equipment" to run the test
                  </p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Pricing Data Tab */}
          <TabsContent value="pricing">
            <Card className="bg-gray-800 border-gray-700">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-white">Equipment Pricing Table Data</CardTitle>
                  <Button
                    onClick={runPricingTest}
                    disabled={loading}
                    className="bg-green-600 hover:bg-green-700"
                  >
                    {loading ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Play className="h-4 w-4 mr-2" />
                    )}
                    Verify Pricing
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {pricingResults ? (
                  <div className="space-y-4">
                    <div className="grid grid-cols-4 gap-4">
                      <StatCard
                        label="Total Records"
                        value={pricingResults.total_pricing_records}
                        icon={<FileJson className="h-5 w-5" />}
                      />
                      <StatCard
                        label="Valid Refs"
                        value={pricingResults.valid_references.length}
                        icon={<CheckCircle className="h-5 w-5 text-green-400" />}
                      />
                      <StatCard
                        label="Orphaned"
                        value={pricingResults.orphaned_pricing.length}
                        icon={<AlertTriangle className="h-5 w-5 text-yellow-400" />}
                      />
                      <StatCard
                        label="Missing"
                        value={pricingResults.missing_pricing.length}
                        icon={<XCircle className="h-5 w-5 text-red-400" />}
                      />
                    </div>

                    {/* Issues Summary */}
                    {pricingResults.issues.length > 0 && (
                      <div className="bg-red-900/20 border border-red-500/30 rounded-lg p-4">
                        <h3 className="font-bold text-red-300 mb-2">
                          Issues Found ({pricingResults.issues.length})
                        </h3>
                        <ul className="space-y-1">
                          {pricingResults.issues.map((issue, i) => (
                            <li key={i} className="text-sm text-red-200">• {issue}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Missing Pricing Details */}
                    {pricingResults.missing_pricing.length > 0 && (
                      <div className="bg-yellow-900/20 border border-yellow-500/30 rounded-lg p-4">
                        <h3 className="font-bold text-yellow-300 mb-2">
                          Equipment Missing Pricing
                        </h3>
                        <ul className="space-y-1">
                          {pricingResults.missing_pricing.map((item, i) => (
                            <li key={i} className="text-sm text-yellow-200">
                              • {item.equipment_name} ({item.equipment_type})
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-gray-400 text-center py-8">
                    Click "Verify Pricing" to run the test
                  </p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Test Scenarios Tab */}
          <TabsContent value="tests">
            <div className="grid gap-4">
              {/* Price Lookup Test */}
              <Card className="bg-gray-800 border-gray-700">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-white">Price Lookup Test</CardTitle>
                    <Button
                      onClick={runLookupTest}
                      disabled={loading}
                      className="bg-blue-600 hover:bg-blue-700"
                    >
                      {loading ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Play className="h-4 w-4 mr-2" />
                      )}
                      Run Test
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {lookupResults ? (
                    <div className="space-y-4">
                      <div className="grid grid-cols-3 gap-4">
                        <StatCard
                          label="Total Tests"
                          value={lookupResults.total_tests}
                          icon={<FileJson className="h-5 w-5" />}
                        />
                        <StatCard
                          label="Passed"
                          value={lookupResults.passed}
                          icon={<CheckCircle className="h-5 w-5 text-green-400" />}
                        />
                        <StatCard
                          label="Failed"
                          value={lookupResults.failed}
                          icon={<XCircle className="h-5 w-5 text-red-400" />}
                        />
                      </div>

                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead className="bg-gray-900">
                            <tr>
                              <th className="p-3 text-left text-gray-400">Equipment</th>
                              <th className="p-3 text-left text-gray-400">Type</th>
                              <th className="p-3 text-left text-gray-400">Expected</th>
                              <th className="p-3 text-left text-gray-400">Returned</th>
                              <th className="p-3 text-center text-gray-400">Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {lookupResults.test_results?.map((result, i) => (
                              <tr key={i} className={`border-b border-gray-700 ${!result.passed ? 'bg-red-900/20' : ''}`}>
                                <td className="p-3 text-white">{result.equipment_name}</td>
                                <td className="p-3"><Badge>{result.equipment_type}</Badge></td>
                                <td className="p-3 text-gray-400">${Number(result.expected_price || 0).toFixed(2)}</td>
                                <td className="p-3 text-white">
                                  {result.returned_price !== null ? `$${Number(result.returned_price).toFixed(2)}` : 'null'}
                                </td>
                                <td className="p-3 text-center">
                                  {result.passed ? (
                                    <CheckCircle className="h-4 w-4 text-green-400 inline" />
                                  ) : (
                                    <XCircle className="h-4 w-4 text-red-400 inline" />
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : (
                    <p className="text-gray-400 text-center py-8">
                      Click "Run Test" to test price lookups for all equipment
                    </p>
                  )}
                </CardContent>
              </Card>

              {/* Price Update Flow Test */}
              <Card className="bg-gray-800 border-gray-700">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-white">Price Update Flow Test</CardTitle>
                    <Button
                      onClick={runUpdateTest}
                      disabled={loading}
                      className="bg-purple-600 hover:bg-purple-700"
                    >
                      {loading ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Play className="h-4 w-4 mr-2" />
                      )}
                      Run Test
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {updateResults ? (
                    <div className="space-y-4">
                      <div className={`p-4 rounded-lg border ${
                        updateResults.passed 
                          ? 'bg-green-900/20 border-green-500/30' 
                          : 'bg-red-900/20 border-red-500/30'
                      }`}>
                        <div className="flex items-center gap-3 mb-4">
                          {updateResults.passed ? (
                            <CheckCircle className="h-6 w-6 text-green-400" />
                          ) : (
                            <XCircle className="h-6 w-6 text-red-400" />
                          )}
                          <h3 className="font-bold text-white">
                            {updateResults.passed ? 'All Tests Passed' : 'Some Tests Failed'}
                          </h3>
                        </div>

                        <div className="space-y-2">
                          <TestStep
                            label="Equipment Selected"
                            status={updateResults.test_equipment ? 'pass' : 'fail'}
                            details={updateResults.test_equipment?.name}
                          />
                          <TestStep
                            label="Update Saved"
                            status={updateResults.update_saved ? 'pass' : 'fail'}
                            details={`${updateResults.original_price ? `$${updateResults.original_price.toFixed(2)}` : 'N/A'} → $${updateResults.new_price ? updateResults.new_price.toFixed(2) : 'N/A'}`}
                          />
                          <TestStep
                            label="Price History Updated"
                            status={updateResults.price_history_updated ? 'pass' : 'fail'}
                          />
                          <TestStep
                            label="Last Updated Timestamp"
                            status={updateResults.last_updated_verified ? 'pass' : 'fail'}
                          />
                          <TestStep
                            label="Updated By Field"
                            status={updateResults.updated_by_verified ? 'pass' : 'warn'}
                          />
                          <TestStep
                            label="Rollback Successful"
                            status={updateResults.rollback_successful ? 'pass' : 'fail'}
                          />
                        </div>

                        {updateResults.issues?.length > 0 && (
                          <div className="mt-4 bg-black/30 p-3 rounded">
                            <p className="text-sm font-bold text-red-300 mb-2">Issues:</p>
                            <ul className="space-y-1">
                              {updateResults.issues.map((issue, i) => (
                                <li key={i} className="text-xs text-red-200">• {issue}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <p className="text-gray-400 text-center py-8">
                      Click "Run Test" to test the complete price update flow
                    </p>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Verification Results Tab */}
          <TabsContent value="results">
            <Card className="bg-gray-800 border-gray-700">
              <CardHeader>
                <CardTitle className="text-white">Complete Verification Results</CardTitle>
              </CardHeader>
              <CardContent>
                {fullResults ? (
                  <div className="space-y-4">
                    <div className={`p-4 rounded-lg border ${
                      fullResults.overall_passed 
                        ? 'bg-green-900/20 border-green-500/30' 
                        : 'bg-red-900/20 border-red-500/30'
                    }`}>
                      <div className="flex items-center gap-3">
                        {fullResults.overall_passed ? (
                          <CheckCircle className="h-8 w-8 text-green-400" />
                        ) : (
                          <XCircle className="h-8 w-8 text-red-400" />
                        )}
                        <div>
                          <h3 className="font-bold text-xl text-white">
                            {fullResults.overall_passed ? 'All Verifications Passed' : 'Verification Issues Detected'}
                          </h3>
                          <p className="text-sm text-gray-400">
                            Completed at: {new Date(fullResults.timestamp).toLocaleString()}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <ResultCard
                        title="Equipment Table"
                        passed={fullResults.equipment_table?.passed}
                        details={`${fullResults.equipment_table?.valid_records.length} valid / ${fullResults.equipment_table?.total_records} total`}
                      />
                      <ResultCard
                        title="Pricing Table"
                        passed={fullResults.pricing_table?.passed}
                        details={`${fullResults.pricing_table?.valid_references.length} valid refs`}
                      />
                      <ResultCard
                        title="Price Lookups"
                        passed={fullResults.price_lookups?.failed === 0}
                        details={`${fullResults.price_lookups?.passed} / ${fullResults.price_lookups?.total_tests} passed`}
                      />
                      <ResultCard
                        title="Update Flow"
                        passed={fullResults.price_update_flow?.passed}
                        details={fullResults.price_update_flow?.passed ? 'All steps verified' : 'Some steps failed'}
                      />
                    </div>
                  </div>
                ) : (
                  <p className="text-gray-400 text-center py-8">
                    No verification results yet. Run "Run All Tests" to generate a complete report.
                  </p>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

const StatCard = ({ label, value, icon }) => (
  <div className="bg-gray-900 p-4 rounded-lg">
    <div className="flex items-center justify-between mb-2">
      <p className="text-sm text-gray-400">{label}</p>
      {icon}
    </div>
    <p className="text-2xl font-bold text-white">{value}</p>
  </div>
);

const TestStep = ({ label, status, details }) => (
  <div className="flex items-center justify-between p-2 bg-black/30 rounded">
    <span className="text-sm text-white">{label}</span>
    <div className="flex items-center gap-2">
      {details && <span className="text-xs text-gray-400">{details}</span>}
      {status === 'pass' && <CheckCircle className="h-4 w-4 text-green-400" />}
      {status === 'fail' && <XCircle className="h-4 w-4 text-red-400" />}
      {status === 'warn' && <AlertTriangle className="h-4 w-4 text-yellow-400" />}
    </div>
  </div>
);

const ResultCard = ({ title, passed, details }) => (
  <div className={`p-4 rounded-lg border ${
    passed 
      ? 'bg-green-900/20 border-green-500/30' 
      : 'bg-red-900/20 border-red-500/30'
  }`}>
    <div className="flex items-center gap-2 mb-2">
      {passed ? (
        <CheckCircle className="h-5 w-5 text-green-400" />
      ) : (
        <XCircle className="h-5 w-5 text-red-400" />
      )}
      <h4 className="font-bold text-white">{title}</h4>
    </div>
    <p className="text-sm text-gray-400">{details}</p>
  </div>
);

export default EquipmentDataVerificationPage;