import React from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, ArrowRight, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { format, parseISO, isValid } from 'date-fns';

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
        insurance: 20,
        drivewayProtection: 15,
    };

    const planName = plan?.name || 'Selected Plan';
    const displayPlanName = isDelivery ? `${planName} (with Delivery)` : planName;

    const contactAddress = bookingData?.contactAddress || {};
    const hasAddress = contactAddress.street || bookingData?.street || isDelivery;
    const displayStreet = contactAddress.street || bookingData?.street || 'Address not provided';
    const displayCity = contactAddress.city || bookingData?.city || '';
    const displayState = contactAddress.state || bookingData?.state || '';
    const displayZip = contactAddress.zip || bookingData?.zip || '';

    // basePrice passed from AddonsForm includes the delivery fee initially set by BookingForm.
    // We isolate the actual base rental to display it clearly ($80 base rental vs $20 delivery fee).
    const deliveryFeeAmount = addonsData?.deliveryFee || 0;
    const displayBasePrice = (basePrice || 0) - deliveryFeeAmount;

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
                            {hasAddress && (
                                <div>
                                    <p className="text-sm text-gray-400">Location</p>
                                    <p className="font-semibold text-white">{displayStreet}</p>
                                    <p className="text-sm">{displayCity}, {displayState} {displayZip}</p>
                                </div>
                            )}
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
                                <span>${displayBasePrice.toFixed(2)}</span>
                            </div>

                            {deliveryFeeAmount > 0 && (
                                <div className="flex justify-between text-blue-300">
                                    <span>Delivery Fee</span>
                                    <span>${deliveryFeeAmount.toFixed(2)}</span>
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
                            
                            {(addonsData?.mileageCharge || 0) > 0 && (
                                <div className="flex flex-col">
                                    <div className="flex justify-between text-blue-300">
                                        <span>Mileage Charge</span>
                                        <span>${addonsData.mileageCharge.toFixed(2)}</span>
                                    </div>
                                    {addonsData.distanceFeeDisplay && (
                                        <div className="text-[11px] text-cyan-300/70 mt-0.5">
                                            {addonsData.distanceFeeDisplay}
                                        </div>
                                    )}
                                </div>
                            )}
                            
                            {addonsData?.insurance === 'accept' && (
                                <div className="flex justify-between text-blue-300">
                                    <span>Rental Insurance</span>
                                    <span>${addonPrices.insurance.toFixed(2)}</span>
                                </div>
                            )}
                            
                            {(plan?.id === 1 || isDelivery) && addonsData?.drivewayProtection === 'accept' && (
                                <div className="flex justify-between text-blue-300">
                                    <span>Driveway Protection</span>
                                    <span>${addonPrices.drivewayProtection.toFixed(2)}</span>
                                </div>
                            )}

                            {addonsData?.coupon?.isValid && (
                                <div className="flex justify-between text-green-400 font-semibold">
                                    <span>Discount ({addonsData.coupon.code || 'Applied'})</span>
                                    <span>
                                        {addonsData.coupon.discountType === 'fixed' 
                                            ? `-$${(addonsData.coupon.discountValue || 0).toFixed(2)}` 
                                            : `-${addonsData.coupon.discountValue || 0}%`}
                                    </span>
                                </div>
                            )}

                            <div className="border-t border-white/20 pt-4 mt-4">
                                <div className="flex justify-between items-center text-xl font-bold text-white">
                                    <span>Estimated Total</span>
                                    <span className="text-green-400">${(totalPrice || 0).toFixed(2)} <span className="text-sm text-gray-400 font-normal">(plus tax)</span></span>
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