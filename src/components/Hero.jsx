import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/customSupabaseClient';
import { Loader2 } from 'lucide-react';

const ServiceCard = ({ name, price, unit, description, delay }) => (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.5, delay }}
    className="bg-white/10 backdrop-blur-md p-6 rounded-xl shadow-lg border border-white/20 text-center"
  >
    <h3 className="text-2xl font-bold text-yellow-400">{name}</h3>
    <p className="text-4xl font-bold my-4">
      ${price}<span className="text-xl font-normal text-blue-200">{unit}</span>
    </p>
    <p className="text-blue-200">{description}</p>
  </motion.div>
);

export const Hero = () => {
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchServices = async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('services')
        .select('name, homepage_price, homepage_price_unit, homepage_description')
        .order('id');
      
      if (error) {
        console.error('Error fetching services:', error);
      } else {
        setServices(data);
      }
      setLoading(false);
    };

    fetchServices();
  }, []);

  return (
    <section className="py-20 text-center relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-t from-blue-900 to-transparent z-0"></div>
      <div className="container mx-auto px-4 relative z-10">
        <motion.h1
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="text-5xl md:text-7xl font-extrabold mb-4 tracking-tight"
        >
          Your Project, Our Priority
        </motion.h1>
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="text-xl md:text-2xl text-blue-200 max-w-3xl mx-auto mb-12"
        >
          Fast, reliable, and affordable dumpster and equipment rentals. Book online in minutes and get same-day service.
        </motion.p>

        {loading ? (
          <div className="flex justify-center items-center h-48">
            <Loader2 className="h-12 w-12 animate-spin text-yellow-400" />
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-4xl mx-auto">
            {services.map((service, index) => (
              <ServiceCard
                key={service.name}
                name={service.name}
                price={service.homepage_price}
                unit={service.homepage_price_unit}
                description={service.homepage_description}
                delay={0.4 + index * 0.2}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
};