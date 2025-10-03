import React from 'react';
import { Shield, HardHat, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AddonSection } from './AddonSection';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export const ProtectionSection = ({ addonsData, handleInsuranceChange, handleDrivewayProtectionChange, plan, addonPrices, isDelivery }) => {

    const insuranceTooltip = (
        <div>
            <p className="font-bold mb-2">Comprehensive Rental Insurance</p>
            <p className="mb-2">For a small fee, you gain peace of mind. Our rental insurance covers a wide range of accidental damages to the rental unit itself.</p>
            <ul className="list-disc list-inside mb-2 text-sm space-y-1">
                <li>Covers dents, scratches, and bends from normal use.</li>
                <li>Protects against damage to doors, latches, and hinges.</li>
                <li>Reduces your liability for unforeseen incidents.</li>
            </ul>
            <p className="text-xs text-yellow-300">Disclaimer: This insurance does not cover damages from prohibited materials, overloading, or intentional misuse. It does not cover damage to your property (see Driveway Protection).</p>
        </div>
    );

    const drivewayTooltip = (
        <div>
            <p className="font-bold mb-2">Advanced Driveway Protection System</p>
            <p className="mb-2">Protect your property with our advanced driveway protection system. Specially engineered, environmentally friendly pads are placed under the dumpster's contact points to distribute weight evenly and create a protective barrier between the heavy steel container and your driveway surface.</p>
            <ul className="list-disc list-inside mb-2 text-sm space-y-1">
                <li>Vastly superior to standard wood planks.</li>
                <li>Dramatically reduces pressure to prevent cracks and scrapes.</li>
                <li>Effective on concrete, asphalt, gravel, and even turf.</li>
            </ul>
            <p className="text-xs text-yellow-300">Disclaimer: This is an added preventative measure to significantly reduce the risk of damage. While highly effective, it does not constitute a guarantee against all potential driveway damage. U-Fill Dumpsters LLC is not responsible for any driveway damage if this protection is declined.</p>
        </div>
    );

    return (
        <>
            <AddonSection
                title="Rental Insurance"
                icon={<Shield />}
                tooltipContent={insuranceTooltip}
            >
                <p className="text-sm text-blue-200 mb-4">
                    For just ${addonPrices.insurance.toFixed(2)}, get peace of mind. Declining means you accept full responsibility for any damage to the rental unit during your rental period.
                </p>
                <div className="grid grid-cols-2 gap-3">
                    <Button
                        onClick={() => handleInsuranceChange('accept')}
                        variant={addonsData.insurance === 'accept' ? 'default' : 'outline'}
                        className={cn(
                            "h-12 text-lg",
                            addonsData.insurance === 'accept' ? 'bg-yellow-400 text-black hover:bg-yellow-500 border-yellow-400' : 'border-white/30 text-white hover:bg-white/10'
                        )}
                    >
                        Accept (+${addonPrices.insurance.toFixed(2)})
                    </Button>
                    <Button
                        onClick={() => handleInsuranceChange('decline')}
                        variant={addonsData.insurance === 'decline' ? 'destructive' : 'outline'}
                        className={cn(
                            "h-12 text-lg",
                            addonsData.insurance === 'decline' ? '' : 'border-white/30 text-white hover:bg-white/10'
                        )}
                    >
                        Decline
                    </Button>
                </div>
            </AddonSection>

            {(plan.id === 1 || isDelivery) && (
                <AddonSection
                    title="Driveway Protection"
                    icon={<HardHat />}
                    tooltipContent={drivewayTooltip}
                >
                    <p className="text-sm text-blue-200 mb-4">
                        For ${addonPrices.drivewayProtection.toFixed(2)}, we'll use protective devices to prevent scratches or cracks. Declining means you accept responsibility for any driveway damage.
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                        <Button
                            onClick={() => handleDrivewayProtectionChange('accept')}
                            variant={addonsData.drivewayProtection === 'accept' ? 'default' : 'outline'}
                            className={cn(
                                "h-12 text-lg",
                                addonsData.drivewayProtection === 'accept' ? 'bg-yellow-400 text-black hover:bg-yellow-500 border-yellow-400' : 'border-white/30 text-white hover:bg-white/10'
                            )}
                        >
                            Accept (+${addonPrices.drivewayProtection.toFixed(2)})
                        </Button>
                        <Button
                            onClick={() => handleDrivewayProtectionChange('decline')}
                            variant={addonsData.drivewayProtection === 'decline' ? 'destructive' : 'outline'}
                            className={cn(
                                "h-12 text-lg",
                                addonsData.drivewayProtection === 'decline' ? '' : 'border-white/30 text-white hover:bg-white/10'
                            )}
                        >
                            Decline
                        </Button>
                    </div>
                </AddonSection>
            )}
        </>
    );
};