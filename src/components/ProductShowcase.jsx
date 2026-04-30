import React from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, Image as ImageIcon, ArrowDownCircle } from 'lucide-react';
import { motion } from 'framer-motion';

const ProductShowcase = ({ onOpenModal }) => {
  const services = [
    {
      id: "service-16-yard",
      title: "16-Yard Roll-Off",
      description: "Perfect for major renovations and construction.",
      capacity: "Up to 4 Tons",
      image: "https://horizons-cdn.hostinger.com/19eea40a-338e-4256-ae46-d1bf7f025b8d/1eb71dd14ce1c00f3ae44d87e8f75c40.jpg"
    },
    {
      id: "service-10-yard",
      title: "10-Yard Roll-Off",
      description: "Ideal for medium cleanouts and roofing projects.",
      capacity: "Up to 2 Tons",
      image: "https://horizons-cdn.hostinger.com/19eea40a-338e-4256-ae46-d1bf7f025b8d/1eb71dd14ce1c00f3ae44d87e8f75c40.jpg"
    },
    {
      id: "service-6-yard",
      title: "6-Yard Roll-Off",
      description: "Great for small yard waste or garage cleanups.",
      capacity: "Up to 1 Ton",
      image: "https://horizons-cdn.hostinger.com/19eea40a-338e-4256-ae46-d1bf7f025b8d/1eb71dd14ce1c00f3ae44d87e8f75c40.jpg"
    }
  ];

  const handleScrollToService = (id) => {
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' });
    }
  };

  return (
    <div className="container mx-auto px-4 py-12">
      <div className="text-center mb-10">
        <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">Our Dumpster Sizes</h2>
        <p className="text-muted-foreground text-lg">Click on a dumpster to view its booking details</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {services.map((service, index) => (
          <motion.div
            key={service.id}
            id={`showcase-${service.id}`}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: index * 0.1 }}
          >
            <Card 
              className="bg-card border-border shadow-lg overflow-hidden cursor-pointer hover:shadow-2xl transition-all duration-300 hover:-translate-y-2 group"
              onClick={() => handleScrollToService(service.id)}
            >
              <CardHeader className="bg-primary text-primary-foreground text-center py-4 transition-colors group-hover:bg-primary/90">
                <CardTitle className="text-2xl font-bold">
                  {service.title}
                </CardTitle>
                <Badge variant="secondary" className="mt-2 text-sm bg-secondary text-secondary-foreground">
                  {service.capacity}
                </Badge>
              </CardHeader>
              
              <CardContent className="p-6 bg-card text-card-foreground">
                <div className="relative rounded-lg overflow-hidden shadow-md border border-border mb-6">
                  <img 
                    src={service.image} 
                    alt={service.title}
                    className="w-full h-48 object-cover transition-transform duration-500 group-hover:scale-110"
                  />
                  <div className="absolute inset-0 bg-primary/0 group-hover:bg-primary/20 transition-colors duration-300 flex items-center justify-center">
                    <div className="bg-background/90 text-foreground rounded-full p-4 opacity-0 group-hover:opacity-100 transition-opacity duration-300 transform scale-50 group-hover:scale-100 flex items-center gap-2 font-semibold shadow-lg">
                      <ArrowDownCircle className="h-5 w-5 text-primary" />
                      Book Now
                    </div>
                  </div>
                </div>

                <div className="text-center">
                  <p className="text-muted-foreground mb-4 h-12">
                    {service.description}
                  </p>
                  <Button 
                    variant="outline"
                    className="w-full group-hover:bg-primary group-hover:text-primary-foreground transition-colors"
                  >
                    View Details & Book
                  </Button>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>
    </div>
  );
};

export default ProductShowcase;