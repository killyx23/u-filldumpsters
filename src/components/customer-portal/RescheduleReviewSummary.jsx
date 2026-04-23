
import React from 'react';
import { format, parseISO } from 'date-fns';
import { formatCurrency } from '@/api/EcommerceApi';
import { ArrowRight, Calendar, Clock, Receipt, AlertCircle } from 'lucide-react';
import { Card, CardContent } from "@/components/ui/card";
import { formatRescheduleMessage } from '@/utils/rescheduleCalculations';

export const RescheduleReviewSummary = ({ 
    booking, 
    newDropOffDate, 
    newPickupDate, 
    newDropOffTime, 
    newPickupTime, 
    selectedServiceData,
    costBreakdown,
    terminology 
}) => {
    
    const isServiceChanged = booking?.plan?.id !== selectedServiceData?.id;
    const isCredit = costBreakdown.totalChange < 0;
    
    return (
        <div className="space-y-6">
            
            {/* Change Comparison */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Original */}
                <Card className="bg-gray-900 border-gray-800 opacity-70">
                    <CardContent className="p-4 space-y-3">
                        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 border-b border-gray-800 pb-2">Original Booking</div>
                        
                        <div className="flex items-start gap-2">
                            <Receipt className="w-4 h-4 text-gray-400 mt-0.5" />
                            <div className="text-sm text-gray-300">{booking?.plan?.name}</div>
                        </div>
                        
                        <div className="flex items-start gap-2">
                            <Calendar className="w-4 h-4 text-gray-400 mt-0.5" />
                            <div className="text-sm text-gray-300">
                                {format(parseISO(booking.drop_off_date), 'MMM d, yyyy')} - {format(parseISO(booking.pickup_date), 'MMM d, yyyy')}
                            </div>
                        </div>
                        
                        <div className="flex items-start gap-2">
                            <Clock className="w-4 h-4 text-gray-400 mt-0.5" />
                            <div className="text-sm text-gray-300">
                                {booking.drop_off_time_slot} / {booking.pickup_time_slot}
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Arrow indicator for desktop */}
                <div className="hidden md:flex absolute left-1/2 top-[40%] -translate-x-1/2 -translate-y-1/2 z-10 bg-gray-900 rounded-full p-2 border border-gray-800">
                    <ArrowRight className="w-5 h-5 text-gray-500" />
                </div>

                {/* New */}
                <Card className="bg-gray-800 border-yellow-500/30 relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-1 h-full bg-yellow-500"></div>
                    <CardContent className="p-4 space-y-3">
                        <div className="text-xs font-semibold text-yellow-500 uppercase tracking-wider mb-2 border-b border-gray-700 pb-2">New Selection</div>
                        
                        <div className="flex items-start gap-2">
                            <Receipt className="w-4 h-4 text-yellow-400 mt-0.5" />
                            <div className={`text-sm ${isServiceChanged ? 'text-yellow-400 font-bold' : 'text-white'}`}>
                                {selectedServiceData?.name}
                            </div>
                        </div>
                        
                        <div className="flex items-start gap-2">
                            <Calendar className="w-4 h-4 text-yellow-400 mt-0.5" />
                            <div className="text-sm text-white">
                                {format(newDropOffDate, 'MMM d, yyyy')} - {format(newPickupDate, 'MMM d, yyyy')}
                            </div>
                        </div>
                        
                        <div className="flex items-start gap-2">
                            <Clock className="w-4 h-4 text-yellow-400 mt-0.5" />
                            <div className="text-sm text-white">
                                {newDropOffTime} / {newPickupTime}
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Fee Notification */}
            <div className={`p-3 rounded-lg text-sm border flex items-start gap-3 ${costBreakdown.feeApplies ? 'bg-orange-950/40 border-orange-500/30 text-orange-200' : 'bg-green-950/30 border-green-500/30 text-green-200'}`}>
                <AlertCircle className={`w-5 h-5 shrink-0 ${costBreakdown.feeApplies ? 'text-orange-400' : 'text-green-400'}`} />
                <div>{formatRescheduleMessage(costBreakdown.feeApplies, costBreakdown.rescheduleFee)}</div>
            </div>

            {/* Financial Breakdown */}
            <Card className="bg-black/40 border-gray-800">
                <CardContent className="p-5 space-y-3">
                    <h4 className="font-bold text-white mb-4 flex items-center gap-2">
                        <Receipt className="w-4 h-4 text-gray-400" /> Cost Adjustment
                    </h4>
                    
                    <div className="flex justify-between items-center text-sm text-gray-400">
                        <span>Original Paid Amount:</span>
                        <span>{formatCurrency(costBreakdown.originalPrice * 100, {code: 'USD'})}</span>
                    </div>
                    
                    <div className="flex justify-between items-center text-sm text-gray-400">
                        <span>New Service Value:</span>
                        <span>{formatCurrency(costBreakdown.newServicePrice * 100, {code: 'USD'})}</span>
                    </div>
                    
                    <div className="flex justify-between items-center text-sm">
                        <span>Base Difference:</span>
                        <span className={costBreakdown.priceDifference > 0 ? 'text-orange-400' : costBreakdown.priceDifference < 0 ? 'text-green-400' : 'text-gray-400'}>
                            {costBreakdown.priceDifference > 0 ? '+' : ''}{formatCurrency(costBreakdown.priceDifference * 100, {code: 'USD'})}
                        </span>
                    </div>

                    {costBreakdown.feeApplies && (
                        <div className="flex justify-between items-center text-sm text-orange-400">
                            <span>Reschedule Fee (5%):</span>
                            <span>+{formatCurrency(costBreakdown.rescheduleFee * 100, {code: 'USD'})}</span>
                        </div>
                    )}
                    
                    <div className="border-t border-gray-800 my-2 pt-3 flex justify-between items-center">
                        <span className="font-bold text-white text-base">
                            {costBreakdown.totalChange > 0 ? 'Total Due Now:' : costBreakdown.totalChange < 0 ? 'Total Credit Amount:' : 'No Additional Charge'}
                        </span>
                        <span className={`text-xl font-bold ${costBreakdown.totalChange > 0 ? 'text-orange-400' : costBreakdown.totalChange < 0 ? 'text-green-400' : 'text-white'}`}>
                            {formatCurrency(Math.abs(costBreakdown.totalChange) * 100, {code: 'USD'})}
                        </span>
                    </div>
                    
                    {isCredit && (
                        <p className="text-xs text-gray-500 mt-2 italic text-right">
                            *Credits will be refunded to your original payment method within 3-5 business days.
                        </p>
                    )}
                </CardContent>
            </Card>

        </div>
    );
};
