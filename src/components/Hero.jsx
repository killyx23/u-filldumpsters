import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/customSupabaseClient';
import { Loader2, AlertCircle } from 'lucide-react';
import { fetchHomepageServices, getHeroStaticFallback } from '@/utils/servicePlan';

const ServiceCard = ({
  name,
  delay,
  id,
  onClick
}) => {
  // Common visual layout for ID 1 (16 Yard Dumpster), ID 2 (Dump Loader Trailer), and ID 3 (Rock Mulch and Gravel)
  let imageUrl = "";
  if (id === 1) {
    imageUrl = "https://horizons-cdn.hostinger.com/cea2470f-97d4-49f4-bb80-a5f3b466837f/ab93b9ab311fb0efb03f5a24f0c97ada.jpg";
  } else if (id === 2) {
    imageUrl = "https://horizons-cdn.hostinger.com/cea2470f-97d4-49f4-bb80-a5f3b466837f/71ba93b0b17b71051b7ab08600b18632.jpg";
  } else if (id === 3) {
    imageUrl = "https://horizons-cdn.hostinger.com/cea2470f-97d4-49f4-bb80-a5f3b466837f/d690552d16c0ca79c2f9b31cc3dd1aa0.png";
  } else if (id === 5) {
    imageUrl = "/images/diy-heavy-equipment.png";
  }
  
  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }} 
      animate={{ opacity: 1, y: 0 }} 
      transition={{ duration: 0.5, delay }} 
      onClick={() => onClick(id)} 
      className="bg-white/10 backdrop-blur-md rounded-xl shadow-lg border border-white/20 text-center flex flex-col h-full overflow-hidden group cursor-pointer"
    >
      <div className="w-full aspect-[16/10] overflow-hidden">
        <img 
          src={imageUrl} 
          alt={name} 
          className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" 
        />
      </div>
      <div className="p-8 flex flex-col items-center justify-center flex-grow">
        <h3 className="text-2xl font-bold text-yellow-400 leading-tight">
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

        let data = homepageResult.data?.map((s) => ({ id: s.id, name: s.name })) || [];

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
    const idMap = {
      1: '16-yard-dumpster',
      2: 'dump-loader-trailer',
      3: 'rock-mulch-gravel',
      5: 'mini-excavator',
    };
    const targetId = idMap[serviceId];
    if (!targetId) return;

    // Try finding the exact container by ID or data attribute
    let targetElement = document.getElementById(targetId) || document.querySelector(`[data-service-id="${targetId}"]`);

    // Fallback: search for headings containing the service name if explicit IDs are missing
    if (!targetElement) {
      const headings = Array.from(document.querySelectorAll('h3, h2'));
      const searchTexts = {
        1: '16 Yard Dumpster',
        2: 'Dump Loader Trailer',
        3: 'Rock Mulch',
        4: 'Mulch',
        5: 'Excavator',
      };
      const match = headings.find(h => h.textContent.includes(searchTexts[serviceId]) || h.textContent.includes('Decorative Rock'));
      if (match) {
        // Assume the parent wrapper is the card containing the book button
        targetElement = match.closest('.bg-white\\/10') || match.closest('div[class*="rounded"]') || match.parentElement;
      }
    }
    
    if (targetElement) {
      // Calculate offset to move the page down
      const elementRect = targetElement.getBoundingClientRect();
      const absoluteTop = elementRect.top + window.scrollY;

      // Reduced scroll offset by an additional 1/8 of the viewport height
      const offsetPosition = absoluteTop + window.innerHeight - window.innerHeight / 4 - window.innerHeight / 8;
      window.scrollTo({
        top: offsetPosition,
        behavior: 'smooth'
      });

      // Find the corresponding "Book Now" button and focus it
      setTimeout(() => {
        const buttons = Array.from(targetElement.querySelectorAll('button'));
        const bookBtn = buttons.find(b => b.textContent.toLowerCase().includes('book')) || buttons[0];
        if (bookBtn) {
          bookBtn.focus({ preventScroll: true });
        }
      }, 300);
    }
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