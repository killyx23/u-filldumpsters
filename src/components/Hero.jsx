import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/customSupabaseClient';
import { Loader2, AlertCircle } from 'lucide-react';
import { fetchHomepageServices, getHeroStaticFallback } from '@/utils/servicePlan';
import { DIY_HOMEPAGE_DISPLAY_NAME } from '@/config/diyEquipmentMachines';
import { getHeroImageForService } from '@/config/siteImages';

const ServiceCard = ({
  name,
  delay,
  id,
  onClick
}) => {
  const numericId = Number(id);
  const imageUrl = getHeroImageForService(numericId);

  const handleActivate = () => onClick(numericId);
  
  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }} 
      animate={{ opacity: 1, y: 0 }} 
      transition={{ duration: 0.5, delay }} 
      onClick={handleActivate}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleActivate();
        }
      }}
      role="button"
      tabIndex={0}
      aria-label={`View ${name} pricing and book`}
      className="bg-white/10 backdrop-blur-md rounded-xl shadow-lg border border-white/20 text-center flex flex-col h-full overflow-hidden group cursor-pointer hover:border-yellow-400/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400"
    >
      <div className="w-full aspect-[16/10] overflow-hidden">
        <img 
          src={imageUrl} 
          alt={name} 
          className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105 pointer-events-none" 
        />
      </div>
      <div className="p-8 flex flex-col items-center justify-center flex-grow">
        <h3 className="text-2xl font-bold text-yellow-400 leading-tight group-hover:underline underline-offset-4">
          {name}
        </h3>
      </div>
    </motion.div>
  );
};

export const Hero = () => {
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchServices = async () => {
      setLoading(true);
      setError(null);
      
      try {
        console.log('[Hero] 🔄 Initiating fetch from Supabase');
        console.log('[Hero] Supabase client status:', supabase ? '✓ Initialized' : '✗ Not initialized');
        
        // Test basic connection first
        const { data: testData, error: testError } = await supabase
          .from('services')
          .select('id')
          .limit(1);
        
        if (testError) {
          console.error('[Hero] ✗ Connection test failed:', testError);
          throw new Error(`Connection test failed: ${testError.message}`);
        }
        
        console.log('[Hero] ✓ Connection test successful');
        
        const homepageResult = await fetchHomepageServices(supabase);

        if (homepageResult.error) {
          console.error('[Hero] ✗ Fetch error:', homepageResult.error);
          throw homepageResult.error;
        }

        let data =
          homepageResult.data?.map((s) => ({
            id: s.id,
            // Keep DIY category label on hero even after service 5 is Mini Excavator in DB
            name: Number(s.id) === 5 ? DIY_HOMEPAGE_DISPLAY_NAME : s.name,
          })) || [];

        if (data.length === 0) {
          console.warn('[Hero] No services from DB; using static fallback');
          data = getHeroStaticFallback();
        }

        console.log('[Hero] ✓ Fetched services:', data.length);
        setServices(data);
        
      } catch (err) {
        console.error('[Hero] ✗ Fatal error:', err);
        setError(err.message);
        setServices(getHeroStaticFallback());
      } finally {
        setLoading(false);
      }
    };
    
    fetchServices();
  }, []);

  const scrollToService = serviceId => {
    const numericId = Number(serviceId);
    if (!Number.isFinite(numericId)) return;

    // PlanCard sets data-service-id to the numeric service id
    let targetElement = document.querySelector(`[data-service-id="${numericId}"]`);

    // Fallback: match plan card headings by service name
    if (!targetElement) {
      const headings = Array.from(document.querySelectorAll('h3, h2'));
      const searchTexts = {
        1: '16 Yard Dumpster',
        2: 'Dump Loader Trailer',
        3: 'Rock, Mulch',
        5: DIY_HOMEPAGE_DISPLAY_NAME,
      };
      const needle = searchTexts[numericId];
      const match = needle
        ? headings.find((h) => h.textContent.includes(needle))
        : null;
      if (match) {
        targetElement =
          match.closest('[data-service-id]') ||
          match.closest('div[class*="rounded"]') ||
          match.parentElement;
      }
    }

    if (!targetElement) {
      document.getElementById('choose-your-service')?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
      return;
    }

    const headerOffset = 96;
    const absoluteTop = targetElement.getBoundingClientRect().top + window.scrollY;
    window.scrollTo({
      top: Math.max(0, absoluteTop - headerOffset),
      behavior: 'smooth',
    });

    targetElement.classList.add('ring-2', 'ring-yellow-400', 'ring-offset-2', 'ring-offset-slate-900');
    window.setTimeout(() => {
      targetElement.classList.remove('ring-2', 'ring-yellow-400', 'ring-offset-2', 'ring-offset-slate-900');
    }, 1600);

    window.setTimeout(() => {
      const buttons = Array.from(targetElement.querySelectorAll('button'));
      const bookBtn =
        buttons.find((b) => b.textContent.toLowerCase().includes('book')) || buttons[0];
      if (bookBtn) {
        bookBtn.focus({ preventScroll: true });
      }
    }, 400);
  };

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
            Fast, reliable, and affordable dumpsters and equipment rentals. Book online in minutes and enjoy seamless, professional delivery tailored to your project schedule.
          </motion.p>
        </div>

        {loading ? (
          <div className="flex justify-center items-center h-64">
            <Loader2 className="h-12 w-12 animate-spin text-yellow-400" />
          </div>
        ) : error ? (
          <div className="flex flex-col justify-center items-center h-64">
            <AlertCircle className="h-12 w-12 text-yellow-400 mb-4" />
            <p className="text-blue-200">Showing default services</p>
          </div>
        ) : (
          <div className={`grid grid-cols-1 md:grid-cols-2 ${services.length >= 4 ? 'lg:grid-cols-4' : 'lg:grid-cols-3'} gap-8 max-w-6xl mx-auto`}>
            {services.map((service, index) => (
              <ServiceCard 
                key={service.id} 
                id={service.id} 
                name={service.name} 
                delay={0.4 + index * 0.15} 
                onClick={scrollToService} 
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
};