
import React from 'react';
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ShieldAlert, AlertTriangle, FileText, Info } from 'lucide-react';

export const RescheduleTermsAndConditions = ({ serviceId, agreed, onAgreedChange }) => {
    
    const getServiceSpecificTerms = () => {
        if (serviceId === 1 || serviceId === 4) {
            return (
                <div className="space-y-4 mb-4">
                    <div className="flex gap-3">
                        <AlertTriangle className="w-5 h-5 text-orange-400 shrink-0 mt-0.5" />
                        <div>
                            <h4 className="font-bold text-white text-sm">Site Preparation</h4>
                            <p className="text-gray-400 text-xs">By changing your delivery date, you confirm that the drop-off location will be clear of obstructions, vehicles, and debris on the new requested date. Failure to provide clear access may result in a failed delivery fee.</p>
                        </div>
                    </div>
                </div>
            );
        }
        
        if (serviceId === 2) {
            return (
                <div className="space-y-4 mb-4">
                    <div className="flex gap-3">
                        <ShieldAlert className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
                        <div>
                            <h4 className="font-bold text-white text-sm">Insurance & Towing Requirements</h4>
                            <p className="text-gray-400 text-xs">Changing dates requires that your previously verified towing vehicle and auto insurance policy remain active and valid through the entirety of the new rental period. You accept full liability if coverage lapses.</p>
                        </div>
                    </div>
                </div>
            );
        }
        
        return null;
    };

    return (
        <div className="space-y-6">
            <div className="bg-gray-950 border border-gray-800 rounded-lg overflow-hidden">
                <div className="bg-gray-900 px-4 py-2 border-b border-gray-800 flex items-center gap-2">
                    <FileText className="w-4 h-4 text-gray-400" />
                    <span className="text-xs font-semibold text-gray-300 uppercase tracking-wider">Service Modification Agreement</span>
                </div>
                <ScrollArea className="h-48 p-4">
                    <div className="space-y-6 pr-4">
                        {getServiceSpecificTerms()}
                        
                        <div className="flex gap-3">
                            <Info className="w-5 h-5 text-gray-400 shrink-0 mt-0.5" />
                            <div>
                                <h4 className="font-bold text-white text-sm">Modification & Cancellation Policy</h4>
                                <p className="text-gray-400 text-xs mt-1">Changes made within 24 hours of the original appointment incur a 5% rescheduling fee. Your original dates will be immediately released to the public upon confirmation. If you cancel this new booking later, cancellation fees will be calculated based on the original booking creation date, not the modification date.</p>
                            </div>
                        </div>

                        <div className="flex gap-3">
                            <ShieldAlert className="w-5 h-5 text-gray-400 shrink-0 mt-0.5" />
                            <div>
                                <h4 className="font-bold text-white text-sm">Liability Acknowledgement</h4>
                                <p className="text-gray-400 text-xs mt-1">I acknowledge that all original terms of service, safety waivers, and liability releases signed during the initial booking remain in full effect for the new dates. I am responsible for ensuring I comply with all safety requirements for the equipment on the newly selected dates.</p>
                            </div>
                        </div>
                    </div>
                </ScrollArea>
            </div>

            <div className="flex items-start space-x-3 p-4 bg-gray-800/50 rounded-lg border border-gray-700/50 hover:bg-gray-800 transition-colors cursor-pointer" onClick={() => onAgreedChange(!agreed)}>
                <Checkbox 
                    id="terms-agree" 
                    checked={agreed} 
                    onCheckedChange={onAgreedChange} 
                    className="mt-1 data-[state=checked]:bg-yellow-500 data-[state=checked]:border-yellow-500"
                />
                <Label htmlFor="terms-agree" className="text-sm leading-snug cursor-pointer">
                    I have read and agree to the modified Service Terms, Cancellation Policy, and Insurance requirements for my new dates. I authorize any displayed cost adjustments to my payment method.
                </Label>
            </div>
        </div>
    );
};
