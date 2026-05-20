import React from 'react';
import { motion } from 'framer-motion';
import { useLocation } from 'react-router-dom';
import { Award, Gift, Headphones as HeadphonesIcon, Tag, Sparkles } from 'lucide-react';

export const ReturningCustomerLoyaltyBadge = ({ customerName, bookingCount, embedded = false }) => {
  const { pathname } = useLocation();

  if (!embedded && !pathname.startsWith('/customer-portal')) {
    return null;
  }
  const benefits = [
    {
      icon: Tag,
      title: 'Exclusive Discounts',
      description: 'Special pricing for loyal customers',
      color: 'text-yellow-400',
      bgColor: 'bg-yellow-500/10'
    },
    {
      icon: Gift,
      title: 'Referral Rewards',
      description: 'Earn credits for referrals',
      color: 'text-green-400',
      bgColor: 'bg-green-500/10'
    },
    {
      icon: HeadphonesIcon,
      title: 'Priority Support',
      description: 'Fast-tracked customer service',
      color: 'text-blue-400',
      bgColor: 'bg-blue-500/10'
    },
    {
      icon: Sparkles,
      title: 'Coupon Access',
      description: 'First access to new promotions',
      color: 'text-purple-400',
      bgColor: 'bg-purple-500/10'
    }
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="w-full bg-gradient-to-br from-yellow-900/30 via-orange-900/20 to-yellow-900/30 border-2 border-yellow-500/50 rounded-2xl p-6 shadow-2xl mb-6"
    >
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 mb-6 text-left">
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.2, type: 'spring', stiffness: 200 }}
          className="bg-yellow-500/20 rounded-full p-4 flex-shrink-0"
        >
          <Award className="h-10 w-10 text-yellow-400" />
        </motion.div>
        <div className="min-w-0 flex-1">
          <motion.h3
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
            className="text-xl sm:text-2xl font-bold text-white"
          >
            Welcome Back, {customerName}!
          </motion.h3>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4 }}
            className="text-yellow-300 text-sm mt-1"
          >
            Valued Customer • {bookingCount} {bookingCount === 1 ? 'Order' : 'Orders'} Completed
          </motion.p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {benefits.map((benefit, index) => (
          <motion.div
            key={benefit.title}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.5 + index * 0.1 }}
            className={`${benefit.bgColor} rounded-xl p-4 border border-white/10 hover:border-white/30 transition-all`}
          >
            <div className="flex items-start gap-3">
              <div className={`${benefit.bgColor} rounded-lg p-2`}>
                <benefit.icon className={`h-5 w-5 ${benefit.color}`} />
              </div>
              <div className="flex-1">
                <h4 className={`font-semibold ${benefit.color} text-sm`}>
                  {benefit.title}
                </h4>
                <p className="text-xs text-gray-300 mt-1">
                  {benefit.description}
                </p>
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1 }}
        className="mt-6 text-center"
      >
        <p className="text-xs text-yellow-200 italic">
          ⭐ Thank you for being a loyal customer! Your continued support means the world to us.
        </p>
      </motion.div>
    </motion.div>
  );
};