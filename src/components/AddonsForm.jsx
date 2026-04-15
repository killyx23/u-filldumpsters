import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, HardHat, ShoppingCart, Hammer, PackagePlus, Trash2, Monitor, Info, ShowerHead as WashingMachine } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';
import { ProtectionSection } from './addons/ProtectionSection';
import { EquipmentSection } from './addons/EquipmentSection';
import { OrderSummary } from './addons/OrderSummary';
import { DeliveryAddressSection } from './DeliveryAddressSection';
import { calculateDistanceAndFee } from '@/services/DistanceCalculationService';
import { useInsurancePricing } from '@/hooks/useInsurancePricing';

const addonPrices = {
  drivewayProtection: 15,
  equipment: {
    wheelbarrow: 10,
    handTruck: 15,
    gloves: 5,
  },
};

const equipmentMeta = [
  { id: 'wheelbarrow', dbId: 1, label: 'Wheelbarrow', price: addonPrices.equipment.wheelbarrow, icon: <ShoppingCart className="h-6 w-6 mr-3 text-yellow-400" />, quantity: false, type: 'rental' },
  { id: 'handTruck', dbId: 2, label: 'Hand Truck', price: addonPrices.equipment.handTruck, icon: <Hammer className="h-6 w-6 mr-3 text-yellow-400" />, quantity: false, type: 'rental' },
  { id: 'gloves', dbId: 3, label: 'Working Gloves (Pair)', price: addonPrices.equipment.gloves, icon: <HardHat className="h-6 w-6 mr-3 text-yellow-400" />, quantity: true, type: 'purchase' },
];

const disposalMeta = [
  { id: 'mattressDisposal', label: 'Mattress Disposal', price: 25, icon: <Trash2 className="h-6 w-6 mr-3 text-yellow-400" /> },
  { id: 'tvDisposal', label: 'TV Disposal', price: 15, icon: <Monitor className="h-6 w-6 mr-3 text-yellow-400" /> },
  { id: 'applianceDisposal', label: 'Appliance Disposal', price: 35, icon: <WashingMachine className="h-6 w-6 mr-3 text-yellow-400" /> },
];

