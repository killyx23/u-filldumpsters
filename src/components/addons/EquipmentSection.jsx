import React from 'react';
import { Loader2 } from 'lucide-react';
import { AddonSection } from './AddonSection';
import { EquipmentItem } from './EquipmentItem';
import { bookableFromInventoryRow } from '@/utils/equipmentInventoryManager';
import { additionalDayIncludesPrint, quoteRentalEquipmentLine } from '@/utils/rentalEquipmentPricing';

export const EquipmentSection = ({ addonsData, handleEquipmentQuantityChange, equipmentInventory, loadingInventory, equipmentMeta, title, icon, rentalStart = null, rentalEnd = null }) => {
    if (equipmentMeta.length === 0) {
        return null;
    }

    return (
        <AddonSection icon={icon} title={title}>
            {loadingInventory ? <div className="flex justify-center"><Loader2 className="h-8 w-8 animate-spin text-yellow-400" /></div> :
            <div className="space-y-3">
                {equipmentMeta.map(item => {
                    const currentItem = addonsData.equipment.find(e => e.id === item.id);
                    const quantity = currentItem ? currentItem.quantity : 0;
                    const inventoryItem = equipmentInventory.find(inv => inv.id === item.dbId);
                    const isRental = String(item.type || inventoryItem?.type || '').toLowerCase() === 'rental';
                    const available = inventoryItem
                        ? (isRental
                            ? bookableFromInventoryRow({ ...inventoryItem, type: 'rental' })
                            : Number(inventoryItem.available_quantity ?? inventoryItem.total_quantity ?? 0))
                        : 0;
                    
                    const itemPrice = Number(item.price || 0);
                    const isPurchaseItem = item.dbId === 3 || item.type === 'purchase';
                    const stayQuote = quoteRentalEquipmentLine({
                        basePrice: itemPrice,
                        additionalDayPrice: item.additionalDayPrice || 0,
                        quantity: Math.max(quantity, 1),
                        dropOff: rentalStart,
                        pickup: rentalEnd || rentalStart,
                        isRental: isRental && !isPurchaseItem,
                    });
                    const unitForStay = isRental && !isPurchaseItem
                        ? quoteRentalEquipmentLine({
                            basePrice: itemPrice,
                            additionalDayPrice: item.additionalDayPrice || 0,
                            quantity: 1,
                            dropOff: rentalStart,
                            pickup: rentalEnd || rentalStart,
                            isRental: true,
                        }).lineTotal
                        : itemPrice;
                    const extraDayNote = isRental && !isPurchaseItem ? additionalDayIncludesPrint(stayQuote) : '';
                    
                    const displayLabel = isPurchaseItem && itemPrice > 0 
                        ? `${item.label} - $${itemPrice.toFixed(2)}`
                        : item.label;
                    
                    return (
                        <EquipmentItem 
                            key={item.id} 
                            id={item.id} 
                            label={displayLabel} 
                            price={unitForStay}
                            extraDayNote={extraDayNote}
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
    );
};