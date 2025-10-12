import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';
import { Loader2, Package, Save, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export const EquipmentManager = () => {
    const [equipment, setEquipment] = useState([]);
    const [loading, setLoading] = useState(true);
    const [savingStates, setSavingStates] = useState({});

    const fetchEquipment = useCallback(async () => {
        setLoading(true);
        const { data, error } = await supabase.from('equipment').select('*').order('id');
        if (error) {
            toast({ title: "Failed to load equipment", description: error.message, variant: "destructive" });
        } else {
            setEquipment(data);
        }
        setLoading(false);
    }, []);

    useEffect(() => {
        fetchEquipment();
    }, [fetchEquipment]);

    const handleQuantityChange = (id, newQuantity) => {
        const quantity = parseInt(newQuantity, 10);
        if (isNaN(quantity)) return;
        setEquipment(prev => prev.map(item => item.id === id ? { ...item, total_quantity: quantity } : item));
    };

    const handleSave = async (item) => {
        setSavingStates(prev => ({ ...prev, [item.id]: true }));
        const { error } = await supabase
            .from('equipment')
            .update({ total_quantity: item.total_quantity })
            .eq('id', item.id);
        
        if (error) {
            toast({ title: `Failed to save ${item.name}`, description: error.message, variant: 'destructive' });
        } else {
            toast({ title: `${item.name} updated successfully!` });
        }
        setSavingStates(prev => ({ ...prev, [item.id]: false }));
    };

    if (loading) {
        return <div className="flex justify-center items-center h-64"><Loader2 className="h-16 w-16 animate-spin text-yellow-400" /></div>;
    }

    return (
        <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 shadow-2xl border border-white/20">
            <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold">Manage Equipment Inventory</h2>
            </div>
            <div className="space-y-4">
                {equipment.map(item => (
                    <div key={item.id} className="bg-white/5 p-4 rounded-lg flex items-center justify-between">
                        <div className="flex items-center">
                            <Package className="h-6 w-6 mr-4 text-yellow-400" />
                            <p className="text-lg font-bold">{item.name}</p>
                        </div>
                        <div className="flex items-center gap-4">
                            <Label htmlFor={`quantity-${item.id}`}>Total in Stock:</Label>
                            <Input 
                                id={`quantity-${item.id}`}
                                type="number" 
                                value={item.total_quantity} 
                                onChange={(e) => handleQuantityChange(item.id, e.target.value)}
                                className="w-24 bg-white/10"
                            />
                            <Button onClick={() => handleSave(item)} size="sm" disabled={savingStates[item.id]}>
                                {savingStates[item.id] ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                                Save
                            </Button>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};