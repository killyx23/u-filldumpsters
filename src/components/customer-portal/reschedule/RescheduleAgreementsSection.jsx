import React from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import { FileText, ShieldAlert, CreditCard, Info, MessageSquare } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

export const RescheduleAgreementsSection = ({ 
    agreementsAccepted, 
    setAgreementsAccepted, 
    comments,
    setComments,
    booking 
}) => {
    // Safety check: provide default empty function if callback not provided
    const handleAgreementsUpdate = setAgreementsAccepted || (() => {
        console.warn('RescheduleAgreementsSection: setAgreementsAccepted callback not provided');
    });

    const handleCommentsUpdate = setComments || (() => {
        console.warn('RescheduleAgreementsSection: setComments callback not provided');
    });
    
    const handleToggle = (key) => {
        // Validate callback is a function before calling
        if (typeof handleAgreementsUpdate !== 'function') {
            console.error('RescheduleAgreementsSection: setAgreementsAccepted is not a function');
            return;
        }

        try {
            handleAgreementsUpdate(prev => ({ 
                ...prev, 
                [key]: !prev[key] 
            }));
        } catch (error) {
            console.error('RescheduleAgreementsSection: Error updating agreement state:', error);
        }
    };

    const hasAddons = booking?.addons && Object.keys(booking.addons).length > 0;

    // Safety checks for boolean values
    const termsChecked = !!agreementsAccepted?.terms;
    const chargesChecked = !!agreementsAccepted?.charges;
    const releaseChecked = !!agreementsAccepted?.release;

    return (
        <div className="space-y-6 animate-in fade-in duration-300 max-w-4xl mx-auto w-full">
            <div className="text-center space-y-2 mb-4">
                <div className="mx-auto w-12 h-12 bg-yellow-500/10 rounded-full flex items-center justify-center mb-2">
                    <FileText className="w-6 h-6 text-yellow-500" />
                </div>
                <h2 className="text-3xl font-extrabold text-white tracking-tight">Agreements & Policies</h2>
                <p className="text-base text-gray-400 max-w-2xl mx-auto">Please review our policies and provide your authorization to proceed.</p>
            </div>
            
            <Card className="bg-gray-900 border-gray-800 shadow-xl overflow-hidden">
                <CardContent className="p-0">
                    <ScrollArea className="h-56 w-full bg-gray-950 p-5 border-b border-gray-800">
                        <div className="space-y-5 pr-4">
                            <div className="space-y-2">
                                <h4 className="font-bold text-white flex items-center text-base">
                                    <ShieldAlert className="w-5 h-5 mr-2 text-yellow-500" /> Rescheduling Policy
                                </h4>
                                <p className="leading-relaxed text-gray-400 text-sm">
                                    By requesting a reschedule, your original appointment dates will be released and made available to others IF you have chosen new dates. Your new requested dates are subject to final admin approval and inventory availability. <span className="text-yellow-400 font-semibold">If the new dates cannot be accommodated, we will contact you to find an alternative.</span>
                                </p>
                            </div>
                            
                            <div className="space-y-2">
                                <h4 className="font-bold text-white flex items-center text-base">
                                    <CreditCard className="w-5 h-5 mr-2 text-yellow-500" /> Fees & Pricing Changes
                                </h4>
                                <p className="leading-relaxed text-gray-400 text-sm">
                                    Requests made within 24 hours of the original scheduled appointment will incur a <span className="text-red-400 font-semibold">5% rescheduling fee</span> based on the original base total. Pricing for new services is recalculated dynamically based on our current base rates, daily rates, and mileage fees. Any differences in price will be charged or credited accordingly.
                                </p>
                            </div>

                            {hasAddons && (
                                <div className="space-y-2 bg-yellow-900/10 p-3 rounded-lg border border-yellow-500/20">
                                    <h4 className="font-bold text-white flex items-center text-base">
                                        <Info className="w-5 h-5 mr-2 text-yellow-500" /> Add-ons & Equipment
                                    </h4>
                                    <p className="leading-relaxed text-yellow-100/70 text-sm">
                                        Your selected add-ons (insurance, equipment, etc.) from the original booking will be carried over to the new booking. Subtotals for add-ons are calculated separately from the main service base cost.
                                    </p>
                                </div>
                            )}

                            <div className="space-y-2">
                                <h4 className="font-bold text-white flex items-center text-base">
                                    <FileText className="w-5 h-5 mr-2 text-yellow-500" /> Cancellation
                                </h4>
                                <p className="leading-relaxed text-gray-400 text-sm">
                                    If you choose to cancel your booking entirely instead of rescheduling, our standard cancellation policies will apply. Rescheduled bookings that are later cancelled may be subject to additional fees.
                                </p>
                            </div>
                        </div>
                    </ScrollArea>

                    <div className="p-6 space-y-4 bg-gray-900">
                        <h3 className="text-base font-bold text-white mb-3 border-b border-gray-800 pb-2">
                            Required Authorizations
                        </h3>
                        
                        <div className="flex items-start space-x-3 group cursor-pointer hover:bg-white/5 p-2 rounded-lg transition-colors" onClick={() => handleToggle('terms')}>
                            <Checkbox 
                                id="agree-terms" 
                                checked={termsChecked} 
                                onCheckedChange={() => handleToggle('terms')} 
                                className="mt-1 w-5 h-5 data-[state=checked]:bg-yellow-500 data-[state=checked]:text-black border-gray-600 rounded"
                            />
                            <Label htmlFor="agree-terms" className="text-sm font-medium leading-relaxed text-gray-300 cursor-pointer group-hover:text-white transition-colors pointer-events-none flex-1">
                                I have read and agree to the <span className="text-yellow-400">rental agreement</span> and terms of service.
                            </Label>
                        </div>
                        
                        <div className="flex items-start space-x-3 group cursor-pointer hover:bg-white/5 p-2 rounded-lg transition-colors" onClick={() => handleToggle('charges')}>
                            <Checkbox 
                                id="agree-charges" 
                                checked={chargesChecked} 
                                onCheckedChange={() => handleToggle('charges')} 
                                className="mt-1 w-5 h-5 data-[state=checked]:bg-yellow-500 data-[state=checked]:text-black border-gray-600 rounded" 
                            />
                            <Label htmlFor="agree-charges" className="text-sm font-medium leading-relaxed text-gray-300 cursor-pointer group-hover:text-white transition-colors pointer-events-none flex-1">
                                I authorize any <span className="text-red-400">new charges</span> or differences in price, including accurate add-on pricing.
                            </Label>
                        </div>

                        <div className="flex items-start space-x-3 group cursor-pointer hover:bg-white/5 p-2 rounded-lg transition-colors" onClick={() => handleToggle('release')}>
                            <Checkbox 
                                id="agree-release" 
                                checked={releaseChecked} 
                                onCheckedChange={() => handleToggle('release')} 
                                className="mt-1 w-5 h-5 data-[state=checked]:bg-yellow-500 data-[state=checked]:text-black border-gray-600 rounded" 
                            />
                            <Label htmlFor="agree-release" className="text-sm font-medium leading-relaxed text-gray-300 cursor-pointer group-hover:text-white transition-colors pointer-events-none flex-1">
                                I acknowledge that <span className="text-yellow-400 font-semibold">changing dates</span> means my old dates may be booked by someone else.
                            </Label>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Additional Comments Section */}
            <Card className="bg-gray-900 border-gray-800 shadow-xl">
                <CardContent className="p-6">
                    <div className="space-y-3">
                        <Label className="text-base font-bold text-white flex items-center">
                            <MessageSquare className="w-5 h-5 mr-2 text-blue-400" />
                            Additional Comments (Optional)
                        </Label>
                        <p className="text-sm text-gray-400">
                            Add any special requests or information about your reschedule request.
                        </p>
                        <Textarea
                            value={comments || ''}
                            onChange={(e) => {
                                if (typeof handleCommentsUpdate === 'function') {
                                    handleCommentsUpdate(e.target.value);
                                }
                            }}
                            placeholder="Example: I need to reschedule due to a family emergency. Please contact me if my new dates aren't available."
                            className="min-h-[120px] bg-gray-950 border-gray-700 text-white placeholder:text-gray-500 focus:border-blue-500 resize-none"
                        />
                    </div>
                </CardContent>
            </Card>
        </div>
    );
};