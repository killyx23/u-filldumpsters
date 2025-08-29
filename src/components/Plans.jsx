
    import React from 'react';
    import { motion } from 'framer-motion';
    import { PlanCard } from '@/components/PlanCard';

    export const Plans = ({ plans, onSelectPlan, serviceAvailability }) => {
      return (
        <section className="py-16 px-4">
          <div className="container mx-auto">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
              className="text-center mb-12"
            >
              <h2 className="text-4xl font-bold text-white mb-4">Choose Your Dumpster Type Of Service You Want</h2>
              <p className="text-xl text-blue-200">Select your perfect choice for your project</p>
            </motion.div>

            <div className="grid md:grid-cols-3 gap-8">
              {plans.map((plan, index) => (
                <PlanCard key={plan.id} plan={plan} onSelect={onSelectPlan} index={index} isAvailable={serviceAvailability ? serviceAvailability[plan.id] : true} />
              ))}
            </div>
          </div>
        </section>
      );
    };
  