import React from 'react';
import { ArrowRight, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

export const OrderSummary = ({ basePrice, addonsData, totalPrice, setAddonsData, handleBookingSubmit, plan, equipmentMeta, addonPrices, deliveryService }) => {
    
    const isDelivery = plan.id === 2 && deliveryService;
    
    return (
        <div className="bg-white/5 p-6 rounded-lg space-y-4 flex flex-col">
            <h3 className="text-2xl font-bold text-yellow-400">Order Summary</h3>
            <div className="flex-grow space-y-3 text-sm">
                <div className="flex justify-between">
                    <span className="text-blue-200">Base Price:</span>
                    <span className="text-white font-semibold">${basePrice.toFixed(2)}</span>
                </div>
                {addonsData.distanceInfo?.fee > 0 && (
                    <div className="flex justify-between">
                        <span className="text-blue-200">Extended Delivery Fee:</span>
                        <span className="text-white font-semibold">${addonsData.distanceInfo.fee.toFixed(2)}</span>
                    </div>
                )}
                {addonsData.insurance === 'accept' && plan.id !== 1 && (
                    <div className="flex justify-between">
                        <span className="text-blue-200">Rental Insurance:</span>
                        <span className="text-white font-semibold">${addonPrices.insurance.toFixed(2)}</span>
                    </div>
                )}
                {(plan.id === 1 || isDelivery) && addonsData.drivewayProtection === 'accept' && (
                    <div className="flex justify-between">
                        <span className="text-blue-200">Driveway Protection:</span>
                        <span className="text-white font-semibold">${addonPrices.drivewayProtection.toFixed(2)}</span>
                    </div>
                )}
                {addonsData.equipment.length > 0 && (
                    <div className="pt-2 border-t border-white/10">
                        <p className="text-blue-200 mb-1">Equipment:</p>
                        {addonsData.equipment.map(item => {
                            const equipmentInfo = equipmentMeta.find(e => e.id === item.id);
                            if (!equipmentInfo) return null;
                            return (
                                <div key={item.id} className="flex justify-between">
                                    <span className="text-blue-200 pl-2">{equipmentInfo.label} x{item.quantity}</span>
                                    <span className="text-white font-semibold">${(equipmentInfo.price * item.quantity).toFixed(2)}</span>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
            
            <div className="border-t border-white/20 pt-4">
                <div className="flex justify-between items-baseline">
                    <span className="text-white text-lg font-bold">Total:</span>
                    <span className="text-green-400 text-3xl font-bold">${totalPrice.toFixed(2)}</span>
                </div>
                <p className="text-xs text-blue-200 text-right">(plus tax)</p>
            </div>
            
            <div>
                <label htmlFor="notes" className="text-sm font-semibold text-white mb-2 block">Special Instructions / Notes</label>
                <Textarea 
                    id="notes" 
                    placeholder="e.g., Placement instructions, gate codes..." 
                    className="bg-white/10 border-white/30"
                    value={addonsData.notes}
                    onChange={(e) => setAddonsData(prev => ({...prev, notes: e.target.value}))}
                />
            </div>
            
            <Button
                onClick={handleBookingSubmit}
                className="w-full py-3 text-lg font-semibold bg-gradient-to-r from-yellow-500 to-orange-600 hover:from-yellow-600 hover:to-orange-700 text-black disabled:opacity-50"
            >
                Continue to Agreement
                <ArrowRight className="ml-2" />
            </Button>
        </div>
    );
};