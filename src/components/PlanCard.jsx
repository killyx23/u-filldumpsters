import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { AlertTriangle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export const PlanCard = ({ plan, onSelect, isTemporarilyUnavailable }) => {
    const [showUnavailableDialog, setShowUnavailableDialog] = useState(false);
    const navigate = useNavigate();

    const handleSelect = () => {
        if (isTemporarilyUnavailable) {
            setShowUnavailableDialog(true);
        } else {
            onSelect(plan);
        }
    };

    const handleContact = () => {
        setShowUnavailableDialog(false);
        navigate('/contact');
    };

    return (
        <>
            <motion.div
                initial={{ opacity: 0, y: 50 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
                className={`relative bg-white/10 backdrop-blur-lg p-8 rounded-2xl shadow-xl border ${isTemporarilyUnavailable ? 'border-red-500/50' : 'border-white/20'} flex flex-col`}
            >
                {isTemporarilyUnavailable && (
                    <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-red-600 text-white px-4 py-1 rounded-full text-sm font-bold shadow-lg">
                        Unavailable
                    </div>
                )}
                <div className="flex-grow">
                    <h3 className="text-2xl font-bold text-yellow-400 mb-2">{plan.name}</h3>
                    <p className="text-blue-200 mb-6 h-24 text-sm">{plan.description}</p>
                    <div className="mb-8">
                        <span className="text-4xl font-extrabold text-white">${plan.price.toFixed(2)}</span>
                        <span className="text-blue-200 ml-2">{plan.priceUnit}</span>
                    </div>
                    <ul className="space-y-3 text-blue-100 mb-8">
                        {plan.features.map((feature, index) => (
                            <li key={index} className="flex items-center text-sm">
                                <svg className="w-5 h-5 text-green-400 mr-2 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
                                <span>{feature}</span>
                            </li>
                        ))}
                    </ul>
                </div>
                <Button 
                    onClick={handleSelect}
                    className={`w-full py-3 text-lg font-semibold ${isTemporarilyUnavailable ? 'bg-gray-600 hover:bg-gray-500 cursor-not-allowed' : 'bg-gradient-to-r from-yellow-500 to-orange-600 hover:from-yellow-600 hover:to-orange-700'} text-black transition-all duration-300 transform hover:scale-105`}
                >
                    {isTemporarilyUnavailable ? 'Temporarily Unavailable' : 'Book Now'}
                </Button>
            </motion.div>
            <Dialog open={showUnavailableDialog} onOpenChange={setShowUnavailableDialog}>
                <DialogContent className="bg-gray-900 border-yellow-500 text-white">
                    <DialogHeader>
                        <DialogTitle className="flex items-center text-2xl text-yellow-400">
                            <AlertTriangle className="mr-3 h-8 w-8" />
                            Service Currently Unavailable
                        </DialogTitle>
                    </DialogHeader>
                    <DialogDescription className="my-4 text-base text-blue-200 space-y-4">
                        <p>We apologize for the inconvenience. Due to unexpected circumstances, this service is not being offered at this time. We are working hard to make it available again as soon as possible.</p>
                        <p>If your timeline is flexible or you have a future need, we encourage you to get in touch. We may be able to make special arrangements to accommodate you.</p>
                    </DialogDescription>
                    <DialogFooter className="sm:justify-between gap-2 mt-4">
                        <Button onClick={() => setShowUnavailableDialog(false)} variant="outline" className="text-white border-white/50 hover:bg-white/20">
                            Thanks, I'll Check Back Soon
                        </Button>
                        <Button onClick={handleContact} className="bg-yellow-500 hover:bg-yellow-600 text-black">
                            Contact Us
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
};