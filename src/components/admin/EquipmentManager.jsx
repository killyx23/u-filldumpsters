
import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';
import { Loader2, Package, Save, AlertCircle, Truck, ShoppingCart, Wrench } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export const EquipmentManager = () => {
  const [equipment, setEquipment] = useState([]);
  const [bookingEquipment, setBookingEquipment] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingStates, setSavingStates] = useState({});

  const fetchEquipment = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('equipment')
      .select('*')
      .order('type', { ascending: true })
      .order('name', { ascending: true });
      
    if (error) {
      toast({ title: "Failed to load equipment", description: error.message, variant: "destructive" });
    } else {
      setEquipment(data);
    }
    setLoading(false);
  }, []);

  const fetchBookingEquipment = useCallback(async () => {
    const { data, error } = await supabase
      .from('booking_equipment')
      .select(`
        *,
        equipment (*),
        bookings (id, status, drop_off_date, pickup_date, customers (name, email))
      `)
      .is('returned_at', null)
      .order('created_at', { ascending: false });
      
    if (error) {
      toast({ title: "Failed to load booking equipment", description: error.message, variant: "destructive" });
    } else {
      setBookingEquipment(data);
    }
  }, []);

  useEffect(() => {
    fetchEquipment();
    fetchBookingEquipment();
  }, [fetchEquipment, fetchBookingEquipment]);

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

  const getTypeIcon = (type) => {
    switch(type) {
      case 'rental': return <Truck className="h-5 w-5 text-blue-400" />;
      case 'consumable': return <ShoppingCart className="h-5 w-5 text-orange-400" />;
      case 'service': return <Wrench className="h-5 w-5 text-green-400" />;
      default: return <Package className="h-5 w-5 text-gray-400" />;
    }
  };

  const getTypeBadge = (type) => {
    const colors = {
      rental: 'bg-blue-900/40 text-blue-300 border-blue-500/30',
      consumable: 'bg-orange-900/40 text-orange-300 border-orange-500/30',
      service: 'bg-green-900/40 text-green-300 border-green-500/30'
    };
    return colors[type] || 'bg-gray-900/40 text-gray-300 border-gray-500/30';
  };

  const rentalEquipment = equipment.filter(e => e.type === 'rental');
  const consumableEquipment = equipment.filter(e => e.type === 'consumable');
  const serviceEquipment = equipment.filter(e => e.type === 'service');

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Loader2 className="h-16 w-16 animate-spin text-yellow-400" />
      </div>
    );
  }

  return (
    <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 shadow-2xl border border-white/20">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold flex items-center">
          <Package className="mr-3 h-7 w-7 text-yellow-400" />
          Equipment Inventory Manager
        </h2>
      </div>

      <Tabs defaultValue="rentals" className="w-full">
        <TabsList className="grid w-full grid-cols-4 mb-6">
          <TabsTrigger value="rentals">Rentals ({rentalEquipment.length})</TabsTrigger>
          <TabsTrigger value="consumables">Consumables ({consumableEquipment.length})</TabsTrigger>
          <TabsTrigger value="services">Services ({serviceEquipment.length})</TabsTrigger>
          <TabsTrigger value="active">Active Bookings ({bookingEquipment.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="rentals" className="space-y-4">
          <div className="bg-blue-900/20 p-4 rounded-lg border border-blue-500/30 mb-4">
            <div className="flex items-center gap-2 mb-2">
              <Truck className="h-5 w-5 text-blue-400" />
              <h3 className="font-bold text-blue-300">Rental Equipment</h3>
            </div>
            <p className="text-sm text-blue-200">
              Inventory is tracked. Quantities decrease when rented out and increase when returned.
            </p>
          </div>
          {rentalEquipment.map(item => (
            <EquipmentCard 
              key={item.id} 
              item={item} 
              onQuantityChange={handleQuantityChange}
              onSave={handleSave}
              isSaving={savingStates[item.id]}
              getTypeIcon={getTypeIcon}
              getTypeBadge={getTypeBadge}
            />
          ))}
        </TabsContent>

        <TabsContent value="consumables" className="space-y-4">
          <div className="bg-orange-900/20 p-4 rounded-lg border border-orange-500/30 mb-4">
            <div className="flex items-center gap-2 mb-2">
              <ShoppingCart className="h-5 w-5 text-orange-400" />
              <h3 className="font-bold text-orange-300">Consumable Items</h3>
            </div>
            <p className="text-sm text-orange-200">
              Purchased items. Inventory decreases permanently when sold (non-returnable).
            </p>
          </div>
          {consumableEquipment.map(item => (
            <EquipmentCard 
              key={item.id} 
              item={item} 
              onQuantityChange={handleQuantityChange}
              onSave={handleSave}
              isSaving={savingStates[item.id]}
              getTypeIcon={getTypeIcon}
              getTypeBadge={getTypeBadge}
            />
          ))}
        </TabsContent>

        <TabsContent value="services" className="space-y-4">
          <div className="bg-green-900/20 p-4 rounded-lg border border-green-500/30 mb-4">
            <div className="flex items-center gap-2 mb-2">
              <Wrench className="h-5 w-5 text-green-400" />
              <h3 className="font-bold text-green-300">Service Items</h3>
            </div>
            <p className="text-sm text-green-200">
              Services with unlimited availability. No inventory tracking.
            </p>
          </div>
          {serviceEquipment.map(item => (
            <Card key={item.id} className="bg-white/5 border-gray-800">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    {getTypeIcon(item.type)}
                    <div>
                      <p className="text-lg font-bold">{item.name}</p>
                      <p className="text-sm text-gray-400">{item.description}</p>
                      <span className={`inline-block mt-2 text-xs px-2 py-1 rounded-full border font-semibold ${getTypeBadge(item.type)}`}>
                        {item.type}
                      </span>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-bold text-green-400">${Number(item.price).toFixed(2)}</p>
                    <p className="text-xs text-gray-500">Unlimited availability</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="active" className="space-y-4">
          <div className="bg-yellow-900/20 p-4 rounded-lg border border-yellow-500/30 mb-4">
            <div className="flex items-center gap-2 mb-2">
              <AlertCircle className="h-5 w-5 text-yellow-400" />
              <h3 className="font-bold text-yellow-300">Currently Rented Equipment</h3>
            </div>
            <p className="text-sm text-yellow-200">
              Equipment currently assigned to active bookings. These quantities are not available for new rentals.
            </p>
          </div>
          {bookingEquipment.length === 0 ? (
            <p className="text-gray-400 text-center py-8">No equipment currently rented out.</p>
          ) : (
            bookingEquipment.map((be, idx) => (
              <Card key={`booking-eq-${idx}`} className="bg-white/5 border-gray-800">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-lg font-bold">{be.equipment?.name}</p>
                      <p className="text-sm text-gray-400">
                        Booking #{be.booking_id} - {be.bookings?.customers?.name}
                      </p>
                      <p className="text-xs text-gray-500 mt-1">
                        Status: {be.bookings?.status} | 
                        Drop-off: {be.bookings?.drop_off_date} | 
                        Pickup: {be.bookings?.pickup_date}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-2xl font-bold text-yellow-400">×{be.quantity}</p>
                      <span className={`inline-block mt-2 text-xs px-2 py-1 rounded-full border font-semibold ${getTypeBadge(be.equipment?.type)}`}>
                        {be.equipment?.type}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
};

const EquipmentCard = ({ item, onQuantityChange, onSave, isSaving, getTypeIcon, getTypeBadge }) => (
  <Card className="bg-white/5 border-gray-800">
    <CardContent className="p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4 flex-1">
          {getTypeIcon(item.type)}
          <div className="flex-1">
            <p className="text-lg font-bold">{item.name}</p>
            <p className="text-sm text-gray-400">{item.description}</p>
            <span className={`inline-block mt-2 text-xs px-2 py-1 rounded-full border font-semibold ${getTypeBadge(item.type)}`}>
              {item.type}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="text-sm text-gray-400 mb-1">Price</p>
            <p className="text-xl font-bold text-green-400">${Number(item.price).toFixed(2)}</p>
          </div>
          <div className="flex items-center gap-2">
            <div>
              <Label htmlFor={`quantity-${item.id}`} className="text-xs text-gray-400">In Stock:</Label>
              <Input 
                id={`quantity-${item.id}`}
                type="number" 
                value={item.total_quantity} 
                onChange={(e) => onQuantityChange(item.id, e.target.value)}
                className="w-24 bg-white/10 mt-1"
              />
            </div>
            <Button onClick={() => onSave(item)} size="sm" disabled={isSaving} className="mt-5">
              {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Save
            </Button>
          </div>
        </div>
      </div>
    </CardContent>
  </Card>
);
