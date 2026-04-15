
import React, { useState } from 'react';
import { CheckCircle, Info, Star, Package } from 'lucide-react';
import { formatCurrency } from '@/api/EcommerceApi';
import { ServiceDescriptionModal } from './ServiceDescriptionModal';
import { safeExtractString, safeExtractNumber } from '@/utils/stringExtractors';

export const RescheduleServiceSelectionSection = ({ currentServiceId, selectedService, onSelectService, availableServices = [] }) => {
    const [infoModalService, setInfoModalService] = useState(null);

    return (
        <div className="w-full max-w-5xl mx-auto animate-in fade-in duration-500 space-y-8">
            <div className="text-center space-y-3 pb-4">
                <h2 className="text-3xl font-extrabold text-white tracking-tight">
                    Select Your Service Level
                </h2>
                <p className="text-base text-gray-400 max-w-2xl mx-auto">
                    Choose the best option for your new dates. You can maintain your current service or upgrade your experience.
                </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {availableServices?.map((service, idx) => {
                    const safeId = service?.id || `service-${idx}`;
                    const isSelected = selectedService?.id === service?.id;
                    const isCurrent = currentServiceId === service?.id;
                    
                    const serviceName = safeExtractString(service?.name, 'Standard Service');
                    const rawDesc = service?.description || service?.homepage_description || "Premium rental service.";
                    const description = safeExtractString(rawDesc, "Premium rental service.");
                    const basePrice = safeExtractNumber(service?.base_price, 0);
                    
                    return (
                        <div 
                            key={safeId} 
                            className={`relative flex flex-col p-6 rounded-2xl border transition-all duration-300 overflow-hidden cursor-pointer group
                                ${isSelected 
                                    ? 'bg-[hsl(var(--gold)_/_0.08)] border-gold shadow-[0_0_30px_hsla(var(--gold),0.15)] scale-[1.02]' 
                                    : 'bg-gray-900 border-gray-800 hover:border-gold/50 hover:bg-gray-800/80 hover:shadow-xl'
                                }
                            `}
                            onClick={() => onSelectService(service)}
                        >
                            {isCurrent && (
                                <div className="absolute top-0 right-0 bg-gray-800/90 backdrop-blur-md text-white text-[10px] font-black px-4 py-1.5 rounded-bl-xl z-10 flex items-center border-b border-l border-gray-700 shadow-sm">
                                    <Star className="w-3.5 h-3.5 mr-1.5 text-gold fill-gold" /> CURRENT
                                </div>
                            )}
                            
                            {isSelected && (
                                <div className="absolute top-5 right-5 text-gold z-10 bg-gray-950/80 rounded-full p-0 shadow-gold animate-in zoom-in duration-300">
                                    <CheckCircle className="h-7 w-7" />
                                </div>
                            )}

                            <div className="mb-6">
                                <div className={`w-16 h-16 rounded-2xl flex items-center justify-center border transition-colors shadow-sm
                                    ${isSelected ? 'bg-[hsl(var(--gold)_/_0.15)] border-gold/40 text-gold' : 'bg-gray-950 border-gray-800 text-gray-400 group-hover:text-gray-200'}`}>
                                    <Package className="w-8 h-8" />
                                </div>
                            </div>

                            <div className="flex-1 flex flex-col">
                                <div className="flex justify-between items-start mb-3 gap-2">
                                    <h4 className={`font-extrabold text-xl leading-tight transition-colors ${isSelected ? 'text-gold-light' : 'text-white group-hover:text-gray-100'}`}>
                                        {serviceName}
                                    </h4>
                                    <button 
                                        onClick={(e) => { e.stopPropagation(); setInfoModalService(service); }}
                                        className="p-2 rounded-full bg-gray-800/60 text-gray-400 hover:bg-gray-700 hover:text-gold transition-colors z-20 relative flex-shrink-0"
                                        title="View full details"
                                    >
                                        <Info className="w-5 h-5" />
                                    </button>
                                </div>
                                <p className="text-sm text-gray-400 leading-relaxed mb-6 line-clamp-3 pr-2">
                                    {description}
                                </p>
                                
                                <div className="mt-auto pt-5 border-t border-gray-800/60">
                                    <div className="flex justify-between items-end">
                                        <span className="text-xs text-gray-500 uppercase tracking-widest font-bold">Base Rate</span>
                                        <span className={`text-2xl font-black tracking-tight ${isSelected ? 'text-gold drop-shadow-sm' : 'text-white'}`}>
                                            {formatCurrency(basePrice * 100, {code: 'USD', symbol: '$'})}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>

            <ServiceDescriptionModal 
                service={infoModalService} 
                isOpen={!!infoModalService} 
                onClose={() => setInfoModalService(null)} 
            />
        </div>
    );
};
