
import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { formatCurrency } from '@/api/EcommerceApi';
import { CheckCircle2, Package, Sparkles } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { safeExtractString, safeExtractNumber } from '@/utils/stringExtractors';

export const ServiceDescriptionModal = ({ service, isOpen, onClose }) => {
    if (!service) return null;

    // Helper to highlight key terms with gold text
    const highlightDescription = (text) => {
        const safeText = safeExtractString(text);
        if (!safeText) return null;
        
        const keywords = ['Delivery', 'Rental', 'Base price', 'mileage'];
        let elements = [safeText];
        
        keywords.forEach(keyword => {
            elements = elements.flatMap(el => {
                if (typeof el !== 'string') return [el];
                const parts = el.split(new RegExp(`(${keyword})`, 'gi'));
                return parts.map((part, i) => 
                    part.toLowerCase() === keyword.toLowerCase() 
                        ? <span key={`${keyword}-${i}`} className="text-gold font-bold">{part}</span> 
                        : part
                );
            });
        });
        return <>{elements}</>;
    };

    const features = Array.isArray(service.features) 
        ? service.features 
        : (service.features?.list || ['High quality equipment', 'Professional service', 'Flexible scheduling']);

    const serviceName = safeExtractString(service?.name, 'Service Level');
    const serviceDesc = safeExtractString(service?.description || service?.homepage_description, "Premium service carefully tailored to meet your scheduling needs.");
    const basePrice = safeExtractNumber(service?.base_price, 0);
    const deliveryFee = safeExtractNumber(service?.delivery_fee, 0);
    const mileageRate = safeExtractNumber(service?.mileage_rate, 0);

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="sm:max-w-[600px] bg-gray-950 border border-gray-800 shadow-2xl modal-backdrop-blur">
                <DialogHeader className="border-b border-gray-800 pb-4">
                    <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-xl bg-[hsl(var(--gold)_/_0.1)] border border-[hsl(var(--gold)_/_0.2)] flex items-center justify-center shadow-gold">
                            <Sparkles className="w-6 h-6 text-gold" />
                        </div>
                        <div>
                            <DialogTitle className="text-2xl font-extrabold text-white">
                                {serviceName}
                            </DialogTitle>
                            <DialogDescription className="text-gold-light font-medium">
                                Base Price: {formatCurrency(basePrice * 100, {code: 'USD', symbol: '$'})}
                            </DialogDescription>
                        </div>
                    </div>
                </DialogHeader>
                
                <ScrollArea className="max-h-[60vh] mt-4 pr-4">
                    <div className="space-y-6 pb-6">
                        <div className="space-y-2">
                            <h4 className="text-sm uppercase tracking-widest text-gray-500 font-bold">Service Details</h4>
                            <p className="text-gray-300 leading-relaxed">
                                {highlightDescription(serviceDesc)}
                            </p>
                        </div>

                        <div className="space-y-3">
                            <h4 className="text-sm uppercase tracking-widest text-gray-500 font-bold">Included Features</h4>
                            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                {features.map((feature, idx) => {
                                    const safeFeature = safeExtractString(feature, 'Included Benefit');
                                    return (
                                        <li key={idx} className="flex items-start text-sm text-gray-300 bg-gray-900/50 p-3 rounded-lg border border-gray-800/50">
                                            <CheckCircle2 className="w-4 h-4 text-gold mr-2 mt-0.5 flex-shrink-0" />
                                            <span className="leading-snug">{safeFeature}</span>
                                        </li>
                                    );
                                })}
                            </ul>
                        </div>

                        <div className="bg-[hsl(var(--gold)_/_0.05)] border border-[hsl(var(--gold)_/_0.2)] p-4 rounded-xl">
                            <h4 className="text-gold font-bold text-sm mb-2 flex items-center">
                                <Package className="w-4 h-4 mr-2" /> Pricing Structure
                            </h4>
                            <ul className="space-y-2 text-sm text-gray-300">
                                <li className="flex justify-between border-b border-gray-800/50 pb-1">
                                    <span>Base Price</span>
                                    <span className="font-bold text-white">{formatCurrency(basePrice * 100, {code: 'USD', symbol: '$'})}</span>
                                </li>
                                {deliveryFee > 0 && (
                                    <li className="flex justify-between border-b border-gray-800/50 pb-1">
                                        <span>Base Delivery Fee</span>
                                        <span className="font-bold text-white">{formatCurrency(deliveryFee * 100, {code: 'USD', symbol: '$'})}</span>
                                    </li>
                                )}
                                {mileageRate > 0 && (
                                    <li className="flex justify-between border-b border-gray-800/50 pb-1">
                                        <span>Mileage Rate</span>
                                        <span className="font-bold text-white">{formatCurrency(mileageRate * 100, {code: 'USD', symbol: '$'})}/mile</span>
                                    </li>
                                )}
                            </ul>
                        </div>
                    </div>
                </ScrollArea>
            </DialogContent>
        </Dialog>
    );
};
