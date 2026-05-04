
import React, { useEffect, useState } from 'react';
import { PackagePlus, Loader2, Shield, Truck, HardHat, ShoppingCart, Trash2, Tv, Box, Plus, Minus, Info, CheckCircle2 } from 'lucide-react';
import { formatCurrency } from '@/api/EcommerceApi';
import { supabase } from '@/lib/customSupabaseClient';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useInsurancePricing } from '@/hooks/useInsurancePricing';
import { toast } from '@/components/ui/use-toast';
import { checkInventoryAvailability } from '@/utils/equipmentInventoryManager';

const getIconForEquipment = (name) => {
  const nameLower = name?.toLowerCase() || '';
  if (nameLower.includes('hand truck')) return <Truck className="h-6 w-6" />;
  if (nameLower.includes('gloves')) return <HardHat className="h-6 w-6" />;
  if (nameLower.includes('cart') || nameLower.includes('wheelbarrow')) return <ShoppingCart className="h-6 w-6" />;
  if (nameLower.includes('mattress')) return <Trash2 className="h-6 w-6" />;
  if (nameLower.includes('tv')) return <Tv className="h-6 w-6" />;
  if (nameLower.includes('appliance')) return <Box className="h-6 w-6" />;
  if (nameLower.includes('insurance')) return <Shield className="h-6 w-6" />;
  return <Box className="h-6 w-6" />;
};

const isDisposalService = (name) => {
  const nameLower = (name || '').toLowerCase();
  return nameLower.includes('mattress disposal') || 
         nameLower.includes('tv disposal') || 
         nameLower.includes('appliance disposal');
};

