import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/customSupabaseClient';
import { Loader2 } from 'lucide-react';

const ServiceCard = ({ name, delay, id, onClick }) => {
  // Common visual layout for ID 1 (16 Yard Dumpster), ID 2 (Dump Loader Trailer), and ID 3 (Rock Mulch and Gravel)
  let imageUrl = "";
  if (id === 1) {
    imageUrl = "https://horizons-cdn.hostinger.com/fd437a4e-c58b-43b8-bbf1-15b6bcb2f2a7/ab93b9ab311fb0efb03f5a24f0c97ada.jpg";
  } else if (id === 2) {
    imageUrl = "https://horizons-cdn.hostinger.com/fd437a4e-c58b-43b8-bbf1-15b6bcb2f2a7/71ba93b0b17b71051b7ab08600b18632.jpg";
  } else if (id === 3) {
    imageUrl = "https://horizons-cdn.hostinger.com/fd437a4e-c58b-43b8-bbf1-15b6bcb2f2a7/d690552d16c0ca79c2f9b31cc3dd1aa0.png";
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

  useEffect(() => {
    const fetchServices = async () => {
      setLoading(true);
      try {
        // Fetching IDs 1, 2, and 3 for the homepage grid
        const { data, error } = await supabase
          .from('services')
          .select('id, name')
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

  const scrollToService = (serviceId) => {
    const idMap = {
      1: '16-yard-dumpster',
      2: 'dump-loader-trailer',
      3: 'rock-mulch-gravel'
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
        4: 'Mulch'
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
      
      // Task 1: Reduced scroll offset by an additional 1/8 of the viewport height (window.innerHeight / 8)
      // Original was: absoluteTop + window.innerHeight - (window.innerHeight / 4);
      // New offset positions the section 1/8 page higher:
      const offsetPosition = absoluteTop + window.innerHeight - (window.innerHeight / 4) - (window.innerHeight / 8);

      window.scrollTo({
        top: offsetPosition,
        behavior: 'smooth'
      });

      // Find the corresponding "Book Now" button within the target and focus it.
      // Timeout ensures the smooth scroll begins before the focus event happens, 
      // preventing browsers from snapping immediately to the focused element.
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
                id={service.id}
                name={service.id === 3 ? "Rock, Decorative Rock, Mulch, & Gravel Delivery Service" : service.name}
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