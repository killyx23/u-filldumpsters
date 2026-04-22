
import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AlertCircle, CheckCircle, Loader2, FileText, Download } from 'lucide-react';
import { generateEquipmentIdHealthReport, exportHealthReport } from '@/utils/equipmentIdMigrationUtility';
import { toast } from '@/components/ui/use-toast';

/**
 * Equipment ID Validation Component
 * Admin tool for diagnosing and validating equipment IDs
 */
export const EquipmentIdValidation = () => {
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState(null);

  const runValidation = async () => {
    setLoading(true);
    try {
      const healthReport = await generateEquipmentIdHealthReport();
      setReport(healthReport);
      
      if (healthReport.overall_health === 'critical') {
        toast({
          title: 'Critical Issues Found',
          description: `${healthReport.summary.critical_issues} critical equipment ID issues detected.`,
          variant: 'destructive'
        });
      } else if (healthReport.overall_health === 'warning') {
        toast({
          title: 'Warnings Detected',
          description: `${healthReport.summary.warnings} equipment ID warnings found.`
        });
      } else {
        toast({
          title: 'Validation Complete',
          description: 'All equipment IDs are valid!'
        });
      }
    } catch (error) {
      console.error('Validation error:', error);
      toast({
        title: 'Validation Failed',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const downloadReport = () => {
    if (!report) return;
    
    const reportJson = exportHealthReport(report);
    const blob = new Blob([reportJson], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `equipment-id-health-report-${new Date().toISOString()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    
    toast({
      title: 'Report Downloaded',
      description: 'Health report has been downloaded successfully.'
    });
  };

  return (
    <Card className="bg-gray-800 border-gray-700">
      <CardHeader>
        <CardTitle className="text-white flex items-center">
          <FileText className="h-5 w-5 mr-2 text-blue-400" />
          Equipment ID Validation
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="text-sm text-gray-300">
          <p className="mb-2">
            This tool validates all equipment IDs in the system to ensure they are valid UUIDs
            and properly referenced in the equipment_pricing table.
          </p>
          <ul className="list-disc list-inside space-y-1 text-xs text-gray-400">
            <li>Checks for invalid UUID formats</li>
            <li>Identifies legacy numeric IDs</li>
            <li>Detects orphaned pricing records</li>
            <li>Finds equipment missing pricing</li>
          </ul>
        </div>

        <div className="flex gap-2">
          <Button
            onClick={runValidation}
            disabled={loading}
            className="bg-blue-600 hover:bg-blue-700"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Running Validation...
              </>
            ) : (
              'Validate Equipment IDs'
            )}
          </Button>

          {report && (
            <Button
              onClick={downloadReport}
              variant="outline"
              className="border-gray-600 text-white hover:bg-gray-700"
            >
              <Download className="h-4 w-4 mr-2" />
              Download Report
            </Button>
          )}
        </div>

        {report && (
          <div className="mt-6 space-y-4">
            {/* Overall Health Status */}
            <div className={`p-4 rounded-lg border ${
              report.overall_health === 'healthy' 
                ? 'bg-green-900/20 border-green-500/30' 
                : report.overall_health === 'warning'
                ? 'bg-yellow-900/20 border-yellow-500/30'
                : 'bg-red-900/20 border-red-500/30'
            }`}>
              <div className="flex items-center gap-2 mb-2">
                {report.overall_health === 'healthy' ? (
                  <CheckCircle className="h-5 w-5 text-green-400" />
                ) : (
                  <AlertCircle className="h-5 w-5 text-yellow-400" />
                )}
                <h3 className="font-bold text-white">
                  Overall Health: {report.overall_health.toUpperCase()}
                </h3>
              </div>
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div>
                  <p className="text-gray-400">Total Issues</p>
                  <p className="text-lg font-bold text-white">{report.summary.total_issues}</p>
                </div>
                <div>
                  <p className="text-gray-400">Critical</p>
                  <p className="text-lg font-bold text-red-400">{report.summary.critical_issues}</p>
                </div>
                <div>
                  <p className="text-gray-400">Warnings</p>
                  <p className="text-lg font-bold text-yellow-400">{report.summary.warnings}</p>
                </div>
              </div>
            </div>

            {/* Database Issues */}
            {report.database && (
              <div className="bg-gray-900/50 p-4 rounded-lg border border-gray-700">
                <h4 className="font-bold text-white mb-3">Database Equipment</h4>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-gray-400">Total Equipment</p>
                    <p className="text-white">{report.database.total_equipment}</p>
                  </div>
                  <div>
                    <p className="text-gray-400">Valid UUIDs</p>
                    <p className="text-green-400">{report.database.valid_ids?.length || 0}</p>
                  </div>
                  <div>
                    <p className="text-gray-400">Numeric IDs</p>
                    <p className="text-yellow-400">{report.database.numeric_ids?.length || 0}</p>
                  </div>
                  <div>
                    <p className="text-gray-400">Invalid IDs</p>
                    <p className="text-red-400">{report.database.invalid_ids?.length || 0}</p>
                  </div>
                </div>

                {report.database.equipment_with_issues?.length > 0 && (
                  <div className="mt-3">
                    <p className="text-xs text-gray-400 mb-2">Equipment with Issues:</p>
                    <div className="space-y-1 max-h-40 overflow-y-auto">
                      {report.database.equipment_with_issues.map((item, i) => (
                        <div key={i} className="text-xs text-gray-300 bg-black/20 p-2 rounded">
                          {item.name} - {item.id}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Pricing Issues */}
            {report.pricing && (
              <div className="bg-gray-900/50 p-4 rounded-lg border border-gray-700">
                <h4 className="font-bold text-white mb-3">Equipment Pricing</h4>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-gray-400">Total Records</p>
                    <p className="text-white">{report.pricing.total_pricing_records}</p>
                  </div>
                  <div>
                    <p className="text-gray-400">Valid References</p>
                    <p className="text-green-400">{report.pricing.valid_references?.length || 0}</p>
                  </div>
                  <div>
                    <p className="text-gray-400">Orphaned Records</p>
                    <p className="text-yellow-400">{report.pricing.orphaned_records?.length || 0}</p>
                  </div>
                  <div>
                    <p className="text-gray-400">Missing Pricing</p>
                    <p className="text-orange-400">{report.pricing.missing_equipment?.length || 0}</p>
                  </div>
                </div>
              </div>
            )}

            {/* Recommendations */}
            {report.summary.recommendations?.length > 0 && (
              <div className="bg-blue-900/20 p-4 rounded-lg border border-blue-500/30">
                <h4 className="font-bold text-blue-300 mb-3">Recommendations</h4>
                <ul className="space-y-2">
                  {report.summary.recommendations.map((rec, i) => (
                    <li key={i} className="text-sm text-blue-200 flex items-start">
                      <span className="text-blue-400 mr-2">{i + 1}.</span>
                      {rec}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
