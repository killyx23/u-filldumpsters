
import React from 'react';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Star } from 'lucide-react';
import { cn } from '@/lib/utils';

export const PlanCard = ({ plan, onSelect, isTemporarilyUnavailable }) => {

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
    };

    const currentStyle = cardStyles[plan?.id] || cardStyles[3];

    // Safely extract properties to prevent React "Objects are not valid as a React child" errors
    const displayDescription = plan?.homepage_description || plan?.description || '';
    const displayPrice = plan?.base_price || 0;
    const displayPriceUnit = plan?.price_unit || '';
    const planName = plan?.name || 'Service Plan';

    const features = plan?.features ? (typeof plan.features === 'string' ? JSON.parse(plan.features) : plan.features) : [];

    return (
        <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: plan?.highlight?.delay || 0 }}
            className={cn(
                "relative h-full pt-8 group transition-all duration-300",
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
            <div className={cn(
                "relative p-0.5 overflow-hidden rounded-2xl h-full shadow-2xl transition-all duration-300",
                "bg-gradient-to-r", currentStyle.border
            )}>
                <div className={cn(
                    "relative z-10 backdrop-blur-xl rounded-[15px] p-6 flex flex-col h-full",
                    currentStyle.bg
                )}>
                    
                    {isTemporarilyUnavailable && (
                        <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-red-600/90 backdrop-blur text-white px-6 py-1.5 rounded-full text-sm font-bold shadow-xl z-20 whitespace-nowrap border border-red-400/50">
                            Temporarily Unavailable
                        </div>
                    )}

                    <div className="flex-grow pt-8">
                        <h3 className={cn("text-3xl font-bold mb-3 text-center", currentStyle.title)} style={{ textShadow: '0 2px 8px rgba(0,0,0,0.7)' }}>{planName}</h3>
                        <p className="text-white/80 mb-6 h-24 text-[15px] leading-relaxed text-center" >
                            {typeof displayDescription === 'string' ? displayDescription : 'Description unavailable'}
                        </p>
                        <div className="mb-6 text-center">
                            <span className="text-5xl font-bold text-white">${parseFloat(displayPrice).toFixed(2)}</span>
                            <span className="text-gray-300 ml-2 text-sm" >{typeof displayPriceUnit === 'string' ? displayPriceUnit : ''}</span>
                        </div>
                        <ul className="space-y-3 text-white/90 mb-8">
                            {Array.isArray(features) && features.map((feature, index) => {
                                // CRITICAL FIX: Ensure object features are extracted to strings to prevent React crashes
                                let featureText = '';
                                if (typeof feature === 'object' && feature !== null) {
                                    featureText = feature.name || '';
                                    if (feature.value) featureText += ` ($${feature.value})`;
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
                        onClick={() => onSelect(plan)}
                        disabled={isTemporarilyUnavailable}
                        className={cn(
                            'w-full py-3 mt-auto text-lg font-bold transition-all duration-300 shadow-lg',
                            isTemporarilyUnavailable 
                                ? 'bg-slate-700 hover:bg-slate-700 text-slate-300 cursor-not-allowed border-none' 
                                : `${currentStyle.button} transform hover:scale-105`
                        )}
                    >
                        {isTemporarilyUnavailable ? 'Temporarily Unavailable' : 'Book Now'}
                    </Button>
                </div>
            </div>
        </motion.div>
    );
};
