import React, { useState } from 'react';
import { Info } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

/**
 * Reusable Price Breakdown Category Component
 * Displays a standardized category section with icon, title, optional info button, items list, and separator
 */
export const PriceBreakdownCategory = ({ 
  icon, 
  title, 
  items = [], 
  showInfoButton = false,
  infoTitle = '',
  infoDescription = '',
  showSeparator = true,
  className = '',
  serviceName = '' // New prop for service-aware text
}) => {
  const [showInfoDialog, setShowInfoDialog] = useState(false);

  if (!items || items.length === 0) return null;

  // Service-specific logic for Protection Options dialog text
  const getProtectionOptionsText = () => {
    // Only apply custom text if this is the Protection Options category
    const isProtectionOptions = title?.toLowerCase().includes('protection') && 
                                title?.toLowerCase().includes('options');
    
    if (!isProtectionOptions || !infoDescription) {
      return infoDescription;
    }

    // Check if service is a dump loader service (but NOT 16 Yard Dumpster Rental)
    const isDumpLoaderService = serviceName && 
                                (serviceName.toLowerCase().includes('dump loader') ||
                                 serviceName.toLowerCase().includes('dump trailer') ||
                                 serviceName.toLowerCase().includes('loader trailer')) &&
                                !serviceName.toLowerCase().includes('16 yard') &&
                                !serviceName.toLowerCase().includes('dumpster');

    // Return service-specific text for dump loader services
    if (isDumpLoaderService) {
      return "Insurance covers damage to the rental equipment while in your possession during loading. This provides peace of mind if the bin, doors, hinges, or equipment are accidentally damaged while you have it. Insurance covers the first $500 of repair costs.";
    }

    // Return original text for all other services
    return infoDescription;
  };

  const displayDescription = getProtectionOptionsText();

  return (
    <>
      <div className={`price-breakdown-category ${className}`}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-xl" role="img" aria-label={title}>{icon}</span>
            <h4 className="text-sm font-semibold text-white uppercase tracking-wide">{title}</h4>
            {showInfoButton && (
              <button
                type="button"
                onClick={() => setShowInfoDialog(true)}
                className="ml-1 text-yellow-400 hover:text-yellow-300 transition-colors p-1 rounded-full hover:bg-yellow-400/10"
                title={`Learn more about ${title}`}
              >
                <Info className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
        
        <div className="space-y-2 ml-7">
          {items.map((item, index) => (
            <div key={index} className="flex justify-between items-start text-sm">
              <div className="flex-1">
                <span className="text-blue-200">{item.label}</span>
                {item.sublabel && (
                  <div className="text-xs text-gray-400 mt-0.5">{item.sublabel}</div>
                )}
              </div>
              <span className={`font-medium ${item.highlight ? 'text-green-400' : 'text-blue-100'}`}>
                {item.amount < 0 ? '-' : ''}${Math.abs(item.amount).toFixed(2)}
              </span>
            </div>
          ))}
        </div>
        
        {showSeparator && <div className="category-separator mt-4" />}
      </div>

      {/* Info Dialog */}
      {showInfoButton && (
        <Dialog open={showInfoDialog} onOpenChange={setShowInfoDialog}>
          <DialogContent className="bg-gray-900 border-yellow-400 text-white max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center text-yellow-400 text-xl">
                {icon && <span className="mr-2 text-2xl">{icon}</span>}
                {infoTitle || title}
              </DialogTitle>
            </DialogHeader>
            <DialogDescription className="text-blue-100 space-y-2">
              {displayDescription}
            </DialogDescription>
            <DialogFooter>
              <Button onClick={() => setShowInfoDialog(false)} className="bg-yellow-500 hover:bg-yellow-600 text-black">
                Got it
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
};