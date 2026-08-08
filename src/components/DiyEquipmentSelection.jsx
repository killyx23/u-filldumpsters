import React from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DIY_EQUIPMENT_MACHINES } from '@/config/diyEquipmentMachines';

/**
 * Pre-step after DIY Heavy Equipment Book Now — choose Mini Excavator or Loader.
 */
export const DiyEquipmentSelection = ({ onSelectMachine, onBack, machines = DIY_EQUIPMENT_MACHINES }) => {
  return (
    <div className="min-h-[70vh] py-12 px-4">
      <div className="max-w-5xl mx-auto">
        <Button
          type="button"
          variant="ghost"
          onClick={onBack}
          className="mb-8 text-blue-200 hover:text-white hover:bg-white/10"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to services
        </Button>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="text-center mb-10"
        >
          <h1 className="text-3xl md:text-4xl font-bold text-white mb-3">
            Choose Your Equipment
          </h1>
          <p className="text-blue-200 text-lg max-w-2xl mx-auto">
            Select the machine you want to rent. Next you&apos;ll enter booking details
            just like our other self-pickup rentals.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8">
          {machines.map((machine, index) => (
            <motion.button
              key={machine.serviceId}
              type="button"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.1 + index * 0.1 }}
              onClick={() => onSelectMachine(machine)}
              className="group text-left rounded-2xl overflow-hidden border border-emerald-400/30 bg-gradient-to-br from-emerald-400/10 via-blue-900 to-indigo-900 shadow-xl hover:border-emerald-300/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 transition-colors"
            >
              <div className="aspect-[4/3] overflow-hidden bg-black/30">
                <img
                  src={machine.image}
                  alt={machine.title}
                  className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                />
              </div>
              <div className="p-6 space-y-3">
                <h2 className="text-2xl font-bold text-emerald-300">{machine.title}</h2>
                <p className="text-blue-200 text-sm leading-relaxed">{machine.description}</p>
                <span className="inline-flex items-center justify-center w-full mt-2 rounded-lg bg-gradient-to-r from-emerald-400 to-teal-500 text-white font-semibold py-3 group-hover:from-emerald-500 group-hover:to-teal-600 transition-colors">
                  Book {machine.title}
                </span>
              </div>
            </motion.button>
          ))}
        </div>
      </div>
    </div>
  );
};
