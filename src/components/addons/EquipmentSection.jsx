import React from 'react';
    import { Loader2, PackagePlus } from 'lucide-react';
    import { AddonSection } from './AddonSection';
    import { EquipmentItem } from './EquipmentItem';

    export const EquipmentSection = ({ addonsData, handleEquipmentQuantityChange, equipmentInventory, loadingInventory, equipmentMeta }) => {
        return (
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
        );
    };