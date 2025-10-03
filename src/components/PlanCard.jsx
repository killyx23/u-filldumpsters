import React, { useState } from 'react';
    import { motion } from 'framer-motion';
    import { Button } from '@/components/ui/button';
    import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
    import { AlertTriangle, Star } from 'lucide-react';
    import { useNavigate } from 'react-router-dom';
    import { cn } from '@/lib/utils';
    
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
        
        const handleReturnHome = () => {
            setShowUnavailableDialog(false);
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
        };
    
        const currentStyle = cardStyles[plan.id] || cardStyles[3];
    
        const displayDescription = plan.homepage_description || plan.description;
        const displayPrice = plan.homepage_price !== null ? plan.homepage_price : plan.base_price;
        const displayPriceUnit = plan.homepage_price_unit || plan.price_unit;
    
        const features = plan.features ? (typeof plan.features === 'string' ? JSON.parse(plan.features) : plan.features) : [];
    
        return (
            <>
                <motion.div
                    initial={{ opacity: 0, y: 50 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, delay: plan.highlight?.delay || 0 }}
                    className="relative h-full pt-8 group"
                >
                     {plan.highlight && (
                        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-auto whitespace-nowrap z-20">
                            <div className={cn("p-0.5 rounded-full shadow-lg bg-gradient-to-r", currentStyle.highlightBg)}>
                                <div className="bg-black/80 backdrop-blur-sm rounded-full px-5 py-2 flex items-center gap-2 transform transition-transform duration-300 group-hover:scale-105">
                                    <Star size={18} className="text-yellow-300" />
                                    <span className="text-lg font-extrabold text-white tracking-wide" style={{textShadow: '0 2px 4px rgba(0,0,0,0.5)'}}>{plan.highlight.text}</span>
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
                            currentStyle.bg,
                            isTemporarilyUnavailable ? 'opacity-70' : ''
                        )}>
                            
                            {isTemporarilyUnavailable && (
                                <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-red-600 text-white px-4 py-1 rounded-full text-sm font-bold shadow-lg z-20">
                                    Unavailable
                                </div>
                            )}
    
                            <div className="flex-grow pt-8">
                                <h3 className={cn("text-3xl font-bold mb-3 text-center", currentStyle.title)} style={{ textShadow: '0 2px 8px rgba(0,0,0,0.7)' }}>{plan.name}</h3>
                                <p className="text-white/80 mb-6 h-24 text-[15px] leading-relaxed text-center" >{displayDescription}</p>
                                <div className="mb-6 text-center">
                                    <span className="text-5xl font-bold text-white">${parseFloat(displayPrice).toFixed(2)}</span>
                                    <span className="text-gray-300 ml-2 text-sm" >{displayPriceUnit}</span>
                                </div>
                                <ul className="space-y-3 text-white/90 mb-8">
                                    {features.map((feature, index) => (
                                        <li key={index} className="flex items-center text-base">
                                            <svg className="w-5 h-5 text-green-400 mr-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
                                            <span className="font-medium">{feature}</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                            <Button
                                onClick={handleSelect}
                                className={cn(
                                    'w-full py-3 mt-auto text-lg font-bold transition-all duration-300 transform hover:scale-105 shadow-lg',
                                    isTemporarilyUnavailable ? 'bg-gray-600 hover:bg-gray-500 text-white' : currentStyle.button
                                )}
                            >
                                {isTemporarilyUnavailable ? 'Temporarily Unavailable' : 'Book Now'}
                            </Button>
                        </div>
                    </div>
                </motion.div>
                <Dialog open={showUnavailableDialog} onOpenChange={setShowUnavailableDialog}>
                    <DialogContent className="bg-gray-900 border-yellow-500 text-white">
                        <DialogHeader>
                            <DialogTitle className="flex items-center text-2xl text-yellow-400">
                                <AlertTriangle className="mr-3 h-8 w-8" />
                                Service Temporarily Unavailable
                            </DialogTitle>
                        </DialogHeader>
                        <DialogDescription className="my-4 text-base text-blue-200 space-y-4">
                           <p>We're sorry, this service is temporarily unavailable, and we are working on getting it up and available soon.</p>
                           <p>If you are flexible on your schedule and when you need the service, we may be able to make special arrangements. Please contact us to discuss.</p>
                        </DialogDescription>
                        <DialogFooter className="sm:justify-between gap-2 mt-4">
                            <Button onClick={handleReturnHome} variant="outline" className="text-white border-white/50 hover:bg-white/20">
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