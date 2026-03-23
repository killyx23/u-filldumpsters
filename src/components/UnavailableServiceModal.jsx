
import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';

export const UnavailableServiceModal = ({ isOpen, onClose, serviceName }) => {
  const navigate = useNavigate();

  const handleContactClick = () => {
    onClose();
    navigate('/contact');
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="relative w-full max-w-md bg-slate-900 border border-slate-700 rounded-xl shadow-2xl p-6 overflow-hidden z-10"
          >
            <button
              onClick={onClose}
              className="absolute top-4 right-4 text-slate-400 hover:text-white transition-colors"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="flex flex-col items-center text-center mt-4">
              <div className="h-12 w-12 rounded-full bg-yellow-500/20 flex items-center justify-center mb-4">
                <AlertCircle className="h-6 w-6 text-yellow-500" />
              </div>
              <h2 className="text-2xl font-bold text-white mb-2">We're Sorry</h2>
              <p className="text-slate-300 mb-6 leading-relaxed">
                The <strong className="text-white">{serviceName}</strong> is temporarily unavailable for the selected date. Please try another date or contact us for assistance with your scheduling needs.
              </p>

              <div className="flex flex-col sm:flex-row w-full gap-3">
                <Button
                  onClick={onClose}
                  variant="outline"
                  className="flex-1 bg-slate-800 border-slate-600 text-white hover:bg-slate-700 hover:text-white"
                >
                  Return to Services
                </Button>
                <Button
                  onClick={handleContactClick}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
                >
                  Contact Us
                </Button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
