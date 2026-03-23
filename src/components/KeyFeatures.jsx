
import React from 'react';
import { motion } from 'framer-motion';
import { Calendar, Shield, MapPin } from 'lucide-react';

const features = [
  {
    icon: <Calendar className="h-6 w-6 text-blue-400" />,
    title: "Scheduled Deliveries",
    description: "Online scheduled deliveries for your convenience.",
  },
  {
    icon: <Shield className="h-6 w-6 text-green-400" />,
    title: "Fully Insured",
    description: "We offer insurance for your protection and peace of mind.",
  },
  {
    icon: <MapPin className="h-6 w-6 text-purple-400" />,
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
      <h3 className="text-lg font-semibold text-white mb-1">{title}</h3>
      <p className="text-blue-200/70 text-sm leading-relaxed">{description}</p>
    </div>
  </motion.div>
);

export const KeyFeatures = () => {
  return (
    <section className="py-12 bg-slate-900/40 relative overflow-hidden border-y border-white/5">
      {/* Subtle Background Glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full h-full bg-blue-500/5 blur-3xl pointer-events-none" />
      
      <div className="container mx-auto px-4 relative z-10">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 lg:gap-12">
          {features.map((feature, index) => (
            <FeatureCard key={index} {...feature} index={index} />
          ))}
        </div>
      </div>
    </section>
  );
};
