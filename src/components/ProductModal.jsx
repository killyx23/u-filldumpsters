
import React, { useState } from 'react';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { motion, AnimatePresence } from 'framer-motion';
import { Card } from '@/components/ui/card';

const ProductModal = ({ isOpen, onClose }) => {
  const [currentImageIndex, setCurrentImageIndex] = useState(0);

  const productImages = [
    {
      url: "https://horizons-cdn.hostinger.com/084723fe-37cf-40b6-bc10-548f6485382e/1eb71dd14ce1c00f3ae44d87e8f75c40.jpg",
      title: "Feature Diagram"
    },
    {
      url: "https://horizons-cdn.hostinger.com/084723fe-37cf-40b6-bc10-548f6485382e/2873b0d0a82a61c4a19b11ff87b0d54c.jpg",
      title: "Side View"
    },
    {
      url: "https://horizons-cdn.hostinger.com/084723fe-37cf-40b6-bc10-548f6485382e/51c03cb59f65a3a6de7e2c0cea6cd0a1.jpg",
      title: "Full Cart View"
    },
    {
      url: "https://horizons-cdn.hostinger.com/084723fe-37cf-40b6-bc10-548f6485382e/5b3a6c7df3e8e054e99ea5c91fefff17.jpg",
      title: "Loaded Cart"
    },
    {
      url: "https://horizons-cdn.hostinger.com/084723fe-37cf-40b6-bc10-548f6485382e/606a27ef6d5ac3f6a4be89ca68aaa94d.jpg",
      title: "Dumping Action"
    },
    {
      url: "https://horizons-cdn.hostinger.com/084723fe-37cf-40b6-bc10-548f6485382e/7b85d85c6fd89eaed3a5a0db42e8dc7a.jpg",
      title: "Detail Shot"
    },
    {
      url: "https://horizons-cdn.hostinger.com/084723fe-37cf-40b6-bc10-548f6485382e/b64e3c53e93abec19efa6a7cc2085d98.jpg",
      title: "Frame Construction"
    },
    {
      url: "https://horizons-cdn.hostinger.com/084723fe-37cf-40b6-bc10-548f6485382e/d3ebe77a4f0a97c0c7e6f5d48c8c0ba8.jpg",
      title: "Wheel Assembly"
    },
    {
      url: "https://horizons-cdn.hostinger.com/084723fe-37cf-40b6-bc10-548f6485382e/d65e88a5d16e84fdec8b9da7e5cc95f9.jpg",
      title: "Handle Detail"
    },
    {
      url: "https://horizons-cdn.hostinger.com/084723fe-37cf-40b6-bc10-548f6485382e/e39f62cc6fa2a31f8bc98a3ab60c8f20.jpg",
      title: "In Use"
    }
  ];

  const features = [
    "1,200 lb. capacity",
    "10 cu. ft. removable bed",
    "2-in-1 functionality: use as a yard cart or lift & dump with ease",
    "Patented quick-release dumping system",
    "Heavy-duty steel frame construction",
    "Pneumatic tires for all-terrain use",
    "Ergonomic handle design for comfortable maneuvering",
    "Rust-resistant powder-coated finish"
  ];

  const handlePrevImage = () => {
    setCurrentImageIndex((prev) => (prev === 0 ? productImages.length - 1 : prev - 1));
  };

  const handleNextImage = () => {
    setCurrentImageIndex((prev) => (prev === productImages.length - 1 ? 0 : prev + 1));
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-6xl max-h-[90vh] bg-secondary text-secondary-foreground p-0 overflow-hidden">
        <DialogHeader className="bg-gradient-to-r from-blue-900 to-purple-900 text-white p-6 sticky top-0 z-10">
          <DialogTitle className="text-2xl md:text-3xl font-bold text-white flex items-center justify-between">
            <span>Gorilla Heavy-Duty Dump Cart</span>
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="text-white hover:bg-white/20 rounded-full"
            >
              <X className="h-6 w-6" />
            </Button>
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="h-full max-h-[calc(90vh-80px)]">
          <div className="p-6 space-y-8">
            {/* YouTube Video */}
            <Card className="overflow-hidden bg-black">
              <div className="aspect-video w-full">
                <iframe
                  width="100%"
                  height="100%"
                  src="https://www.youtube.com/embed/7CZB55q6H3k?autoplay=1&mute=1&start=23"
                  title="Gorilla Heavy-Duty Dump Cart Demo"
                  frameBorder="0"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                  className="w-full h-full"
                ></iframe>
              </div>
            </Card>

            {/* Image Gallery Carousel */}
            <div className="space-y-4">
              <h3 className="text-xl font-semibold text-secondary-foreground">Product Gallery</h3>
              
              {/* Main Image Display */}
              <div className="relative">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={currentImageIndex}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.3 }}
                    className="relative aspect-video rounded-lg overflow-hidden border-2 border-border"
                  >
                    <img
                      src={productImages[currentImageIndex].url}
                      alt={productImages[currentImageIndex].title}
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-4">
                      <p className="text-white font-semibold">{productImages[currentImageIndex].title}</p>
                      <p className="text-white/80 text-sm">Image {currentImageIndex + 1} of {productImages.length}</p>
                    </div>
                  </motion.div>
                </AnimatePresence>

                {/* Navigation Buttons */}
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handlePrevImage}
                  className="absolute left-2 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white rounded-full"
                >
                  <ChevronLeft className="h-6 w-6" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleNextImage}
                  className="absolute right-2 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white rounded-full"
                >
                  <ChevronRight className="h-6 w-6" />
                </Button>
              </div>

              {/* Thumbnail Grid */}
              <div className="grid grid-cols-5 gap-2">
                {productImages.map((image, index) => (
                  <motion.div
                    key={index}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => setCurrentImageIndex(index)}
                    className={`cursor-pointer rounded-lg overflow-hidden border-2 transition-all ${
                      index === currentImageIndex
                        ? 'border-blue-500 ring-2 ring-blue-300'
                        : 'border-border hover:border-blue-300'
                    }`}
                  >
                    <img
                      src={image.url}
                      alt={image.title}
                      className="w-full h-full object-cover aspect-square"
                    />
                  </motion.div>
                ))}
              </div>
            </div>

            {/* Product Description */}
            <div className="space-y-4 bg-muted p-6 rounded-lg">
              <h3 className="text-xl font-semibold text-muted-foreground">About This Product</h3>
              <p className="text-muted-foreground leading-relaxed">
                The Gorilla Heavy-Duty Dump Cart is the ultimate solution for efficient material handling in your yard, 
                garden, or construction site. Built with professional-grade steel construction and featuring a patented 
                quick-release dumping system, this cart makes moving heavy loads easier than ever before. Whether you're 
                hauling soil, mulch, firewood, or debris, the 1,200 lb. capacity and 10 cu. ft. bed ensure you can get 
                the job done in fewer trips.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                The 2-in-1 design allows you to use it as a traditional yard cart for transport or quickly convert it 
                to dump mode for easy unloading. Pneumatic tires provide smooth rolling on any terrain, while the 
                ergonomic handle design reduces fatigue during extended use. The rust-resistant powder-coated finish 
                ensures years of reliable service, even in harsh outdoor conditions.
              </p>
            </div>

            {/* Features List */}
            <div className="space-y-4">
              <h3 className="text-xl font-semibold text-secondary-foreground">Key Features</h3>
              <div className="grid md:grid-cols-2 gap-3">
                {features.map((feature, index) => (
                  <motion.div
                    key={index}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.05 }}
                    className="flex items-start gap-3 p-3 bg-muted rounded-lg"
                  >
                    <div className="h-2 w-2 bg-blue-500 rounded-full mt-2 flex-shrink-0"></div>
                    <span className="text-muted-foreground">{feature}</span>
                  </motion.div>
                ))}
              </div>
            </div>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
};

export default ProductModal;
