import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Minus, Plus, ChevronLeft, ChevronRight, Info, Package } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const handTruckImages = [
  "https://horizons-cdn.hostinger.com/19eea40a-338e-4256-ae46-d1bf7f025b8d/438c04aacba2716be43c830e350b5eb6.jpg",
  "https://horizons-cdn.hostinger.com/19eea40a-338e-4256-ae46-d1bf7f025b8d/86e98c2dc6d87e71b72926251853bc97.jpg",
  "https://horizons-cdn.hostinger.com/19eea40a-338e-4256-ae46-d1bf7f025b8d/32442900188c66551491ad9c3a07a680.jpg",
  "https://horizons-cdn.hostinger.com/19eea40a-338e-4256-ae46-d1bf7f025b8d/38ccd7fd464955d1c8cd2c74e3c81ac1.jpg",
  "https://horizons-cdn.hostinger.com/19eea40a-338e-4256-ae46-d1bf7f025b8d/d8ad679fd9727d4de60d63303ee3c773.jpg",
  "https://horizons-cdn.hostinger.com/19eea40a-338e-4256-ae46-d1bf7f025b8d/814730697e17b8d9b311c32ddf45da75.jpg"
];

const handTruckFeatures = [
  "3-in-1 Convertible Design: Quickly switch between two-wheel climbing upright, four-wheel 45° tilt, and four-wheel dolly modes without tools",
  "1000 LBS Heavy-Duty Capacity: High-strength aluminum alloy frame for transporting appliances, furniture, and large boxes",
  "6 Rubber Wheels: Superior traction on stairs and uneven terrain (grass, pebbles, cement, brick roads)",
  "Expandable U-Shaped Ring: Extends to carry larger, heavier items with even weight distribution",
  "Versatile Use: Perfect for hauling heavy appliances, furniture, or maneuvering bulky furniture up stairs. This 3-in-1 powerhouse adapts to any job site and is also great for moving any heavy items to the trash."
];

const gorillaImages = [
  "https://horizons-cdn.hostinger.com/19eea40a-338e-4256-ae46-d1bf7f025b8d/bf76a0fe48c0067c3d5cf8111f67bb6e.jpg",
  "https://horizons-cdn.hostinger.com/19eea40a-338e-4256-ae46-d1bf7f025b8d/1b47df06cca424854ef628599b7724ed.jpg",
  "https://horizons-cdn.hostinger.com/19eea40a-338e-4256-ae46-d1bf7f025b8d/3f278af24cb7e75e4fd71de66f75df17.jpg",
  "https://horizons-cdn.hostinger.com/19eea40a-338e-4256-ae46-d1bf7f025b8d/b5178280ff3c8203532f253ccdf125ea.jpg",
  "https://horizons-cdn.hostinger.com/19eea40a-338e-4256-ae46-d1bf7f025b8d/8c7d92ee5ec7d1aa3cd25a1cf6961f7b.jpg",
  "https://horizons-cdn.hostinger.com/19eea40a-338e-4256-ae46-d1bf7f025b8d/2b5135e077b05c73e5d3a26b79796310.jpg",
  "https://horizons-cdn.hostinger.com/19eea40a-338e-4256-ae46-d1bf7f025b8d/a0818a449711b9c10b3e121797bb3a7e.jpg",
  "https://horizons-cdn.hostinger.com/19eea40a-338e-4256-ae46-d1bf7f025b8d/b4265b04e3d99c0b792667f7b8fcba8f.jpg",
  "https://horizons-cdn.hostinger.com/19eea40a-338e-4256-ae46-d1bf7f025b8d/27e96171270f4792935dea32a3123abc.jpg"
];

const gorillaFeatures = [
  "1,500 lb. Heavy Duty Capacity - Perfect for moving heavy items, rocks, soil, or debris from the yard or job site",
  "Patented Quick-Release Dumping System - Allows unloading with ease",
  "Innovative Steel Frame Design - Reduces assembly time while offering improved maneuverability",
  "Easy to Maneuver - Tight-turning steering for better control",
  "Huge Heavy-Duty Rust-Resistant Poly Bed - Durable construction",
  "Patented 2-in-1 Handle - Allows cart to be towed behind a lawn tractor or ATV or pulled by hand",
  "16″ Pneumatic Tires - To haul heavy loads"
];

const gorillaSpecs = [
  { label: "Product Dimensions", value: "55.2\"D x 32.5\"W x 30.2\"H" },
  { label: "Brand", value: "Gorilla Carts" },
  { label: "Material", value: "Steel, heavy-duty poly, and pneumatic turf tires" },
  { label: "Color", value: "Black" },
  { label: "Special Feature", value: "Durable" }
];

