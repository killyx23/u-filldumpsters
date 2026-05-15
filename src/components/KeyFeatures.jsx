import React from 'react';
import { motion } from 'framer-motion';
import { Calendar, Shield, MapPin } from 'lucide-react';

const features = [
  {
    icon: (
      <div 
        className="relative"
        style={{
          filter: 'drop-shadow(0 6px 12px rgba(0, 0, 0, 0.4)) drop-shadow(0 0 8px rgba(0, 217, 255, 0.3))'
        }}
      >
        <Calendar 
          className="h-14 w-14" 
          strokeWidth={2.5}
          style={{
            color: '#00D9FF',
            stroke: '#000000',
            paintOrder: 'stroke fill'
          }}
        />
      </div>
    ),
    title: "Scheduled Deliveries",
    description: "Online scheduled deliveries for your convenience.",
  },
  {
    icon: (
      <div 
        className="relative"
        style={{
          filter: 'drop-shadow(0 6px 12px rgba(0, 0, 0, 0.4)) drop-shadow(0 0 8px rgba(0, 255, 65, 0.3))'
        }}
      >
        <Shield 
          className="h-14 w-14" 
          strokeWidth={2.5}
          style={{
            color: '#00FF41',
            stroke: '#000000',
            paintOrder: 'stroke fill'
          }}
        />
      </div>
    ),
    title: "Fully Insured",
    description: "We offer insurance for your protection and peace of mind.",
  },
  {
    icon: (
      <div 
        className="relative"
        style={{
          filter: 'drop-shadow(0 6px 12px rgba(0, 0, 0, 0.4)) drop-shadow(0 0 8px rgba(255, 0, 110, 0.3))'
        }}
      >
        <MapPin 
          className="h-14 w-14" 
          strokeWidth={2.5}
          style={{
            color: '#FF006E',
            stroke: '#000000',
            paintOrder: 'stroke fill'
          }}
        />
      </div>
    ),
    title: "Local Service",
    description: "Serving the Saratoga Springs and surrounding areas.",
  },
];

const FeatureCard = ({ icon, title, description, index }) => (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    whileInView={{ opacity: 1, y: 0 }}
    viewport={{ once: true }}
    transition={{ duration: 0.5, delay: index * 0.1 }}
    className="flex items-start space-x-4 p-4 rounded-xl hover:bg-white/5 transition-colors duration-300"
  >
    <div className="mt-1 flex-shrink-0">
      {icon}
    </div>
    <div>
      <h3 
        className="text-lg font-bold text-gray-900 mb-1"
        style={{
          textShadow: '0 1px 2px rgba(255, 255, 255, 0.8), 0 0 4px rgba(255, 255, 255, 0.4)'
        }}
      >
        {title}
      </h3>
      <p 
        className="text-sm leading-relaxed font-semibold text-gray-800"
        style={{
          textShadow: '0 1px 1px rgba(255, 255, 255, 0.6), 0 0 3px rgba(255, 255, 255, 0.3)'
        }}
      >
        {description}
      </p>
    </div>
  </motion.div>
);

export const KeyFeatures = () => {
  return (
    <section className="py-12 bg-slate-900/40 relative overflow-hidden border-y border-white/5">
      {/* Subtle Background Glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full h-full bg-blue-500/5 blur-3xl pointer-events-none" />
      
      <div className="container mx-auto px-4 relative z-10">
        <div 
          className="grid grid-cols-1 md:grid-cols-3 gap-6 lg:gap-12 rounded-2xl p-6"
          style={{
            background: 'linear-gradient(to right, #FCD34D 0%, #FBBF24 10%, #93C5FD 40%, #60A5FA 60%, #3B82F6 80%, #2563EB 100%)'
          }}
        >
          {features.map((feature, index) => (
            <FeatureCard key={index} {...feature} index={index} />
          ))}
        </div>
      </div>
    </section>
  );
};