
import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Loader2, Tag, CheckCircle, XCircle } from 'lucide-react';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';
import { formatCurrency } from '@/api/EcommerceApi';
import { calculateDistanceAndFee } from '@/services/DistanceCalculationService';

const addonPrices = {
  insurance: 20,
  drivewayProtection: 15,
};

const equipmentMeta = [
  { id: 'wheelbarrow', label: 'Wheelbarrow', price: 10 },
  { id: 'handTruck', label: 'Hand Truck', price: 15 },
  { id: 'gloves', label: 'Working Gloves (Pair)', price: 5 },
];

export const OrderSummary = ({ plan, addons, contactAddress, onProceed, isProcessing, onCouponApply, deliveryService, fetchedMileageRate }) => {
  const [couponCode, setCouponCode] = useState('');
  const [coupon, setCoupon] = useState(null);
  const [couponLoading, setCouponLoading] = useState(false);
  const [couponError, setCouponError] = useState('');
  
  // Use fetched rate from parent if available, else fetch it here as fallback
  const [mileageRate, setMileageRate] = useState(fetchedMileageRate !== undefined ? fetchedMileageRate : (plan?.mileage_rate || 20));

  useEffect(() => {
    if (addons?.coupon) {
      setCoupon(addons.coupon);
      setCouponCode(addons.coupon.code || '');
    }
  }, [addons?.coupon]);

  useEffect(() => {
    if (fetchedMileageRate !== undefined) {
      setMileageRate(fetchedMileageRate);
    } else {
      const fetchRate = async () => {
        if (plan?.id) {
          const { data, error } = await supabase.from('services').select('mileage_rate').eq('id', plan.id).single();
          if (!error && data && data.mileage_rate !== null) {
            setMileageRate(Number(data.mileage_rate));
          }
        }
      };
      fetchRate();
    }
  }, [fetchedMileageRate, plan?.id]);

  const getDiscountAmount = (subtotal) => {
    if (coupon && coupon.isValid) {
      if (coupon.discountType === 'fixed') {
        return Math.min(subtotal, coupon.discountValue || 0);
      } else if (coupon.discountType === 'percentage') {
        return subtotal * ((coupon.discountValue || 0) / 100);
      }
    }
    return 0;
  };

  const calculateTotal = () => {
    let subtotal = plan?.price || 0;
    if (addons?.insurance === 'accept') subtotal += addonPrices.insurance;
    if (addons?.drivewayProtection === 'accept' && (plan?.id === 1 || (plan?.id === 2 && deliveryService))) subtotal += addonPrices.drivewayProtection;
    
    if (addons?.equipment && Array.isArray(addons.equipment)) {
        addons.equipment.forEach(item => {
          const meta = equipmentMeta.find(e => e.id === item.id);
          if (meta && item.quantity) {
            subtotal += meta.price * item.quantity;
          }
        });
    }

    // Always fetch calculated mileage fee based on correct logic (including 30 free miles for Plan 1)
    const feeResult = calculateDistanceAndFee(addons?.deliveryDistance || 0, plan?.id, mileageRate);
    const calculatedMileageCharge = feeResult.totalFee;

    if (calculatedMileageCharge > 0) {
      subtotal += calculatedMileageCharge;
    }

    const discountAmount = getDiscountAmount(subtotal);
    const total = subtotal - discountAmount;

    return { subtotal, discountAmount, total, calculatedMileageCharge, feeResult };
  };

  const { subtotal, discountAmount, total, calculatedMileageCharge, feeResult } = calculateTotal();

  const handleApplyCoupon = async () => {
    if (!couponCode || !plan?.id) return;
    setCouponLoading(true);
    setCouponError('');
    setCoupon(null);
    onCouponApply(null);

    const { data, error } = await supabase.rpc('validate_coupon', {
      coupon_code: couponCode.toUpperCase(),
      service_id_arg: plan.id
    });

    if (error || (data && !data.isValid)) {
      const message = (data && data.error) || error?.message || 'An unknown error occurred.';
      const safeMessage = typeof message === 'string' ? message : JSON.stringify(message);
      setCouponError(safeMessage);
      toast({ title: 'Invalid Coupon', description: safeMessage, variant: 'destructive' });
      setCoupon(null);
      onCouponApply(null);
    } else if (data && data.isValid) {
      setCoupon(data);
      toast({ title: 'Coupon Applied!', description: `Your coupon "${data.code}" has been applied.` });
      onCouponApply(data);
    }
    setCouponLoading(false);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="bg-slate-900/90 backdrop-blur-lg rounded-2xl p-8 shadow-2xl border border-white/20 sticky top-24 summary-container z-40"
    >
      <h3 className="text-2xl font-bold text-yellow-400 mb-6">Order Summary</h3>
      <div className="space-y-4">
        <div className="flex justify-between items-center summary-item">
          <span className="text-blue-200">Base Service</span>
          <span className="font-semibold text-white">{formatCurrency((plan?.price || 0) * 100)}</span>
        </div>
        
        {addons?.insurance === 'accept' && (
          <div className="flex justify-between items-center summary-item">
            <span className="text-blue-200">Rental Insurance</span>
            <span className="font-semibold text-white">{formatCurrency(addonPrices.insurance * 100)}</span>
          </div>
        )}
        
        {addons?.drivewayProtection === 'accept' && (plan?.id === 1 || (plan?.id === 2 && deliveryService)) && (
          <div className="flex justify-between items-center summary-item">
            <span className="text-blue-200">Driveway Protection</span>
            <span className="font-semibold text-white">{formatCurrency(addonPrices.drivewayProtection * 100)}</span>
          </div>
        )}
        
        {addons?.equipment && addons.equipment.length > 0 && (
          <div>
            <p className="text-blue-200 mb-2">Equipment:</p>
            <ul className="space-y-1 pl-4">
              {addons.equipment.map(item => {
                const meta = equipmentMeta.find(e => e.id === item.id);
                if (!meta) return null;
                return (
                  <li key={item.id} className="flex justify-between text-sm summary-item">
                    <span className="text-gray-300">{meta.label} x{item.quantity}</span>
                    <span className="text-gray-300">{formatCurrency(meta.price * item.quantity * 100)}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {(plan?.id === 1 || (plan?.id === 2 && deliveryService) || plan?.id === 4) && (addons?.deliveryDistance || 0) > 0 && (
          <div className="border-t border-white/10 pt-4 mt-2">
            <div className="flex justify-between items-center summary-item">
              <div className="flex items-center gap-1">
                <span className="text-cyan-300 font-medium text-sm">Mileage Charge</span>
              </div>
              <span className="font-semibold text-cyan-300">{formatCurrency(calculatedMileageCharge * 100)}</span>
            </div>
            {feeResult?.displayText && (
              <div className="mt-1 mb-2 text-[11px] text-cyan-300/70 font-medium bg-cyan-900/10 p-1.5 rounded">
                {feeResult.displayText}
              </div>
            )}
            
            {addons?.deliveryAddress?.street && (
              <div className="mt-3 bg-black/30 p-3 rounded-lg text-xs space-y-1 border border-white/5">
                <p className="text-gray-300 truncate"><span className="text-gray-500 font-semibold mr-1">Contact:</span> {contactAddress?.street || 'N/A'}</p>
                {addons.deliveryAddress.street !== contactAddress?.street && (
                    <p className="text-green-400 truncate"><span className="text-gray-500 font-semibold mr-1">Delivery:</span> {addons.deliveryAddress.street}</p>
                )}
              </div>
            )}
          </div>
        )}
        
        <div className="border-t border-white/20 pt-4">
          <div className="flex items-end gap-2">
            <div className="flex-grow">
              <label htmlFor="coupon" className="text-sm text-blue-200 mb-1 block">Have a coupon?</label>
              <input 
                id="coupon"
                type="text"
                value={couponCode}
                onChange={(e) => setCouponCode(e.target.value)}
                placeholder="Enter code"
                className="w-full h-10 rounded-md border border-white/30 bg-white/10 px-3 py-2 text-sm text-white placeholder:text-blue-200/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400 transition-colors"
              />
            </div>
            <Button onClick={handleApplyCoupon} disabled={couponLoading || !couponCode} variant="secondary" className="interactive-hover">
              {couponLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Apply'}
            </Button>
          </div>
          {couponError && <p className="text-red-400 text-sm mt-2 flex items-center"><XCircle className="mr-1 h-4 w-4"/> {couponError}</p>}
          {coupon && coupon.isValid && (
            <div className="text-green-400 text-sm mt-2 flex items-center bg-green-900/20 p-2 rounded border border-green-500/20">
              <CheckCircle className="mr-2 h-4 w-4"/> 
              Coupon "{coupon.code}" applied!
            </div>
          )}
        </div>

        {discountAmount > 0 && (
          <div className="flex justify-between items-center text-green-400 bg-green-900/20 p-3 rounded-lg border border-green-500/20 summary-item">
            <span className="font-semibold">Discount ({coupon?.code || 'Applied'})</span>
            <span className="font-semibold">- {formatCurrency(discountAmount * 100)}</span>
          </div>
        )}

        <div className="border-t-2 border-yellow-400 pt-4 mt-4">
          <div className="flex justify-between items-center text-xl">
            <span className="font-bold text-white">Total</span>
            <span className="font-bold text-yellow-400">{formatCurrency(total * 100)}</span>
          </div>
        </div>
      </div>
      <Button
        onClick={() => onProceed()}
        className="w-full mt-8 text-lg bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 shadow-lg shadow-blue-900/50 interactive-hover"
        size="lg"
        disabled={isProcessing}
      >
        {isProcessing ? (
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        ) : (
          <Tag className="mr-2 h-5 w-5" />
        )}
        {isProcessing ? 'Processing...' : 'Proceed to Checkout'}
      </Button>
    </motion.div>
  );
};
