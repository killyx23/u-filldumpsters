import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, Check, Shield, HardHat, PackagePlus, ShoppingCart, Hammer, Minus, Plus, AlertTriangle, Loader2, MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

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
  const [showDeclineWarning, setShowDeclineWarning] = useState(false);
  const [equipmentInventory, setEquipmentInventory] = useState([]);
  const [loadingInventory, setLoadingInventory] = useState(true);

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
    setTotalPrice(newTotal);
  }, [addonsData, basePrice, plan.id]);

  const handleInsuranceChange = (value) => {
    if (value === 'decline') {
      setShowDeclineWarning(true);
    } else {
      setAddonsData(prev => ({ ...prev, insurance: 'accept' }));
    }
  };

  const confirmDeclineInsurance = () => {
    setAddonsData(prev => ({ ...prev, insurance: 'decline' }));
    setShowDeclineWarning(false);
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

  return (
    <>
      <motion.div
        initial={{ opacity: 0, x: 100 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -100 }}
        transition={{ duration: 0.5 }}
        className="container mx-auto py-16 px-4"
      >
        <div className="max-w-4xl mx-auto bg-white/10 backdrop-blur-lg rounded-2xl p-8 shadow-2xl border border-white/20">
          <div className="flex items-center mb-8">
            <Button onClick={onBack} variant="ghost" size="icon" className="mr-4 text-white hover:bg-white/20">
              <ArrowLeft />
            </Button>
            <h2 className="text-3xl font-bold text-white">Step 2: Add-ons & Protection</h2>
          </div>

          <div className="grid md:grid-cols-2 gap-8">
            <div className="space-y-6">
              <AddonSection icon={<Shield />} title="Rental Insurance">
                <p className="text-sm text-blue-200 mb-3">For just ${addonPrices.insurance}, get peace of mind. Declining means you accept full responsibility for any damage to the rental unit during your rental period.</p>
                <RadioGroup value={addonsData.insurance} onValueChange={handleInsuranceChange} className="flex gap-4">
                  <RadioCard id="ins-accept" value="accept" label={`Accept (+$${addonPrices.insurance})`} />
                  <RadioCard id="ins-decline" value="decline" label="Decline" />
                </RadioGroup>
              </AddonSection>

              {plan.id !== 2 && (
                <AddonSection icon={<HardHat />} title="Driveway Protection">
                  <p className="text-sm text-blue-200 mb-3">For ${addonPrices.drivewayProtection}, we'll use protective boards to prevent scratches or cracks. Declining means you accept responsibility for any driveway damage.</p>
                  <RadioGroup value={addonsData.drivewayProtection} onValueChange={(value) => setAddonsData(prev => ({...prev, drivewayProtection: value}))} className="flex gap-4">
                    <RadioCard id="dp-accept" value="accept" label={`Accept (+$${addonPrices.drivewayProtection})`} />
                    <RadioCard id="dp-decline" value="decline" label="Decline" />
                  </RadioGroup>
                </AddonSection>
              )}

              <AddonSection icon={<PackagePlus />} title="Rent Additional Equipment">
                {loadingInventory ? <div className="flex justify-center"><Loader2 className="h-8 w-8 animate-spin text-yellow-400" /></div> :
                <div className="space-y-3">
                  {equipmentMeta.map(item => {
                    const currentItem = addonsData.equipment.find(e => e.id === item.id);
                    const quantity = currentItem ? currentItem.quantity : 0;
                    const inventoryItem = equipmentInventory.find(inv => inv.name === item.dbName);
                    const available = inventoryItem ? inventoryItem.total_quantity : 0;
                    
                    return (
                      <EquipmentItem 
                        key={item.id} 
                        id={item.id} 
                        label={item.label} 
                        price={item.price}
                        icon={item.icon}
                        hasQuantitySelector={item.quantity}
                        quantity={quantity}
                        onQuantityChange={(newQuantity) => handleEquipmentQuantityChange(item.id, newQuantity)}
                        available={available}
                      />
                    );
                  })}
                </div>}
              </AddonSection>
            </div>

            <div className="bg-white/5 p-6 rounded-lg flex flex-col">
              <h3 className="text-2xl font-bold text-yellow-400 mb-4">Your Order Summary</h3>
              <div className="space-y-2 text-white flex-grow">
                <SummaryLine label="Base Price" value={basePrice} />
                {addonsData.insurance === 'accept' && <SummaryLine label="Rental Insurance" value={addonPrices.insurance} />}
                {plan.id !== 2 && addonsData.drivewayProtection === 'accept' && <SummaryLine label="Driveway Protection" value={addonPrices.drivewayProtection} />}
                {addonsData.equipment.length > 0 && <p className="font-semibold pt-2">Equipment:</p>}
                {addonsData.equipment.map(item => {
                  const equipmentInfo = equipmentMeta.find(e => e.id === item.id);
                  return (
                    <SummaryLine key={item.id} label={`${equipmentInfo.label} (x${item.quantity})`} value={equipmentInfo.price * item.quantity} isSubItem />
                  );
                })}
              </div>
              <div className="border-t border-white/20 pt-4 mt-4">
                <p className="text-white text-lg font-semibold">Final Total:</p>
                <p className="text-5xl font-bold text-green-400">${totalPrice.toFixed(2)}</p>
              </div>
              <div className="mt-6">
                <Label htmlFor="customer-notes" className="flex items-center text-lg font-semibold text-white mb-2">
                    <MessageSquare className="h-5 w-5 mr-2 text-yellow-400" />
                    Special Instructions
                </Label>
                <Textarea 
                    id="customer-notes"
                    value={addonsData.notes || ''}
                    onChange={(e) => setAddonsData(prev => ({ ...prev, notes: e.target.value }))}
                    placeholder="Any special instructions for delivery or pickup? (e.g., gate code, specific placement)"
                    className="bg-white/10 min-h-[100px]"
                />
              </div>
              <Button onClick={() => onSubmit(totalPrice)} className="w-full mt-6 py-3 text-lg font-semibold bg-gradient-to-r from-green-500 to-teal-600 hover:from-green-600 hover:to-teal-700 text-white">
                <Check className="mr-2" /> Complete Booking
              </Button>
            </div>
          </div>
        </div>
      </motion.div>

      <Dialog open={showDeclineWarning} onOpenChange={setShowDeclineWarning}>
        <DialogContent className="bg-gray-900 border-yellow-500 text-white">
          <DialogHeader>
            <DialogTitle className="flex items-center text-yellow-400 text-2xl">
              <AlertTriangle className="mr-3 h-8 w-8" />
              Confirm Your Choice
            </DialogTitle>
          </DialogHeader>
          <DialogDescription className="text-blue-200 my-4 text-base">
            By declining rental insurance, you acknowledge and agree that you are fully responsible for any and all damages that may occur to the rental unit, trailer, and all its components during your rental period.
          </DialogDescription>
          <DialogFooter className="gap-2 sm:justify-center">
            <Button onClick={() => setShowDeclineWarning(false)} variant="outline" className="border-yellow-400 text-yellow-400 hover:bg-yellow-400 hover:text-black">Go Back & Accept</Button>
            <Button onClick={confirmDeclineInsurance} variant="destructive">I Understand & Decline</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

const AddonSection = ({ icon, title, children }) => (
    <div className="bg-white/5 p-6 rounded-lg">
        <div className="flex items-center mb-4">
            <div className="text-yellow-400 mr-3">{icon}</div>
            <h4 className="text-xl font-semibold text-white">{title}</h4>
        </div>
        {children}
    </div>
);

const RadioCard = ({ id, value, label }) => (
    <div className="flex-1">
        <RadioGroupItem value={value} id={id} className="peer sr-only" />
        <Label htmlFor={id} className="flex flex-col items-center justify-center rounded-md border-2 border-white/20 bg-transparent p-3 text-white hover:bg-white/10 peer-data-[state=checked]:border-yellow-400 peer-data-[state=checked]:text-yellow-400 [&:has([data-state=checked])]:border-yellow-400 cursor-pointer transition-colors">
            {label}
        </Label>
    </div>
);

const EquipmentItem = ({ id, label, price, icon, hasQuantitySelector, quantity, onQuantityChange, available }) => {
    const isAvailable = available > 0;
    const canAddMore = available > quantity;

    const addButton = (
        <Button size="sm" variant={quantity > 0 ? "destructive" : "secondary"} onClick={() => onQuantityChange(quantity > 0 ? 0 : 1)} disabled={!isAvailable && quantity === 0}>
            {quantity > 0 ? 'Remove' : (isAvailable ? 'Add' : 'Out of Stock')}
        </Button>
    );

    return (
        <div className="flex items-center p-3 bg-white/10 rounded-lg">
            {icon}
            <span className="ml-3 text-white flex-grow">{label}</span>
            {hasQuantitySelector ? (
                <div className="flex items-center gap-2">
                    <Button size="icon" variant="ghost" className="h-8 w-8 text-white hover:bg-white/20" onClick={() => onQuantityChange(Math.max(0, quantity - 1))}>
                        <Minus className="h-4 w-4" />
                    </Button>
                    <span className="font-bold text-lg text-white w-8 text-center">{quantity}</span>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <span tabIndex={0}>
                                <Button size="icon" variant="ghost" className="h-8 w-8 text-white hover:bg-white/20" onClick={() => onQuantityChange(quantity + 1)} disabled={!canAddMore}>
                                    <Plus className="h-4 w-4" />
                                </Button>
                            </span>
                        </TooltipTrigger>
                        {!canAddMore && <TooltipContent><p>No more available.</p></TooltipContent>}
                    </Tooltip>
                </div>
            ) : (
                <>
                    <span className="font-semibold text-green-400 mr-4">+${price.toFixed(2)}</span>
                    {!isAvailable && quantity === 0 ? (
                        <Tooltip>
                            <TooltipTrigger asChild><span tabIndex={0}>{addButton}</span></TooltipTrigger>
                            <TooltipContent><p>This item is temporarily out of stock.</p></TooltipContent>
                        </Tooltip>
                    ) : addButton}
                </>
            )}
        </div>
    );
};

const SummaryLine = ({ label, value, isSubItem = false }) => (
    <div className={`flex justify-between items-center ${isSubItem ? 'pl-4' : ''}`}>
        <p className={isSubItem ? 'text-blue-200' : 'text-white'}>{label}</p>
        <p className="font-mono text-green-300">${value.toFixed(2)}</p>
    </div>
);