
import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Edit, Trash2, Save, X, Loader2, Package, Wrench, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';
import { EquipmentIdValidation } from './EquipmentIdValidation';
import { updateEquipmentPrice } from '@/utils/equipmentPricingIntegration';
import { isValidEquipmentId } from '@/utils/equipmentIdValidator';

const EQUIPMENT_CATEGORIES = {
  rental: { 
    label: 'Rental Equipment', 
    icon: Package, 
    description: 'Physical rental items like dumpsters and equipment',
    color: 'blue'
  },
  consumable: { 
    label: 'Consumable Accessories', 
    icon: Wrench, 
    description: 'Items consumed or used during rental period',
    color: 'green'
  },
  service: { 
    label: 'Disposable Services', 
    icon: FileText, 
    description: 'One-time services and fees',
    color: 'yellow'
  }
};

export const EquipmentManager = () => {
    const [equipment, setEquipment] = useState([]);
    const [loading, setLoading] = useState(true);
    const [editingId, setEditingId] = useState(null);
    const [addingNew, setAddingNew] = useState(false);
    const [addingCategory, setAddingCategory] = useState(null);
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
                .in('type', ['rental', 'consumable', 'service'])
                .order('type', { ascending: true })
                .order('name', { ascending: true });

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
                        formData.type === 'service' ? 'service_item' : 'rental_equipment',
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
            setAddingCategory(null);
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
        setAddingCategory(null);
        setFormData({ name: '', total_quantity: 0, type: 'rental', price: 0, description: '' });
    };

    const handleAddInCategory = (categoryType) => {
        setAddingNew(true);
        setAddingCategory(categoryType);
        setFormData({ ...formData, type: categoryType });
    };

    const groupedEquipment = Object.keys(EQUIPMENT_CATEGORIES).reduce((acc, category) => {
        acc[category] = equipment.filter(item => (item.type || 'rental') === category);
        return acc;
    }, {});

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
                        <div>
                            <CardTitle className="text-white">Equipment Inventory</CardTitle>
                            <p className="text-sm text-gray-400 mt-1">Organized by category for easy management</p>
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    <Accordion type="multiple" defaultValue={Object.keys(EQUIPMENT_CATEGORIES)} className="space-y-4">
                        {Object.entries(EQUIPMENT_CATEGORIES).map(([categoryKey, category]) => {
                            const Icon = category.icon;
                            const categoryItems = groupedEquipment[categoryKey] || [];
                            const isAddingInThisCategory = addingNew && addingCategory === categoryKey;

                            return (
                                <AccordionItem 
                                    key={categoryKey} 
                                    value={categoryKey}
                                    className={`equipment-category-section category-${category.color}`}
                                >
                                    <AccordionTrigger className="equipment-category-header hover:no-underline">
                                        <div className="flex items-center justify-between w-full pr-4">
                                            <div className="flex items-center gap-3">
                                                <div className={`category-icon category-icon-${category.color}`}>
                                                    <Icon className="h-5 w-5" />
                                                </div>
                                                <div className="text-left">
                                                    <h3 className="text-lg font-semibold text-white">{category.label}</h3>
                                                    <p className="text-xs text-gray-400 mt-0.5">{category.description}</p>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-3">
                                                <span className="text-sm text-gray-400 bg-gray-700/50 px-3 py-1 rounded-full">
                                                    {categoryItems.length} {categoryItems.length === 1 ? 'item' : 'items'}
                                                </span>
                                            </div>
                                        </div>
                                    </AccordionTrigger>
                                    <AccordionContent className="equipment-category-content">
                                        <div className="space-y-3 pt-4">
                                            {/* Add New Button for Category */}
                                            <div className="flex justify-end mb-3">
                                                <Button
                                                    onClick={() => handleAddInCategory(categoryKey)}
                                                    className={`bg-${category.color}-600 hover:bg-${category.color}-700 text-white`}
                                                    size="sm"
                                                    disabled={addingNew}
                                                >
                                                    <Plus className="h-4 w-4 mr-2" />
                                                    Add to {category.label}
                                                </Button>
                                            </div>

                                            {/* Add New Form */}
                                            {isAddingInThisCategory && (
                                                <EquipmentForm
                                                    formData={formData}
                                                    setFormData={setFormData}
                                                    onSave={handleSave}
                                                    onCancel={handleCancel}
                                                    isNew
                                                    category={category}
                                                />
                                            )}

                                            {/* Equipment Items */}
                                            {categoryItems.length === 0 && !isAddingInThisCategory ? (
                                                <div className="text-center py-8 text-gray-400 bg-gray-900/30 rounded-lg border border-gray-700 border-dashed">
                                                    <Icon className="h-8 w-8 mx-auto mb-2 opacity-50" />
                                                    <p>No {category.label.toLowerCase()} yet</p>
                                                    <p className="text-xs mt-1">Click "Add to {category.label}" to create one</p>
                                                </div>
                                            ) : (
                                                categoryItems.map(item => (
                                                    editingId === item.id ? (
                                                        <EquipmentForm
                                                            key={item.id}
                                                            formData={formData}
                                                            setFormData={setFormData}
                                                            onSave={handleSave}
                                                            onCancel={handleCancel}
                                                            category={category}
                                                        />
                                                    ) : (
                                                        <EquipmentItem
                                                            key={item.id}
                                                            item={item}
                                                            onEdit={() => handleEdit(item)}
                                                            onDelete={() => handleDelete(item.id)}
                                                            category={category}
                                                        />
                                                    )
                                                ))
                                            )}
                                        </div>
                                    </AccordionContent>
                                </AccordionItem>
                            );
                        })}
                    </Accordion>
                </CardContent>
            </Card>
        </div>
    );
};

