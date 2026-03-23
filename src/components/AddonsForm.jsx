
import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, HardHat, ShoppingCart, Hammer, PackagePlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';
import { ProtectionSection } from './addons/ProtectionSection';
import { EquipmentSection } from './addons/EquipmentSection';
import { OrderSummary } from './addons/OrderSummary';
import { DeliveryAddressSection } from './DeliveryAddressSection';
import { calculateDistanceAndFee } from '@/services/DistanceCalculationService';

const addonPrices = {
  insurance: 20,
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

export const AddonsForm = ({ basePrice, addonsData, setAddonsData, onSubmit, onBack, plan, deliveryService, contactAddress }) => {
  const [showInsuranceDeclineWarning, setShowInsuranceDeclineWarning] = useState(false);
  const [showDrivewayDeclineWarning, setShowDrivewayDeclineWarning] = useState(false);
  const [equipmentInventory, setEquipmentInventory] = useState([]);
  const [loadingInventory, setLoadingInventory] = useState(true);
  const [fetchedMileageRate, setFetchedMileageRate] = useState(plan?.mileage_rate !== undefined ? Number(plan.mileage_rate) : 20);

  const isDeliveryRequired = plan?.id === 1 || (plan?.id === 2 && deliveryService) || plan?.id === 4;

  useEffect(() => {
    const fetchRate = async () => {
      if (plan?.id) {
        const { data, error } = await supabase.from('services').select('mileage_rate').eq('id', plan.id).single();
        if (!error && data && data.mileage_rate !== null) {
          setFetchedMileageRate(Number(data.mileage_rate));
        }
      }
    };
    fetchRate();
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
  
  const handleProceed = async () => {
    if (isDeliveryRequired) {
      if (!addonsData?.deliveryAddress || !addonsData.deliveryAddress.isVerified) {
        toast({ title: "Delivery Address Required", description: "Please provide a valid delivery address to calculate fees.", variant: "destructive" });
        return;
      }
      if (!addonsData?.deliveryDistance || addonsData.deliveryDistance <= 0) {
        toast({ title: "Distance Calculation Required", description: "Delivery distance must be calculated before proceeding.", variant: "destructive" });
        return;
      }
    }

    let finalTotal = basePrice || 0;
    if (addonsData?.insurance === 'accept') finalTotal += addonPrices.insurance;
    if (addonsData?.drivewayProtection === 'accept' && (plan?.id === 1 || (plan?.id === 2 && deliveryService))) finalTotal += addonPrices.drivewayProtection;
    
    if (addonsData?.equipment && Array.isArray(addonsData.equipment)) {
        addonsData.equipment.forEach(item => {
          const meta = equipmentMeta.find(e => e.id === item.id);
          if (meta) finalTotal += meta.price * item.quantity;
        });
    }

    const feeResult = calculateDistanceAndFee(addonsData?.deliveryDistance || 0, plan?.id, fetchedMileageRate);
    const calculatedMileageCharge = feeResult.totalFee;

    if (calculatedMileageCharge > 0) {
      finalTotal += calculatedMileageCharge;
    }

    if (addonsData?.coupon && addonsData.coupon.isValid) {
      if (addonsData.coupon.discountType === 'fixed') {
        finalTotal = Math.max(0, finalTotal - (addonsData.coupon.discountValue || 0));
      } else if (addonsData.coupon.discountType === 'percentage') {
        finalTotal = finalTotal - (finalTotal * ((addonsData.coupon.discountValue || 0) / 100));
      }
    }
    
    const updatedAddons = { ...addonsData, mileageCharge: calculatedMileageCharge, distanceFeeDisplay: feeResult.displayText };
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
                  addonPrices={addonPrices}
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
