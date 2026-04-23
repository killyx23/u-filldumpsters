
import React from 'react';
import { PriceBreakdown } from '@/components/pricing/PriceBreakdown';

/**
 * Charges Breakdown Component
 * Wrapper around PriceBreakdown for displaying charges
 * Used in admin dashboard and customer portal
 */
export const ChargesBreakdown = ({ 
  booking, 
  showTitle = true,
  className = '' 
}) => {
  if (!booking) {
    return (
      <div className="text-center text-gray-400 py-4">
        No booking data available
      </div>
    );
  }

  const plan = booking.plan;
  const addons = booking.addons || {};
  const basePrice = booking.total_price || 0;

  return (
    <div className={className}>
      {showTitle && (
        <h3 className="text-xl font-bold text-white mb-4">Charges Breakdown</h3>
      )}
      
      <PriceBreakdown 
        booking={booking}
        plan={plan}
        addons={addons}
        basePrice={basePrice}
      />
    </div>
  );
};
