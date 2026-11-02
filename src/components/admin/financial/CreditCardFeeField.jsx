import React, { useEffect, useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/use-toast';
import { formatCurrency } from '@/utils/formatCurrency';
import { useCreditCardFeeOverride } from '@/hooks/useCreditCardFeeOverride';
import {
  effectiveCreditCardFees,
  sumCreditCardFees,
} from '@/utils/creditCardFees';

export const CreditCardFeeField = ({ bookings = [] }) => {
  const calculated = useMemo(() => sumCreditCardFees(bookings), [bookings]);
  const { override, loading, saving, save } = useCreditCardFeeOverride();
  const effective = effectiveCreditCardFees(calculated.total, override);
  const [draft, setDraft] = useState(effective.toFixed(2));
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!dirty) setDraft(effective.toFixed(2));
  }, [effective, dirty]);

  const commit = async () => {
    const parsed = Number(draft);
    if (!Number.isFinite(parsed) || parsed < 0) {
      setDraft(effective.toFixed(2));
      setDirty(false);
      toast({
        title: 'Enter the fee as a dollar amount',
        description: 'Credit card fees cannot be negative.',
        variant: 'destructive',
      });
      return;
    }
    const rounded = Math.round(parsed * 100) / 100;
    const nextOverride = Math.abs(rounded - calculated.total) < 0.001 ? null : rounded;
    if (nextOverride === override || (nextOverride == null && override == null)) {
      setDraft(rounded.toFixed(2));
      setDirty(false);
      return;
    }
    try {
      await save(nextOverride);
      setDraft(rounded.toFixed(2));
      setDirty(false);
      toast({
        title: nextOverride == null ? 'Credit card fees follow the calculation' : 'Credit card fees updated',
        description: nextOverride == null
          ? `Using ${formatCurrency(calculated.total)} from 2.9% plus $0.30 per order.`
          : `Using ${formatCurrency(rounded)} instead of the calculated ${formatCurrency(calculated.total)}.`,
      });
    } catch (error) {
      toast({
        title: 'Could not save credit card fees',
        description: error.message,
        variant: 'destructive',
      });
    }
  };

  const reset = async () => {
    try {
      await save(null);
      setDirty(false);
      toast({
        title: 'Credit card fees follow the calculation',
        description: `${formatCurrency(calculated.total)} from ${calculated.orderCount} order${calculated.orderCount === 1 ? '' : 's'}.`,
      });
    } catch (error) {
      toast({
        title: 'Could not reset credit card fees',
        description: error.message,
        variant: 'destructive',
      });
    }
  };

  return (
    <div className="space-y-2">
      <Label htmlFor="credit-card-fees" className="text-white">Credit card fees</Label>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          id="credit-card-fees"
          type="number"
          min="0"
          step="0.01"
          inputMode="decimal"
          value={loading ? '' : draft}
          disabled={loading || saving}
          onChange={(event) => {
            setDraft(event.target.value);
            setDirty(true);
          }}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
          }}
          className="h-10 w-40 bg-gray-900 border-gray-600 text-white"
        />
        {override != null && (
          <Button type="button" size="sm" variant="outline" onClick={reset} disabled={saving}>
            Use calculated amount
          </Button>
        )}
      </div>
      <p className="text-xs text-gray-400">
        Starts at 2.9% of each order plus $0.30.
        {' '}
        Calculated {formatCurrency(calculated.total)} from {calculated.orderCount} order{calculated.orderCount === 1 ? '' : 's'}.
        {override != null ? ' This amount is a manual override.' : ' Change the amount to override it.'}
      </p>
    </div>
  );
};