// Shared modal component for both Gorilla Cart and Hand Truck
const SharedProductModal = ({ isOpen, onClose, title, images, features, specifications, videoId, videoStart = 0, showVideo = true }) => {
  const [imageIndex, setImageIndex] = useState(0);

  const handleNext = () => setImageIndex((prev) => (prev + 1) % images.length);
  const handlePrev = () => setImageIndex((prev) => (prev - 1 + images.length) % images.length);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl bg-white text-slate-900 border-border max-h-[90vh] overflow-y-auto overflow-x-hidden p-0 shadow-2xl">
        <DialogHeader className="p-6 pb-2 sticky top-0 z-10 bg-white/95 backdrop-blur-sm border-b border-slate-100 text-center">
          <DialogTitle className="text-2xl md:text-3xl font-extrabold text-slate-900">
            {title}
          </DialogTitle>
        </DialogHeader>

        <div className="p-6 space-y-8 flex flex-col items-center">
          {/* Responsive & Centered Video Section */}
          {showVideo && (
            <div className="w-full max-w-2xl mx-auto">
              <div className="aspect-video w-full overflow-hidden rounded-xl shadow-lg bg-black">
                <iframe
                  className="w-full h-full"
                  src={`https://www.youtube.com/embed/${videoId}?autoplay=1&mute=1&loop=1&playlist=${videoId}&start=${videoStart}`}
                  title={`${title} Showcase Video`}
                  frameBorder="0"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                ></iframe>
              </div>
            </div>
          )}

          {/* Centered Image Gallery */}
          <div className="w-full max-w-2xl mx-auto space-y-6">
            <div className="relative aspect-video rounded-xl overflow-hidden border border-slate-200 bg-slate-50 group">
              <AnimatePresence mode="wait">
                <motion.img
                  key={imageIndex}
                  src={images[imageIndex]}
                  alt={`${title} Gallery Image ${imageIndex + 1}`}
                  className="w-full h-full object-contain"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                />
              </AnimatePresence>
              
              <Button 
                variant="secondary" 
                size="icon" 
                className="absolute left-3 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity bg-white/90 hover:bg-white text-slate-900 shadow-md"
                onClick={handlePrev}
              >
                <ChevronLeft className="h-5 w-5" />
              </Button>
              <Button 
                variant="secondary" 
                size="icon" 
                className="absolute right-3 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity bg-white/90 hover:bg-white text-slate-900 shadow-md"
                onClick={handleNext}
              >
                <ChevronRight className="h-5 w-5" />
              </Button>
            </div>

            {/* Thumbnail Strip - Centered and Wrapped (No horizontal scroll) */}
            <div className="flex flex-wrap justify-center gap-3">
              {images.map((img, idx) => (
                <button 
                  key={idx} 
                  onClick={() => setImageIndex(idx)} 
                  className={`flex-shrink-0 w-20 h-16 sm:w-24 sm:h-20 rounded-lg overflow-hidden border-2 transition-all ${
                    idx === imageIndex 
                      ? 'border-blue-600 ring-2 ring-blue-600/20 ring-offset-1' 
                      : 'border-slate-200 hover:border-blue-400 opacity-70 hover:opacity-100'
                  }`}
                >
                  <img src={img} className="w-full h-full object-cover" alt={`Thumbnail ${idx + 1}`} />
                </button>
              ))}
            </div>
          </div>

          {/* Centered Features Description */}
          <div className="w-full max-w-3xl mx-auto bg-slate-50 p-6 rounded-xl border border-slate-100">
            <h3 className="text-xl font-bold mb-4 text-slate-900 flex items-center justify-center gap-2">
              <Info className="h-5 w-5 text-blue-600" />
              Key Features
            </h3>
            <ul className="grid md:grid-cols-2 gap-4">
              {features.map((feat, idx) => (
                <li key={idx} className="flex items-start gap-3 text-slate-700">
                  <div className="mt-2 h-1.5 w-1.5 rounded-full bg-blue-600 flex-shrink-0" />
                  <span className="leading-relaxed text-sm sm:text-base">{feat}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Specifications Section */}
          {specifications && specifications.length > 0 && (
            <div className="w-full max-w-3xl mx-auto bg-slate-50 p-6 rounded-xl border border-slate-100">
              <h3 className="text-xl font-bold mb-4 text-slate-900 flex items-center justify-center gap-2">
                <Package className="h-5 w-5 text-blue-600" />
                Specifications
              </h3>
              <div className="space-y-3">
                {specifications.map((spec, idx) => (
                  <div key={idx} className="flex items-start justify-between gap-4 py-2 border-b border-slate-200 last:border-0">
                    <span className="font-semibold text-slate-900 text-sm sm:text-base">{spec.label}:</span>
                    <span className="text-slate-700 text-sm sm:text-base text-right">{spec.value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export const EquipmentItem = ({ id, label, price, icon, hasQuantitySelector, quantity, onQuantityChange, available }) => {
    const isAvailable = available > 0;
    const canAddMore = available > quantity;
    
    // Categorize item types
    const isGorillaCart = label === 'Wheelbarrow' || label.includes('Gorilla') || label.includes('Dump Cart');
    const isHandTruck = label === 'Hand Truck' || label.includes('Hand Truck') || label.includes('3-in-1');
    const isInteractive = isGorillaCart || isHandTruck;
    
    // Set appropriate display label
    let displayLabel = label;
    if (isGorillaCart) displayLabel = 'Gorilla Heavy-Duty Dump Cart';
    if (isHandTruck) displayLabel = '3-in-1 Convertible Hand Truck';

    const [isModalOpen, setIsModalOpen] = useState(false);

    const handleItemClick = () => {
        if (isInteractive) {
            setIsModalOpen(true);
        }
    };

    // Calculate item total: price × quantity
    const itemTotal = Number(price) * Number(quantity);

    const addButton = (
        <Button size="sm" variant={quantity > 0 ? "destructive" : "secondary"} onClick={() => onQuantityChange(quantity > 0 ? 0 : 1)} disabled={!isAvailable && quantity === 0}>
            {quantity > 0 ? 'Remove' : (isAvailable ? 'Add' : 'Out of Stock')}
        </Button>
    );

    return (
        <>
            <div 
                className={`flex items-center p-3 bg-white/10 rounded-lg transition-all duration-300 ${
                    isInteractive ? 'cursor-pointer hover:bg-white/20 hover:shadow-lg border border-transparent hover:border-white/20' : ''
                }`}
                onClick={handleItemClick}
            >
                <div className="p-2 text-white">
                    {icon}
                </div>
                
                <div className="ml-3 text-white flex-grow flex items-center flex-wrap gap-3">
                    <span className="font-medium">{displayLabel}</span>
                    
                    {isInteractive && (
                        <span className="text-[10px] uppercase tracking-wider bg-blue-600/80 text-white px-2 py-0.5 rounded-full font-bold animate-pulse shadow-sm">
                            Click for Details
                        </span>
                    )}
                </div>
                
                <div onClick={(e) => e.stopPropagation()} className="flex items-center shrink-0 ml-4">
                    {hasQuantitySelector ? (
                        <div className="flex items-center gap-2">
                            <Button size="icon" variant="ghost" className="h-8 w-8 text-white hover:bg-white/20" onClick={() => onQuantityChange(Math.max(0, quantity - 1))}>
                                <Minus className="h-4 w-4" />
                            </Button>
                            <span className="font-bold text-lg text-white w-8 text-center">{quantity}</span>
                            <TooltipProvider>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <span tabIndex={0}>
                                            <Button size="icon" variant="ghost" className="h-8 w-8 text-white hover:bg-white/20" onClick={() => onQuantityChange(quantity + 1)} disabled={!canAddMore}>
                                                <Plus className="h-4 w-4" />
                                            </Button>
                                        </span>
                                    </TooltipTrigger>
                                    {!canAddMore && <TooltipContent><p>No more available.</p></TooltipContent>}
                                </Tooltip>
                            </TooltipProvider>
                        </div>
                    ) : (
                        <div className="flex items-center gap-4">
                            <span className="font-semibold text-green-400">
                                {quantity > 0 ? `$${itemTotal.toFixed(2)}` : `+$${Number(price).toFixed(2)}`}
                            </span>
                            {!isAvailable && quantity === 0 ? (
                                <TooltipProvider>
                                    <Tooltip>
                                        <TooltipTrigger asChild><span tabIndex={0}>{addButton}</span></TooltipTrigger>
                                        <TooltipContent><p>This item is temporarily out of stock.</p></TooltipContent>
                                    </Tooltip>
                                </TooltipProvider>
                            ) : addButton}
                        </div>
                    )}
                </div>
            </div>

            {/* Dynamic Modal rendering based on item type */}
            {isInteractive && (
                <SharedProductModal 
                    isOpen={isModalOpen} 
                    onClose={() => setIsModalOpen(false)}
                    title={displayLabel}
                    images={isGorillaCart ? gorillaImages : handTruckImages}
                    features={isGorillaCart ? gorillaFeatures : handTruckFeatures}
                    specifications={isGorillaCart ? gorillaSpecs : null}
                    videoId="7CZB55q6H3k"
                    videoStart={isGorillaCart ? 23 : 0}
                    showVideo={isGorillaCart}
                />
            )}
        </>
    );
};