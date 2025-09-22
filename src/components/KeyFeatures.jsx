import React from 'react';
import { motion } from 'framer-motion';
import { Calendar, Shield, MapPin } from 'lucide-react';

const features = [
  {
    icon: <Calendar className="h-10 w-10 text-white" />,
    title: "Scheduled Deliveries",
    description: "Online scheduled deliveries for your convenience.",
    color: "from-blue-400 to-indigo-500",
  },
  {
    icon: <Shield className="h-10 w-10 text-white" />,
    title: "Fully Insured",
    description: "Complete insurance coverage for your peace of mind.",
    color: "from-green-400 to-teal-500",
  },
  {
    icon: <MapPin className="h-10 w-10 text-white" />,
    title: "Local Service",
    description: "Serving the Saratoga Springs and surrounding areas.",
    color: "from-purple-400 to-pink-500",
  },
];

const FeatureCard = ({ icon, title, description, color, index }) => (
  <motion.div
    initial={{ opacity: 0, y: 50 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.5, delay: index * 0.1 }}
    className="text-center"
  >
    <div className={`mx-auto mb-6 flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br ${color} shadow-lg`}>
      {icon}
    </div>
    <h3 className="mb-2 text-xl font-bold text-white">{title}</h3>
    <p className="text-blue-200">{description}</p>
  </motion.div>
);

export const KeyFeatures = () => {
  return (
    <section className="py-20">
      <div className="container mx-auto px-4">
        <div className="grid grid-cols-1 gap-12 md:grid-cols-3">
          {features.map((feature, index) => (
            <FeatureCard key={index} {...feature} index={index} />
          ))}
        </div>
      </div>
    </section>
  );
};