import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Edit, Trash2, Save, X, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';
import { EquipmentIdValidation } from './EquipmentIdValidation';
import { updateEquipmentPrice, getPriceForEquipment } from '@/utils/equipmentPricingIntegration';
import { isValidEquipmentId } from '@/utils/equipmentIdValidator';

export const EquipmentManager = () => {
    const [equipment, setEquipment] = useState([]);
    const [loading, setLoading] = useState(true);
    const [editingId, setEditingId] = useState(null);
    const [addingNew, setAddingNew] = useState(false);
    const [formData, setFormData] = useState({
        name: '',
        total_quantity: 0,
        type: 'rental',
        price: 0,
        description: ''
    });

    const fetchEquipment = useCallback(async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('equipment')
                .select('*')
                .order('id');

            if (error) throw error;
            setEquipment(data || []);
        } catch (error) {
            console.error('Error fetching equipment:', error);
            toast({
                title: 'Error',
                description: 'Failed to load equipment',
                variant: 'destructive'
            });
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchEquipment();
    }, [fetchEquipment]);

    const handleEdit = (item) => {
        setEditingId(item.id);
        setFormData({
            name: item.name,
            total_quantity: item.total_quantity,
            type: item.type || 'rental',
            price: item.price || 0,
            description: item.description || ''
        });
    };

    const handleSave = async () => {
        try {
            const dataToSave = {
                name: formData.name,
                total_quantity: parseInt(formData.total_quantity),
                type: formData.type,
                price: parseFloat(formData.price),
                description: formData.description
            };

            if (editingId) {
                // Update equipment table
                const { error: equipError } = await supabase
                    .from('equipment')
                    .update(dataToSave)
                    .eq('id', editingId);

                if (equipError) throw equipError;

                // Update equipment_pricing table if valid ID (1-7)
                if (isValidEquipmentId(editingId)) {
                    console.log('[EquipmentManager] Updating equipment_pricing for ID:', editingId);
                    
                    const result = await updateEquipmentPrice(
                        editingId,
                        parseFloat(formData.price),
                        formData.type === 'consumable' ? 'consumable_item' : 
                        formData.type === 'service' ? 'service_item' : 
                        formData.type === 'insurance' ? 'insurance' : 'rental_equipment',
                        null,
                        'Admin price update via Equipment Manager'
                    );

                    if (!result.success) {
                        console.warn('[EquipmentManager] Failed to update equipment_pricing:', result.error);
                        toast({
                            title: 'Partial Success',
                            description: 'Equipment updated but pricing table update failed.',
                            variant: 'warning'
                        });
                    } else {
                        console.log('[EquipmentManager] ✓ Equipment and pricing updated successfully');
                    }
                } else {
                    console.log('[EquipmentManager] Equipment ID not in range 1-7, skipping equipment_pricing update');
                }

                toast({ title: 'Success', description: 'Equipment updated successfully' });
            } else {
                const { error } = await supabase
                    .from('equipment')
                    .insert([dataToSave]);

                if (error) throw error;
                toast({ title: 'Success', description: 'Equipment added successfully' });
            }

            setEditingId(null);
            setAddingNew(false);
            setFormData({ name: '', total_quantity: 0, type: 'rental', price: 0, description: '' });
            fetchEquipment();
        } catch (error) {
            console.error('Error saving equipment:', error);
            toast({
                title: 'Error',
                description: 'Failed to save equipment',
                variant: 'destructive'
            });
        }
    };

    const handleDelete = async (id) => {
        if (!confirm('Are you sure you want to delete this equipment?')) return;

        try {
            const { error } = await supabase
                .from('equipment')
                .delete()
                .eq('id', id);

            if (error) throw error;
            toast({ title: 'Success', description: 'Equipment deleted successfully' });
            fetchEquipment();
        } catch (error) {
            console.error('Error deleting equipment:', error);
            toast({
                title: 'Error',
                description: 'Failed to delete equipment',
                variant: 'destructive'
            });
        }
    };

    const handleCancel = () => {
        setEditingId(null);
        setAddingNew(false);
        setFormData({ name: '', total_quantity: 0, type: 'rental', price: 0, description: '' });
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="h-8 w-8 animate-spin text-yellow-400" />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Equipment ID Validation Tool */}
            <EquipmentIdValidation />

            {/* Equipment List */}
            <Card className="bg-gray-800 border-gray-700">
                <CardHeader>
                    <div className="flex justify-between items-center">
                        <CardTitle className="text-white">Equipment Inventory</CardTitle>
                        <Button
                            onClick={() => setAddingNew(true)}
                            className="bg-green-600 hover:bg-green-700"
                            disabled={addingNew}
                        >
                            <Plus className="h-4 w-4 mr-2" />
                            Add Equipment
                        </Button>
                    </div>
                </CardHeader>
                <CardContent>
                    <div className="space-y-3">
                        {/* Add New Form */}
                        {addingNew && (
                            <EquipmentForm
                                formData={formData}
                                setFormData={setFormData}
                                onSave={handleSave}
                                onCancel={handleCancel}
                                isNew
                            />
                        )}

                        {/* Equipment List */}
                        {equipment.map(item => (
                            editingId === item.id ? (
                                <EquipmentForm
                                    key={item.id}
                                    formData={formData}
                                    setFormData={setFormData}
                                    onSave={handleSave}
                                    onCancel={handleCancel}
                                />
                            ) : (
                                <EquipmentItem
                                    key={item.id}
                                    item={item}
                                    onEdit={() => handleEdit(item)}
                                    onDelete={() => handleDelete(item.id)}
                                />
                            )
                        ))}

                        {equipment.length === 0 && !addingNew && (
                            <p className="text-gray-400 text-center py-8">No equipment found</p>
                        )}
                    </div>
                </CardContent>
            </Card>
        </div>
    );
};

