
    import React from 'react';
    import { Button } from '@/components/ui/button';
    import { Label } from '@/components/ui/label';
    import { Textarea } from '@/components/ui/textarea';
    import { Check, MessageSquare } from 'lucide-react';

    const SummaryLine = ({ label, value, isSubItem = false }) => (
        <div className={`flex justify-between items-center ${isSubItem ? 'pl-4' : ''}`}>
            <p className={isSubItem ? 'text-blue-200' : 'text-white'}>{label}</p>
            <p className="font-mono text-green-300">${value.toFixed(2)}</p>
        </div>
    );

    export const OrderSummary = ({ basePrice, addonsData, totalPrice, setAddonsData, handleBookingSubmit, plan, equipmentMeta, addonPrices }) => {
        return (
            <div className="bg-white/5 p-6 rounded-lg flex flex-col">
                <h3 className="text-2xl font-bold text-yellow-400 mb-4">Your Order Summary</h3>
                <div className="space-y-2 text-white flex-grow">
                    <SummaryLine label="Base Price" value={basePrice} />
                    {addonsData.distanceInfo?.fee > 0 && <SummaryLine label={`Extended Delivery (${addonsData.distanceInfo.miles.toFixed(1)} miles)`} value={addonsData.distanceInfo.fee} />}
                    {addonsData.insurance === 'accept' && <SummaryLine label="Rental Insurance" value={addonPrices.insurance} />}
                    {plan.id !== 2 && addonsData.drivewayProtection === 'accept' && <SummaryLine label="Driveway Protection" value={addonPrices.drivewayProtection} />}
                    {addonsData.equipment.length > 0 && <p className="font-semibold pt-2">Equipment:</p>}
                    {addonsData.equipment.map(item => {
                        const equipmentInfo = equipmentMeta.find(e => e.id === item.id);
                        return (
                            <SummaryLine key={item.id} label={`${equipmentInfo.label} (x${item.quantity})`} value={equipmentInfo.price * item.quantity} isSubItem />
                        );
                    })}
                </div>
                <div className="border-t border-white/20 pt-4 mt-4">
                    <p className="text-white text-lg font-semibold">Final Total:</p>
                    <p className="text-5xl font-bold text-green-400">${totalPrice.toFixed(2)}</p>
                </div>
                <div className="mt-6">
                    <Label htmlFor="customer-notes" className="flex items-center text-lg font-semibold text-white mb-2">
                        <MessageSquare className="h-5 w-5 mr-2 text-yellow-400" />
                        Special Instructions
                    </Label>
                    <Textarea 
                        id="customer-notes"
                        value={addonsData.notes || ''}
                        onChange={(e) => setAddonsData(prev => ({ ...prev, notes: e.target.value }))}
                        placeholder="Any special instructions for delivery or pickup? (e.g., gate code, specific placement)"
                        className="bg-white/10 min-h-[100px]"
                    />
                </div>
                <Button onClick={handleBookingSubmit} className="w-full mt-6 py-3 text-lg font-semibold bg-gradient-to-r from-green-500 to-teal-600 hover:from-green-600 hover:to-teal-700 text-white">
                    <Check className="mr-2" /> Complete Booking
                </Button>
            </div>
        );
    };
  