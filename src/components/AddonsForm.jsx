import React, { useState, useEffect, useCallback } from 'react';
    import { motion } from 'framer-motion';
    import { ArrowLeft, HardHat, ShoppingCart, Hammer } from 'lucide-react';
    import { Button } from '@/components/ui/button';
    import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
    import { supabase } from '@/lib/customSupabaseClient';
    import { toast } from '@/components/ui/use-toast';
    import { Link } from 'react-router-dom';
    import { VerificationDialog } from './addons/VerificationDialog';
    import { ProtectionSection } from './addons/ProtectionSection';
    import { EquipmentSection } from './addons/EquipmentSection';
    import { OrderSummary } from './addons/OrderSummary';

    const addonPrices = {
      insurance: 15,
      drivewayProtection: 10,
      equipment: {
        wheelbarrow: 20,
        handTruck: 15,
        gloves: 5,
      },
    };

    const equipmentMeta = [
      { id: 'wheelbarrow', dbName: 'Wheelbarrow', label: 'Wheelbarrow', price: addonPrices.equipment.wheelbarrow, icon: <ShoppingCart className="h-6 w-6 mr-3 text-yellow-400" />, quantity: false },
      { id: 'handTruck', dbName: 'Hand Truck', label: 'Hand Truck', price: addonPrices.equipment.handTruck, icon: <Hammer className="h-6 w-6 mr-3 text-yellow-400" />, quantity: false },
      { id: 'gloves', dbName: 'Working Gloves', label: 'Working Gloves (Pair)', price: addonPrices.equipment.gloves, icon: <HardHat className="h-6 w-6 mr-3 text-yellow-400" />, quantity: true },
    ];

    export const AddonsForm = ({ basePrice, addonsData, setAddonsData, onSubmit, onBack, plan }) => {
      const [totalPrice, setTotalPrice] = useState(basePrice);
      const [showInsuranceDeclineWarning, setShowInsuranceDeclineWarning] = useState(false);
      const [showDrivewayDeclineWarning, setShowDrivewayDeclineWarning] = useState(false);
      const [equipmentInventory, setEquipmentInventory] = useState([]);
      const [loadingInventory, setLoadingInventory] = useState(true);
      const [showVerificationDialog, setShowVerificationDialog] = useState(false);

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

      useEffect(() => {
        let newTotal = basePrice;
        if (addonsData.insurance === 'accept') {
          newTotal += addonPrices.insurance;
        }
        if (plan.id !== 2 && addonsData.drivewayProtection === 'accept') {
          newTotal += addonPrices.drivewayProtection;
        }
        addonsData.equipment.forEach(item => {
          const equipmentInfo = equipmentMeta.find(e => e.id === item.id);
          if (equipmentInfo) {
            newTotal += equipmentInfo.price * item.quantity;
          }
        });
        if (addonsData.distanceInfo?.fee > 0) {
            newTotal += addonsData.distanceInfo.fee;
        }
        setTotalPrice(newTotal);
      }, [addonsData, basePrice, plan.id]);

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
          const existingItem = prev.equipment.find(item => item.id === itemId);
          if (newQuantity > 0) {
            if (existingItem) {
              return { ...prev, equipment: prev.equipment.map(item => item.id === itemId ? { ...item, quantity: newQuantity } : item) };
            } else {
              return { ...prev, equipment: [...prev.equipment, { id: itemId, quantity: newQuantity }] };
            }
          } else {
            return { ...prev, equipment: prev.equipment.filter(item => item.id !== itemId) };
          }
        });
      };
      
      const handleBookingSubmit = () => {
        if (plan.id === 2) {
          setShowVerificationDialog(true);
        } else {
          onSubmit(totalPrice);
        }
      };

      const handleVerifiedSubmit = (verificationData) => {
        setShowVerificationDialog(false);
        const finalAddons = { ...addonsData, verificationSkipped: verificationData.verificationSkipped };
        onSubmit(totalPrice, verificationData, finalAddons);
      };

      return (
        <>
          {plan.id === 2 && (
              <VerificationDialog open={showVerificationDialog} onOpenChange={setShowVerificationDialog} onVerifiedSubmit={handleVerifiedSubmit}/>
          )}
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -50 }}
            transition={{ duration: 0.5 }}
            className="container mx-auto py-16 px-4"
          >
            <div className="max-w-4xl mx-auto bg-white/10 backdrop-blur-lg rounded-2xl p-8 shadow-2xl border border-white/20 relative">
              <div className="flex items-center justify-between mb-8">
                <div className="flex items-center">
                  <Button onClick={onBack} variant="ghost" size="icon" className="mr-4 text-white hover:bg-white/20 hidden sm:inline-flex">
                    <ArrowLeft />
                  </Button>
                  <h2 className="text-3xl font-bold text-white">Add-ons & Protection</h2>
                </div>
                 {(plan.id === 1 || plan.id === 3) && (
                    <div className="flex items-center space-x-2">
                        <Button onClick={onBack} variant="outline" className="text-white border-white/30 hover:bg-white/10 hover:text-white">Back</Button>
                        <Button asChild variant="outline" className="text-white border-white/30 hover:bg-white/10 hover:text-white">
                          <Link to="/contact">Contact</Link>
                        </Button>
                    </div>
                )}
              </div>

              <div className="grid md:grid-cols-2 gap-8">
                <div className="space-y-6">
                  <ProtectionSection 
                    addonsData={addonsData}
                    handleInsuranceChange={handleInsuranceChange}
                    handleDrivewayProtectionChange={handleDrivewayProtectionChange}
                    plan={plan}
                    addonPrices={addonPrices}
                  />
                  <EquipmentSection 
                    addonsData={addonsData}
                    handleEquipmentQuantityChange={handleEquipmentQuantityChange}
                    equipmentInventory={equipmentInventory}
                    loadingInventory={loadingInventory}
                    equipmentMeta={equipmentMeta}
                  />
                </div>

                <OrderSummary
                    basePrice={basePrice}
                    addonsData={addonsData}
                    totalPrice={totalPrice}
                    setAddonsData={setAddonsData}
                    handleBookingSubmit={handleBookingSubmit}
                    plan={plan}
                    equipmentMeta={equipmentMeta}
                    addonPrices={addonPrices}
                />
              </div>
            </div>
          </motion.div>

          <DeclineWarningDialog 
            open={showInsuranceDeclineWarning}
            onOpenChange={setShowInsuranceDeclineWarning}
            onConfirm={confirmDeclineInsurance}
            title="Confirm Your Choice"
            description="By declining rental insurance, you acknowledge and agree that you are fully responsible for any and all damages that may occur to the rental unit, trailer, and all its components during your rental period."
          />

          <DeclineWarningDialog 
            open={showDrivewayDeclineWarning}
            onOpenChange={setShowDrivewayDeclineWarning}
            onConfirm={confirmDeclineDrivewayProtection}
            title="Confirm Your Choice"
            description="By declining driveway protection, you acknowledge that U-Fill Dumpsters is not liable for any potential damage, including but not limited to cracks, scratches, or stains, to your driveway or the surrounding area."
          />
        </>
      );
    };

    const DeclineWarningDialog = ({ open, onOpenChange, onConfirm, title, description }) => (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="bg-gray-900 border-yellow-500 text-white">
                <DialogHeader>
                    <DialogTitle className="flex items-center text-yellow-400 text-2xl">
                        <ArrowLeft className="mr-3 h-8 w-8" />
                        {title}
                    </DialogTitle>
                </DialogHeader>
                <DialogDescription className="text-blue-200 my-4 text-base">{description}</DialogDescription>
                <DialogFooter className="gap-2 sm:justify-center">
                    <Button onClick={() => onOpenChange(false)} variant="outline" className="border-yellow-400 text-yellow-400 hover:bg-yellow-400 hover:text-black">Go Back & Accept</Button>
                    <Button onClick={onConfirm} variant="destructive">I Understand & Decline</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
