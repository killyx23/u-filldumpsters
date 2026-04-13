
import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { AlertTriangle } from 'lucide-react';

export const AddressVerificationDialog = ({ isOpen, onOpenChange, onContinue }) => {
    const [agreed, setAgreed] = useState(false);

    const handleContinue = () => {
        if (agreed) {
            onContinue();
            onOpenChange(false);
            setAgreed(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="bg-gray-900 border-orange-500 text-white sm:max-w-[500px]">
                <DialogHeader>
                    <DialogTitle className="flex items-center text-orange-400 text-xl">
                        <AlertTriangle className="mr-2 h-6 w-6" />
                        Address Verification Required
                    </DialogTitle>
                </DialogHeader>
                <div className="py-4 space-y-4 text-sm text-gray-200">
                    <p className="text-base font-semibold text-white">
                        Your delivery address could not be verified through our system.
                    </p>
                    <p>
                        If you continue without verification, your delivery may be delayed. Cancellation fees or credit card charges may apply if the address is invalid.
                    </p>
                    <p className="text-orange-200 bg-orange-900/20 p-3 rounded border border-orange-500/30">
                        Manual address entry requires verification from our scheduling department. If applicable, any additional fees and or delivery fees will be calculated and applied during the review process.
                    </p>
                    <div className="flex items-start space-x-3 bg-black/40 p-4 rounded-lg border border-white/10 mt-4">
                        <Checkbox 
                            id="agree-unverified" 
                            checked={agreed} 
                            onCheckedChange={setAgreed}
                            className="mt-0.5 border-orange-500 data-[state=checked]:bg-orange-500"
                        />
                        <label htmlFor="agree-unverified" className="text-sm font-medium leading-tight cursor-pointer text-white">
                            I understand and agree to proceed without address verification, acknowledging that delays or fees may apply.
                        </label>
                    </div>
                </div>
                <DialogFooter className="gap-2 sm:gap-0">
                    <Button variant="ghost" onClick={() => onOpenChange(false)} className="text-gray-400 hover:text-white">
                        Cancel & Try Again
                    </Button>
                    <Button 
                        onClick={handleContinue} 
                        disabled={!agreed} 
                        className="bg-orange-500 hover:bg-orange-600 text-white font-bold"
                    >
                        Continue Manually
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
