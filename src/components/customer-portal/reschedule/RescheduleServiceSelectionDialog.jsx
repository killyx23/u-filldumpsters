import React, { useEffect, useState } from 'react';
import { CheckCircle, Loader2, Package, Star, Info } from 'lucide-react';
import { formatCurrency } from '@/api/EcommerceApi';
import { ScrollArea } from '@/components/ui/scroll-area';
import { fetchAllServices } from '@/utils/rescheduleDataIntegration';
import { safeExtractString, safeExtractNumber } from '@/utils/stringExtractors';

export const RescheduleServiceSelectionDialog = ({ currentServiceId, selectedService, onSelectService }) => {
    const [services, setServices] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        const loadServices = async () => {
            setLoading(true);
            setError(null);
            try {
                const data = await fetchAllServices();
                setServices(data || []);
                
                if (!selectedService && currentServiceId) {
                    const current = data?.find(s => s.id === currentServiceId);
                    if (current) onSelectService(current);
                }
            } catch (err) {
                console.error("Failed to load services:", err);
                setError("Unable to load available services. Please try again.");
            } finally {
                setLoading(false);
            }
        };
        loadServices();
    }, [currentServiceId, selectedService, onSelectService]);

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center py-20 space-y-4 h-full">
                <Loader2 className="h-8 w-8 animate-spin text-yellow-500" />
                <p className="text-gray-400 text-sm">Loading available services...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="p-4 bg-red-900/20 border border-red-500/50 rounded-xl text-center max-w-2xl mx-auto mt-4">
                <p className="text-red-400 text-sm">{error}</p>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full w-full max-w-6xl mx-auto animate-in fade-in duration-300">
            <div className="text-center space-y-2 pb-4 flex-shrink-0">
                <h2 className="text-2xl font-extrabold text-white tracking-tight">
                    Select Your Service Level
                </h2>
                <p className="text-sm text-gray-400 max-w-2xl mx-auto">
                    Choose the best option for your new dates.
                </p>
            </div>

            <ScrollArea className="flex-1 w-full rounded-xl">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 pb-6 pr-4">
                    {services?.map((service, idx) => {
                        const safeId = service?.id || `service-${idx}`;
                        const isSelected = selectedService?.id === service?.id;
                        const isCurrent = currentServiceId === service?.id;
                        
                        const serviceName = safeExtractString(service?.name, 'Standard Service');
                        const rawDesc = service?.description || service?.homepage_description || "High quality rental service.";
                        const description = safeExtractString(rawDesc, "High quality rental service.");
                        const basePrice = safeExtractNumber(service?.base_price, 0);
                        const dailyRate = safeExtractNumber(service?.daily_rate, 0);
                        
                        return (
                            <div 
                                key={safeId} 
                                className={`service-card-wide group ${isSelected ? 'selected' : ''}`}
                                onClick={() => onSelectService(service)}
                            >
                                {isCurrent && (
                                    <div className="absolute top-0 right-0 bg-gray-700 text-white text-[10px] font-bold px-3 py-1.5 rounded-bl-lg rounded-tr-xl z-10 flex items-center shadow-md border-b border-l border-gray-600">
                                        <Star className="w-3 h-3 mr-1.5 text-yellow-400 fill-yellow-400" /> CURRENT BOOKING
                                    </div>
                                )}
                                {isSelected && (
                                    <div className="absolute top-3 right-3 text-yellow-400 z-10 bg-yellow-900/80 rounded-full p-0.5 backdrop-blur-sm shadow-[0_0_10px_rgba(234,179,8,0.5)]">
                                        <CheckCircle className="h-6 w-6" />
                                    </div>
                                )}

                                <div className={`h-24 shrink-0 rounded-lg mb-4 flex items-center justify-center border transition-colors ${isSelected ? 'bg-yellow-900/20 border-yellow-500/30' : 'bg-gray-950 border-gray-800'}`}>
                                    <Package className={`h-10 w-10 transition-transform duration-300 ${isSelected ? 'text-yellow-400 scale-110' : 'text-gray-600'}`} />
                                </div>

                                <div className="flex flex-col flex-1">
                                    <div className="flex justify-between items-start mb-2">
                                        <h4 className={`font-bold text-lg leading-tight ${isSelected ? 'text-yellow-400' : 'text-white'}`}>{serviceName}</h4>
                                        <div className="relative">
                                            <Info className="w-4 h-4 text-gray-500 hover:text-gray-300" />
                                            <div className="absolute right-0 bottom-full mb-2 hidden group-hover:block w-48 p-2 bg-gray-800 text-xs text-gray-200 rounded shadow-lg z-20 border border-gray-700">
                                                {description}
                                            </div>
                                        </div>
                                    </div>
                                    
                                    <p className="text-xs text-gray-400 leading-relaxed mb-4 flex-1 line-clamp-3">
                                        {description}
                                    </p>

                                    <div className="pt-3 border-t border-gray-800/80 space-y-2 mt-auto">
                                        {basePrice > 0 && (
                                            <div className="flex justify-between items-center text-sm">
                                                <span className="text-gray-400">Base Price</span>
                                                <span className={`font-bold ${isSelected ? 'text-yellow-400' : 'text-white'}`}>{formatCurrency(basePrice * 100, {code: 'USD', symbol: '$'})}</span>
                                            </div>
                                        )}
                                        {dailyRate > 0 && (
                                            <div className="flex justify-between items-center text-sm">
                                                <span className="text-gray-400">Daily Rate</span>
                                                <span className={`font-bold ${isSelected ? 'text-yellow-400' : 'text-white'}`}>{formatCurrency(dailyRate * 100, {code: 'USD', symbol: '$'})}<span className="text-[10px] font-normal text-gray-500 ml-1">/day</span></span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </ScrollArea>
        </div>
    );
};