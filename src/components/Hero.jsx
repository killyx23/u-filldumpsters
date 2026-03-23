
import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/customSupabaseClient';
import { Loader2 } from 'lucide-react';
import { formatISO } from 'date-fns';

const ServiceCard = ({ name, price, unit, description, delay }) => (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.5, delay }}
    className="bg-white/10 backdrop-blur-md p-8 rounded-xl shadow-lg border border-white/20 text-center flex flex-col h-full"
  >
    <h3 className="text-2xl font-bold text-yellow-400 mb-2">{name}</h3>
    <div className="flex-grow flex flex-col justify-center">
      <p className="text-4xl font-bold my-4 text-white">
        ${price}<span className="text-xl font-normal text-blue-200">{unit}</span>
      </p>
      <p className="text-blue-100 leading-relaxed">{description}</p>
    </div>
  </motion.div>
);

export const Hero = () => {
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchServices = async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from('services')
          .select('id, name, base_price, price_unit, homepage_description')
          .in('id', [1, 2, 3])
          .order('id');
        
        if (error) {
          console.error('Error fetching services:', error);
        } else {
          setServices(data);
        }
      } catch (err) {
        console.error('Unexpected error fetching services:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchServices();
  }, []);

  return (
    <section className="py-24 text-center relative overflow-hidden min-h-[80vh] flex items-center">
      <div className="absolute inset-0 bg-gradient-to-b from-blue-900/40 to-transparent z-0"></div>
      
      <div className="container mx-auto px-4 relative z-10">
        <div className="max-w-4xl mx-auto mb-16">
          <motion.h1
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="text-5xl md:text-7xl font-extrabold mb-6 tracking-tight text-white"
          >
            Your Project, Our Priority
          </motion.h1>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="text-xl md:text-2xl text-blue-100 max-w-2xl mx-auto leading-relaxed"
          >
            Fast, reliable, and affordable dumpster and equipment rentals. Book online in minutes and get same-day service.
          </motion.p>
        </div>

        {loading ? (
          <div className="flex justify-center items-center h-64">
            <Loader2 className="h-12 w-12 animate-spin text-yellow-400" />
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 max-w-6xl mx-auto">
            {services.map((service, index) => (
              <ServiceCard
                key={service.id}
                name={service.name}
                price={service.base_price}
                unit={service.price_unit}
                description={service.homepage_description}
                delay={0.4 + index * 0.15}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
};