const EquipmentForm = ({ formData, setFormData, onSave, onCancel, isNew, category }) => (
    <div className="equipment-form-container">
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
                    <SelectValue placeholder="Select Category" />
                </SelectTrigger>
                <SelectContent className="bg-gray-800 border-gray-700">
                    {Object.entries(EQUIPMENT_CATEGORIES).map(([key, cat]) => (
                        <SelectItem key={key} value={key} className="text-white">
                            {cat.label}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
            <Input
                type="number"
                step="0.01"
                value={formData.price}
                onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                placeholder="Price ($)"
                className="bg-gray-800 border-gray-600 text-white"
            />
        </div>
        <Input
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            placeholder="Description (optional)"
            className="bg-gray-800 border-gray-600 text-white mt-3"
        />
        <div className="flex gap-2 mt-4">
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

const EquipmentItem = ({ item, onEdit, onDelete, category }) => (
    <div className={`equipment-item-card category-${category.color}`}>
        <div className="flex items-center justify-between">
            <div className="flex-1 grid grid-cols-1 md:grid-cols-4 gap-3">
                <div>
                    <p className="text-xs text-gray-400 mb-1">Name</p>
                    <p className="text-white font-medium">{item.name}</p>
                </div>
                <div>
                    <p className="text-xs text-gray-400 mb-1">Category</p>
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium category-badge category-badge-${category.color}`}>
                        {React.createElement(category.icon, { className: "h-3 w-3" })}
                        {category.label}
                    </span>
                </div>
                <div>
                    <p className="text-xs text-gray-400 mb-1">Quantity</p>
                    <p className="text-white">{item.total_quantity}</p>
                </div>
                <div>
                    <p className="text-xs text-gray-400 mb-1">Price</p>
                    <p className="text-green-400 font-semibold">${Number(item.price || 0).toFixed(2)}</p>
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
            <p className="text-sm text-gray-400 mt-3 pt-3 border-t border-gray-700">{item.description}</p>
        )}
        <div className="flex items-center gap-3 mt-2 text-xs text-gray-500">
            <span>ID: {item.id}</span>
        </div>
    </div>
);
