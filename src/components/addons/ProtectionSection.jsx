
import React, { useEffect } from 'react';
import { Shield, HardHat } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AddonSection } from './AddonSection';
import { cn } from '@/lib/utils';
import { useInsurancePricing } from '@/hooks/useInsurancePricing';
import { motion } from 'framer-motion';

export const ProtectionSection = ({ addonsData, handleInsuranceChange, handleDrivewayProtectionChange, plan, addonPrices, isDelivery }) => {
    const { insurancePrice } = useInsurancePricing();

    // Default to 'accept' if no choice has been made yet
    useEffect(() => {
        if (!addonsData.insurance || (addonsData.insurance !== 'accept' && addonsData.insurance !== 'decline')) {
            handleInsuranceChange('accept');
        }
    }, [addonsData.insurance, handleInsuranceChange]);

    const insuranceTooltip = (
        <div className="space-y-3 max-h-[30vh] overflow-y-auto pr-3 -mr-3 [&::-webkit-scrollbar]:w-2.5 [&::-webkit-scrollbar-track]:bg-gray-800 [&::-webkit-scrollbar-track]:rounded-full [&::-webkit-scrollbar-thumb]:bg-gray-500 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-gray-400">
            <p className="font-bold text-base border-b border-gray-700 pb-1">Hardware Protection For Only ${insurancePrice.toFixed(2)}</p>
            <p className="text-sm">Just for a small fee. Gain peace of mind for our premium Sure-Trac equipment. Our hardware protection reduces your liability for accidental damage to critical systems.</p>
            
            <div>
                <p className="font-semibold text-sm mb-1">How it Works:</p>
                <ul className="list-disc list-inside text-xs space-y-1 text-gray-200">
                    <li>Provides up to a $500 credit toward repair or replacement costs.</li>
                    <li>Significantly reduces your out-of-pocket expenses for accidental hardware damage.</li>
                </ul>
            </div>

            <div>
                <p className="font-semibold text-sm mb-1">What's Covered:</p>
                <ul className="list-disc list-inside text-xs space-y-1 text-gray-200">
                    <li>Auto-Tarping System</li>
                    <li>Wireless Remote System</li>
                    <li>Hydraulic Lift System</li>
                    <li>Winch & Lighting</li>
                </ul>
            </div>

            <div>
                <p className="font-semibold text-sm mb-1 text-red-400">ZERO COVERAGE for Misuse or Negligence:</p>
                <ul className="list-disc list-inside text-xs space-y-1 text-gray-200">
                    <li>Overloading beyond the trailer's rated capacity</li>
                    <li>Improper Tarping procedures leading to mechanical failure</li>
                    <li>Gross Negligence, reckless operation, or intentional damage</li>
                </ul>
            </div>

            <p className="text-xs text-blue-300 italic pt-1 border-t border-gray-700">
                Note: This protection strictly covers only the listed hardware stated above. It does not cover tire damage due to negligence or misuse. Also, any wear and tear that is beyond expected normal wear, along with any cosmetic scratches, dings, or dents. Including large dents or improper use causing damage to hinges or the doors, Etc. Coverage applies strictly to the roll-off trailer itself. It does not cover your tow vehicle, personal property, or driveway, Etc.
            </p>
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
                    For just ${insurancePrice.toFixed(2)}, get peace of mind. Declining means you accept full responsibility for any damage to the rental unit during your rental period.
                </p>
                <div className="grid grid-cols-2 gap-3">
                    <motion.div whileTap={{ scale: 0.95, y: 2 }}>
                        <Button
                            onClick={() => handleInsuranceChange('accept')}
                            variant={addonsData.insurance === 'accept' ? 'default' : 'outline'}
                            className={cn(
                                "h-12 w-full text-lg transition-all font-semibold active:bg-yellow-700",
                                addonsData.insurance === 'accept' 
                                    ? 'bg-yellow-600 text-black hover:bg-yellow-700 border-yellow-700 shadow-[inset_0_4px_8px_rgba(0,0,0,0.6)]' 
                                    : 'border-yellow-400/50 text-yellow-400 hover:bg-yellow-400/10'
                            )}
                        >
                            {addonsData.insurance === 'accept' ? 'Accepted' : `Accept (+$${insurancePrice.toFixed(2)})`}
                        </Button>
                    </motion.div>
                    
                    <motion.div whileTap={{ scale: 0.95, y: 2 }}>
                        <Button
                            onClick={() => handleInsuranceChange('decline')}
                            variant="default"
                            className={cn(
                                "h-12 w-full text-lg transition-all font-semibold active:bg-red-900 border",
                                addonsData.insurance === 'decline' 
                                    ? 'bg-red-800 text-white hover:bg-red-900 border-red-800 shadow-[inset_0_4px_8px_rgba(0,0,0,0.6)]' 
                                    : 'bg-red-700 text-black hover:bg-red-800 border-red-700'
                            )}
                        >
                            {addonsData.insurance === 'decline' ? 'Declined' : 'Decline'}
                        </Button>
                    </motion.div>
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
                        <motion.div whileTap={{ scale: 0.95, y: 2 }}>
                            <Button
                                onClick={() => handleDrivewayProtectionChange('accept')}
                                variant={addonsData.drivewayProtection === 'accept' ? 'default' : 'outline'}
                                className={cn(
                                    "h-12 w-full text-lg transition-all font-semibold active:bg-yellow-700",
                                    addonsData.drivewayProtection === 'accept' 
                                        ? 'bg-yellow-600 text-black hover:bg-yellow-700 border-yellow-700 shadow-[inset_0_4px_8px_rgba(0,0,0,0.6)]' 
                                        : 'border-yellow-400/50 text-yellow-400 hover:bg-yellow-400/10'
                                )}
                            >
                                {addonsData.drivewayProtection === 'accept' ? 'Accepted' : `Accept (+$${addonPrices.drivewayProtection.toFixed(2)})`}
                            </Button>
                        </motion.div>
                        <motion.div whileTap={{ scale: 0.95, y: 2 }}>
                            <Button
                                onClick={() => handleDrivewayProtectionChange('decline')}
                                variant={addonsData.drivewayProtection === 'decline' ? 'destructive' : 'outline'}
                                className={cn(
                                    "h-12 w-full text-lg transition-all font-semibold active:bg-red-900",
                                    addonsData.drivewayProtection === 'decline' 
                                        ? 'bg-red-800 text-white hover:bg-red-900 border-red-800 shadow-[inset_0_4px_8px_rgba(0,0,0,0.6)]' 
                                        : 'border-red-500/50 text-red-500 hover:bg-red-500/10'
                                )}
                            >
                                {addonsData.drivewayProtection === 'decline' ? 'Declined' : 'Decline'}
                            </Button>
                        </motion.div>
                    </div>
                </AddonSection>
            )}
        </>
    );
};