const EquipmentForm = ({ formData, setFormData, onSave, onCancel, isNew }) => (
    <div className="bg-gray-900/50 p-4 rounded-lg border border-gray-700 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="Equipment Name"
                className="bg-gray-800 border-gray-600 text-white"
            />
            <Input
                type="number"
                value={formData.total_quantity}
                onChange={(e) => setFormData({ ...formData, total_quantity: e.target.value })}
                placeholder="Quantity"
                className="bg-gray-800 border-gray-600 text-white"
            />
            <Select
                value={formData.type}
                onValueChange={(value) => setFormData({ ...formData, type: value })}
            >
                <SelectTrigger className="bg-gray-800 border-gray-600 text-white">
                    <SelectValue placeholder="Select Type" />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="rental">Rental</SelectItem>
                    <SelectItem value="consumable">Consumable</SelectItem>
                    <SelectItem value="service">Service</SelectItem>
                    <SelectItem value="insurance">Insurance</SelectItem>
                </SelectContent>
            </Select>
            <Input
                type="number"
                step="0.01"
                value={formData.price}
                onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                placeholder="Price"
                className="bg-gray-800 border-gray-600 text-white"
            />
        </div>
        <Input
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            placeholder="Description (optional)"
            className="bg-gray-800 border-gray-600 text-white"
        />
        <div className="flex gap-2">
            <Button onClick={onSave} className="bg-green-600 hover:bg-green-700">
                <Save className="h-4 w-4 mr-2" />
                Save
            </Button>
            <Button onClick={onCancel} variant="outline" className="border-gray-600 text-white hover:bg-gray-700">
                <X className="h-4 w-4 mr-2" />
                Cancel
            </Button>
        </div>
    </div>
);

const EquipmentItem = ({ item, onEdit, onDelete }) => (
    <div className="bg-gray-900/30 p-4 rounded-lg border border-gray-700 hover:border-gray-600 transition-colors">
        <div className="flex items-center justify-between">
            <div className="flex-1 grid grid-cols-1 md:grid-cols-4 gap-3">
                <div>
                    <p className="text-xs text-gray-400">Name</p>
                    <p className="text-white font-medium">{item.name}</p>
                </div>
                <div>
                    <p className="text-xs text-gray-400">Type</p>
                    <p className="text-white capitalize">{item.type || 'rental'}</p>
                </div>
                <div>
                    <p className="text-xs text-gray-400">Quantity</p>
                    <p className="text-white">{item.total_quantity}</p>
                </div>
                <div>
                    <p className="text-xs text-gray-400">Price</p>
                    <p className="text-green-400">${Number(item.price || 0).toFixed(2)}</p>
                </div>
            </div>
            <div className="flex gap-2 ml-4">
                <Button
                    onClick={onEdit}
                    size="icon"
                    variant="outline"
                    className="border-gray-600 text-white hover:bg-gray-700"
                >
                    <Edit className="h-4 w-4" />
                </Button>
                <Button
                    onClick={onDelete}
                    size="icon"
                    variant="outline"
                    className="border-red-600 text-red-400 hover:bg-red-900/20"
                >
                    <Trash2 className="h-4 w-4" />
                </Button>
            </div>
        </div>
        {item.description && (
            <p className="text-sm text-gray-400 mt-2">{item.description}</p>
        )}
        <p className="text-xs text-gray-500 mt-1">ID: {item.id}</p>
    </div>
);