import React from 'react';
import { formatCurrency } from '@/utils/formatCurrency';

const LINES = [
  { key: 'trailerMiles', label: 'Company trailer miles', money: false },
  { key: 'truckOperationalCost', label: 'Truck operational costs', money: true },
  { key: 'trailerOperationalCost', label: 'Trailer operational costs', money: true },
];

export const OperatingCostDetailsSummary = ({ totals, title = 'Operating cost details' }) => {
  return (
    <div className="space-y-3">
      <div>
        <p className="text-white font-semibold">{title}</p>
        <p className="text-xs text-gray-400">
          Filled from {totals.tripCount} trip log{totals.tripCount === 1 ? '' : 's'}. Truck operational costs are deliveries, including maintenance. Trailer operational costs are customer-pickup maintenance only.
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 text-sm">
        {LINES.map((line) => (
          <div key={line.key} className="rounded-md border border-gray-700 bg-gray-900/60 p-3">
            <p className="text-gray-400">{line.label}</p>
            <p className="text-white font-semibold">
              {line.money ? formatCurrency(totals[line.key]) : `${Number(totals.trailerMiles || 0).toFixed(1)} mi`}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
};
