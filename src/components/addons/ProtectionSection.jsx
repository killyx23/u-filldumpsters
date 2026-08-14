import React, { useState } from 'react';
import { Shield, Truck, Info } from 'lucide-react';
import { AddonSection } from './AddonSection';
import { RadioGroup } from '@/components/ui/radio-group';
import { RadioCard } from './RadioCard';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { HardwareProtectionInfoDialog } from '@/components/addons/HardwareProtectionInfoDialog';
import { mentionsDumpTrailer } from '@/utils/displayPlanName';

/**
 * Protection Section Component
 * Displays insurance and driveway protection options with info buttons
 */
export const ProtectionSection = ({ 
    addonsData, 
    handleInsuranceChange, 
    handleDrivewayProtectionChange, 
    plan, 
    addonPrices,
    isDelivery,
    hasDrivewayPlan = false,
    rentalInsurancePlan = null,
    drivewayProtectionPlan = null,
}) => {
    const [showInsuranceInfo, setShowInsuranceInfo] = useState(false);
    const [showDrivewayInfo, setShowDrivewayInfo] = useState(false);

    // Detect specific dump loader service types
    const isDumpLoaderWithDelivery = plan?.name && 
                                     mentionsDumpTrailer(plan.name) &&
                                     plan.name.toLowerCase().includes('delivery');

    const isDumpLoaderTrailerRental = plan?.name && 
                                      mentionsDumpTrailer(plan.name) &&
                                      !plan.name.toLowerCase().includes('delivery') &&
                                      !plan.name.toLowerCase().includes('16 yard') &&
                                      !plan.name.toLowerCase().includes('dumpster');

    const isDeliveryRequired = plan?.id === 1 || (plan?.id === 2 && isDelivery) || plan?.id === 4;
    const showDrivewayProtection =
        hasDrivewayPlan &&
        isDeliveryRequired &&
        !isDumpLoaderTrailerRental &&
        !isDumpLoaderWithDelivery;
    
    const insurancePrice = addonPrices?.insurance ?? rentalInsurancePlan?.price ?? 20;
    const drivewayPrice = addonPrices?.drivewayProtection ?? drivewayProtectionPlan?.price ?? 15;

    // Service-specific insurance info text
    const getInsuranceInfoText = () => {
        if (rentalInsurancePlan?.infoText) {
            return rentalInsurancePlan.infoText;
        }
        // Dump Loader with Delivery gets the detailed $500 coverage text
        if (isDumpLoaderWithDelivery) {
            return "Insurance covers damage to the rental equipment while in your possession during loading. This provides peace of mind if the bin, doors, hinges, or equipment are accidentally damaged while you have it. Insurance covers the first $500 of repair costs.";
        }
        // All other services (including Dump Loader Trailer Rental) get the simple text
        return "Insurance covers damage to the rental equipment. Driveway protection prevents damage to your property during delivery.";
    };

    return (
        <>
            <AddonSection icon={<Shield className="h-6 w-6" />} title="Protection Options">
                <div className="space-y-4">
                    {/* Rental Insurance */}
                    <div>
                        <div className="flex items-center gap-2 mb-3">
                            <h4 className="text-lg font-semibold text-white">Rental Insurance</h4>
                            <button
                                type="button"
                                onClick={() => setShowInsuranceInfo(true)}
                                className="text-yellow-400 hover:text-yellow-500 transition-colors"
                                title="Learn more about insurance coverage"
                            >
                                <Info className="h-4 w-4" />
                            </button>
                        </div>
                        <RadioGroup 
                            value={addonsData?.insurance || 'accept'} 
                            onValueChange={handleInsuranceChange}
                            className="grid grid-cols-1 md:grid-cols-2 gap-3"
                        >
                            <RadioCard
                                id="insurance-accept"
                                value="accept"
                                checked={addonsData?.insurance === 'accept'}
                                onChange={() => handleInsuranceChange('accept')}
                                title="Accept Insurance"
                                price={insurancePrice}
                                description="Protect yourself from damage liability"
                                recommended
                            />
                            <RadioCard
                                id="insurance-decline"
                                value="decline"
                                checked={addonsData?.insurance === 'decline'}
                                onChange={() => handleInsuranceChange('decline')}
                                title="Decline Insurance"
                                price={0}
                                description="You assume full liability"
                                warning
                            />
                        </RadioGroup>
                    </div>

                    {/* Driveway Protection - Only show for delivery services (excluding dump loaders) */}
                    {showDrivewayProtection && (
                        <div>
                            <div className="flex items-center gap-2 mb-3">
                                <Truck className="h-5 w-5 text-blue-400" />
                                <h4 className="text-lg font-semibold text-white">Driveway Protection</h4>
                                <button
                                    type="button"
                                    onClick={() => setShowDrivewayInfo(true)}
                                    className="text-yellow-400 hover:text-yellow-500 transition-colors"
                                    title="Learn about driveway protection"
                                >
                                    <Info className="h-4 w-4" />
                                </button>
                            </div>
                            <RadioGroup 
                                value={addonsData?.drivewayProtection || 'decline'} 
                                onValueChange={handleDrivewayProtectionChange}
                                className="grid grid-cols-1 md:grid-cols-2 gap-3"
                            >
                                <RadioCard
                                    id="driveway-accept"
                                    value="accept"
                                    checked={addonsData?.drivewayProtection === 'accept'}
                                    onChange={() => handleDrivewayProtectionChange('accept')}
                                    title="Accept Protection"
                                    price={drivewayPrice}
                                    description="Protect your driveway from potential damage"
                                    recommended
                                />
                                <RadioCard
                                    id="driveway-decline"
                                    value="decline"
                                    checked={addonsData?.drivewayProtection === 'decline'}
                                    onChange={() => handleDrivewayProtectionChange('decline')}
                                    title="Decline Protection"
                                    price={0}
                                    description="You assume responsibility for any damage"
                                    warning
                                />
                            </RadioGroup>
                        </div>
                    )}
                </div>
            </AddonSection>

            <HardwareProtectionInfoDialog
                open={showInsuranceInfo}
                onOpenChange={setShowInsuranceInfo}
                insurancePrice={insurancePrice}
                isDumpLoaderWithDelivery={Boolean(isDumpLoaderWithDelivery)}
                customInfoText={getInsuranceInfoText()}
            />

            {/* Driveway Protection Info Dialog */}
            <Dialog open={showDrivewayInfo} onOpenChange={setShowDrivewayInfo}>
                <DialogContent className="bg-gray-900 border-green-500 text-white max-w-2xl max-h-[90vh]">
                    <DialogHeader>
                        <DialogTitle className="text-green-400 text-2xl flex items-center">
                            <Truck className="mr-2 h-6 w-6" />
                            Driveway Protection
                        </DialogTitle>
                    </DialogHeader>
                    <ScrollArea className="max-h-[60vh] pr-4">
                        <DialogDescription className="text-green-100 space-y-4">
                            <p>Protects your driveway from damage during delivery and pickup. Our protective covering system prevents scratches, marks, and damage to your driveway surface.</p>
                            
                            <div>
                                <h5 className="font-bold text-white text-lg mb-2">What&apos;s Included:</h5>
                                <ul className="list-disc list-inside space-y-1 ml-2">
                                    <li>Professional protective covering installation</li>
                                    <li>Full driveway surface protection</li>
                                    <li>Damage inspection before and after</li>
                                    <li>Peace of mind during equipment delivery</li>
                                </ul>
                            </div>

                            <div>
                                <h5 className="font-bold text-white text-lg mb-2">Coverage Details:</h5>
                                <ul className="list-disc list-inside space-y-1 ml-2">
                                    <li>Protects against scratches and marks from equipment</li>
                                    <li>Covers delivery and pickup operations</li>
                                    <li>Professional installation and removal</li>
                                    <li>Inspection documentation provided</li>
                                </ul>
                            </div>

                            <div className="bg-green-900/20 p-3 rounded border border-green-500/30 text-sm">
                                <p><strong>Note:</strong> This protection covers damage caused by normal delivery operations only. Does not cover pre-existing damage or damage from other sources.</p>
                            </div>
                        </DialogDescription>
                    </ScrollArea>
                    <div className="flex justify-end mt-4">
                        <Button onClick={() => setShowDrivewayInfo(false)} className="bg-green-600 hover:bg-green-700">
                            Got it
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        </>
    );
};
