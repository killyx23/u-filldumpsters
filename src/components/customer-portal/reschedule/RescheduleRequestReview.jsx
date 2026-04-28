import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { format } from 'date-fns';
import { Clock, Calendar, MapPin, MessageSquare, Package, CheckSquare, DollarSign, ArrowRight, ShieldCheck } from 'lucide-react';
import { formatCurrency } from '@/api/EcommerceApi';
import { convertTo12Hour } from '@/utils/timeFormatConverter';
import { safeExtractString, safeExtractNumber } from '@/utils/stringExtractors';
import { calculateBookingCosts, calculateDays } from '@/utils/rescheduleCalculations';

export const RescheduleRequestReview = ({ 
    bookingId,
    originalBooking, 
    originalService, 
    newService, 
    newDropOffDate, 
    newPickupDate, 
    newDropOffTime, 
    newPickupTime, 
    selectedAddonsList,
    deliveryAddress, 
    comments 
}) => {
    // Calculate original costs
    const origDays = calculateDays(originalBooking?.drop_off_date, originalBooking?.pickup_date);
    const originalDistance = Number(originalBooking?.customers?.distance_miles || 0);
    
    // Get original addons from booking_equipment (passed via selectedAddonsList initially)
    const originalAddonsList = [];
    if (originalBooking?.addons && typeof originalBooking.addons === 'object') {
        Object.entries(originalBooking.addons).forEach(([key, val]) => {
            if (key.toLowerCase().includes('insurance')) {
                const price = typeof val === 'object' ? Number(val.price || 25) : Number(val || 25);
                originalAddonsList.push({
                    id: 'insurance',
                    name: 'Premium Insurance',
                    quantity: 1,
                    price: price
                });
            }
        });
    }
    
    const originalCosts = calculateBookingCosts(originalService, origDays, originalAddonsList, originalDistance);
    
    // Calculate new costs
    const newDays = calculateDays(newDropOffDate, newPickupDate);
    const newDistance = originalDistance; // Using same distance unless address changed
    const newCosts = calculateBookingCosts(newService, newDays, selectedAddonsList || [], newDistance);
    
    const diffVal = newCosts.total - originalCosts.total;
    
    const originalServiceName = safeExtractString(originalService?.name, 'Standard Service');
    const newServiceName = safeExtractString(newService?.name, 'New Service');
    
    const origDropOffStr = safeExtractString(originalBooking?.drop_off_date);
    const origPickupStr = safeExtractString(originalBooking?.pickup_date);
    const origDropOffTimeStr = safeExtractString(originalBooking?.drop_off_time_slot, '08:00');
    const origPickupTimeStr = safeExtractString(originalBooking?.pickup_time_slot, '17:00');

    const newDropOffTimeStr = safeExtractString(newDropOffTime, '08:00');
    const newPickupTimeStr = safeExtractString(newPickupTime, '17:00');
    const safeAddress = safeExtractString(deliveryAddress, 'No address provided');
    const safeComments = safeExtractString(comments, '');

    // Agreements state (these should all be true to reach this step)
    const agreements = {
        terms: true,
        charges: true,
        release: true
    };

    return (
        <div className="space-y-8 animate-in fade-in duration-500 max-w-6xl mx-auto w-full">
            <div className="text-center space-y-4 mb-8">
                <div className="inline-flex items-center justify-center px-6 py-2.5 rounded-full bg-[hsl(var(--gold)_/_0.1)] text-gold border border-gold/40 text-sm font-bold shadow-gold">
                    <ShieldCheck className="w-5 h-5 mr-2" /> Official Request Review
                </div>
                <h2 className="text-4xl font-extrabold text-white tracking-tight">Confirm Details</h2>
                <p className="text-base text-gray-400 max-w-2xl mx-auto">Please meticulously review all parameters of your request. Submitting this form formally requests new dates pending admin approval.</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto_1fr] gap-6 items-stretch">
                {/* Original Details */}
                <Card className="bg-gray-900/80 border-gray-800 shadow-none h-full flex flex-col rounded-2xl">
                    <CardContent className="p-8 flex-1 flex flex-col space-y-6">
                        <h4 className="font-black text-gray-500 flex items-center border-b border-gray-800 pb-4 uppercase tracking-widest text-xs">
                            <Calendar className="w-5 h-5 mr-2"/> Original Booking
                        </h4>
                        <div className="text-base text-gray-400 space-y-6 flex-1">
                            <div className="flex items-start">
                                <Package className="w-6 h-6 mr-4 mt-1 opacity-60 shrink-0"/> 
                                <div>
                                    <span className="text-gray-200 font-bold text-xl block mb-2">{originalServiceName}</span>
                                </div>
                            </div>
                            <div className="bg-gray-950 p-5 rounded-xl border border-gray-800 space-y-3 shadow-inner">
                                <p className="flex items-center">
                                    <Clock className="w-5 h-5 mr-3 opacity-60 shrink-0"/> 
                                    <span className="text-gray-300 font-medium">Start: {origDropOffStr ? format(new Date(origDropOffStr), 'MMM d, yyyy') : 'N/A'} @ {convertTo12Hour(origDropOffTimeStr)}</span>
                                </p>
                                <p className="flex items-center">
                                    <Clock className="w-5 h-5 mr-3 opacity-60 shrink-0"/> 
                                    <span className="text-gray-300 font-medium">End: {origPickupStr ? format(new Date(origPickupStr), 'MMM d, yyyy') : 'N/A'} @ {convertTo12Hour(origPickupTimeStr)}</span>
                                </p>
                            </div>
                        </div>
                        <div className="pt-6 border-t border-gray-800 flex justify-between items-end">
                            <span className="text-xs font-black text-gray-500 uppercase tracking-widest">Original Receipt</span>
                            <span className="text-2xl font-bold text-gray-300">{formatCurrency(originalCosts.total * 100, {code: 'USD', symbol: '$'})}</span>
                        </div>
                    </CardContent>
                </Card>

                <div className="flex justify-center items-center py-4 lg:py-0">
                    <ArrowRight className="w-10 h-10 text-gray-700 rotate-90 lg:rotate-0" />
                </div>

                {/* New Details */}
                <Card className="bg-[hsl(var(--gold)_/_0.03)] border-[hsl(var(--gold)_/_0.4)] shadow-[0_0_30px_hsla(var(--gold),0.05)] h-full flex flex-col relative overflow-hidden rounded-2xl">
                    <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-gold to-gold-light"></div>
                    <CardContent className="p-8 flex-1 flex flex-col space-y-6">
                        <h4 className="font-black text-gold flex items-center border-b border-[hsl(var(--gold)_/_0.2)] pb-4 uppercase tracking-widest text-xs">
                            <Calendar className="w-5 h-5 mr-2"/> New Request
                        </h4>
                        <div className="text-base text-yellow-100/90 space-y-6 flex-1">
                            <div className="flex items-start">
                                <Package className="w-6 h-6 mr-4 mt-1 text-gold shrink-0"/> 
                                <div>
                                    <span className="text-white font-black text-xl block mb-2">{newServiceName}</span>
                                    <div className="flex flex-wrap gap-2 text-gold-light mt-3">
                                        {(selectedAddonsList || []).map((addon, idx) => {
                                            const aName = safeExtractString(addon?.name, 'Add-on');
                                            return (
                                                <span key={`new-addon-${idx}`} className="bg-[hsl(var(--gold)_/_0.15)] border border-[hsl(var(--gold)_/_0.3)] px-3 py-1 text-xs font-bold rounded-md shadow-sm">
                                                    {aName}
                                                </span>
                                            );
                                        })}
                                    </div>
                                </div>
                            </div>
                            <div className="bg-gray-950/80 p-5 rounded-xl border border-[hsl(var(--gold)_/_0.3)] space-y-3 shadow-inner">
                                <p className="flex items-center text-white">
                                    <Clock className="w-5 h-5 mr-3 text-gold shrink-0"/> 
                                    <span className="font-bold">Start: {newDropOffDate ? format(newDropOffDate, 'MMM d, yyyy') : 'N/A'} @ {convertTo12Hour(newDropOffTimeStr)}</span>
                                </p>
                                <p className="flex items-center text-white">
                                    <Clock className="w-5 h-5 mr-3 text-gold shrink-0"/> 
                                    <span className="font-bold">End: {newPickupDate ? format(newPickupDate, 'MMM d, yyyy') : 'N/A'} @ {convertTo12Hour(newPickupTimeStr)}</span>
                                </p>
                            </div>
                        </div>
                        <div className="pt-6 border-t border-[hsl(var(--gold)_/_0.2)] flex justify-between items-end">
                            <span className="text-xs font-black text-gold-light uppercase tracking-widest">New Receipt</span>
                            <span className="text-3xl font-black text-gold drop-shadow-[0_0_8px_hsla(var(--gold),0.4)]">{formatCurrency(newCosts.total * 100, {code: 'USD', symbol: '$'})}</span>
                        </div>
                    </CardContent>
                </Card>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Card className="bg-gray-900 border-gray-800 rounded-2xl">
                    <CardContent className="p-8 flex flex-col h-full justify-center space-y-6">
                        <div className="flex justify-between items-center border-b border-gray-800 pb-6">
                            <div className="space-y-1.5">
                                <h4 className="font-black text-white flex items-center text-sm uppercase tracking-widest">
                                    <DollarSign className="w-5 h-5 mr-2 text-gold"/> Final Adjustment
                                </h4>
                                <p className="text-sm text-gray-400">Total physical difference to account for</p>
                            </div>
                            <div className={`text-3xl font-black px-5 py-2.5 rounded-xl border ${diffVal > 0 ? 'bg-red-950/40 text-red-400 border-red-900/50' : diffVal < 0 ? 'bg-green-950/40 text-green-400 border-green-900/50' : 'bg-gray-950 text-white border-gray-800'}`}>
                                {diffVal > 0 ? '+' : ''}{formatCurrency(diffVal * 100, {code: 'USD', symbol: '$'})}
                            </div>
                        </div>
                        <div className="space-y-3">
                            <h4 className="font-black text-white flex items-center text-xs uppercase tracking-widest">
                                <MapPin className="w-4 h-4 mr-2 text-gold"/> Delivery Address
                            </h4>
                            <p className="text-base text-gray-300 font-medium pl-6 bg-gray-950 p-4 rounded-xl border border-gray-800 truncate shadow-inner">{safeAddress}</p>
                        </div>
                    </CardContent>
                </Card>

                <Card className="bg-gray-900 border-gray-800 rounded-2xl">
                    <CardContent className="p-8 flex flex-col h-full justify-center space-y-6">
                        <div className="space-y-4">
                            <h4 className="font-black text-white flex items-center text-xs uppercase tracking-widest border-b border-gray-800 pb-3">
                                <CheckSquare className="w-4 h-4 mr-2 text-gold"/> Authorizations Provided
                            </h4>
                            <ul className="text-sm text-green-400 space-y-3 font-bold bg-gray-950 p-5 rounded-xl border border-gray-800 shadow-inner">
                                {agreements?.terms && <li className="flex items-center"><CheckSquare className="w-5 h-5 mr-3 shrink-0 text-green-500"/> Terms & Conditions Accepted</li>}
                                {agreements?.charges && <li className="flex items-center"><CheckSquare className="w-5 h-5 mr-3 shrink-0 text-green-500"/> Pricing Changes Authorized</li>}
                                {agreements?.release && <li className="flex items-center"><CheckSquare className="w-5 h-5 mr-3 shrink-0 text-green-500"/> Date Release Acknowledged</li>}
                            </ul>
                        </div>

                        {safeComments && (
                            <div className="space-y-3">
                                <h4 className="font-black text-white flex items-center text-xs uppercase tracking-widest border-b border-gray-800 pb-3">
                                    <MessageSquare className="w-4 h-4 mr-2 text-gold"/> Customer Notes
                                </h4>
                                <p className="text-sm text-gray-300 italic border-l-4 border-gold bg-gray-950 p-4 rounded-r-xl max-h-32 overflow-y-auto shadow-inner">{safeComments}</p>
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
            
            <div className="bg-red-950/30 border-2 border-red-900/60 p-5 rounded-2xl text-center text-red-400 text-sm font-bold shadow-lg flex items-center justify-center">
                <span className="text-xl mr-3">⚠️</span> IMPORTANT: Submitting this request sends it to administration for review. Approval is required before dates are locked in.
            </div>
        </div>
    );
};