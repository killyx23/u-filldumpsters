
import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';
import { Loader2, Save, Plus, Edit } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from '@/components/ui/checkbox';

const ServicePricingCard = ({ service, onSave }) => {
    const [isSaving, setIsSaving] = useState(false);
    const [price, setPrice] = useState(service.base_price || 0);
    const [unit, setUnit] = useState(service.price_unit || '/day');
    const [deliveryFee, setDeliveryFee] = useState(service.features?.find(f => f.name === 'Delivery Fee')?.value || 0);
    const [mileageRate, setMileageRate] = useState(service.mileage_rate !== undefined && service.mileage_rate !== null ? service.mileage_rate : 0.85);

    const isDeliveryService = service.id === 4 || service.id === 1;

    useEffect(() => {
        setPrice(service.base_price || 0);
        setUnit(service.price_unit || '/day');
        setMileageRate(service.mileage_rate !== undefined && service.mileage_rate !== null ? service.mileage_rate : 0.85);
        if (isDeliveryService) {
            setDeliveryFee(service.features?.find(f => f.name === 'Delivery Fee')?.value || 0);
        }
    }, [service, isDeliveryService]);

    const handleSave = async () => {
        try {
            setIsSaving(true);
            
            // Prepare features array if it's a delivery service
            let updatedFeatures = service.features ? JSON.parse(JSON.stringify(service.features)) : [];
            if (isDeliveryService) {
                const feeIndex = updatedFeatures.findIndex(f => f.name === 'Delivery Fee');
                const parsedDeliveryFee = parseFloat(deliveryFee);
                if (feeIndex > -1) {
                    updatedFeatures[feeIndex].value = isNaN(parsedDeliveryFee) ? 0 : parsedDeliveryFee;
                } else {
                    updatedFeatures.push({ name: 'Delivery Fee', value: isNaN(parsedDeliveryFee) ? 0 : parsedDeliveryFee });
                }
            }

            // Prepare strict payload
            const updatePayload = {
                base_price: parseFloat(price) || 0,
                price_unit: unit || '',
                mileage_rate: parseFloat(mileageRate) || 0
            };

            if (isDeliveryService) {
                updatePayload.features = updatedFeatures;
            }

            await onSave(service.id, updatePayload);
        } catch (error) {
            console.error("Error preparing save data:", error);
            toast({ title: "Validation Error", description: "Please check your input values.", variant: "destructive" });
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="bg-white/5 p-4 rounded-lg flex flex-col md:flex-row items-center justify-between gap-4">
            <p className="text-lg font-bold text-white w-full md:w-1/4">{service.name}</p>
            <div className="flex flex-wrap items-center gap-4 flex-1 justify-end">
                <div className="flex items-center gap-2">
                    <Label>Base Price:</Label>
                    <Input 
                        type="number" 
                        step="0.01"
                        value={price} 
                        onChange={(e) => setPrice(e.target.value)}
                        className="w-24 bg-white/10"
                        placeholder="Price"
                        disabled={isSaving}
                    />
                </div>
                <div className="flex items-center gap-2">
                    <Label>Unit:</Label>
                     <Input 
                        type="text" 
                        value={unit} 
                        onChange={(e) => setUnit(e.target.value)}
                        className="w-24 bg-white/10"
                        placeholder="e.g., /day"
                        disabled={isSaving}
                    />
                </div>
               
                {isDeliveryService && (
                    <>
                        <div className="flex items-center gap-2">
                            <Label>Delivery Fee:</Label>
                            <Input 
                                type="number" 
                                step="0.01"
                                value={deliveryFee} 
                                onChange={(e) => setDeliveryFee(e.target.value)}
                                className="w-24 bg-white/10"
                                placeholder="Fee"
                                disabled={isSaving}
                            />
                        </div>
                        <div className="flex items-center gap-2">
                            <Label>Mileage Rate:</Label>
                            <Input 
                                type="number" 
                                step="0.01"
                                value={mileageRate} 
                                onChange={(e) => setMileageRate(e.target.value)}
                                className="w-24 bg-white/10"
                                placeholder="0.85"
                                disabled={isSaving}
                            />
                            <span className="text-sm text-gray-400">/mile</span>
                        </div>
                    </>
                )}
                <Button onClick={handleSave} size="sm" disabled={isSaving} className="ml-2 min-w-[90px]">
                    {isSaving ? (
                        <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving...</>
                    ) : (
                        <><Save className="mr-2 h-4 w-4" /> Save</>
                    )}
                </Button>
            </div>
        </div>
    );
};

const CouponForm = ({ services, onSave, onCancel, coupon }) => {
    const [code, setCode] = useState(coupon?.code || '');
    const [discountType, setDiscountType] = useState(coupon?.discount_type || 'fixed');
    const [discountValue, setDiscountValue] = useState(coupon?.discount_value || '');
    const [expiresAt, setExpiresAt] = useState(coupon?.expires_at ? coupon.expires_at.split('T')[0] : '');
    const [usageLimit, setUsageLimit] = useState(coupon?.usage_limit || '');
    const [selectedServices, setSelectedServices] = useState(coupon?.service_ids || []);
    const [applyToAll, setApplyToAll] = useState(!coupon?.service_ids || coupon.service_ids.length === 0);

    const handleServiceToggle = (serviceId) => {
        setSelectedServices(prev => 
            prev.includes(serviceId) ? prev.filter(id => id !== serviceId) : [...prev, serviceId]
        );
    };

    const handleSubmit = () => {
        const couponData = {
            code: code.toUpperCase(),
            discount_type: discountType,
            discount_value: parseFloat(discountValue),
            expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
            usage_limit: usageLimit ? parseInt(usageLimit) : null,
            service_ids: applyToAll ? null : selectedServices,
            is_active: coupon ? coupon.is_active : true,
        };
        if (coupon?.id) {
            couponData.id = coupon.id;
        }
        onSave(couponData);
    };

    return (
        <DialogContent className="bg-gray-900 border-yellow-400 text-white">
            <DialogHeader>
                <DialogTitle>{coupon ? 'Edit Coupon' : 'Create New Coupon'}</DialogTitle>
                <DialogDescription>
                    {coupon ? 'Update the details for this coupon.' : 'Fill out the form to create a new promotional coupon.'}
                </DialogDescription>
            </DialogHeader>
            <div className="py-4 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <Label htmlFor="code">Coupon Code</Label>
                        <Input id="code" value={code} onChange={e => setCode(e.target.value.toUpperCase())} className="bg-white/10" />
                    </div>
                    <div>
                        <Label htmlFor="usageLimit">Usage Limit (optional)</Label>
                        <Input id="usageLimit" type="number" value={usageLimit} onChange={e => setUsageLimit(e.target.value)} className="bg-white/10" />
                    </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <Label>Discount Type</Label>
                        <Select value={discountType} onValueChange={setDiscountType}>
                            <SelectTrigger className="bg-white/10"><SelectValue /></SelectTrigger>
                            <SelectContent><SelectItem value="fixed">Fixed Amount ($)</SelectItem><SelectItem value="percentage">Percentage (%)</SelectItem></SelectContent>
                        </Select>
                    </div>
                    <div>
                        <Label htmlFor="discountValue">Discount Value</Label>
                        <Input id="discountValue" type="number" value={discountValue} onChange={e => setDiscountValue(e.target.value)} className="bg-white/10" />
                    </div>
                </div>
                <div>
                    <Label htmlFor="expiresAt">Expires At (optional)</Label>
                    <Input id="expiresAt" type="date" value={expiresAt} onChange={e => setExpiresAt(e.target.value)} className="bg-white/10" />
                </div>
                <div>
                    <Label>Applies To</Label>
                    <div className="space-y-2 mt-2 p-3 bg-black/20 rounded-md">
                        <div className="flex items-center space-x-2">
                            <Checkbox id="all-services" checked={applyToAll} onCheckedChange={checked => setApplyToAll(checked)} />
                            <Label htmlFor="all-services">All Services</Label>
                        </div>
                        {!applyToAll && (
                            <div className="grid grid-cols-2 gap-2 pt-2 border-t border-white/10">
                                {services.map(service => (
                                    <div key={service.id} className="flex items-center space-x-2">
                                        <Checkbox id={`service-${service.id}`} checked={selectedServices.includes(service.id)} onCheckedChange={() => handleServiceToggle(service.id)} />
                                        <Label htmlFor={`service-${service.id}`}>{service.name}</Label>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
            <DialogFooter>
                <DialogClose asChild><Button variant="ghost" onClick={onCancel}>Cancel</Button></DialogClose>
                <Button onClick={handleSubmit}><Save className="mr-2 h-4 w-4" /> Save Coupon</Button>
            </DialogFooter>
        </DialogContent>
    );
};

export const PricingManager = () => {
    const [services, setServices] = useState([]);
    const [coupons, setCoupons] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isCouponFormOpen, setIsCouponFormOpen] = useState(false);
    const [editingCoupon, setEditingCoupon] = useState(null);

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const [servicesRes, couponsRes] = await Promise.all([
                supabase.from('services').select('*').in('id', [1, 2, 3, 4]).order('id'),
                supabase.from('coupons').select('*').order('created_at', { ascending: false })
            ]);

            if (servicesRes.error) throw servicesRes.error;
            if (couponsRes.error) throw couponsRes.error;

            const serviceData = servicesRes.data;
            const hasDeliveryService = serviceData.some(s => s.id === 4);
            if (!hasDeliveryService) {
                const { data: newService, error: newServiceError } = await supabase.from('services').select('*').eq('id', 4).single();
                if (!newServiceError && newService) {
                    serviceData.push(newService);
                    serviceData.sort((a,b) => a.id - b.id);
                }
            }
            setServices(serviceData);
            setCoupons(couponsRes.data);
        } catch (error) {
            console.error("Failed to fetch data:", error);
            toast({ title: "Failed to load data", variant: "destructive", description: error.message });
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const handleSaveService = async (id, updateData) => {
        try {
            const { error } = await supabase
                .from('services')
                .update(updateData)
                .eq('id', id);
            
            if (error) {
                console.error("Supabase update error:", error);
                throw error;
            }
            
            toast({ title: "Service pricing updated successfully" });
            await fetchData(); // Refresh to ensure UI stays perfectly synced with DB
        } catch (error) {
            console.error("Failed to save service pricing:", error);
            toast({ title: "Failed to save pricing", description: error.message || "An unknown database error occurred.", variant: "destructive" });
        }
    };

    const handleSaveCoupon = async (couponData) => {
        try {
            const { error } = await supabase.from('coupons').upsert(couponData, { onConflict: 'id' });
            if (error) throw error;
            
            toast({ title: 'Coupon saved successfully!' });
            setIsCouponFormOpen(false);
            setEditingCoupon(null);
            fetchData();
        } catch (error) {
            toast({ title: 'Failed to save coupon', description: error.message, variant: 'destructive' });
        }
    };

    const handleToggleCouponStatus = async (coupon) => {
        try {
            const { error } = await supabase
                .from('coupons')
                .update({ is_active: !coupon.is_active })
                .eq('id', coupon.id);
            if (error) throw error;
            
            toast({ title: `Coupon ${coupon.is_active ? 'deactivated' : 'activated'}.` });
            fetchData();
        } catch (error) {
            toast({ title: 'Failed to update coupon status', variant: 'destructive', description: error.message });
        }
    };

    if (loading) {
        return <div className="flex justify-center items-center h-64"><Loader2 className="h-16 w-16 animate-spin text-yellow-400" /></div>;
    }

    return (
        <div className="space-y-8">
            <div className="bg-white/10 p-6 rounded-2xl">
                <h2 className="text-2xl font-bold mb-4">Service Pricing</h2>
                <div className="space-y-4">
                    {services.filter(s => [1,2,3,4].includes(s.id)).map(service => (
                        <ServicePricingCard key={service.id} service={service} onSave={handleSaveService} />
                    ))}
                </div>
            </div>

            <div className="bg-white/10 p-6 rounded-2xl">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-2xl font-bold">Coupons</h2>
                    <Button onClick={() => { setEditingCoupon(null); setIsCouponFormOpen(true); }}>
                        <Plus className="mr-2 h-4 w-4" /> Create Coupon
                    </Button>
                </div>
                <div className="space-y-2">
                    {coupons.map(coupon => (
                        <div key={coupon.id} className="bg-white/5 p-3 rounded-lg flex justify-between items-center">
                            <div>
                                <p className="font-bold text-lg">{coupon.code}</p>
                                <p className="text-sm text-blue-200">
                                    {coupon.discount_type === 'fixed' ? `$${coupon.discount_value}` : `${coupon.discount_value}%`} off
                                </p>
                            </div>
                            <div className="text-sm text-gray-400">
                                <p>Used: {coupon.usage_count} / {coupon.usage_limit || '∞'}</p>
                                <p>Expires: {coupon.expires_at ? new Date(coupon.expires_at).toLocaleDateString() : 'Never'}</p>
                            </div>
                            <div className="flex items-center gap-2">
                                <Button variant={coupon.is_active ? 'destructive' : 'secondary'} size="sm" onClick={() => handleToggleCouponStatus(coupon)}>
                                    {coupon.is_active ? 'Deactivate' : 'Activate'}
                                </Button>
                                <Button variant="outline" size="sm" onClick={() => { setEditingCoupon(coupon); setIsCouponFormOpen(true); }}>
                                    <Edit className="mr-2 h-4 w-4" /> Edit
                                </Button>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            <Dialog open={isCouponFormOpen} onOpenChange={setIsCouponFormOpen}>
                <CouponForm 
                    services={services} 
                    onSave={handleSaveCoupon} 
                    onCancel={() => setIsCouponFormOpen(false)}
                    coupon={editingCoupon}
                />
            </Dialog>
        </div>
    );
};
