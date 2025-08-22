
    import React from 'react';
    import { RadioGroup } from '@/components/ui/radio-group';
    import { Shield, HardHat } from 'lucide-react';
    import { AddonSection } from './AddonSection';
    import { RadioCard } from './RadioCard';

    export const ProtectionSection = ({ addonsData, handleInsuranceChange, handleDrivewayProtectionChange, plan, addonPrices }) => {
        return (
            <>
                <AddonSection icon={<Shield />} title="Rental Insurance">
                    <p className="text-sm text-blue-200 mb-3">For just ${addonPrices.insurance}, get peace of mind. Declining means you accept full responsibility for any damage to the rental unit during your rental period.</p>
                    <RadioGroup value={addonsData.insurance} onValueChange={handleInsuranceChange} className="flex gap-4">
                        <RadioCard id="ins-accept" value="accept" label={`Accept (+$${addonPrices.insurance})`} />
                        <RadioCard id="ins-decline" value="decline" label="Decline" />
                    </RadioGroup>
                </AddonSection>

                {plan.id !== 2 && (
                    <AddonSection 
                      icon={<HardHat />} 
                      title="Driveway Protection"
                      tooltipContent={
                        <>
                          <h4 className="font-bold text-yellow-300 mb-2">Advanced Driveway Protection System</h4>
                          <p className="text-sm text-blue-200 mb-3">
                            Protect your property with our advanced driveway protection system. Specially engineered, environmentally friendly pads are placed under the dumpster's contact points to distribute weight evenly and create a protective barrier between the heavy steel container and your driveway surface.
                          </p>
                          <ul className="text-xs text-blue-200 list-disc list-inside space-y-1 mb-3">
                            <li>Vastly superior to standard wood planks.</li>
                            <li>Dramatically reduces pressure to prevent cracks and scrapes.</li>
                            <li>Effective on concrete, asphalt, gravel, and even turf.</li>
                          </ul>
                          <p className="text-xs text-amber-300/80">
                            <strong>Disclaimer:</strong> This is an added preventative measure to significantly reduce the risk of damage. While highly effective, it does not constitute a guarantee against all potential driveway damage.
                          </p>
                        </>
                      }
                    >
                      <p className="text-sm text-blue-200 mb-3">For ${addonPrices.drivewayProtection}, we'll use protective devices to prevent scratches or cracks. Declining means you accept responsibility for any driveway damage.</p>
                      <RadioGroup value={addonsData.drivewayProtection} onValueChange={handleDrivewayProtectionChange} className="flex gap-4">
                        <RadioCard id="dp-accept" value="accept" label={`Accept (+$${addonPrices.drivewayProtection})`} />
                        <RadioCard id="dp-decline" value="decline" label="Decline" />
                      </RadioGroup>
                    </AddonSection>
                )}
            </>
        );
    };
  