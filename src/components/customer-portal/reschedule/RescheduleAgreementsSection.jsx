
import React from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { FileText, ShieldAlert, CreditCard, Info } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

export const RescheduleAgreementsSection = ({ agreements, setAgreements, booking }) => {
    
    const handleToggle = (key) => {
        setAgreements(prev => ({ ...prev, [key]: !prev[key] }));
    };

    const hasAddons = booking?.addons && Object.keys(booking.addons).length > 0;

    // Safety checks for boolean values instead of potentially rendering objects
    const termsChecked = typeof agreements?.terms === 'object' ? !!agreements.terms?.value : !!agreements?.terms;
    const chargesChecked = typeof agreements?.charges === 'object' ? !!agreements.charges?.value : !!agreements?.charges;
    const releaseChecked = typeof agreements?.release === 'object' ? !!agreements.release?.value : !!agreements?.release;

    return (
        <div className="space-y-4 animate-in fade-in duration-300 max-w-4xl mx-auto w-full">
            <div className="text-center space-y-1 mb-2">
                <div className="mx-auto w-10 h-10 bg-yellow-500/10 rounded-full flex items-center justify-center mb-1">
                    <FileText className="w-5 h-5 text-yellow-500" />
                </div>
                <h2 className="text-2xl font-extrabold text-white tracking-tight">Agreements & Policies</h2>
                <p className="text-sm text-gray-400">Please review our policies and provide your authorization to proceed.</p>
            </div>
            
            <Card className="bg-gray-900 border-gray-800 shadow-xl overflow-hidden">
                <CardContent className="p-0">
                    <ScrollArea className="h-48 w-full bg-gray-950 p-4 border-b border-gray-800">
                        <div className="space-y-4 pr-4">
                            <div className="space-y-1">
                                <h4 className="font-bold text-white flex items-center text-sm"><ShieldAlert className="w-4 h-4 mr-2 text-yellow-500" /> Rescheduling Policy</h4>
                                <p className="leading-snug text-gray-400 text-xs">By requesting a reschedule, your original appointment dates will be released and made available to others IF you have chosen new dates. Your new requested dates are subject to final admin approval and inventory availability. <span className="text-yellow-400 font-semibold">If the new dates cannot be accommodated, we will contact you to find an alternative.</span></p>
                            </div>
                            
                            <div className="space-y-1">
                                <h4 className="font-bold text-white flex items-center text-sm"><CreditCard className="w-4 h-4 mr-2 text-yellow-500" /> Fees & Pricing Changes</h4>
                                <p className="leading-snug text-gray-400 text-xs">Requests made within 24 hours of the original scheduled appointment will incur a <span className="text-red-400 font-semibold">5% rescheduling fee</span> based on the original base total. Pricing for new services is recalculated dynamically based on our current base rates, daily rates, and mileage fees. Any differences in price will be charged or credited accordingly.</p>
                            </div>

                            {hasAddons && (
                                <div className="space-y-1 bg-yellow-900/10 p-2 rounded-md border border-yellow-500/20">
                                    <h4 className="font-bold text-white flex items-center text-sm"><Info className="w-4 h-4 mr-2 text-yellow-500" /> Add-ons & Equipment</h4>
                                    <p className="leading-snug text-yellow-100/70 text-xs">Your selected add-ons (insurance, equipment, etc.) from the original booking will be carried over to the new booking. Subtotals for add-ons are calculated separately from the main service base cost.</p>
                                </div>
                            )}

                            <div className="space-y-1">
                                <h4 className="font-bold text-white flex items-center text-sm"><FileText className="w-4 h-4 mr-2 text-yellow-500" /> Cancellation</h4>
                                <p className="leading-snug text-gray-400 text-xs">If you choose to cancel your booking entirely instead of rescheduling, our standard cancellation policies will apply. Rescheduled bookings that are later cancelled may be subject to additional fees.</p>
                            </div>
                        </div>
                    </ScrollArea>

                    <div className="p-4 space-y-2 bg-gray-900">
                        <h3 className="text-sm font-bold text-white mb-2 border-b border-gray-800 pb-2">Required Authorizations</h3>
                        
                        <div className="agreement-checkbox-wrapper group cursor-pointer" onClick={() => handleToggle('terms')}>
                            <Checkbox 
                                id="agree-terms" 
                                checked={termsChecked} 
                                onCheckedChange={() => handleToggle('terms')} 
                                className="mt-0.5 w-4 h-4 data-[state=checked]:bg-yellow-500 data-[state=checked]:text-black border-gray-500 rounded"
                            />
                            <Label htmlFor="agree-terms" className="text-xs font-medium leading-tight text-gray-300 cursor-pointer group-hover:text-white transition-colors pointer-events-none">
                                I have read and agree to the <span className="text-yellow-400">rental agreement</span> and terms of service.
                            </Label>
                        </div>
                        
                        <div className="agreement-checkbox-wrapper group cursor-pointer" onClick={() => handleToggle('charges')}>
                            <Checkbox 
                                id="agree-charges" 
                                checked={chargesChecked} 
                                onCheckedChange={() => handleToggle('charges')} 
                                className="mt-0.5 w-4 h-4 data-[state=checked]:bg-yellow-500 data-[state=checked]:text-black border-gray-500 rounded" 
                            />
                            <Label htmlFor="agree-charges" className="text-xs font-medium leading-tight text-gray-300 cursor-pointer group-hover:text-white transition-colors pointer-events-none">
                                I authorize any <span className="text-red-400">new charges</span> or differences in price, including accurate add-on pricing.
                            </Label>
                        </div>

                        <div className="agreement-checkbox-wrapper group cursor-pointer" onClick={() => handleToggle('release')}>
                            <Checkbox 
                                id="agree-release" 
                                checked={releaseChecked} 
                                onCheckedChange={() => handleToggle('release')} 
                                className="mt-0.5 w-4 h-4 data-[state=checked]:bg-yellow-500 data-[state=checked]:text-black border-gray-500 rounded" 
                            />
                            <Label htmlFor="agree-release" className="text-xs font-medium leading-tight text-gray-300 cursor-pointer group-hover:text-white transition-colors pointer-events-none">
                                I acknowledge that <span className="text-yellow-400 font-semibold">changing dates</span> means my old dates may be booked by someone else.
                            </Label>
                        </div>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
};
