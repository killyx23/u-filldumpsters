
    import React from 'react';
    import { motion } from 'framer-motion';
    import { CheckCircle, XCircle } from 'lucide-react';
    import { Button } from '@/components/ui/button';
    import { cn } from '@/lib/utils';

    const Banner = ({ text, className }) => (
      <div className="absolute -top-4 left-1/2 transform -translate-x-1/2 w-max max-w-xs">
        <span className={cn("text-black px-4 py-1 rounded-full text-sm font-bold whitespace-nowrap", className)}>
          {text}
        </span>
      </div>
    );

    export const PlanCard = ({ plan, onSelect, index, isAvailable }) => {
      
      const getBorderClass = () => {
        if (plan.id === 1) return 'border-yellow-400 ring-2 ring-yellow-400/50'; // Most Popular
        if (plan.id === 2) return 'border-blue-400 ring-2 ring-blue-400/50'; // Incredible Value
        if (plan.id === 3) return 'border-red-500 ring-2 ring-red-500/50'; // Save Time
        return 'border-white/20';
      };

      const getBanner = () => {
        if (plan.id === 1) return <Banner text="MOST POPULAR" className="bg-gradient-to-r from-yellow-400 to-orange-500" />;
        if (plan.id === 2) return <Banner text="INCREDIBLE VALUE" className="bg-gradient-to-r from-blue-400 to-cyan-400" />;
        if (plan.id === 3) return <Banner text="SAVE TIME & MONEY" className="bg-gradient-to-r from-red-500 to-orange-500" />;
        return null;
      }
      
      const getButtonClass = () => {
        if (plan.id === 1) return 'bg-gradient-to-r from-yellow-500 to-orange-600 hover:from-yellow-600 hover:to-orange-700 text-black';
        if (plan.id === 2) return 'bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white';
        if (plan.id === 3) return 'bg-gradient-to-r from-red-600 to-orange-600 hover:from-red-700 hover:to-orange-700 text-white';
        return 'bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white';
      };

      return (
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: index * 0.1 }}
          className={cn(
            "relative bg-white/10 backdrop-blur-md rounded-2xl p-8 border hover:bg-white/20 transition-all duration-300 flex flex-col mt-4",
            getBorderClass(),
            !isAvailable && "opacity-60"
          )}
        >
          {getBanner()}

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

            {isAvailable ? (
              <Button
                onClick={() => onSelect(plan)}
                className={cn("w-full py-3 text-lg font-semibold", getButtonClass())}
              >
                Book This Service
              </Button>
            ) : (
              <Button
                disabled
                className="w-full py-3 text-lg font-semibold bg-gray-500 text-gray-300 cursor-not-allowed"
              >
                <XCircle className="mr-2 h-5 w-5" />
                Temporarily Unavailable
              </Button>
            )}
          </div>
        </motion.div>
      );
    };
  