import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Gift, Tag, Sparkles } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { supabase } from '@/lib/customSupabaseClient';

export const ReturningCustomerBenefits = ({ serviceId }) => {
  const [loyaltyCoupon, setLoyaltyCoupon] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchLoyaltyBenefits = async () => {
      console.log('[ReturningCustomerBenefits] Fetching loyalty benefits for service:', serviceId);
      setLoading(true);

      try {
        const { data, error } = await supabase
          .from('coupons')
          .select('*')
          .eq('is_active', true)
          .or(`service_ids.cs.{${serviceId}},service_ids.is.null`)
          .order('discount_value', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (error) {
          console.error('[ReturningCustomerBenefits] Error fetching coupon:', error);
        } else if (data) {
          console.log('[ReturningCustomerBenefits] ✓ Loyalty coupon found:', data.code);
          setLoyaltyCoupon(data);
        } else {
          console.log('[ReturningCustomerBenefits] No active loyalty coupons found');
        }
      } catch (err) {
        console.error('[ReturningCustomerBenefits] Unexpected error:', err);
      } finally {
        setLoading(false);
      }
    };

    if (serviceId) {
      fetchLoyaltyBenefits();
    }
  }, [serviceId]);

  if (loading) {
    return null;
  }

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="mb-6"
    >
      <Card className="bg-gradient-to-br from-yellow-900/30 to-orange-900/30 border-2 border-yellow-500/50 shadow-lg">
        <CardContent className="p-5">
          <div className="flex items-start gap-4">
            <div className="bg-yellow-500/20 rounded-full p-2.5 flex-shrink-0">
              <Gift className="h-6 w-6 text-yellow-400" />
            </div>
            
            <div className="flex-1">
              <h4 className="text-lg font-bold text-white flex items-center gap-2 mb-2">
                <Sparkles className="h-5 w-5 text-yellow-400" />
                Returning Customer Reward!
              </h4>
              
              {loyaltyCoupon ? (
                <div className="space-y-2">
                  <p className="text-yellow-100 text-sm leading-relaxed">
                    As a valued returning customer, you're eligible for a special discount:
                  </p>
                  
                  <div className="bg-black/30 rounded-lg p-3 border border-yellow-500/30">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Tag className="h-5 w-5 text-yellow-400" />
                        <span className="font-mono text-xl font-bold text-yellow-300">
                          {loyaltyCoupon.code}
                        </span>
                      </div>
                      <div className="text-right">
                        <p className="text-2xl font-bold text-green-400">
                          {loyaltyCoupon.discount_type === 'percentage' 
                            ? `${loyaltyCoupon.discount_value}% OFF`
                            : `$${loyaltyCoupon.discount_value} OFF`
                          }
                        </p>
                      </div>
                    </div>
                  </div>
                  
                  <p className="text-xs text-yellow-200 italic">
                    💡 This code will be automatically applied at checkout!
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-yellow-100 text-sm leading-relaxed">
                    Thank you for being a loyal customer! We appreciate your continued business.
                  </p>
                  <div className="bg-black/30 rounded-lg p-3 border border-yellow-500/30">
                    <p className="text-sm text-yellow-200">
                      ⭐ <strong>Priority Service:</strong> Your booking will receive expedited processing.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
};