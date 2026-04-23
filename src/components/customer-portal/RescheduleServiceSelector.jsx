
import React from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle2, Package, Truck, Calendar as CalendarIcon } from 'lucide-react';

export const RescheduleServiceSelector = ({ services, selectedPlanId, onSelect, originalPlanId }) => {
    
    const getServiceIcon = (id) => {
        if (id === 2) return <Truck className="w-6 h-6" />;
        if (id === 1) return <Package className="w-6 h-6" />;
        return <CalendarIcon className="w-6 h-6" />;
    };

    return (
        <div className="space-y-4">
            {services.map((service) => {
                const isSelected = selectedPlanId === service.id;
                const isOriginal = originalPlanId === service.id;
                
                return (
                    <Card 
                        key={service.id}
                        className={`cursor-pointer transition-all duration-200 border-2 overflow-hidden hover:-translate-y-1 ${
                            isSelected 
                            ? 'border-yellow-500 bg-gray-800 shadow-[0_0_15px_rgba(234,179,8,0.2)]' 
                            : 'border-gray-700 bg-gray-900 hover:border-gray-500'
                        }`}
                        onClick={() => onSelect(service.id)}
                    >
                        <CardContent className="p-0">
                            <div className="flex p-4">
                                <div className={`flex-shrink-0 w-12 h-12 rounded-full flex items-center justify-center mr-4 ${isSelected ? 'bg-yellow-500 text-black' : 'bg-gray-800 text-gray-400'}`}>
                                    {getServiceIcon(service.id)}
                                </div>
                                <div className="flex-1">
                                    <div className="flex justify-between items-start">
                                        <div>
                                            <h4 className={`text-lg font-bold ${isSelected ? 'text-yellow-400' : 'text-white'}`}>
                                                {service.name}
                                            </h4>
                                            {isOriginal && (
                                                <span className="inline-block px-2 py-0.5 bg-blue-900/50 text-blue-300 text-[10px] rounded-full mt-1 border border-blue-500/30">
                                                    Current Booking
                                                </span>
                                            )}
                                        </div>
                                        <div className="text-right">
                                            <div className="font-bold text-lg">${service.base_price}</div>
                                            <div className="text-xs text-gray-500">Base Rate</div>
                                        </div>
                                    </div>
                                    <p className="text-sm text-gray-400 mt-2 line-clamp-2">
                                        {service.description || "Premium equipment rental service."}
                                    </p>
                                </div>
                                <div className="flex-shrink-0 flex items-center ml-4">
                                    <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center ${isSelected ? 'border-yellow-500 bg-yellow-500' : 'border-gray-600'}`}>
                                        {isSelected && <CheckCircle2 className="w-4 h-4 text-black" />}
                                    </div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                );
            })}
        </div>
    );
};
