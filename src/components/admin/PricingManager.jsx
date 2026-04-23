import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';
import { Loader2, Save, Plus, Edit, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from '@/components/ui/checkbox';
import { useDumpFees } from '@/hooks/useDumpFees';
import { useInsurancePricing } from '@/hooks/useInsurancePricing';

const ServicePricingCard = ({ service, onSave }) => {
    const [isSaving, setIsSaving] = useState(false);
    const [price, setPrice] = useState(service.base_price || 0);
    const [unit, setUnit] = useState(service.price_unit || '/day');
    const [deliveryFee, setDeliveryFee] = useState(service.delivery_fee || 0);
    const [mileageRate, setMileageRate] = useState(service.mileage_rate !== undefined && service.mileage_rate !== null ? service.mileage_rate : 0.85);

    const isDeliveryService = service.id === 4 || service.id === 1;

    useEffect(() => {
        setPrice(service.base_price || 0);
        setUnit(service.price_unit || '/day');
        setDeliveryFee(service.delivery_fee || 0);
        setMileageRate(service.mileage_rate !== undefined && service.mileage_rate !== null ? service.mileage_rate : 0.85);
    }, [service]);

    const handleSave = async () => {
        try {
            setIsSaving(true);
            const updatePayload = {
                base_price: parseFloat(price) || 0,
                price_unit: unit || '',
                mileage_rate: parseFloat(mileageRate) || 0,
                delivery_fee: parseFloat(deliveryFee) || 0
            };
            await onSave(service.id, updatePayload);
        } catch (error) {
            console.error("Error preparing save data:", error);
            toast({ title: "Validation Error", description: "Please check your input values.", variant: "destructive" });
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="bg-white/5 p-4 rounded-lg flex flex-col md:flex-row items-center justify-between gap-4 border border-white/10">
            <p className="text-lg font-bold text-white w-full md:w-1/4">{service.name}</p>
            <div className="flex flex-wrap items-center gap-4 flex-1 justify-end">
                <div className="flex items-center gap-2">
                    <Label>Base Price:</Label>
                    <Input 
                        type="number" 
                        step="0.01"
                        value={price} 
                        onChange={(e) => setPrice(e.target.value)}
                        className="w-24 bg-white/10 text-white"
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
                        className="w-24 bg-white/10 text-white"
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
                                className="w-24 bg-white/10 text-white"
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
                                className="w-24 bg-white/10 text-white"
                                placeholder="0.85"
                                disabled={isSaving}
                            />
                            <span className="text-sm text-gray-400">/mile</span>
                        </div>
                    </>
                )}
                <Button onClick={handleSave} size="sm" disabled={isSaving} className="ml-2 min-w-[90px] bg-blue-600 hover:bg-blue-700 text-white">
                    {isSaving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving...</> : <><Save className="mr-2 h-4 w-4" /> Save</>}
                </Button>
            </div>
        </div>
    );
};

const DumpFeeCard = ({ service, dumpFeeData, onSave }) => {
    const [isSaving, setIsSaving] = useState(false);
    const [feePerTon, setFeePerTon] = useState(dumpFeeData?.fee_per_ton || 45.00);
    const [maxTons, setMaxTons] = useState(dumpFeeData?.max_tons || '');

    useEffect(() => {
        if (dumpFeeData) {
            setFeePerTon(dumpFeeData.fee_per_ton);
            setMaxTons(dumpFeeData.max_tons || '');
        }
    }, [dumpFeeData]);

    const handleSave = async () => {
        setIsSaving(true);
        await onSave(service.id, parseFloat(feePerTon), maxTons ? parseFloat(maxTons) : null);
        setIsSaving(false);
    };

    return (
        <div className="bg-white/5 p-4 rounded-lg flex flex-col md:flex-row items-center justify-between gap-4 border border-white/10">
            <p className="text-lg font-bold text-white w-full md:w-1/4">{service.name}</p>
            <div className="flex flex-wrap items-center gap-4 flex-1 justify-end">
                <div className="flex items-center gap-2">
                    <Label className="text-white">Fee Per Ton ($):</Label>
                    <Input 
                        type="number" 
                        step="0.01"
                        value={feePerTon} 
                        onChange={(e) => setFeePerTon(e.target.value)}
                        className="w-24 bg-white/10 text-white"
                        placeholder="45.00"
                        disabled={isSaving}
                    />
                </div>
                <div className="flex items-center gap-2">
                    <Label className="text-white">Max Tons (Optional):</Label>
                     <Input 
                        type="number" 
                        step="0.1"
                        value={maxTons} 
                        onChange={(e) => setMaxTons(e.target.value)}
                        className="w-24 bg-white/10 text-white"
                        placeholder="e.g., 2.5"
                        disabled={isSaving}
                    />
                </div>
                <Button onClick={handleSave} size="sm" disabled={isSaving} className="ml-2 min-w-[90px] bg-green-600 hover:bg-green-700 text-white">
                    {isSaving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving...</> : <><Save className="mr-2 h-4 w-4" /> Save Fee</>}
                </Button>
            </div>
        </div>
    );
};

