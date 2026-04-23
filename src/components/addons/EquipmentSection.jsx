
import React from 'react';
import { Loader2 } from 'lucide-react';
import { AddonSection } from './AddonSection';
import { EquipmentItem } from './EquipmentItem';

export const EquipmentSection = ({ addonsData, handleEquipmentQuantityChange, equipmentInventory, loadingInventory, equipmentMeta, title, icon }) => {
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
                    const available = inventoryItem ? inventoryItem.total_quantity : 0;
                    
                    // Use price from item metadata (loaded from equipment_pricing in parent)
                    const itemPrice = Number(item.price || 0);
                    
                    return (
                        <EquipmentItem 
                            key={item.id} 
                            id={item.id} 
                            label={item.label} 
                            price={itemPrice}
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
