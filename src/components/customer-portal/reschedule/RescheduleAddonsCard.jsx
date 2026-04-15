
import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Info, Plus, ShieldCheck, Box } from 'lucide-react';
import { formatCurrency } from '@/api/EcommerceApi';
import { safeExtractString, safeExtractNumber } from '@/utils/stringExtractors';

export const RescheduleAddonsCard = ({ addon, isSelected, onToggle }) => {
    const safeName = safeExtractString(addon?.name, 'Add-on');
    const safeDesc = safeExtractString(addon?.description, `Include ${safeName} with your reservation.`);
    const safePrice = safeExtractNumber(addon?.price, 0);
    const isInsurance = safeName.toLowerCase().includes('insurance') || safeName.toLowerCase().includes('protection');

    return (
        <div 
            className={`relative flex flex-col p-5 rounded-2xl border transition-all duration-300 cursor-pointer group h-full
                ${isSelected 
                    ? 'bg-[hsl(var(--gold)_/_0.05)] border-[hsl(var(--gold)_/_0.6)] shadow-[0_0_20px_hsla(var(--gold),0.1)]' 
                    : 'bg-gray-900 border-gray-800 hover:border-gray-600 hover:bg-gray-800/50'
                }
            `}
            onClick={() => onToggle(addon)}
        >
            <div className="flex justify-between items-start mb-4">
                <Checkbox 
                    checked={isSelected} 
                    onCheckedChange={() => onToggle(addon)}
                    className="w-6 h-6 rounded-md data-[state=checked]:bg-gold data-[state=checked]:border-gold data-[state=checked]:text-black border-gray-500 transition-all mt-1" 
                />
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center shadow-sm transition-colors
                    ${isSelected ? 'bg-gold text-gray-950' : 'bg-gray-950 text-gray-400 border border-gray-800 group-hover:text-gray-200'}`}>
                    {isInsurance ? <ShieldCheck className="w-6 h-6" /> : <Box className="w-6 h-6" />}
                </div>
            </div>
            
            <div className="flex-1 flex flex-col">
                <h4 className={`font-bold text-lg leading-tight mb-2 transition-colors ${isSelected ? 'text-gold-light' : 'text-gray-100'}`}>
                    {safeName}
                </h4>
                <p className="text-sm text-gray-400 leading-relaxed mb-4 line-clamp-2">
                    {safeDesc}
                </p>
                
                <div className="mt-auto pt-4 border-t border-gray-800/60">
                    <div className="flex justify-between items-end">
                        <span className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Rate</span>
                        <span className={`text-xl font-black ${isSelected ? 'text-gold' : 'text-white'}`}>
                            +{formatCurrency(safePrice * 100, {code: 'USD', symbol: '$'})}
                        </span>
                    </div>
                </div>
            </div>
        </div>
    );
};