export const AddonsForm = ({ basePrice, addonsData, setAddonsData, onSubmit, onBack, plan, deliveryService, contactAddress }) => {
  const [showInsuranceDeclineWarning, setShowInsuranceDeclineWarning] = useState(false);
  const [showDrivewayDeclineWarning, setShowDrivewayDeclineWarning] = useState(false);
  const [showDisposalInfo, setShowDisposalInfo] = useState(false);
  const [equipmentInventory, setEquipmentInventory] = useState([]);
  const [loadingInventory, setLoadingInventory] = useState(true);
  const [fetchedMileageRate, setFetchedMileageRate] = useState(plan?.mileage_rate !== undefined ? Number(plan.mileage_rate) : 0.85);
  const [fetchedDeliveryFeeFlat, setFetchedDeliveryFeeFlat] = useState(plan?.delivery_fee !== undefined ? Number(plan.delivery_fee) : 10.00);

  const { insurancePrice } = useInsurancePricing();

  const isDeliveryRequired = plan?.id === 1 || (plan?.id === 2 && deliveryService) || plan?.id === 4;

  // Initialize insurance to 'accept' by default if it's missing/undefined
  useEffect(() => {
    if (addonsData && addonsData.insurance === undefined) {
      setAddonsData(prev => ({ ...prev, insurance: 'accept' }));
    }
  }, [addonsData?.insurance, setAddonsData]);

  useEffect(() => {
    const fetchPricing = async () => {
      if (plan?.id) {
        const { data, error } = await supabase.from('services').select('mileage_rate, delivery_fee').eq('id', plan.id).single();
        if (!error && data) {
          if (data.mileage_rate !== null) setFetchedMileageRate(Number(data.mileage_rate));
          if (data.delivery_fee !== null) setFetchedDeliveryFeeFlat(Number(data.delivery_fee));
        }
      }
    };
    fetchPricing();
  }, [plan?.id]);

  const fetchInventory = useCallback(async () => {
    setLoadingInventory(true);
    const { data, error } = await supabase.functions.invoke('get-equipment-inventory');
    if (error) {
      toast({ title: "Could not load equipment inventory.", variant: "destructive" });
    } else {
      setEquipmentInventory(data.inventory);
    }
    setLoadingInventory(false);
  }, []);

  useEffect(() => {
    fetchInventory();
  }, [fetchInventory]);

  const handleInsuranceChange = (value) => {
    if (value === 'decline') {
      setShowInsuranceDeclineWarning(true);
    } else {
      setAddonsData(prev => ({ ...prev, insurance: 'accept' }));
    }
  };

  const confirmDeclineInsurance = () => {
    setAddonsData(prev => ({ ...prev, insurance: 'decline' }));
    setShowInsuranceDeclineWarning(false);
  };

  const handleDrivewayProtectionChange = (value) => {
    if (value === 'decline') {
      setShowDrivewayDeclineWarning(true);
    } else {
      setAddonsData(prev => ({ ...prev, drivewayProtection: 'accept' }));
    }
  };

  const confirmDeclineDrivewayProtection = () => {
    setAddonsData(prev => ({ ...prev, drivewayProtection: 'decline' }));
    setShowDrivewayDeclineWarning(false);
  };

  const handleEquipmentQuantityChange = (itemId, newQuantity) => {
    setAddonsData(prev => {
      const equipmentInfo = equipmentMeta.find(e => e.id === itemId);
      if(!equipmentInfo) return prev;

      const currentEquipment = Array.isArray(prev.equipment) ? prev.equipment : [];
      const existingItem = currentEquipment.find(item => item.id === itemId);
      
      if (newQuantity > 0) {
        if (existingItem) {
          return { ...prev, equipment: currentEquipment.map(item => item.id === itemId ? { ...item, quantity: newQuantity } : item) };
        } else {
          return { ...prev, equipment: [...currentEquipment, { id: itemId, dbId: equipmentInfo.dbId, quantity: newQuantity }] };
        }
      } else {
        return { ...prev, equipment: currentEquipment.filter(item => item.id !== itemId) };
      }
    });
  };

  const handleDisposalQuantityChange = (itemId, newQuantity) => {
    setAddonsData(prev => ({
      ...prev,
      [itemId]: newQuantity
    }));
  };
  
  const handleProceed = async (appliedDeliveryFeeFlat, calculatedMileageCharge) => {
    if (isDeliveryRequired) {
      const dAddress = addonsData?.deliveryAddress;
      if (!dAddress || !dAddress.street || !dAddress.city || !dAddress.state || !dAddress.zip) {
        toast({ title: "Delivery Address Required", description: "Please provide a complete delivery address.", variant: "destructive" });
        return;
      }
      if (dAddress.isVerified && (!addonsData?.deliveryDistance || addonsData.deliveryDistance <= 0)) {
        toast({ title: "Distance Calculation Required", description: "Delivery distance must be calculated before proceeding.", variant: "destructive" });
        return;
      }
    }

    let finalTotal = basePrice || 0;
    
    if (isDeliveryRequired) {
        finalTotal += appliedDeliveryFeeFlat || 0;
    }

    // Dynamic insurance price from useInsurancePricing hook
    // Notice this correctly checks for 'accept', which is now the default
    if (addonsData?.insurance === 'accept') finalTotal += insurancePrice;
    if (addonsData?.drivewayProtection === 'accept' && isDeliveryRequired) finalTotal += addonPrices.drivewayProtection;
    
    if (addonsData?.equipment && Array.isArray(addonsData.equipment)) {
        addonsData.equipment.forEach(item => {
          const meta = equipmentMeta.find(e => e.id === item.id);
          if (meta) finalTotal += meta.price * item.quantity;
        });
    }

    let totalDisposalFee = 0;
    let disposalItemsList = [];
    
    // Do not process disposal items for Dump Loader Trailer (ID 2)
    if (plan?.id !== 2) {
      if (addonsData?.mattressDisposal > 0) {
          finalTotal += 25 * addonsData.mattressDisposal;
          totalDisposalFee += 25 * addonsData.mattressDisposal;
          disposalItemsList.push(`${addonsData.mattressDisposal}x Mattress Disposal`);
      }
      if (addonsData?.tvDisposal > 0) {
          finalTotal += 15 * addonsData.tvDisposal;
          totalDisposalFee += 15 * addonsData.tvDisposal;
          disposalItemsList.push(`${addonsData.tvDisposal}x TV Disposal`);
      }
      if (addonsData?.applianceDisposal > 0) {
          finalTotal += 35 * addonsData.applianceDisposal;
          totalDisposalFee += 35 * addonsData.applianceDisposal;
          disposalItemsList.push(`${addonsData.applianceDisposal}x Appliance Disposal`);
      }
    }

    const feeResult = calculateDistanceAndFee(addonsData?.deliveryDistance || 0, plan?.id, fetchedMileageRate);
    const resolvedMileageCharge = calculatedMileageCharge !== undefined ? calculatedMileageCharge : (feeResult.trip_mileage_cost || 0);

    if (resolvedMileageCharge > 0 && isDeliveryRequired) {
      finalTotal += resolvedMileageCharge;
    }

    if (addonsData?.coupon && addonsData.coupon.isValid) {
      if (addonsData.coupon.discountType === 'fixed') {
        finalTotal = Math.max(0, finalTotal - (addonsData.coupon.discountValue || 0));
      } else if (addonsData.coupon.discountType === 'percentage') {
        finalTotal = finalTotal - (finalTotal * ((addonsData.coupon.discountValue || 0) / 100));
      }
    }
    
    const updatedAddons = { 
        ...addonsData, 
        deliveryFee: isDeliveryRequired ? appliedDeliveryFeeFlat : 0,
        mileageCharge: isDeliveryRequired ? resolvedMileageCharge : 0, 
        distanceFeeDisplay: feeResult.displayText,
        insurancePriceApplied: addonsData?.insurance === 'accept' ? insurancePrice : 0 // Keep track of applied price for edge cases
    };

    if (disposalItemsList.length > 0) {
        updatedAddons.disposalNotes = `Disposal Items included: ${disposalItemsList.join(', ')} (Total Dump Fee: $${totalDisposalFee})`;
    } else {
        updatedAddons.disposalNotes = null;
    }

    onSubmit(finalTotal, null, updatedAddons);
  };

  const handleCouponApply = (coupon) => {
    setAddonsData(prev => ({ ...prev, coupon }));
  };

  if (!addonsData || !plan) {
    return null;
  }
  
  const rentalEquipment = equipmentMeta.filter(item => item.type === 'rental');
  const purchaseItems = equipmentMeta.filter(item => item.type === 'purchase');

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 50 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -50 }}
        transition={{ duration: 0.5 }}
        className="container mx-auto py-16 px-4"
      >
        <div className="max-w-6xl mx-auto relative">
          <div className="grid lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2 bg-white/10 backdrop-blur-lg rounded-2xl p-8 shadow-2xl border border-white/20 z-10">
              <div className="flex items-center justify-between mb-8">
                <div className="flex items-center">
                  <Button onClick={onBack} variant="ghost" size="icon" className="mr-4 text-white hover:bg-white/20 hidden sm:inline-flex interactive-hover">
                    <ArrowLeft />
                  </Button>
                  <h2 className="text-3xl font-bold text-white">Add-ons & Options</h2>
                </div>
              </div>

              <div className="space-y-8">
                {isDeliveryRequired && (
                  <DeliveryAddressSection 
                    contactAddress={contactAddress}
                    addonsData={addonsData}
                    setAddonsData={setAddonsData}
                    plan={plan}
                    fetchedMileageRate={fetchedMileageRate}
                  />
                )}
              
                <ProtectionSection 
                  addonsData={addonsData}
                  handleInsuranceChange={handleInsuranceChange}
                  handleDrivewayProtectionChange={handleDrivewayProtectionChange}
                  plan={plan}
                  addonPrices={{ ...addonPrices, insurance: insurancePrice }} // Dynamically inject insurance price
                  isDelivery={deliveryService && plan.id === 2}
                />
                <EquipmentSection 
                  addonsData={addonsData}
                  handleEquipmentQuantityChange={handleEquipmentQuantityChange}
                  equipmentInventory={equipmentInventory}
                  loadingInventory={loadingInventory}
                  equipmentMeta={rentalEquipment}
                  title="Rent Additional Equipment"
                  icon={<PackagePlus />}
                />
                <EquipmentSection 
                  addonsData={addonsData}
                  handleEquipmentQuantityChange={handleEquipmentQuantityChange}
                  equipmentInventory={equipmentInventory}
                  loadingInventory={loadingInventory}
                  equipmentMeta={purchaseItems}
                  title="Items for Purchase"
                  icon={<ShoppingCart />}
                />

                {plan?.id !== 2 && (
                  <div className="bg-black/20 p-6 rounded-xl border border-white/10 mt-8">
                    <div className="flex items-center mb-4">
                      <Trash2 className="h-6 w-6 mr-3 text-yellow-400" />
                      <h3 className="text-xl font-semibold text-white">Disposal Items</h3>
                      <button 
                        type="button" 
                        onClick={() => setShowDisposalInfo(true)}
                        className="ml-2 text-blue-300 hover:text-yellow-400 transition-colors"
                        title="Why these fees?"
                      >
                        <Info className="h-5 w-5" />
                      </button>
                    </div>
                    <div className="space-y-4">
                      {disposalMeta.map(item => {
                        const quantity = addonsData?.[item.id] || 0;
                        return (
                          <div key={item.id} className="flex items-center justify-between bg-white/5 p-4 rounded-lg border border-white/5">
                            <div className="flex items-center">
                              {item.icon}
                              <div>
                                <p className="text-white font-medium">{item.label}</p>
                                <p className="text-green-400 text-sm">${item.price}/unit</p>
                              </div>
                            </div>
                            <div className="flex items-center space-x-3">
                              <Button 
                                type="button" 
                                variant="outline" 
                                size="icon" 
                                onClick={() => handleDisposalQuantityChange(item.id, Math.max(0, quantity - 1))} 
                                className="h-8 w-8 text-white border-white/30 hover:bg-white/20"
                              >
                                -
                              </Button>
                              <span className="text-white w-4 text-center">{quantity}</span>
                              <Button 
                                type="button" 
                                variant="outline" 
                                size="icon" 
                                onClick={() => handleDisposalQuantityChange(item.id, quantity + 1)} 
                                className="h-8 w-8 text-white border-white/30 hover:bg-white/20"
                              >
                                +
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

              </div>
            </div>

            <div className="lg:col-span-1 z-0 relative">
              <OrderSummary
                  plan={{...plan, price: basePrice}}
                  addons={addonsData}
                  contactAddress={contactAddress}
                  onProceed={handleProceed}
                  isProcessing={false}
                  onCouponApply={handleCouponApply}
                  deliveryService={deliveryService}
                  fetchedMileageRate={fetchedMileageRate}
                  fetchedDeliveryFeeFlat={fetchedDeliveryFeeFlat}
              />
            </div>
          </div>
        </div>
      </motion.div>

      <DeclineWarningDialog 
        open={showInsuranceDeclineWarning}
        onOpenChange={setShowInsuranceDeclineWarning}
        onConfirm={confirmDeclineInsurance}
        title="Confirm Your Choice"
        description="By declining rental insurance, you acknowledge and agree that you are fully responsible for any and all damages that may occur to the rental unit, trailer, and all its components during your rental period. You will be billed for the full cost of repairs or replacement."
      />

      <DeclineWarningDialog 
        open={showDrivewayDeclineWarning}
        onOpenChange={setShowDrivewayDeclineWarning}
        onConfirm={confirmDeclineDrivewayProtection}
        title="Confirm Your Choice"
        description="By declining driveway protection, you acknowledge that U-Fill Dumpsters LLC is not liable for any potential damage, including but not limited to cracks, scratches, or stains, to your driveway or the surrounding area."
      />

      <Dialog open={showDisposalInfo} onOpenChange={setShowDisposalInfo}>
        <DialogContent className="bg-gray-900 border-white/20 text-white z-[9999]">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold text-white mb-2">Prohibited Materials & Extra Fees</DialogTitle>
          </DialogHeader>
          <DialogDescription className="text-blue-200 text-sm leading-relaxed pt-2 pb-4">
            Mattress, TV, and appliance disposal requires specialized handling and processing at certified waste facilities. These items cannot be disposed of in standard landfills due to environmental and safety regulations. The fees charged reflect the actual costs incurred by waste management facilities for proper recycling and disposal:
            <ul className="list-disc list-inside mt-2 space-y-1 text-white">
              <li>Mattresses: $25/unit</li>
              <li>TVs/Monitors: $15/unit</li>
              <li>Appliances: $35/unit</li>
            </ul>
            <br />
            By including these fees upfront, we ensure transparent pricing and proper environmental stewardship for these materials.
          </DialogDescription>
          <DialogFooter className="sm:justify-end">
            <Button onClick={() => setShowDisposalInfo(false)} variant="secondary" className="w-full sm:w-auto">
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

const DeclineWarningDialog = ({ open, onOpenChange, onConfirm, title, description }) => (
    <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="bg-gray-900 border-yellow-400 text-white z-[9999]">
            <DialogHeader>
                <DialogTitle className="flex items-center text-yellow-400 text-2xl">
                    <ArrowLeft className="mr-3 h-8 w-8" />
                    {typeof title === 'string' ? title : 'Confirm'}
                </DialogTitle>
            </DialogHeader>
            <DialogDescription className="my-4 text-base">
                {typeof description === 'string' ? description : 'Please confirm your choice.'}
            </DialogDescription>
            <DialogFooter className="gap-2 sm:justify-center">
                <Button onClick={() => onOpenChange(false)} variant="outline" className="border-yellow-400 text-yellow-400 hover:bg-yellow-400 hover:text-black interactive-hover">Go Back & Accept</Button>
                <Button onClick={onConfirm} variant="destructive" className="interactive-hover">I Understand & Decline</Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>
);