import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Loader2, Tag, CheckCircle, XCircle } from 'lucide-react';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';

const addonPrices = {
  insurance: 20,
  drivewayProtection: 15,
};

const equipmentMeta = [
  { id: 'wheelbarrow', label: 'Wheelbarrow', price: 10 },
  { id: 'handTruck', label: 'Hand Truck', price: 15 },
  { id: 'gloves', label: 'Working Gloves (Pair)', price: 5 },
];

export const OrderSummary = ({ plan, addons, onProceed, isProcessing, onCouponApply, deliveryService }) => {
  const [couponCode, setCouponCode] = useState('');
  const [coupon, setCoupon] = useState(null);
  const [couponLoading, setCouponLoading] = useState(false);
  const [couponError, setCouponError] = useState('');

  useEffect(() => {
    if (addons.coupon) {
      setCoupon(addons.coupon);
      setCouponCode(addons.coupon.code);
    }
  }, [addons.coupon]);

  const getDiscountAmount = (subtotal) => {
    if (coupon && coupon.isValid) {
      if (coupon.discountType === 'fixed') {
        return Math.min(subtotal, coupon.discountValue);
      } else if (coupon.discountType === 'percentage') {
        return subtotal * (coupon.discountValue / 100);
      }
    }
    return 0;
  };

  const calculateTotal = () => {
    let subtotal = plan.price;
    if (addons.insurance === 'accept') subtotal += addonPrices.insurance;
    if (addons.drivewayProtection === 'accept' && (plan.id === 1 || (plan.id === 2 && deliveryService))) subtotal += addonPrices.drivewayProtection;
    
    addons.equipment.forEach(item => {
      const meta = equipmentMeta.find(e => e.id === item.id);
      if (meta) {
        subtotal += meta.price * item.quantity;
      }
    });

    const discountAmount = getDiscountAmount(subtotal);
    const total = subtotal - discountAmount;

    return { subtotal, discountAmount, total };
  };

  const { subtotal, discountAmount, total } = calculateTotal();

  const handleApplyCoupon = async () => {
    if (!couponCode) return;
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
      setCouponError(message);
      toast({ title: 'Invalid Coupon', description: message, variant: 'destructive' });
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
      className="bg-white/10 backdrop-blur-lg rounded-2xl p-8 shadow-2xl border border-white/20 sticky top-24"
    >
      <h3 className="text-2xl font-bold text-yellow-400 mb-6">Order Summary</h3>
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <span className="text-blue-200">Base Service</span>
          <span className="font-semibold text-white">${plan.price.toFixed(2)}</span>
        </div>
        {addons.insurance === 'accept' && (
          <div className="flex justify-between items-center">
            <span className="text-blue-200">Rental Insurance</span>
            <span className="font-semibold text-white">${addonPrices.insurance.toFixed(2)}</span>
          </div>
        )}
        {addons.drivewayProtection === 'accept' && (plan.id === 1 || (plan.id === 2 && deliveryService)) && (
          <div className="flex justify-between items-center">
            <span className="text-blue-200">Driveway Protection</span>
            <span className="font-semibold text-white">${addonPrices.drivewayProtection.toFixed(2)}</span>
          </div>
        )}
        {addons.equipment.length > 0 && (
          <div>
            <p className="text-blue-200 mb-2">Equipment:</p>
            <ul className="space-y-1 pl-4">
              {addons.equipment.map(item => {
                const meta = equipmentMeta.find(e => e.id === item.id);
                return (
                  <li key={item.id} className="flex justify-between text-sm">
                    <span>{meta.label} x{item.quantity}</span>
                    <span>${(meta.price * item.quantity).toFixed(2)}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        
        <div className="border-t border-white/20 pt-4">
          <div className="flex items-end gap-2">
            <div className="flex-grow">
              <label htmlFor="coupon" className="text-sm text-blue-200">Have a coupon?</label>
              <input 
                id="coupon"
                type="text"
                value={couponCode}
                onChange={(e) => setCouponCode(e.target.value)}
                placeholder="Enter code"
                className="w-full h-10 rounded-md border border-white/30 bg-white/10 px-3 py-2 text-sm text-white placeholder:text-blue-200/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400"
              />
            </div>
            <Button onClick={handleApplyCoupon} disabled={couponLoading || !couponCode}>
              {couponLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Apply'}
            </Button>
          </div>
          {couponError && <p className="text-red-400 text-sm mt-2 flex items-center"><XCircle className="mr-1 h-4 w-4"/> {couponError}</p>}
          {coupon && coupon.isValid && (
            <div className="text-green-400 text-sm mt-2 flex items-center">
              <CheckCircle className="mr-1 h-4 w-4"/> 
              Coupon "{coupon.code}" applied!
            </div>
          )}
        </div>

        {discountAmount > 0 && (
          <div className="flex justify-between items-center text-green-400">
            <span className="font-semibold">Coupon Discount ({coupon.code})</span>
            <span className="font-semibold">- ${discountAmount.toFixed(2)}</span>
          </div>
        )}

        <div className="border-t-2 border-yellow-400 pt-4 mt-4">
          <div className="flex justify-between items-center text-xl">
            <span className="font-bold text-white">Total</span>
            <span className="font-bold text-yellow-400">${total.toFixed(2)}</span>
          </div>
        </div>
      </div>
      <Button
        onClick={onProceed}
        className="w-full mt-8 text-lg"
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