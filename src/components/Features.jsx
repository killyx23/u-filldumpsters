import React from 'react';
import { motion } from 'framer-motion';
import { Calendar, Shield, MapPin } from 'lucide-react';

export const Features = () => {
  const featureItems = [
    {
      icon: <Calendar className="h-8 w-8 text-white" />,
      title: "Scheduled Deliveries",
      description: "Online scheduled deliveries for your convenience.",
      bg: "bg-gradient-to-r from-blue-500 to-purple-600",
      delay: 0
    },
    {
      icon: <Shield className="h-8 w-8 text-white" />,
      title: "Fully Insured",
      description: "Complete insurance coverage for your peace of mind",
      bg: "bg-gradient-to-r from-green-500 to-blue-600",
      delay: 0.1
    },
    {
      icon: <MapPin className="h-8 w-8 text-white" />,
      title: "Local Service",
      description: "Serving the Saratoga Springs and surrounding areas.",
      bg: "bg-gradient-to-r from-purple-500 to-pink-600",
      delay: 0.2
    }
  ];

  return (
    <section className="py-16 px-4 bg-white/5">
      <div className="container mx-auto">
        <div className="grid md:grid-cols-3 gap-8">
          {featureItems.map((item, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: item.delay }}
              className="text-center"
            >
              <div className={`${item.bg} p-4 rounded-full w-16 h-16 mx-auto mb-4 flex items-center justify-center`}>
                {item.icon}
              </div>
              <h3 className="text-xl font-bold text-white mb-2">{item.title}</h3>
              <p className="text-blue-200">{item.description}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};