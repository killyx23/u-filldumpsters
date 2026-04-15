import React from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, ArrowRight, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { format, parseISO, isValid } from 'date-fns';
import { useInsurancePricing } from '@/hooks/useInsurancePricing';

export const BookingSummaryReview = ({
    bookingData,
    plan,
    addonsData,
    totalPrice,
    basePrice,
    onBack,
    onContinue,
    deliveryService
}) => {
    const isDelivery = plan?.id === 2 && deliveryService;
    const { insurancePrice } = useInsurancePricing();

    const formatDate = date => {
        if (!date) return 'N/A';
        try {
            const parsedDate = date instanceof Date ? date : parseISO(date.toString());
            if (!isValid(parsedDate)) return "Invalid Date";
            return format(parsedDate, 'MMM d, yyyy');
        } catch (e) {
            return "Invalid Date";
        }
    };

    const formatTime = (timeString) => {
        if (!timeString) return 'N/A';
        try {
            const [hours, minutes] = timeString.split(':');
            const date = new Date();
            date.setHours(parseInt(hours, 10));
            date.setMinutes(parseInt(minutes || '0', 10));
            return isValid(date) ? format(date, 'h:mm a') : timeString;
        } catch (e) {
            return typeof timeString === 'string' ? timeString : 'N/A';
        }
    };

    const equipmentList = [
        { id: 'wheelbarrow', label: 'Wheelbarrow', price: 10 },
        { id: 'handTruck', label: 'Hand Truck', price: 15 },
        { id: 'gloves', label: 'Working Gloves (Pair)', price: 5 }
    ];

    const addonPrices = {
        drivewayProtection: 15,
    };

    const planName = plan?.name || 'Selected Plan';
    const displayPlanName = isDelivery ? `${planName} (with Delivery)` : planName;

    const contactAddress = bookingData?.contactAddress || {};
    
    // Task implementation: Custom location logic for review step
    const isDumpsterService = plan?.id === 2 && !deliveryService;
    const displayLocation = isDumpsterService 
        ? "South Saratoga Springs" 
        : (contactAddress.city || bookingData?.city || 'City not provided');

    const basePriceAmount = plan?.price !== undefined ? plan.price : (basePrice || 0);
    const deliveryFeeFlat = addonsData?.deliveryFee || 0;
    const tripMileageCost = addonsData?.mileageCharge || 0;
    
    let subtotal = basePriceAmount + deliveryFeeFlat + tripMileageCost;

    if (addonsData?.insurance === 'accept') subtotal += insurancePrice;
    if ((plan?.id === 1 || isDelivery) && addonsData?.drivewayProtection === 'accept') subtotal += addonPrices.drivewayProtection;
    
    if (addonsData?.equipment?.length > 0) {
        addonsData.equipment.forEach(item => {
            const eq = equipmentList.find(e => e.id === item.id);
            if (eq) subtotal += (eq.price * item.quantity);
        });
    }

    if (addonsData?.mattressDisposal > 0) subtotal += (addonsData.mattressDisposal * 25);
    if (addonsData?.tvDisposal > 0) subtotal += (addonsData.tvDisposal * 15);
    if (addonsData?.applianceDisposal > 0) subtotal += (addonsData.applianceDisposal * 35);

    const discountAmount = addonsData?.coupon?.isValid 
        ? (addonsData.coupon.discountType === 'fixed' ? (addonsData.coupon.discountValue || 0) : (subtotal * (addonsData.coupon.discountValue / 100))) 
        : 0;

    const displayTotal = subtotal - discountAmount;

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="container mx-auto py-12 px-4"
        >
            <div className="max-w-3xl mx-auto bg-white/10 backdrop-blur-lg rounded-2xl p-8 shadow-2xl border border-white/20">
                <div className="flex items-center mb-8 border-b border-white/10 pb-4">
                    <Button onClick={onBack} variant="ghost" size="icon" className="mr-4 text-white hover:bg-white/20">
                        <ArrowLeft />
                    </Button>
                    <h2 className="text-3xl font-bold text-white flex items-center">
                        <CheckCircle2 className="mr-3 h-8 w-8 text-green-400" />
                        Booking Summary Review
                    </h2>
                </div>

                <div className="space-y-6">
                    <div className="bg-black/20 p-6 rounded-xl border border-white/10">
                        <h3 className="text-xl font-bold text-yellow-400 mb-4 border-b border-white/10 pb-2">Service Details</h3>
                        <div className="grid md:grid-cols-2 gap-4 text-gray-200">
                            <div>
                                <p className="text-sm text-gray-400">Selected Plan</p>
                                <p className="font-semibold text-white text-lg">{displayPlanName}</p>
                            </div>
                            <div>
                                <p className="text-sm text-gray-400">Location</p>
                                <p className="font-semibold text-white text-lg">{displayLocation}</p>
                            </div>
                            <div>
                                <p className="text-sm text-gray-400">{isDelivery ? 'Delivery' : 'Drop-off'}</p>
                                <p className="font-semibold text-white">{formatDate(bookingData?.dropOffDate)}</p>
                                <p className="text-sm">{formatTime(bookingData?.dropOffTimeSlot)}</p>
                            </div>
                            {bookingData?.pickupDate && (
                                <div>
                                    <p className="text-sm text-gray-400">{isDelivery ? 'Pickup' : 'Return'}</p>
                                    <p className="font-semibold text-white">{formatDate(bookingData.pickupDate)}</p>
                                    <p className="text-sm">{formatTime(bookingData.pickupTimeSlot)}</p>
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="bg-black/20 p-6 rounded-xl border border-white/10">
                        <h3 className="text-xl font-bold text-yellow-400 mb-4 border-b border-white/10 pb-2">Price Breakdown</h3>
                        <div className="space-y-3 text-gray-200">
                            <div className="flex justify-between">
                                <span>Base Rental Price</span>
                                <span>${basePriceAmount.toFixed(2)}</span>
                            </div>

                            {deliveryFeeFlat > 0 && (
                                <div className="flex justify-between text-blue-300">
                                    <span>Delivery Fee (Flat)</span>
                                    <span>${deliveryFeeFlat.toFixed(2)}</span>
                                </div>
                            )}

                            {tripMileageCost > 0 && (
                                <div className="flex flex-col">
                                    <div className="flex justify-between text-blue-300">
                                        <span>Mileage Charge</span>
                                        <span>${tripMileageCost.toFixed(2)}</span>
                                    </div>
                                    {addonsData.distanceFeeDisplay && (
                                        <div className="text-[11px] text-cyan-300/70 mt-0.5">
                                            {addonsData.distanceFeeDisplay}
                                        </div>
                                    )}
                                </div>
                            )}

                            {addonsData?.equipment?.length > 0 && addonsData.equipment.map(item => {
                                const eq = equipmentList.find(e => e.id === item.id);
                                if (!eq) return null;
                                return (
                                    <div key={item.id} className="flex justify-between text-blue-300">
                                        <span>{eq.label} (x{item.quantity})</span>
                                        <span>${(eq.price * item.quantity).toFixed(2)}</span>
                                    </div>
                                );
                            })}
                            
                            {(addonsData?.mattressDisposal || 0) > 0 && (
                                <div className="flex justify-between text-blue-300">
                                    <span>Mattress Disposal (x{addonsData.mattressDisposal})</span>
                                    <span>${(addonsData.mattressDisposal * 25).toFixed(2)}</span>
                                </div>
                            )}

                            {(addonsData?.tvDisposal || 0) > 0 && (
                                <div className="flex justify-between text-blue-300">
                                    <span>TV Disposal (x{addonsData.tvDisposal})</span>
                                    <span>${(addonsData.tvDisposal * 15).toFixed(2)}</span>
                                </div>
                            )}

                            {(addonsData?.applianceDisposal || 0) > 0 && (
                                <div className="flex justify-between text-blue-300">
                                    <span>Appliance Disposal (x{addonsData.applianceDisposal})</span>
                                    <span>${(addonsData.applianceDisposal * 35).toFixed(2)}</span>
                                </div>
                            )}
                            
                            {addonsData?.insurance === 'accept' && (
                                <div className="flex justify-between text-blue-300">
                                    <span>Rental Insurance</span>
                                    <span>${insurancePrice.toFixed(2)}</span>
                                </div>
                            )}
                            
                            {(plan?.id === 1 || isDelivery) && addonsData?.drivewayProtection === 'accept' && (
                                <div className="flex justify-between text-blue-300">
                                    <span>Driveway Protection</span>
                                    <span>${addonPrices.drivewayProtection.toFixed(2)}</span>
                                </div>
                            )}

                            <div className="border-t border-white/20 pt-2 mt-2">
                                <div className="flex justify-between font-semibold text-gray-300">
                                    <span>Subtotal</span>
                                    <span>${subtotal.toFixed(2)}</span>
                                </div>
                            </div>

                            {discountAmount > 0 && (
                                <div className="flex justify-between text-green-400 font-semibold mt-2">
                                    <span>Discount ({addonsData.coupon.code || 'Applied'})</span>
                                    <span>-${discountAmount.toFixed(2)}</span>
                                </div>
                            )}

                            <div className="border-t border-white/20 pt-4 mt-4">
                                <div className="flex justify-between items-center text-xl font-bold text-white">
                                    <span>Estimated Total</span>
                                    <span className="text-green-400">${displayTotal.toFixed(2)} <span className="text-sm text-gray-400 font-normal">(plus tax)</span></span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="pt-4">
                        <Button 
                            onClick={onContinue} 
                            className="w-full py-6 text-lg font-bold bg-gradient-to-r from-yellow-500 to-orange-500 hover:from-yellow-600 hover:to-orange-600 text-black shadow-lg shadow-yellow-900/50"
                        >
                            Continue to Contact Info <ArrowRight className="ml-2 h-5 w-5" />
                        </Button>
                    </div>
                </div>
            </div>
        </motion.div>
    );
};