const InsurancePricingCard = () => {
    const { insurancePrice, loading, updateInsurancePrice } = useInsurancePricing();
    const [priceInput, setPriceInput] = useState('');
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        if (!loading) {
            setPriceInput(insurancePrice.toString());
        }
    }, [insurancePrice, loading]);

    const handleSave = async () => {
        setIsSaving(true);
        await updateInsurancePrice(parseFloat(priceInput));
        setIsSaving(false);
    };

    if (loading) return null;

    return (
        <div className="bg-white/5 p-4 rounded-lg flex flex-col md:flex-row items-center justify-between gap-4 border border-white/10">
            <p className="text-lg font-bold text-white w-full md:w-1/4">Hardware Protection (Insurance)</p>
            <div className="flex flex-wrap items-center gap-4 flex-1 justify-end">
                <div className="flex items-center gap-2">
                    <Label className="text-white">Price ($):</Label>
                    <Input 
                        type="number" 
                        step="0.01"
                        value={priceInput} 
                        onChange={(e) => setPriceInput(e.target.value)}
                        className="w-32 bg-white/10 text-white"
                        placeholder="e.g., 20.00"
                        disabled={isSaving}
                    />
                </div>
                <Button onClick={handleSave} size="sm" disabled={isSaving} className="ml-2 min-w-[90px] bg-purple-600 hover:bg-purple-700 text-white">
                    {isSaving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving...</> : <><Save className="mr-2 h-4 w-4" /> Save Price</>}
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
        setSelectedServices(prev => prev.includes(serviceId) ? prev.filter(id => id !== serviceId) : [...prev, serviceId]);
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
        if (coupon?.id) couponData.id = coupon.id;
        onSave(couponData);
    };

    return (
        <DialogContent className="bg-gray-900 border-yellow-400 text-white">
            <DialogHeader>
                <DialogTitle>{coupon ? 'Edit Coupon' : 'Create New Coupon'}</DialogTitle>
                <DialogDescription>Fill out the form to create or edit a promotional coupon.</DialogDescription>
            </DialogHeader>
            <div className="py-4 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <Label htmlFor="code" className="text-white">Coupon Code</Label>
                        <Input id="code" value={code} onChange={e => setCode(e.target.value.toUpperCase())} className="bg-white/10 text-white border-white/20" />
                    </div>
                    <div>
                        <Label htmlFor="usageLimit" className="text-white">Usage Limit (optional)</Label>
                        <Input id="usageLimit" type="number" value={usageLimit} onChange={e => setUsageLimit(e.target.value)} className="bg-white/10 text-white border-white/20" />
                    </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <Label className="text-white">Discount Type</Label>
                        <Select value={discountType} onValueChange={setDiscountType}>
                            <SelectTrigger className="bg-white/10 text-white border-white/20"><SelectValue /></SelectTrigger>
                            <SelectContent className="bg-gray-800 text-white border-gray-700">
                                <SelectItem value="fixed">Fixed Amount ($)</SelectItem>
                                <SelectItem value="percentage">Percentage (%)</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div>
                        <Label htmlFor="discountValue" className="text-white">Discount Value</Label>
                        <Input id="discountValue" type="number" value={discountValue} onChange={e => setDiscountValue(e.target.value)} className="bg-white/10 text-white border-white/20" />
                    </div>
                </div>
                <div>
                    <Label htmlFor="expiresAt" className="text-white">Expires At (optional)</Label>
                    <Input id="expiresAt" type="date" value={expiresAt} onChange={e => setExpiresAt(e.target.value)} className="bg-white/10 text-white border-white/20 [color-scheme:dark]" />
                </div>
                <div>
                    <Label className="text-white">Applies To</Label>
                    <div className="space-y-2 mt-2 p-3 bg-black/20 rounded-md border border-white/10">
                        <div className="flex items-center space-x-2">
                            <Checkbox id="all-services" checked={applyToAll} onCheckedChange={checked => setApplyToAll(checked)} className="border-white/30 data-[state=checked]:bg-blue-500" />
                            <Label htmlFor="all-services" className="text-white cursor-pointer">All Services</Label>
                        </div>
                        {!applyToAll && (
                            <div className="grid grid-cols-2 gap-2 pt-2 border-t border-white/10">
                                {services.map(service => (
                                    <div key={service.id} className="flex items-center space-x-2">
                                        <Checkbox id={`service-${service.id}`} checked={selectedServices.includes(service.id)} onCheckedChange={() => handleServiceToggle(service.id)} className="border-white/30 data-[state=checked]:bg-blue-500" />
                                        <Label htmlFor={`service-${service.id}`} className="text-white cursor-pointer text-sm">{service.name}</Label>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
            <DialogFooter>
                <DialogClose asChild><Button variant="ghost" onClick={onCancel} className="text-gray-300 hover:text-white hover:bg-white/10">Cancel</Button></DialogClose>
                <Button onClick={handleSubmit} className="bg-blue-600 hover:bg-blue-700 text-white"><Save className="mr-2 h-4 w-4" /> Save Coupon</Button>
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

    const { dumpFees, updateDumpFee } = useDumpFees();

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
            const { error } = await supabase.from('services').update(updateData).eq('id', id);
            if (error) throw error;
            toast({ title: "Service pricing updated successfully" });
            await fetchData();
        } catch (error) {
            console.error("Failed to save service pricing:", error);
            toast({ title: "Failed to save pricing", description: error.message || "An unknown error occurred.", variant: "destructive" });
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
            const { error } = await supabase.from('coupons').update({ is_active: !coupon.is_active }).eq('id', coupon.id);
            if (error) throw error;
            toast({ title: `Coupon ${coupon.is_active ? 'deactivated' : 'activated'}.` });
            fetchData();
        } catch (error) {
            toast({ title: 'Failed to update status', variant: 'destructive', description: error.message });
        }
    };

    if (loading) {
        return <div className="flex justify-center items-center h-64"><Loader2 className="h-16 w-16 animate-spin text-yellow-400" /></div>;
    }

    const dumpFeeServices = services.filter(s => [1, 4].includes(s.id));

    return (
        <div className="space-y-8">
            <div className="bg-white/10 p-6 rounded-2xl border border-white/20">
                <h2 className="text-2xl font-bold mb-4 text-white">Service Pricing</h2>
                <div className="space-y-4">
                    {services.filter(s => [1,2,3,4].includes(s.id)).map(service => (
                        <ServicePricingCard key={service.id} service={service} onSave={handleSaveService} />
                    ))}
                </div>
            </div>

            <div className="bg-white/10 p-6 rounded-2xl border border-white/20">
                <h2 className="text-2xl font-bold mb-4 text-white">Add-ons & Options</h2>
                <div className="space-y-4">
                    <InsurancePricingCard />
                </div>
            </div>

            <div className="bg-white/10 p-6 rounded-2xl border border-white/20">
                <h2 className="text-2xl font-bold mb-4 text-white">Dump Fees Management</h2>
                <p className="text-blue-200 mb-4 text-sm">Update the per-ton dump fees for services that include hauling.</p>
                <div className="space-y-4">
                    {dumpFeeServices.map(service => {
                        const dumpFeeData = dumpFees.find(df => df.service_id === service.id);
                        return (
                            <DumpFeeCard 
                                key={service.id} 
                                service={service} 
                                dumpFeeData={dumpFeeData} 
                                onSave={updateDumpFee} 
                            />
                        );
                    })}
                </div>
            </div>

            <div className="bg-white/10 p-6 rounded-2xl border border-white/20">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-2xl font-bold text-white">Coupons</h2>
                    <Button onClick={() => { setEditingCoupon(null); setIsCouponFormOpen(true); }} className="bg-green-600 hover:bg-green-700 text-white">
                        <Plus className="mr-2 h-4 w-4" /> Create Coupon
                    </Button>
                </div>
                <div className="space-y-2">
                    {coupons.map(coupon => (
                        <div key={coupon.id} className="bg-white/5 p-4 rounded-lg flex justify-between items-center border border-white/10">
                            <div>
                                <p className="font-bold text-xl text-yellow-400">{coupon.code}</p>
                                <p className="text-sm text-blue-200">
                                    {coupon.discount_type === 'fixed' ? `$${coupon.discount_value}` : `${coupon.discount_value}%`} off
                                </p>
                            </div>
                            <div className="text-sm text-gray-300">
                                <p>Used: {coupon.usage_count} / {coupon.usage_limit || '∞'}</p>
                                <p>Expires: {coupon.expires_at ? new Date(coupon.expires_at).toLocaleDateString() : 'Never'}</p>
                            </div>
                            <div className="flex items-center gap-2">
                                <Button variant={coupon.is_active ? 'destructive' : 'secondary'} size="sm" onClick={() => handleToggleCouponStatus(coupon)} className={!coupon.is_active ? 'bg-green-600 hover:bg-green-700 text-white' : ''}>
                                    {coupon.is_active ? 'Deactivate' : 'Activate'}
                                </Button>
                                <Button variant="outline" size="sm" onClick={() => { setEditingCoupon(coupon); setIsCouponFormOpen(true); }} className="border-blue-400 text-blue-400 hover:bg-blue-500 hover:text-white">
                                    <Edit className="mr-2 h-4 w-4" /> Edit
                                </Button>
                            </div>
                        </div>
                    ))}
                    {coupons.length === 0 && <p className="text-gray-400 py-4 text-center">No coupons created yet.</p>}
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