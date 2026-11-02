import React, { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { formatCurrency } from '@/utils/formatCurrency';
import { bookingOperatingCost, roundQuantity } from '@/utils/operatingCost';

function rateText(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '$0.000';
  return `$${n.toFixed(3)}`;
}

function QuantityField({ id, label, value, calculated, overridden, saving, onCommit, onReset }) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commit = () => {
    const parsed = Number(draft);
    if (!Number.isFinite(parsed) || parsed < 0) {
      setDraft(String(value));
      return;
    }
    const rounded = roundQuantity(parsed);
    if (rounded === roundQuantity(calculated)) {
      if (overridden) onReset();
      setDraft(String(calculated));
      return;
    }
    if (rounded === roundQuantity(value) && overridden) return;
    onCommit(rounded);
  };

  return (
    <div>
      <label htmlFor={id} className="text-xs text-gray-400">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          type="number"
          min="0"
          step="0.1"
          value={draft}
          disabled={saving}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
          className="h-8 w-28 bg-gray-900 border-gray-700 text-white"
        />
        {overridden ? (
          <Button type="button" variant="outline" className="h-8 border-gray-600 text-white" onClick={onReset}>
            Use calculated {calculated}
          </Button>
        ) : (
          <span className="text-xs text-gray-500">Calculated</span>
        )}
      </div>
    </div>
  );
}

export const BookingOperatingCost = ({ log, rates, saving, onSave }) => {
  const cost = bookingOperatingCost(log, rates);

  return (
    <div className="space-y-3 text-sm text-gray-300">
      <p className="text-white font-semibold">Operating cost details</p>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className="space-y-3">
        <p>
          Recorded round trip <span className="text-white">{Number(log.round_trip_miles || 0).toFixed(1)} mi</span>
          {' · '}
          Customer GPS <span className="text-white">{Number(log.customer_gps_miles || 0).toFixed(1)} mi</span>
          <span className="block text-xs text-gray-500">
            Customer GPS miles are the extra miles reported at return. On a customer-pickup dump trailer they add maintenance only. The customer pays for the fuel.
          </span>
        </p>
        {cost.customerPickup ? (
          <p>
            Additional customer GPS mileage{' '}
            <span className="text-white">{cost.customerGpsMiles.toFixed(1)} mi</span>
            <span className="block text-xs text-gray-500">
              Extra miles reported when the trailer is returned, beyond the miles already known. They add the maintenance per-mile rate only. Fuel and labor stay off because the customer handles those.
            </span>
          </p>
        ) : (
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              className="mt-1"
              checked={cost.includeLandfill}
              disabled={saving}
              onChange={(e) => onSave({ landfill_haul_override: e.target.checked })}
            />
            <span>
              Company landfill haul
              <span className="block text-xs text-gray-500">
                Adds the {cost.includeLandfill ? cost.landfillMiles.toFixed(1) : (Number(rates.landfill_one_way_miles) * 2).toFixed(1)} mile landfill round trip and the {formatCurrency(rates.landfill_ticket)} ticket. Customer pickup stays off until you check this.
              </span>
            </span>
          </label>
        )}
        <p>
          Company trailer miles{' '}
          <span className="text-white">{cost.companyTrailerMiles.toFixed(1)} mi</span>
          <span className="block text-xs text-gray-500">
            Trailer miles plus the round trip, including GPS miles
            {cost.trailerName ? `, on ${cost.trailerName}` : ' on this booking’s trailer'}.
          </span>
        </p>
        {cost.customerPickup ? null : (
          <>
            <QuantityField
              id={`driver-minutes-${log.id}`}
              label="Driver minutes"
              value={cost.driverMinutes}
              calculated={cost.calculatedDriverMinutes}
              overridden={cost.driverMinutesOverridden}
              saving={saving}
              onCommit={(minutes) => onSave({ driver_minutes_override: minutes })}
              onReset={() => onSave({ driver_minutes_override: null })}
            />
            <p className="text-xs text-gray-500">
              Calculated driver time doubles the stored one-way drive time for a company trip. Landfill drive time is not stored, so type extra minutes when you have them.
            </p>
          </>
        )}
      </div>
      <div className="space-y-1">
        {cost.customerPickup ? null : (
          <p>Fuel: {cost.truckMiles.toFixed(1)} mi × {rateText(cost.fuelPerMile)} = <span className="text-white">{formatCurrency(cost.fuel)}</span></p>
        )}
        <p>Maintenance: {cost.truckMiles.toFixed(1)} mi × {rateText(rates.maintenance_per_mile)} = <span className="text-white">{formatCurrency(cost.maintenance)}</span></p>
        {cost.customerPickup ? (
          <p>Additional customer GPS mileage: {cost.customerGpsMiles.toFixed(1)} mi × {rateText(rates.maintenance_per_mile)} = <span className="text-white">{formatCurrency(cost.customerGpsCost)}</span></p>
        ) : (
          <>
            <p>Driver labor: {cost.driverMinutes.toFixed(1)} min × {rateText(cost.laborPerMinute)} = <span className="text-white">{formatCurrency(cost.labor)}</span></p>
            <p>Landfill ticket: <span className="text-white">{formatCurrency(cost.landfillTicket)}</span></p>
          </>
        )}
        <p className="pt-2 text-yellow-300 font-semibold">Operating cost {formatCurrency(cost.total)}</p>
      </div>
      </div>
    </div>
  );
};
