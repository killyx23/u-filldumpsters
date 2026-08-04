import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { AlertTriangle, Star } from 'lucide-react';
import { cn } from '@/lib/utils';

const highlightSaratogaSprings = (text) => {
    if (typeof text !== 'string') return text;
    const parts = text.split(/(South Saratoga Springs|Saratoga Springs)/gi);
    return parts.map((part, index) => {
        const normalized = part.toLowerCase();
        if (normalized === 'south saratoga springs' || normalized === 'saratoga springs') {
            return (
                <span key={index} className="text-yellow-400 font-semibold">
                    {part}
                </span>
            );
        }
        return part;
    });
};

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

    const cardStyles = {
        1: {
            bg: 'bg-gradient-to-br from-yellow-300/10 via-blue-900 to-indigo-900',
            title: 'text-yellow-400',
            button: 'bg-gradient-to-r from-yellow-400 to-amber-500 hover:from-yellow-500 hover:to-amber-600 text-black',
            border: 'from-yellow-400 to-amber-500',
            highlightBg: 'from-yellow-400 to-amber-500',
        },
        2: {
            bg: 'bg-gradient-to-br from-sky-400/10 via-blue-900 to-indigo-900',
            title: 'text-sky-300',
            button: 'bg-gradient-to-r from-sky-400 to-blue-500 hover:from-sky-500 hover:to-blue-600 text-white',
            border: 'from-sky-400 to-blue-500',
            highlightBg: 'from-sky-400 to-blue-500',
        },
        3: {
            bg: 'bg-gradient-to-br from-blue-400/10 via-blue-900 to-indigo-900',
            title: 'text-blue-300',
            button: 'bg-gradient-to-r from-blue-400 to-indigo-500 hover:from-blue-500 hover:to-indigo-600 text-white',
            border: 'from-blue-400 to-indigo-500',
            highlightBg: 'from-blue-400 to-indigo-500',
        },
        5: {
            bg: 'bg-gradient-to-br from-emerald-400/10 via-blue-900 to-indigo-900',
            title: 'text-emerald-300',
            button: 'bg-gradient-to-r from-emerald-400 to-teal-500 hover:from-emerald-500 hover:to-teal-600 text-white',
            border: 'from-emerald-400 to-teal-500',
            highlightBg: 'from-emerald-400 to-teal-500',
        },
    };

    const currentStyle = cardStyles[plan?.id] || cardStyles[3];

    const displayDescription =
        plan?.displayDescription || plan?.homepage_description || plan?.description || '';
    const displayPrice = plan?.displayPrice ?? plan?.homepage_price ?? plan?.base_price ?? 0;
    const displayPriceUnit =
        plan?.displayPriceUnit || plan?.homepage_price_unit || plan?.price_unit || '';
    const planName = plan?.displayName || plan?.name || plan?.highlight?.text || 'Service Plan';

    const displayDeliveryFee =
      plan?.displayDeliveryFee != null && Number(plan.displayDeliveryFee) > 0
        ? Number(plan.displayDeliveryFee)
        : null;
    const deliveryFeeLabel = plan?.displayDeliveryFeeLabel || 'Delivery Fee';

    const features = (() => {
      if (Array.isArray(plan?.displayFeatures)) return plan.displayFeatures;
      if (!plan?.features) return [];
      const raw = typeof plan.features === 'string' ? JSON.parse(plan.features) : plan.features;
      return Array.isArray(raw)
        ? raw.filter((f) => {
            if (typeof f === 'object' && f !== null) {
              return !/delivery\s*fee/i.test(String(f.name || ''));
            }
            return true;
          })
        : [];
    })();

    return (
        <>
        <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: plan?.highlight?.delay || 0 }}
            className={cn(
                "relative h-full w-full pt-8 group transition-all duration-300",
                isTemporarilyUnavailable ? "opacity-80 grayscale-[30%]" : ""
            )}
        >
             {plan?.highlight && (
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-auto whitespace-nowrap z-20">
                    <div className={cn("p-0.5 rounded-full shadow-lg bg-gradient-to-r", currentStyle.highlightBg)}>
                        <div className="bg-black/80 backdrop-blur-sm rounded-full px-5 py-2 flex items-center gap-2 transform transition-transform duration-300 group-hover:scale-105">
                            <Star size={18} className="text-yellow-300" />
                            <span className="text-lg font-extrabold text-white tracking-wide" style={{textShadow: '0 2px 4px rgba(0,0,0,0.5)'}}>
                                {typeof plan.highlight.text === 'string' ? plan.highlight.text : 'Featured'}
                            </span>
                        </div>
                    </div>
                </div>
            )}
            <div
                data-service-id={plan?.id}
                className={cn(
                "relative p-0.5 overflow-hidden rounded-2xl h-full w-full shadow-2xl transition-all duration-300",
                "bg-gradient-to-r", currentStyle.border
            )}>
                <div className={cn(
                    "relative z-10 backdrop-blur-xl rounded-[15px] p-5 xl:p-6 flex flex-col h-full w-full",
                    currentStyle.bg
                )}>
                    
                    {isTemporarilyUnavailable && (
                        <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-red-600/90 backdrop-blur text-white px-6 py-1.5 rounded-full text-sm font-bold shadow-xl z-20 whitespace-nowrap border border-red-400/50">
                            Temporarily Unavailable
                        </div>
                    )}

                    <div className="flex-grow pt-8">
                        <h3 className={cn("text-2xl xl:text-3xl font-bold mb-3 text-center leading-tight", currentStyle.title)} style={{ textShadow: '0 2px 8px rgba(0,0,0,0.7)' }}>{planName}</h3>
                        <p className="text-white/80 mb-6 min-h-[5.5rem] text-sm xl:text-[15px] leading-relaxed text-center" >
                            {typeof displayDescription === 'string'
                                ? highlightSaratogaSprings(displayDescription)
                                : 'Description unavailable'}
                        </p>
                        <div className="mb-6 text-center">
                            <span className="text-4xl xl:text-5xl font-bold text-white">${parseFloat(displayPrice).toFixed(2)}</span>
                            <span className="text-gray-300 ml-2 text-sm" >{typeof displayPriceUnit === 'string' ? displayPriceUnit : ''}</span>
                            {displayDeliveryFee != null && (
                                <p className="mt-2 text-sm font-medium text-gray-300">
                                    {deliveryFeeLabel} (${displayDeliveryFee.toFixed(2)})
                                </p>
                            )}
                            {plan?.showWeeklyRatesAvailable && (
                                <p className="mt-2 text-sm font-medium text-gray-300">
                                    Weekly Rates Available
                                </p>
                            )}
                        </div>
                        <ul className="space-y-3 text-white/90 mb-8">
                            {Array.isArray(features) && features.map((feature, index) => {
                                let featureText = '';
                                if (typeof feature === 'object' && feature !== null) {
                                    featureText = feature.name || '';
                                    if (feature.value !== undefined && feature.value !== null && feature.value !== '') {
                                      const amount = Number(feature.value);
                                      featureText += Number.isFinite(amount)
                                        ? ` ($${amount.toFixed(2)})`
                                        : ` (${feature.value})`;
                                    }
                                } else {
                                    featureText = String(feature);
                                }
                                
                                return (
                                    <li key={index} className="flex items-center text-base">
                                        <svg className={cn("w-5 h-5 mr-3 flex-shrink-0", isTemporarilyUnavailable ? "text-gray-400" : "text-green-400")} fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
                                        <span className="font-medium">{featureText}</span>
                                    </li>
                                );
                            })}
                        </ul>
                    </div>
                    <Button
                        onClick={handleSelect}
                        className={cn(
                            'w-full py-3 mt-auto text-lg font-bold transition-all duration-300 shadow-lg',
                            isTemporarilyUnavailable 
                                ? 'bg-slate-700 hover:bg-slate-600 text-white transform hover:scale-105' 
                                : `${currentStyle.button} transform hover:scale-105`
                        )}
                    >
                        {isTemporarilyUnavailable ? 'Temporarily Unavailable' : 'Book Now'}
                    </Button>
                </div>
            </div>
        </motion.div>

        <Dialog open={showUnavailableDialog} onOpenChange={setShowUnavailableDialog}>
            <DialogContent className="bg-gray-900 border-yellow-500 text-white max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center text-2xl text-yellow-400">
                        <AlertTriangle className="mr-3 h-8 w-8 flex-shrink-0" />
                        Service Temporarily Unavailable
                    </DialogTitle>
                </DialogHeader>
                <DialogDescription asChild>
                    <div className="my-4 text-base text-blue-200 space-y-4">
                        <p>
                            We apologize for the inconvenience. The{' '}
                            <strong className="text-white">{planName}</strong> is temporarily unavailable,
                            and we are working to have it available again soon. Please check back here often.
                        </p>
                        <p>
                            If you need this service and are willing to work with us, or your timeline is flexible
                            and you do not need it right away, we may still be able to fit you in. Please contact
                            our customer service team to discuss options.
                        </p>
                    </div>
                </DialogDescription>
                <DialogFooter className="sm:justify-between gap-2 mt-4">
                    <Button
                        onClick={() => setShowUnavailableDialog(false)}
                        variant="outline"
                        className="text-white border-white/50 hover:bg-white/20"
                    >
                        See You Soon
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
