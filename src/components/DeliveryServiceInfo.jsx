import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { supabase } from '@/lib/customSupabaseClient';
import { Loader2, Info } from 'lucide-react';
import { useDumpFees } from '@/hooks/useDumpFees';

export const DeliveryServiceInfo = ({ isOpen, onClose, planId = 2 }) => {
    const [service, setService] = useState(null);
    const [loading, setLoading] = useState(true);
    const { getFeeForService } = useDumpFees();

    useEffect(() => {
        if (isOpen) {
            const fetchDetails = async () => {
                setLoading(true);
                // Default to the provided planId or fallback to 2 (typically Dump Loader Trailer with Delivery)
                const { data } = await supabase.from('services').select('*').eq('id', planId).single();
                if (data) {
                    setService(data);
                }
                setLoading(false);
            };
            fetchDetails();
        }
    }, [isOpen, planId]);

    const formatCurrency = (val) => {
        return val !== undefined && val !== null ? Number(val).toFixed(2) : '0.00';
    };

    const dumpFeeData = getFeeForService(service?.id === 1 ? 1 : 4);
    const dynamicFee = dumpFeeData?.fee_per_ton ? parseFloat(dumpFeeData.fee_per_ton).toFixed(2) : '45.00';
    const dynamicMaxTons = dumpFeeData?.max_tons ? parseFloat(dumpFeeData.max_tons) : (service?.id === 1 ? 2 : 2.5);

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="bg-slate-900 text-white border-white/20 z-[9999] shadow-2xl">
                <DialogHeader>
                    <DialogTitle className="flex items-center text-yellow-400 text-xl font-bold">
                        <Info className="mr-3 h-6 w-6" /> About Our Delivery Service
                    </DialogTitle>
                </DialogHeader>
                {loading ? (
                    <div className="flex justify-center items-center py-12">
                        <Loader2 className="h-8 w-8 animate-spin text-yellow-400" />
                    </div>
                ) : (
                    <div className="space-y-5 py-4 text-gray-200">
                        <p className="text-lg">
                            Here are the pricing details for the <strong>{service?.name || 'Delivery Service'}</strong>:
                        </p>
                        <div className="bg-white/5 p-4 rounded-lg border border-white/10 space-y-3">
                            <div className="flex items-start">
                                <div className="h-2 w-2 rounded-full bg-cyan-400 mt-2 mr-3 flex-shrink-0"></div>
                                <p><strong>Flat fee of ${formatCurrency(service?.base_price)}</strong> for drop-off and pickup.</p>
                            </div>
                            <div className="flex items-start">
                                <div className="h-2 w-2 rounded-full bg-cyan-400 mt-2 mr-3 flex-shrink-0"></div>
                                <p><strong>Mileage charge of ${formatCurrency(service?.mileage_rate)}</strong> per mile (round trip). {service?.id === 1 && <span className="text-green-400 ml-1">(First 30 miles are free!)</span>}</p>
                            </div>
                            <div className="flex items-start">
                                <div className="h-2 w-2 rounded-full bg-cyan-400 mt-2 mr-3 flex-shrink-0"></div>
                                <p><strong>Dump fees:</strong> ${dynamicFee} per ton{dynamicMaxTons ? ` (${dynamicMaxTons} tons max)` : ''}.</p>
                            </div>
                        </div>
                        <p className="text-sm text-gray-400 mt-4 italic bg-black/20 p-3 rounded border border-white/5">
                            Note: All fees are calculated based on our latest dynamically updated rates and apply to your total driving distance.
                        </p>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
};