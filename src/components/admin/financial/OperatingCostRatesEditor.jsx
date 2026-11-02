import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';
import { Loader2 } from 'lucide-react';
import { formatCurrency } from '@/utils/formatCurrency';
import { useTruckOperatingCosts } from '@/hooks/useTruckOperatingCosts';
import { OperatingCostDetailsSummary } from './OperatingCostDetailsSummary';
import {
  DEFAULT_OPERATING_COST_RATES,
  derivedOperatingRates,
  normalizeOperatingCostRates,
  sumOperatingCosts,
} from '@/utils/operatingCost';

const FIELDS = [
  {
    key: 'fuel_price_per_gallon',
    label: 'Fuel price',
    suffix: '/ gallon',
    step: '0.01',
  },
  {
    key: 'truck_mpg',
    label: 'Truck fuel economy',
    suffix: 'MPG towing',
    step: '0.1',
  },
  {
    key: 'maintenance_per_mile',
    label: 'Truck maintenance and wear',
    suffix: '/ mile',
    step: '0.001',
  },
  {
    key: 'driver_hourly_rate',
    label: 'Driver labor',
    suffix: '/ hour',
    step: '0.01',
  },
  {
    key: 'landfill_ticket',
    label: 'Landfill disposal ticket',
    suffix: 'flat fee',
    step: '0.01',
  },
  {
    key: 'landfill_one_way_miles',
    label: 'Landfill distance from home base',
    suffix: 'miles one way',
    step: '0.1',
  },
];

function rateText(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '$0.000';
  return `$${n.toFixed(3)}`;
}

export const OperatingCostRatesEditor = ({ onRatesChange }) => {
  const [rates, setRates] = useState(DEFAULT_OPERATING_COST_RATES);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { logs, loading: logsLoading } = useTruckOperatingCosts();
  const onRatesChangeRef = useRef(onRatesChange);
  onRatesChangeRef.current = onRatesChange;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('operating_cost_rates')
        .select('*')
        .eq('id', 1)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        toast({
          title: 'Could not load operating costs',
          description: error.message,
          variant: 'destructive',
        });
      } else if (data) {
        const next = normalizeOperatingCostRates(data);
        setRates(next);
        onRatesChangeRef.current?.(next);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const derived = useMemo(() => derivedOperatingRates(rates), [rates]);
  const tripDetails = useMemo(() => sumOperatingCosts(logs, rates), [logs, rates]);

  const updateField = (key, value) => {
    setRates((current) => ({ ...current, [key]: value }));
  };

  const save = async () => {
    const payload = {};
    for (const field of FIELDS) {
      const parsed = Number(rates[field.key]);
      if (!Number.isFinite(parsed) || parsed < 0 || (field.key === 'truck_mpg' && parsed <= 0)) {
        toast({
          title: 'Check the operating cost fields',
          description: `${field.label} needs a number of zero or more. Miles per gallon must be above zero.`,
          variant: 'destructive',
        });
        return;
      }
      payload[field.key] = parsed;
    }
    setSaving(true);
    try {
      const { error } = await supabase
        .from('operating_cost_rates')
        .update({ ...payload, updated_at: new Date().toISOString() })
        .eq('id', 1);
      if (error) throw error;
      const next = normalizeOperatingCostRates(payload);
      setRates(next);
      onRatesChange?.(next);
      toast({
        title: 'Operating costs saved',
        description: 'Every booking now uses these rates.',
      });
    } catch (err) {
      toast({
        title: 'Could not save operating costs',
        description: err.message,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="h-8 w-8 animate-spin text-blue-300" />
      </div>
    );
  }

  return (
    <Card className="bg-gray-800/50 border-gray-700">
      <CardHeader>
        <CardTitle className="text-white">Truck operating costs</CardTitle>
        <p className="text-sm text-gray-400">
          These inputs apply to every booking. Fuel per mile, labor per minute, and the truck cost per mile stay calculated from them.
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {FIELDS.map((field) => (
            <div key={field.key}>
              <Label htmlFor={field.key} className="text-gray-300">
                {field.label}
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  id={field.key}
                  type="number"
                  min="0"
                  step={field.step}
                  value={rates[field.key]}
                  onChange={(e) => updateField(field.key, e.target.value)}
                  className="bg-gray-900 border-gray-700 text-white"
                />
                <span className="text-xs text-gray-400 whitespace-nowrap">{field.suffix}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 text-sm">
          <div className="rounded-md border border-gray-700 bg-gray-900/60 p-3">
            <p className="text-gray-400">Fuel cost per mile</p>
            <p className="text-white font-semibold">{rateText(derived.fuelPerMile)}</p>
            <p className="text-xs text-gray-500">
              {formatCurrency(derived.fuel_price_per_gallon)} ÷ {Number(derived.truck_mpg)} MPG
            </p>
          </div>
          <div className="rounded-md border border-gray-700 bg-gray-900/60 p-3">
            <p className="text-gray-400">Driver labor per minute</p>
            <p className="text-white font-semibold">{rateText(derived.laborPerMinute)}</p>
            <p className="text-xs text-gray-500">{formatCurrency(derived.driver_hourly_rate)} ÷ 60</p>
          </div>
          <div className="rounded-md border border-gray-700 bg-gray-900/60 p-3">
            <p className="text-gray-400">Truck cost per mile</p>
            <p className="text-white font-semibold">{rateText(derived.truckPerMile)}</p>
            <p className="text-xs text-gray-500">Fuel plus maintenance</p>
          </div>
          <div className="rounded-md border border-gray-700 bg-gray-900/60 p-3">
            <p className="text-gray-400">Landfill round trip</p>
            <p className="text-white font-semibold">{derived.landfillRoundTripMiles.toFixed(1)} mi</p>
            <p className="text-xs text-gray-500">{Number(derived.landfill_one_way_miles)} miles each way</p>
          </div>
        </div>

        {logsLoading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-6 w-6 animate-spin text-blue-300" />
          </div>
        ) : (
          <OperatingCostDetailsSummary totals={tripDetails} />
        )}

        <Button type="button" onClick={save} disabled={saving} className="bg-blue-600 hover:bg-blue-700">
          {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
          Save operating costs
        </Button>
      </CardContent>
    </Card>
  );
};