export const RescheduleAddonsSection = ({ 
  originalBooking,
  selectedAddonsList = [], 
  setSelectedAddonsList,
  bookingId 
}) => {
  const [availableEquipment, setAvailableEquipment] = useState([]);
  const [loading, setLoading] = useState(true);
  const [inventoryWarnings, setInventoryWarnings] = useState({});
  const [originalAddonsMap, setOriginalAddonsMap] = useState(new Map());
  const [initialized, setInitialized] = useState(false);
  const { insurancePrice } = useInsurancePricing();

  const currencyInfo = { code: 'USD', symbol: '$' };

  // Fetch original add-ons from booking_equipment and addons JSON
  useEffect(() => {
    const fetchOriginalAddons = async () => {
      if (!bookingId || !originalBooking) return;
      
      try {
        console.log('[RescheduleAddons] Fetching original add-ons for booking:', bookingId);
        const originalMap = new Map();
        
        // Fetch from booking_equipment table (includes disposal services, excludes ID 7)
        const { data: bookingEquip, error: equipErr } = await supabase
          .from('booking_equipment')
          .select('*, equipment(*)')
          .eq('booking_id', bookingId)
          .neq('equipment_id', 7); // Exclude Premium Insurance (ID 7)
        
        if (equipErr) {
          console.error('[RescheduleAddons] Error fetching booking equipment:', equipErr);
          throw equipErr;
        }
        
        console.log('[RescheduleAddons] Booking equipment fetched (excluding ID 7):', bookingEquip);
        
        // Add equipment items to map (excluding ID 7)
        (bookingEquip || []).forEach(be => {
          if (be.equipment && be.equipment.id !== 7) {
            const equipId = be.equipment.id;
            const equipName = be.equipment.name;
            const equipType = be.equipment.type || 'rental';
            const equipPrice = Number(be.equipment.price || 0);
            const equipQty = Number(be.quantity || 1);
            
            console.log(`[RescheduleAddons] Original item: ${equipName} (ID: ${equipId}, Type: ${equipType}, Qty: ${equipQty})`);
            
            originalMap.set(equipId, {
              id: equipId,
              name: equipName,
              price: equipPrice,
              quantity: equipQty,
              type: equipType
            });
          }
        });
        
        // Check for insurance in addons JSON (use hook price, not equipment table)
        if (originalBooking.addons && typeof originalBooking.addons === 'object') {
          Object.entries(originalBooking.addons).forEach(([key, val]) => {
            if (key.toLowerCase().includes('insurance')) {
              // Use insurancePrice from hook (services table)
              console.log('[RescheduleAddons] Original insurance found, using services table price:', insurancePrice);
              originalMap.set('insurance', {
                id: 'insurance',
                name: 'Premium Insurance',
                price: insurancePrice,
                quantity: 1,
                type: 'service'
              });
            }
          });
        }
        
        console.log('[RescheduleAddons] Total original items (excluding equipment ID 7):', originalMap.size);
        setOriginalAddonsMap(originalMap);
        
        // ONLY pre-check items that were on original booking
        if (!initialized && (!selectedAddonsList || selectedAddonsList.length === 0)) {
          const originalList = Array.from(originalMap.values());
          console.log('[RescheduleAddons] Initializing with original items:', originalList);
          setSelectedAddonsList(originalList);
          setInitialized(true);
        }
        
      } catch (err) {
        console.error('[RescheduleAddons] Error fetching original add-ons:', err);
        toast({
          title: "Error Loading Original Items",
          description: "Could not load your original add-ons. Please try again.",
          variant: "destructive"
        });
      }
    };
    
    fetchOriginalAddons();
  }, [bookingId, originalBooking, initialized, insurancePrice]);

  // Fetch available equipment (excluding ID 7)
  useEffect(() => {
    const fetchEquipment = async () => {
      setLoading(true);
      try {
        console.log('[RescheduleAddons] Fetching available equipment (excluding ID 7)...');
        
        // Exclude equipment ID 7 (Premium Insurance)
        const { data: equipmentData, error: equipErr } = await supabase
          .from('equipment')
          .select('*')
          .neq('id', 7) // Exclude Premium Insurance
          .order('type', { ascending: true })
          .order('name', { ascending: true });
        
        if (equipErr) {
          console.error('[RescheduleAddons] Error fetching equipment:', equipErr);
          throw equipErr;
        }

        console.log('[RescheduleAddons] Available equipment fetched (excluding ID 7):', equipmentData?.length);

        const equipmentWithIcons = (equipmentData || []).map(eq => ({
          id: eq.id,
          name: eq.name,
          price: Number(eq.price || 0),
          description: eq.description || eq.type || 'Equipment item',
          icon: getIconForEquipment(eq.name),
          type: eq.type || 'rental',
          total_quantity: eq.total_quantity || 0,
          isQuantityControlled: eq.type !== 'service' || isDisposalService(eq.name)
        }));

        // Add Premium Insurance manually (from services table via hook)
        const allAddons = [
          {
            id: 'insurance',
            name: 'Premium Insurance',
            price: insurancePrice,
            description: 'Complete protection coverage for your rental',
            icon: <Shield className="h-6 w-6" />,
            type: 'service',
            isQuantityControlled: false
          },
          ...equipmentWithIcons
        ];

        console.log('[RescheduleAddons] Total available add-ons (including Premium Insurance from services):', allAddons.length);
        setAvailableEquipment(allAddons);
      } catch (err) {
        console.error("[RescheduleAddons] Failed to load addons:", err);
        toast({
          title: "Error Loading Equipment",
          description: "Could not load equipment options. Please refresh the page.",
          variant: "destructive"
        });
      } finally {
        setLoading(false);
      }
    };

    fetchEquipment();
  }, [insurancePrice]);

  const handleToggle = async (addon) => {
    const isCurrentlySelected = selectedAddonsList.some(a => 
      a.id === addon.id || 
      (a.name && addon.name && a.name.toLowerCase() === addon.name.toLowerCase())
    );
    
    const originalItem = originalAddonsMap.get(addon.id);
    
    if (!isCurrentlySelected) {
      // Adding item
      const quantityToAdd = originalItem ? originalItem.quantity : 1;
      
      // Check inventory for rentals and consumables (but don't block)
      if (addon.type === 'rental' || addon.type === 'consumable') {
        const inventoryCheck = await checkInventoryAvailability(addon.id, quantityToAdd);
        
        if (!inventoryCheck.available) {
          setInventoryWarnings(prev => ({
            ...prev,
            [addon.id]: `Only ${inventoryCheck.quantity} available in stock`
          }));
          
          toast({
            title: "Low Inventory",
            description: `Only ${inventoryCheck.quantity} ${addon.name} currently available.`,
            variant: "default"
          });
        }
      }

      setSelectedAddonsList(prev => [...prev, { ...addon, quantity: quantityToAdd }]);
    } else {
      // Removing item
      if (addon.type === 'consumable') {
        toast({
          title: "Consumable Item Removed",
          description: `${addon.name} removed from your order.`,
          variant: "default"
        });
      }
      
      setSelectedAddonsList(prev => prev.filter(a => 
        a.id !== addon.id && 
        !(a.name && addon.name && a.name.toLowerCase() === addon.name.toLowerCase())
      ));
      
      setInventoryWarnings(prev => {
        const updated = { ...prev };
        delete updated[addon.id];
        return updated;
      });
    }
  };

  const handleQuantityChange = async (addon, newQuantity) => {
    const qty = Math.max(0, Math.min(99, parseInt(newQuantity) || 0));
    
    // If quantity is 0, remove the item
    if (qty === 0) {
      setSelectedAddonsList(prev => prev.filter(a => 
        a.id !== addon.id && 
        !(a.name && addon.name && a.name.toLowerCase() === addon.name.toLowerCase())
      ));
      setInventoryWarnings(prev => {
        const updated = { ...prev };
        delete updated[addon.id];
        return updated;
      });
      return;
    }
    
    // Get original quantity for this item
    const originalItem = originalAddonsMap.get(addon.id);
    const originalQty = originalItem ? originalItem.quantity : 0;
    
    // Check inventory for rentals and consumables
    if (addon.type === 'rental' || addon.type === 'consumable') {
      // Calculate how much additional stock we need beyond original
      const additionalNeeded = Math.max(0, qty - originalQty);
      
      if (additionalNeeded > 0) {
        const inventoryCheck = await checkInventoryAvailability(addon.id, additionalNeeded);
        
        if (!inventoryCheck.available && inventoryCheck.quantity > 0) {
          const maxAllowed = originalQty + inventoryCheck.quantity;
          setInventoryWarnings(prev => ({
            ...prev,
            [addon.id]: `Originally: ${originalQty}, Available stock: ${inventoryCheck.quantity}, Max total: ${maxAllowed}`
          }));
          
          toast({
            title: "Stock Limit Reached",
            description: `You had ${originalQty} originally. Only ${inventoryCheck.quantity} additional available. Max total: ${maxAllowed}`,
            variant: "default"
          });
        } else if (inventoryCheck.quantity === 0) {
          setInventoryWarnings(prev => ({
            ...prev,
            [addon.id]: `No additional stock available (you had ${originalQty} originally)`
          }));
        } else {
          setInventoryWarnings(prev => {
            const updated = { ...prev };
            delete updated[addon.id];
            return updated;
          });
        }
      } else {
        // Reducing quantity or same as original - no stock issue
        setInventoryWarnings(prev => {
          const updated = { ...prev };
          delete updated[addon.id];
          return updated;
        });
      }
    }
    
    setSelectedAddonsList(prev => 
      prev.map(a => {
        if (a.id === addon.id || (a.name && addon.name && a.name.toLowerCase() === addon.name.toLowerCase())) {
          return { ...a, quantity: qty };
        }
        return a;
      })
    );
  };

  const incrementQuantity = (addon) => {
    const current = selectedAddonsList.find(a => 
      a.id === addon.id || 
      (a.name && addon.name && a.name.toLowerCase() === addon.name.toLowerCase())
    );
    const currentQty = current?.quantity || 0;
    handleQuantityChange(addon, currentQty + 1);
  };

  const decrementQuantity = (addon) => {
    const current = selectedAddonsList.find(a => 
      a.id === addon.id || 
      (a.name && addon.name && a.name.toLowerCase() === addon.name.toLowerCase())
    );
    const currentQty = current?.quantity || 0;
    handleQuantityChange(addon, Math.max(0, currentQty - 1));
  };

  const isSelected = (addon) => {
    if (!selectedAddonsList) return false;
    return selectedAddonsList.some(a => 
      a.id === addon.id || 
      (a.name && addon.name && a.name.toLowerCase() === addon.name.toLowerCase())
    );
  };

  const getQuantity = (addon) => {
    const item = selectedAddonsList?.find(a => 
      a.id === addon.id || 
      (a.name && addon.name && a.name.toLowerCase() === addon.name.toLowerCase())
    );
    return item?.quantity || 1;
  };

  const isOriginalItem = (addonId) => {
    const hasOriginal = originalAddonsMap.has(addonId);
    if (hasOriginal) {
      console.log(`[RescheduleAddons] Item ${addonId} is original`);
    }
    return hasOriginal;
  };

  const getOriginalQuantity = (addonId) => {
    const original = originalAddonsMap.get(addonId);
    return original ? original.quantity : 0;
  };

  const subtotal = (selectedAddonsList || []).reduce((sum, item) => {
    const price = Number(item?.price) || 0;
    const quantity = Number(item?.quantity) || 1;
    return sum + (price * quantity);
  }, 0);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <Loader2 className="w-10 h-10 animate-spin text-gold mb-4" />
        <p className="text-gray-400">Loading equipment options...</p>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-500 max-w-5xl mx-auto w-full">
      <div className="text-center space-y-3 pb-2">
        <div className="mx-auto w-14 h-14 bg-[hsl(var(--gold)_/_0.1)] border border-[hsl(var(--gold)_/_0.2)] rounded-2xl flex items-center justify-center mb-4 shadow-gold">
          <PackagePlus className="w-7 h-7 text-gold" />
        </div>
        <h2 className="text-3xl font-extrabold text-white tracking-tight">Enhance Your Booking</h2>
        <p className="text-base text-gray-400 max-w-2xl mx-auto">
          Your original selections are pre-checked below. You can adjust quantities or remove items as needed.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {availableEquipment?.map((addon, idx) => {
          const selected = isSelected(addon);
          const quantity = getQuantity(addon);
          const hasWarning = inventoryWarnings[addon.id];
          const isDisposal = isDisposalService(addon.name);
          const isOriginal = isOriginalItem(addon.id);
          const originalQty = getOriginalQuantity(addon.id);
          
          return (
            <Card 
              key={`addon-${addon?.id || idx}`}
              className={`transition-all duration-300 cursor-pointer relative ${
                selected 
                  ? 'bg-[hsl(var(--gold)_/_0.08)] border-[hsl(var(--gold)_/_0.4)] shadow-[0_0_20px_hsla(var(--gold),0.15)]' 
                  : 'bg-gray-900/60 border-gray-800 hover:border-gray-700'
              }`}
            >
              {isOriginal && (
                <div className="absolute top-2 right-2 z-10">
                  <div className="bg-blue-600 text-white text-xs font-bold px-2 py-1 rounded-full flex items-center gap-1 shadow-lg">
                    <CheckCircle2 className="w-3 h-3" />
                    Originally: {originalQty}
                  </div>
                </div>
              )}
              
              <CardContent className="p-6 space-y-4">
                <div className="flex items-start justify-between">
                  <div 
                    className={`p-3 rounded-xl ${
                      selected 
                        ? 'bg-[hsl(var(--gold)_/_0.15)] text-gold' 
                        : 'bg-gray-800 text-gray-400'
                    }`}
                  >
                    {addon.icon}
                  </div>
                  <Checkbox 
                    checked={selected}
                    onCheckedChange={() => handleToggle(addon)}
                    className={selected ? 'border-gold data-[state=checked]:bg-gold' : ''}
                  />
                </div>
                
                <div>
                  <h4 className="text-white font-bold text-base mb-1">{addon.name}</h4>
                  <p className="text-gray-400 text-sm mb-3">{addon.description}</p>
                  
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`text-xs px-2 py-1 rounded-full font-semibold ${
                      addon.type === 'rental' ? 'bg-blue-900/40 text-blue-300' :
                      addon.type === 'consumable' ? 'bg-orange-900/40 text-orange-300' :
                      isDisposal ? 'bg-purple-900/40 text-purple-300' :
                      'bg-green-900/40 text-green-300'
                    }`}>
                      {addon.type === 'rental' ? 'Rental' : 
                       addon.type === 'consumable' ? 'Purchase' : 
                       isDisposal ? 'Disposal Service' : 'Service'}
                    </span>
                    {addon.type === 'rental' && addon.total_quantity !== undefined && (
                      <span className={`text-xs ${addon.total_quantity === 0 ? 'text-orange-400' : 'text-gray-500'}`}>
                        {addon.total_quantity} in stock
                      </span>
                    )}
                  </div>
                  
                  <p className="text-gold font-black text-xl">
                    {formatCurrency(addon.price * 100, currencyInfo)}
                    {addon.isQuantityControlled && <span className="text-gray-500 text-sm font-normal ml-1">/each</span>}
                  </p>
                </div>

                {hasWarning && (
                  <div className="flex items-center gap-2 bg-blue-900/20 p-2 rounded border border-blue-500/30">
                    <Info className="h-4 w-4 text-blue-400 flex-shrink-0" />
                    <span className="text-xs text-blue-300">{hasWarning}</span>
                  </div>
                )}

                {addon.isQuantityControlled && selected && (
                  <div className="flex items-center gap-3 pt-3 border-t border-gray-800">
                    <span className="text-gray-400 text-sm font-medium">Quantity:</span>
                    <div className="flex items-center gap-2 ml-auto">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={(e) => { e.stopPropagation(); decrementQuantity(addon); }}
                        className="h-8 w-8 p-0 border-gray-700 hover:bg-gray-800"
                      >
                        <Minus className="h-4 w-4" />
                      </Button>
                      <Input
                        type="number"
                        min="0"
                        max="99"
                        value={quantity}
                        onChange={(e) => { e.stopPropagation(); handleQuantityChange(addon, e.target.value); }}
                        className="h-8 w-14 text-center bg-gray-950 border-gray-700 text-white"
                        onClick={(e) => e.stopPropagation()}
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={(e) => { e.stopPropagation(); incrementQuantity(addon); }}
                        className="h-8 w-8 p-0 border-gray-700 hover:bg-gray-800"
                        disabled={quantity >= 99}
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )}

                {selected && addon.isQuantityControlled && quantity > 1 && (
                  <div className="flex justify-between items-center pt-2 border-t border-gray-800">
                    <span className="text-gray-400 text-sm">Item Total:</span>
                    <span className="text-gold-light font-bold">
                      {formatCurrency(addon.price * quantity * 100, currencyInfo)}
                    </span>
                  </div>
                )}

                {addon.type === 'consumable' && selected && (
                  <p className="text-xs text-orange-300 bg-orange-900/20 p-2 rounded border border-orange-500/30">
                    Non-returnable purchase item
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="bg-gray-900 border border-[hsl(var(--gold)_/_0.2)] p-6 rounded-2xl flex justify-between items-center mt-8 shadow-xl">
        <div>
          <span className="text-gold-light font-black text-xs uppercase tracking-widest block mb-1">Add-ons Subtotal</span>
          <span className="text-gray-400 text-sm font-medium">{selectedAddonsList?.length || 0} items selected</span>
        </div>
        <span className="text-3xl font-black text-gold drop-shadow-[0_0_10px_hsla(var(--gold),0.3)]">
          +{formatCurrency(subtotal * 100, currencyInfo)}
        </span>
      </div>
    </div>
  );
};
