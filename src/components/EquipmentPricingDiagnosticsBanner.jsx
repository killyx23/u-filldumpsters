
import React, { useState } from 'react';
import { AlertTriangle, X, Eye, RefreshCw, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useNavigate } from 'react-router-dom';

/**
 * Equipment Pricing Diagnostics Warning Banner
 * Displays at top of page if equipment pricing issues are detected
 * Only shows in development mode
 */
export function EquipmentPricingDiagnosticsBanner({ issues, recommendations, onDismiss, onRefresh }) {
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState(false);

  // Only show in development mode
  const isDevelopment = import.meta.env.MODE === 'development' || 
                       import.meta.env.DEV === true ||
                       window.location.hostname === 'localhost';

  if (!isDevelopment || dismissed || !issues || issues.length === 0) {
    return null;
  }

  const handleDismiss = () => {
    setDismissed(true);
    if (onDismiss) {
      onDismiss();
    }
  };

  const handleViewReport = () => {
    navigate('/admin/equipment-diagnostics');
  };

  return (
    <div className="fixed top-0 left-0 right-0 z-50 p-4">
      <Card className="bg-orange-900/20 border-2 border-orange-500/50 backdrop-blur-lg shadow-2xl">
        <div className="p-4">
          <div className="flex items-start gap-4">
            {/* Warning Icon */}
            <div className="flex-shrink-0">
              <AlertTriangle className="h-8 w-8 text-orange-400 animate-pulse" />
            </div>

            {/* Content */}
            <div className="flex-1 space-y-3">
              <div>
                <h3 className="text-lg font-bold text-orange-300 mb-1">
                  Equipment Pricing Issues Detected
                </h3>
                <p className="text-sm text-orange-200">
                  {issues.length} issue{issues.length !== 1 ? 's' : ''} found in equipment pricing system
                </p>
              </div>

              {/* Key Issues */}
              <div className="space-y-1">
                <p className="text-xs font-semibold text-orange-300">Key Issues:</p>
                <ul className="space-y-0.5">
                  {issues.slice(0, 3).map((issue, index) => (
                    <li key={index} className="text-xs text-orange-100 flex items-start gap-2">
                      <span className="text-orange-400 mt-0.5">•</span>
                      <span>{issue}</span>
                    </li>
                  ))}
                  {issues.length > 3 && (
                    <li className="text-xs text-orange-300 italic ml-3">
                      ... and {issues.length - 3} more
                    </li>
                  )}
                </ul>
              </div>

              {/* Actions */}
              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={handleViewReport}
                  size="sm"
                  className="bg-orange-600 hover:bg-orange-700 text-white"
                >
                  <FileText className="h-4 w-4 mr-2" />
                  View Full Report
                </Button>

                {onRefresh && (
                  <Button
                    onClick={onRefresh}
                    size="sm"
                    variant="outline"
                    className="border-orange-500/30 text-orange-300 hover:bg-orange-900/30"
                  >
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Refresh
                  </Button>
                )}

                <Button
                  onClick={handleDismiss}
                  size="sm"
                  variant="ghost"
                  className="text-orange-300 hover:bg-orange-900/30"
                >
                  Dismiss
                </Button>
              </div>

              {/* Development Mode Notice */}
              <p className="text-xs text-orange-400/70 italic">
                This warning only appears in development mode
              </p>
            </div>

            {/* Close Button */}
            <button
              onClick={handleDismiss}
              className="flex-shrink-0 text-orange-400 hover:text-orange-300 transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
      </Card>
    </div>
  );
}
