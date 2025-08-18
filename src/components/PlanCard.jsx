import React from 'react';
import { motion } from 'framer-motion';
import { CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

export const PlanCard = ({ plan, onSelect, index }) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: index * 0.1 }}
      className={`relative bg-white/10 backdrop-blur-md rounded-2xl p-8 border ${
        plan.popular ? 'border-yellow-400 ring-2 ring-yellow-400/50' : 'border-white/20'
      } hover:bg-white/20 transition-all duration-300 flex flex-col`}
    >
      {plan.popular && (
        <div className="absolute -top-4 left-1/2 transform -translate-x-1/2">
          <span className="bg-gradient-to-r from-yellow-400 to-orange-500 text-black px-4 py-1 rounded-full text-sm font-bold">
            MOST POPULAR
          </span>
        </div>
      )}

      <div className="text-center mb-6 flex-grow">
        <h3 className="text-2xl font-bold text-white mb-2">{plan.name}</h3>
        <div className="text-4xl font-bold text-blue-400 mb-2">{plan.size}</div>
        <div className="text-3xl font-bold text-white">
          ${plan.price}
          <span className="text-lg text-blue-200">{plan.priceUnit}</span>
        </div>
        <p className="text-blue-200 my-6 text-center">{plan.description}</p>
        
        <div className="space-y-3 mb-6 text-left">
          {plan.features.map((feature, idx) => (
            <div key={idx} className="flex items-center space-x-3">
              <CheckCircle className="h-5 w-5 text-green-400 flex-shrink-0" />
              <span className="text-white">{feature}</span>
            </div>
          ))}
        </div>
      </div>
      
      <div className="mt-auto">
        <div className="bg-white/5 rounded-lg p-4 mb-6">
          <div className="text-sm text-blue-200">{plan.dimensions}</div>
          <div className="text-sm text-blue-200">Best for: {plan.bestFor}</div>
        </div>

        <Button
          onClick={() => onSelect(plan)}
          className={`w-full py-3 text-lg font-semibold ${
            plan.popular
              ? 'bg-gradient-to-r from-yellow-500 to-orange-600 hover:from-yellow-600 hover:to-orange-700 text-black'
              : 'bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white'
          }`}
        >
          Book This Service
        </Button>
      </div>
    </motion.div>
  );
};