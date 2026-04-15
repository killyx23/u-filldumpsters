import React from 'react';
import { motion } from 'framer-motion';

export const Banner = () => {
  return (
    <div className="relative w-full h-[200px] md:h-[300px] overflow-hidden">
      {/* Background Image */}
      <img 
        src="https://horizons-cdn.hostinger.com/084723fe-37cf-40b6-bc10-548f6485382e/8524e4e335a6a5924956a3d49db2e487.png" 
        alt="Mountain Lake Landscape" 
        className="absolute inset-0 w-full h-full object-cover"
      />
      
      {/* Overlay for better text readability */}
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" />
      
      {/* Content */}
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
        >
          <h1 className="text-4xl md:text-6xl lg:text-7xl font-black text-white drop-shadow-[0_5px_15px_rgba(0,0,0,0.5)] tracking-tighter uppercase italic">
            U-Fill <span className="text-yellow-400">Dumpsters</span>
          </h1>
          <div className="h-1.5 w-32 md:w-48 bg-yellow-400 mx-auto mt-4 rounded-full shadow-[0_0_15px_rgba(250,204,21,0.5)]" />
        </motion.div>
      </div>
    </div>
  );
};