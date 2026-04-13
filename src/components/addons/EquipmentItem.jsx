
import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Minus, Plus, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const handTruckImages = [
  "https://horizons-cdn.hostinger.com/fd437a4e-c58b-43b8-bbf1-15b6bcb2f2a7/438c04aacba2716be43c830e350b5eb6.jpg",
  "https://horizons-cdn.hostinger.com/fd437a4e-c58b-43b8-bbf1-15b6bcb2f2a7/86e98c2dc6d87e71b72926251853bc97.jpg",
  "https://horizons-cdn.hostinger.com/fd437a4e-c58b-43b8-bbf1-15b6bcb2f2a7/32442900188c66551491ad9c3a07a680.jpg",
  "https://horizons-cdn.hostinger.com/fd437a4e-c58b-43b8-bbf1-15b6bcb2f2a7/38ccd7fd464955d1c8cd2c74e3c81ac1.jpg",
  "https://horizons-cdn.hostinger.com/fd437a4e-c58b-43b8-bbf1-15b6bcb2f2a7/d8ad679fd9727d4de60d63303ee3c773.jpg",
  "https://horizons-cdn.hostinger.com/fd437a4e-c58b-43b8-bbf1-15b6bcb2f2a7/814730697e17b8d9b311c32ddf45da75.jpg"
];

const handTruckFeatures = [
  "3-in-1 Convertible Design: Quickly switch between two-wheel climbing upright, four-wheel 45° tilt, and four-wheel dolly modes without tools",
  "1000 LBS Heavy-Duty Capacity: High-strength aluminum alloy frame for transporting appliances, furniture, and large boxes",
  "6 Rubber Wheels: Superior traction on stairs and uneven terrain (grass, pebbles, cement, brick roads)",
  "Expandable U-Shaped Ring: Extends to carry larger, heavier items with even weight distribution",
  "Versatile Use: Perfect for hauling heavy appliances, furniture, or maneuvering bulky furniture up stairs. This 3-in-1 powerhouse adapts to any job site and is also great for moving any heavy items to the trash."
];

export const EquipmentItem = ({ id, label, price, icon, hasQuantitySelector, quantity, onQuantityChange, available }) => {
    const isAvailable = available > 0;
    const canAddMore = available > quantity;
    const isHandTruck = label === 'Hand Truck' || label.includes('Hand Truck');

    const [isModalOpen, setIsModalOpen] = useState(false);
    const [currentImageIndex, setCurrentImageIndex] = useState(0);

    const openModal = () => setIsModalOpen(true);
    const closeModal = () => setIsModalOpen(false);

    const nextImage = (e) => {
        e.stopPropagation();
        setCurrentImageIndex((prev) => (prev + 1) % handTruckImages.length);
    };

    const prevImage = (e) => {
        e.stopPropagation();
        setCurrentImageIndex((prev) => (prev - 1 + handTruckImages.length) % handTruckImages.length);
    };

    const addButton = (
        <Button size="sm" variant={quantity > 0 ? "destructive" : "secondary"} onClick={() => onQuantityChange(quantity > 0 ? 0 : 1)} disabled={!isAvailable && quantity === 0}>
            {quantity > 0 ? 'Remove' : (isAvailable ? 'Add' : 'Out of Stock')}
        </Button>
    );

    return (
        <>
            <div className="flex items-center p-3 bg-white/10 rounded-lg">
                <div className="p-2 text-white">
                    {icon}
                </div>
                
                <span className="ml-3 text-white flex-grow flex items-center gap-3">
                    {label}
                    {isHandTruck && (
                        <img 
                            src="https://horizons-cdn.hostinger.com/fd437a4e-c58b-43b8-bbf1-15b6bcb2f2a7/c6beec9aa845d4853f814902b0574010.jpg"
                            alt="View Hand Truck Details"
                            className="w-12 h-8 object-cover rounded cursor-pointer transition-transform duration-200 hover:scale-110 shadow-sm border border-white/20"
                            onClick={openModal}
                            title="Click to view hand truck details"
                        />
                    )}
                </span>
                
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
                    <>
                        <span className="font-semibold text-green-400 mr-4">+${price.toFixed(2)}</span>
                        {!isAvailable && quantity === 0 ? (
                            <TooltipProvider>
                                <Tooltip>
                                    <TooltipTrigger asChild><span tabIndex={0}>{addButton}</span></TooltipTrigger>
                                    <TooltipContent><p>This item is temporarily out of stock.</p></TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                        ) : addButton}
                    </>
                )}
            </div>

            <AnimatePresence>
                {isModalOpen && isHandTruck && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6" style={{ backgroundColor: 'rgba(0, 0, 0, 0.8)' }}>
                        <motion.div 
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            className="absolute inset-0"
                            onClick={closeModal}
                        />
                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: 20 }}
                            className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto relative z-10 flex flex-col"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="flex justify-between items-center p-4 border-b border-gray-100">
                                <h3 className="text-xl font-bold text-gray-900">{label} Details</h3>
                                <Button variant="ghost" size="icon" onClick={closeModal} className="text-gray-500 hover:text-gray-900 hover:bg-gray-100">
                                    <X className="h-5 w-5" />
                                </Button>
                            </div>
                            
                            <div className="p-4 sm:p-6">
                                <div className="relative bg-gray-100 rounded-lg overflow-hidden flex items-center justify-center aspect-[4/3] sm:aspect-[16/9] group">
                                    <AnimatePresence mode="wait">
                                        <motion.img
                                            key={currentImageIndex}
                                            src={handTruckImages[currentImageIndex]}
                                            alt={`Hand Truck Image ${currentImageIndex + 1}`}
                                            className="max-h-full max-w-full object-contain"
                                            initial={{ opacity: 0 }}
                                            animate={{ opacity: 1 }}
                                            exit={{ opacity: 0 }}
                                            transition={{ duration: 0.2 }}
                                        />
                                    </AnimatePresence>
                                    
                                    <Button 
                                        variant="secondary" 
                                        size="icon" 
                                        className="absolute left-2 top-1/2 -translate-y-1/2 opacity-70 hover:opacity-100 bg-white/90 text-gray-900"
                                        onClick={prevImage}
                                    >
                                        <ChevronLeft className="h-6 w-6" />
                                    </Button>
                                    <Button 
                                        variant="secondary" 
                                        size="icon" 
                                        className="absolute right-2 top-1/2 -translate-y-1/2 opacity-70 hover:opacity-100 bg-white/90 text-gray-900"
                                        onClick={nextImage}
                                    >
                                        <ChevronRight className="h-6 w-6" />
                                    </Button>
                                </div>
                                <div className="text-center text-sm text-gray-500 mt-3 font-medium">
                                    Image {currentImageIndex + 1} of {handTruckImages.length}
                                </div>

                                <div className="mt-6">
                                    <h4 className="text-lg font-bold text-gray-900 mb-3">Key Features:</h4>
                                    <ul className="space-y-2 text-gray-700 text-sm sm:text-base">
                                        {handTruckFeatures.map((feature, index) => {
                                            const [title, description] = feature.split(': ');
                                            return (
                                                <li key={index} className="flex items-start">
                                                    <span className="text-blue-500 mr-2 mt-1">•</span>
                                                    <span>
                                                        <strong className="text-gray-900">{title}: </strong>
                                                        {description}
                                                    </span>
                                                </li>
                                            );
                                        })}
                                    </ul>
                                </div>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </>
    );
};
