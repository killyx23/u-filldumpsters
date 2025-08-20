import React from 'react';
import { motion } from 'framer-motion';
import { CheckCircle } from 'lucide-react';
export const Hero = () => {
  return <section className="py-20 px-4">
      <div className="container mx-auto text-center">
        <motion.div initial={{
        opacity: 0,
        y: 30
      }} animate={{
        opacity: 1,
        y: 0
      }} transition={{
        duration: 0.8
      }}>
          <h1 className="text-5xl md:text-7xl font-bold text-white mb-6">
            Professional
            <span className="bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent"> Dumpster</span>
            <br />
            Rentals
          </h1>
          <p className="text-xl md:text-2xl text-blue-200 mb-8 max-w-3xl mx-auto">Fast, reliable waste management solutions for your home or business needs.</p>
          <div className="flex flex-wrap justify-center gap-6 text-white">
            <div className="flex items-center space-x-2">
              <CheckCircle className="h-5 w-5 text-green-400" />
              <span>Simple and Fast Online Scheduling</span>
            </div>
            <div className="flex items-center space-x-2">
              <CheckCircle className="h-5 w-5 text-green-400" />
              <span>Up Front and Competitive Pricing</span>
            </div>
            <div className="flex items-center space-x-2">
              <CheckCircle className="h-5 w-5 text-green-400" />
              <span>Professional Service</span>
            </div>
          </div>
        </motion.div>
      </div>
    </section>;
};