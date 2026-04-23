
import React, { useState } from 'react';
import { Shield, Truck, Info } from 'lucide-react';
import { AddonSection } from './AddonSection';
import { RadioGroup } from '@/components/ui/radio-group';
import { RadioCard } from './RadioCard';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

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
    isDelivery 
}) => {
    const [showInsuranceAcceptInfo, setShowInsuranceAcceptInfo] = useState(false);
    const [showInsuranceDeclineInfo, setShowInsuranceDeclineInfo] = useState(false);
    const [showDrivewayInfo, setShowDrivewayInfo] = useState(false);

    const isDeliveryRequired = plan?.id === 1 || (plan?.id === 2 && isDelivery) || plan?.id === 4;
    const showDrivewayProtection = isDeliveryRequired;
    
    // Use insurance price from addonPrices (loaded from database via hook)
    const insurancePrice = addonPrices?.insurance || 20;
    const drivewayPrice = addonPrices?.drivewayProtection || 15;

    return (
        <>
            <AddonSection icon={<Shield className="h-6 w-6" />} title="Protection Options">
                <div className="space-y-4">
                    {/* Rental Insurance */}
                    <div>
                        <h4 className="text-lg font-semibold text-white mb-3">Rental Insurance</h4>
                        <RadioGroup 
                            value={addonsData?.insurance || 'decline'} 
                            onValueChange={handleInsuranceChange}
                            className="grid grid-cols-1 md:grid-cols-2 gap-3"
                        >
                            <div className="relative">
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
                                <button
                                    type="button"
                                    onClick={() => setShowInsuranceAcceptInfo(true)}
                                    className="absolute top-2 right-2 text-blue-400 hover:text-yellow-400 transition-colors z-10 bg-gray-800/80 rounded-full p-1"
                                    title="Learn more about insurance coverage"
                                >
                                    <Info className="h-4 w-4" />
                                </button>
                            </div>
                            <div className="relative">
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
                                <button
                                    type="button"
                                    onClick={() => setShowInsuranceDeclineInfo(true)}
                                    className="absolute top-2 right-2 text-blue-400 hover:text-yellow-400 transition-colors z-10 bg-gray-800/80 rounded-full p-1"
                                    title="Understand the risks"
                                >
                                    <Info className="h-4 w-4" />
                                </button>
                            </div>
                        </RadioGroup>
                    </div>

                    {/* Driveway Protection - Only show for delivery services */}
                    {showDrivewayProtection && (
                        <div>
                            <h4 className="text-lg font-semibold text-white mb-3 flex items-center">
                                <Truck className="h-5 w-5 mr-2 text-blue-400" />
                                Driveway Protection
                            </h4>
                            <RadioGroup 
                                value={addonsData?.drivewayProtection || 'decline'} 
                                onValueChange={handleDrivewayProtectionChange}
                                className="grid grid-cols-1 md:grid-cols-2 gap-3"
                            >
                                <div className="relative">
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
                                    <button
                                        type="button"
                                        onClick={() => setShowDrivewayInfo(true)}
                                        className="absolute top-2 right-2 text-blue-400 hover:text-yellow-400 transition-colors z-10 bg-gray-800/80 rounded-full p-1"
                                        title="Learn about driveway protection"
                                    >
                                        <Info className="h-4 w-4" />
                                    </button>
                                </div>
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

            {/* Insurance Accept Info Dialog */}
            <Dialog open={showInsuranceAcceptInfo} onOpenChange={setShowInsuranceAcceptInfo}>
                <DialogContent className="bg-gray-900 border-blue-500 text-white max-w-md">
                    <DialogHeader>
                        <DialogTitle className="text-blue-400 text-xl flex items-center">
                            <Shield className="mr-2 h-6 w-6" />
                            Rental Insurance Coverage
                        </DialogTitle>
                    </DialogHeader>
                    <DialogDescription className="text-blue-100 space-y-3">
                        <p className="font-semibold text-white">Comprehensive coverage protects you from damage liability.</p>
                        <ul className="list-disc list-inside space-y-2 text-sm">
                            <li>Covers accidental damage to the rental unit</li>
                            <li>Protection against theft and vandalism</li>
                            <li>Peace of mind during your rental period</li>
                            <li>No out-of-pocket repair costs for covered incidents</li>
                        </ul>
                        <p className="text-xs text-gray-400 mt-3">
                            Insurance is highly recommended to protect yourself from unexpected repair costs.
                        </p>
                    </DialogDescription>
                    <div className="flex justify-end mt-4">
                        <Button onClick={() => setShowInsuranceAcceptInfo(false)} className="bg-blue-600 hover:bg-blue-700">
                            Got it
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>

            {/* Insurance Decline Info Dialog */}
            <Dialog open={showInsuranceDeclineInfo} onOpenChange={setShowInsuranceDeclineInfo}>
                <DialogContent className="bg-gray-900 border-red-500 text-white max-w-md">
                    <DialogHeader>
                        <DialogTitle className="text-red-400 text-xl flex items-center">
                            <Shield className="mr-2 h-6 w-6" />
                            Declining Insurance
                        </DialogTitle>
                    </DialogHeader>
                    <DialogDescription className="text-red-100 space-y-3">
                        <p className="font-semibold text-white">You assume full liability for any damage.</p>
                        <ul className="list-disc list-inside space-y-2 text-sm">
                            <li>You are responsible for all repair costs</li>
                            <li>No coverage for accidental damage</li>
                            <li>No protection against theft or vandalism</li>
                            <li>Repair costs can be substantial</li>
                        </ul>
                        <p className="text-xs text-gray-400 mt-3 bg-red-900/20 p-2 rounded border border-red-500/30">
                            ⚠️ <strong>Not recommended:</strong> Declining insurance means you're fully responsible for any damage during your rental period.
                        </p>
                    </DialogDescription>
                    <div className="flex justify-end mt-4">
                        <Button onClick={() => setShowInsuranceDeclineInfo(false)} variant="outline" className="border-red-500 text-red-400 hover:bg-red-900/20">
                            I Understand
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>

            {/* Driveway Protection Info Dialog */}
            <Dialog open={showDrivewayInfo} onOpenChange={setShowDrivewayInfo}>
                <DialogContent className="bg-gray-900 border-green-500 text-white max-w-md">
                    <DialogHeader>
                        <DialogTitle className="text-green-400 text-xl flex items-center">
                            <Truck className="mr-2 h-6 w-6" />
                            Driveway Protection
                        </DialogTitle>
                    </DialogHeader>
                    <DialogDescription className="text-green-100 space-y-3">
                        <p className="font-semibold text-white">Protects your driveway from damage during delivery.</p>
                        <ul className="list-disc list-inside space-y-2 text-sm">
                            <li>Protective covering placed during delivery</li>
                            <li>Pre-delivery and post-delivery inspection</li>
                            <li>Protection against cracks, scratches, and stains</li>
                            <li>Peace of mind for your property</li>
                        </ul>
                        <p className="text-xs text-gray-400 mt-3">
                            Recommended for driveways with decorative surfaces, new pavement, or sealed/stained concrete.
                        </p>
                    </DialogDescription>
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
