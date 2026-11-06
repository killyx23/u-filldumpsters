import React, { useState } from 'react';
import { Tag, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/use-toast';
import { validateCouponForService } from '@/utils/rescheduleCoupon';

/**
 * Same apply/remove coupon UX as booking OrderSummary.
 */
export function CouponApplyField({
  serviceId,
  rentalDays = 1,
  appliedCoupon = null,
  onCouponChange,
  statusMessage = null,
  className = '',
}) {
  const [couponCode, setCouponCode] = useState('');
  const [validating, setValidating] = useState(false);

  const handleApply = async () => {
    if (!couponCode.trim()) {
      toast({
        title: 'Invalid Coupon',
        description: 'Please enter a coupon code.',
        variant: 'destructive',
      });
      return;
    }
    if (!serviceId) {
      toast({
        title: 'Service required',
        description: 'Select a service before applying a coupon.',
        variant: 'destructive',
      });
      return;
    }

    setValidating(true);
    try {
      const result = await validateCouponForService({
        couponCode,
        serviceId,
        rentalDays,
      });
      if (!result.ok || !result.coupon) {
        toast({
          title: 'Invalid Coupon',
          description: result.error || 'This coupon is not valid for the selected service.',
          variant: 'destructive',
        });
        return;
      }
      onCouponChange?.(result.coupon, { status: 'applied' });
      const advertisedHeadline = (result.coupon.rules || []).find((r) => r.advertise && r.headline)?.headline;
      toast({
        title: 'Coupon Applied!',
        description: result.coupon.coupon_kind === 'rules'
          ? (advertisedHeadline || 'Deal applied based on your rental length.')
          : `You saved ${result.coupon.discountType === 'percentage' ? `${result.coupon.discountValue}%` : `$${result.coupon.discountValue}`}!`,
      });
      setCouponCode('');
    } catch (err) {
      console.error('Coupon validation error:', err);
      toast({
        title: 'Error',
        description: 'Failed to validate coupon. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setValidating(false);
    }
  };

  const handleRemove = () => {
    onCouponChange?.(null, { status: 'removed' });
    setCouponCode('');
    toast({
      title: 'Coupon Removed',
      description: 'The coupon has been removed from this quote.',
    });
  };

  return (
    <div className={`space-y-2 ${className}`}>
      <label className="text-sm font-medium text-white flex items-center">
        <Tag className="h-4 w-4 mr-2 text-yellow-400" />
        Have a coupon code?
      </label>

      {appliedCoupon?.isValid ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-green-500/40 bg-green-950/30 px-3 py-2">
          <div>
            <p className="text-sm font-semibold text-green-300">Coupon {appliedCoupon.code} applied</p>
            {statusMessage && <p className="text-xs text-green-200/80 mt-0.5">{statusMessage}</p>}
          </div>
          <Button type="button" size="sm" variant="outline" onClick={handleRemove}>
            Remove
          </Button>
        </div>
      ) : (
        <div className="flex gap-2">
          <Input
            value={couponCode}
            onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
            placeholder="Enter code"
            className="bg-gray-900 border-gray-700 text-white uppercase"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleApply();
              }
            }}
          />
          <Button
            type="button"
            onClick={handleApply}
            disabled={validating || !couponCode.trim()}
            className="bg-yellow-500 hover:bg-yellow-400 text-gray-900 shrink-0"
          >
            {validating ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Apply'}
          </Button>
        </div>
      )}

      {!appliedCoupon?.isValid && statusMessage && (
        <p className="text-xs text-amber-300">{statusMessage}</p>
      )}
    </div>
  );
}
