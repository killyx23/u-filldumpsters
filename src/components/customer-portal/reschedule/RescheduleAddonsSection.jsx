
import React, { useEffect, useState } from 'react';
import { PackagePlus, Loader2 } from 'lucide-react';
import { formatCurrency } from '@/api/EcommerceApi';
import { supabase } from '@/lib/customSupabaseClient';
import { RescheduleAddonsCard } from './RescheduleAddonsCard';
import { safeExtractString, safeExtractNumber } from '@/utils/stringExtractors';

export const RescheduleAddonsSection = ({ originalAddonsList = [], selectedAddonsList = [], setSelectedAddonsList }) => {
    const [availableEquipment, setAvailableEquipment] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchEquipment = async () => {
            setLoading(true);
            try {
                const { data } = await supabase.from('equipment').select('*');
                
                const mappedAddons = (data || []).map(eq => {
                    const safeName = safeExtractString(eq?.name, 'Equipment');
                    const safeDesc = safeExtractString(eq?.type, `Add ${safeName} to your reservation.`);
                    return {
                        id: eq.id,
                        name: safeName,
                        price: 15, // Hardcoded standard equipment price as per schema limits
                        description: safeDesc,
                        quantity: 1
                    };
                });

                // Ensure insurance is an option
                if (!mappedAddons.find(a => safeExtractString(a?.name).toLowerCase().includes('insurance'))) {
                    mappedAddons.unshift({
                        id: 'insurance',
                        name: 'Premium Insurance',
                        price: 25,
                        description: 'Complete coverage for accidental damage.',
                        quantity: 1
                    });
                }

                setAvailableEquipment(mappedAddons);

                // Initialize selection with original addons if empty
                if (!selectedAddonsList || selectedAddonsList.length === 0) {
                    setSelectedAddonsList(originalAddonsList || []);
                }
            } catch (err) {
                console.error("Failed to load addons:", err);
            } finally {
                setLoading(false);
            }
        };

        fetchEquipment();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleToggle = (addon) => {
        setSelectedAddonsList(prev => {
            const addonNameStr = safeExtractString(addon?.name).toLowerCase();
            const exists = prev.find(a => a.id === addon.id || safeExtractString(a?.name).toLowerCase() === addonNameStr);
            if (exists) {
                return prev.filter(a => a.id !== addon.id && safeExtractString(a?.name).toLowerCase() !== addonNameStr);
            } else {
                return [...prev, { ...addon, quantity: 1 }];
            }
        });
    };

    const isSelected = (addon) => {
        if (!selectedAddonsList) return false;
        const addonNameStr = safeExtractString(addon?.name).toLowerCase();
        return selectedAddonsList.some(a => a.id === addon.id || safeExtractString(a?.name).toLowerCase() === addonNameStr);
    };

    const subtotal = (selectedAddonsList || []).reduce((sum, item) => {
        const p = safeExtractNumber(item?.price, 0);
        const q = safeExtractNumber(item?.quantity, 1);
        return sum + (p * q);
    }, 0);

    if (loading) {
        return <div className="flex flex-col items-center justify-center py-20"><Loader2 className="w-10 h-10 animate-spin text-gold mb-4" /><p className="text-gray-400">Loading equipment options...</p></div>;
    }

    return (
        <div className="space-y-8 animate-in fade-in duration-500 max-w-5xl mx-auto w-full">
            <div className="text-center space-y-3 pb-2">
                <div className="mx-auto w-14 h-14 bg-[hsl(var(--gold)_/_0.1)] border border-[hsl(var(--gold)_/_0.2)] rounded-2xl flex items-center justify-center mb-4 shadow-gold">
                    <PackagePlus className="w-7 h-7 text-gold" />
                </div>
                <h2 className="text-3xl font-extrabold text-white tracking-tight">Enhance Your Booking</h2>
                <p className="text-base text-gray-400 max-w-2xl mx-auto">
                    Select additional equipment or protection plans. Your original selections have been pre-selected.
                </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {availableEquipment?.map((addon, idx) => (
                    <RescheduleAddonsCard 
                        key={`addon-${addon?.id || idx}`}
                        addon={addon}
                        isSelected={isSelected(addon)}
                        onToggle={handleToggle}
                    />
                ))}
            </div>

            <div className="bg-gray-900 border border-[hsl(var(--gold)_/_0.2)] p-6 rounded-2xl flex justify-between items-center mt-8 shadow-xl">
                <div>
                    <span className="text-gold-light font-black text-xs uppercase tracking-widest block mb-1">Add-ons Subtotal</span>
                    <span className="text-gray-400 text-sm font-medium">{selectedAddonsList?.length || 0} items selected</span>
                </div>
                <span className="text-3xl font-black text-gold drop-shadow-[0_0_10px_hsla(var(--gold),0.3)]">
                    +{formatCurrency(subtotal * 100, {code: 'USD', symbol: '$'})}
                </span>
            </div>
        </div>
    );
};
