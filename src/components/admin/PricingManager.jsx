import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';
import { Loader2, Save, Plus, Edit, Trash2, Calculator, Shield, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from '@/components/ui/checkbox';
import { useDumpFees } from '@/hooks/useDumpFees';
import { getTaxRate, invalidateTaxRateCache } from '@/utils/getTaxRate';
import { clearProtectionPlansCache } from '@/utils/protectionPlans';
import { formatCustomerFacingPlanName } from '@/utils/displayPlanName';

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
            <p className="text-lg font-bold text-white w-full md:w-1/4">{formatCustomerFacingPlanName(service.name)}</p>
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
            <p className="text-lg font-bold text-white w-full md:w-1/4">{formatCustomerFacingPlanName(service.name)}</p>
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

const InsuranceItemCard = ({ item, onEdit, onDelete, isPrimaryPlan }) => {
    const typeLabel = item.plan_type === 'driveway_protection' ? 'Driveway Protection' : 'Rental Insurance';
    return (
        <div className={`bg-white/5 p-4 rounded-lg flex flex-col md:flex-row items-center justify-between gap-4 border transition-colors ${
            isPrimaryPlan ? 'border-purple-500/40 bg-purple-900/10' : 'border-purple-500/20 hover:border-purple-500/40'
        }`}>
            <div className="flex items-center gap-3 w-full md:w-1/4">
                <div className={`p-2 rounded-lg ${isPrimaryPlan ? 'bg-purple-500/30' : 'bg-purple-500/20'}`}>
                    <Shield className="h-5 w-5 text-purple-400" />
                </div>
                <div>
                    <p className="text-lg font-bold text-white">{item.name}</p>
                    <div className="flex flex-wrap gap-1 mt-1">
                        <span className="text-xs text-purple-300 bg-purple-900/30 px-2 py-0.5 rounded-full">{typeLabel}</span>
                        {isPrimaryPlan && (
                            <span className="text-xs text-purple-300 bg-purple-900/30 px-2 py-0.5 rounded-full">Primary</span>
                        )}
                    </div>
                </div>
            </div>
            <div className="flex flex-wrap items-center gap-4 flex-1 justify-end">
                <div className="text-sm">
                    <p className="text-gray-400">Base Price</p>
                    <p className="text-white font-semibold">${Number(item.price || 0).toFixed(2)}</p>
                </div>
                {item.serviceIds?.length > 0 && (
                    <div className="text-sm max-w-xs">
                        <p className="text-gray-400">Applicable Services</p>
                        <p className="text-white text-xs">{item.serviceIds.length} service(s)</p>
                    </div>
                )}
                {item.description && (
                    <div className="text-sm max-w-xs">
                        <p className="text-gray-400">Description</p>
                        <p className="text-white text-xs">{item.description}</p>
                    </div>
                )}
                <div className="flex gap-2">
                    <Button
                        onClick={() => onEdit(item)}
                        size="icon"
                        variant="outline"
                        className="border-purple-600 text-purple-400 hover:bg-purple-900/20"
                    >
                        <Edit className="h-4 w-4" />
                    </Button>
                    {!isPrimaryPlan && (
                        <Button
                            onClick={() => onDelete(item.id)}
                            size="icon"
                            variant="outline"
                            className="border-red-600 text-red-400 hover:bg-red-900/20"
                        >
                            <Trash2 className="h-4 w-4" />
                        </Button>
                    )}
                </div>
            </div>
        </div>
    );
};

const InsuranceItemForm = ({
    formData,
    setFormData,
    onSave,
    onCancel,
    isEditing,
    isPrimaryPlan,
    rentableServices = [],
}) => {
    const handleServiceToggle = (serviceId) => {
        const current = formData.selectedServices || [];
        setFormData({
            ...formData,
            selectedServices: current.includes(serviceId)
                ? current.filter((id) => id !== serviceId)
                : [...current, serviceId],
        });
    };

    return (
        <div className={`bg-gradient-to-br from-purple-900/30 to-purple-800/20 p-5 rounded-lg border-2 shadow-xl ${
            isPrimaryPlan ? 'border-purple-500/50' : 'border-purple-500/30'
        }`}>
            {isPrimaryPlan && (
                <div className="mb-3 bg-purple-900/40 border border-purple-500/40 rounded p-2">
                    <p className="text-purple-200 text-sm flex items-center gap-2">
                        <Shield className="h-4 w-4" />
                        <span className="font-semibold">Primary protection plan</span> — shown to customers for applicable services
                    </p>
                </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                    <Label className="text-white mb-2">Plan Name</Label>
                    <Input
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        placeholder="e.g., Premium Insurance"
                        className="bg-gray-800 border-gray-600 text-white"
                        disabled={isPrimaryPlan}
                    />
                </div>
                <div>
                    <Label className="text-white mb-2">Plan Type</Label>
                    <Select
                        value={formData.plan_type}
                        onValueChange={(value) => setFormData({ ...formData, plan_type: value })}
                        disabled={isPrimaryPlan}
                    >
                        <SelectTrigger className="bg-gray-800 border-gray-600 text-white">
                            <SelectValue placeholder="Select type" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="rental_insurance">Rental Insurance</SelectItem>
                            <SelectItem value="driveway_protection">Driveway Protection</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
                <div>
                    <Label className="text-white mb-2">Price ($)</Label>
                    <Input
                        type="number"
                        step="0.01"
                        value={formData.price}
                        onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                        placeholder="25.00"
                        className="bg-gray-800 border-gray-600 text-white"
                    />
                </div>
                <div>
                    <Label className="text-white mb-2">Price Unit</Label>
                    <Input
                        value={formData.price_unit}
                        onChange={(e) => setFormData({ ...formData, price_unit: e.target.value })}
                        placeholder="/rental"
                        className="bg-gray-800 border-gray-600 text-white"
                    />
                </div>
            </div>
            <div className="mt-3">
                <Label className="text-white mb-2">Description</Label>
                <Input
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    placeholder="Protection plan details..."
                    className="bg-gray-800 border-gray-600 text-white"
                />
            </div>
            <div className="mt-4">
                <Label className="text-white mb-2">Applicable Services</Label>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 p-3 bg-black/20 rounded-md border border-white/10">
                    {rentableServices.map((service) => (
                        <div key={service.id} className="flex items-center space-x-2">
                            <Checkbox
                                id={`plan-service-${service.id}`}
                                checked={(formData.selectedServices || []).includes(service.id)}
                                onCheckedChange={() => handleServiceToggle(service.id)}
                                className="border-white/30 data-[state=checked]:bg-purple-500"
                            />
                            <Label htmlFor={`plan-service-${service.id}`} className="text-white cursor-pointer text-sm">
                                {formatCustomerFacingPlanName(service.name)}
                            </Label>
                        </div>
                    ))}
                </div>
            </div>
            <div className="flex gap-2 mt-4">
                <Button onClick={onSave} className="bg-purple-600 hover:bg-purple-700">
                    <Save className="h-4 w-4 mr-2" />
                    {isEditing ? 'Update' : 'Save'}
                </Button>
                <Button onClick={onCancel} variant="outline" className="border-gray-600 text-white hover:bg-gray-700">
                    <X className="h-4 w-4 mr-2" />
                    Cancel
                </Button>
            </div>
        </div>
    );
};

const TaxConfigurationCard = () => {
    const [loading, setLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [taxState, setTaxState] = useState('4.85');
    const [taxCounty, setTaxCounty] = useState('2.0');
    const [taxCity, setTaxCity] = useState('0.6');
    const [effectiveDate, setEffectiveDate] = useState('2026-04-23');
    // Checked = exempt (non-taxable). Unchecked = taxable.
    const [exemptInsurance, setExemptInsurance] = useState(false);
    const [exemptDriveway, setExemptDriveway] = useState(false);
    const [exemptDeliveryFee, setExemptDeliveryFee] = useState(false);
    const [exemptMileage, setExemptMileage] = useState(false);
    const [exemptBaseByService, setExemptBaseByService] = useState({});
    const [exemptEquipment, setExemptEquipment] = useState({});
    const [servicesList, setServicesList] = useState([]);
    const [equipmentList, setEquipmentList] = useState([]);
    const [insurancePlanIds, setInsurancePlanIds] = useState([]);
    const [drivewayPlanIds, setDrivewayPlanIds] = useState([]);

    useEffect(() => {
        loadTaxConfig();
    }, []);

    const loadTaxConfig = async () => {
        try {
            const config = await getTaxRate();
            setTaxState(config.tax_state.toString());
            setTaxCounty(config.tax_county.toString());
            setTaxCity(config.tax_city.toString());
            setEffectiveDate(config.tax_effective_date);

            const [plansRes, servicesRes, equipmentRes, equipmentNamesRes] = await Promise.all([
                supabase
                    .from('protection_plans')
                    .select('id, plan_type, plan_key, name, is_taxable, is_active')
                    .eq('is_active', true),
                supabase
                    .from('services')
                    .select('id, name, is_taxable, delivery_fee_is_taxable, mileage_is_taxable, is_rentable')
                    .order('id'),
                supabase
                    .from('equipment_pricing')
                    .select('equipment_id, is_taxable')
                    .in('equipment_id', [1, 2, 3, 4, 5, 6])
                    .order('equipment_id'),
                supabase
                    .from('equipment')
                    .select('id, name')
                    .in('id', [1, 2, 3, 4, 5, 6]),
            ]);

            if (plansRes.error) throw plansRes.error;
            if (servicesRes.error) throw servicesRes.error;
            if (equipmentRes.error) throw equipmentRes.error;

            const plans = plansRes.data || [];
            const insurancePlans = plans.filter(
                (p) => p.plan_type === 'rental_insurance' || p.plan_key === 'premium_insurance'
            );
            const drivewayPlans = plans.filter((p) => p.plan_type === 'driveway_protection');
            setInsurancePlanIds(insurancePlans.map((p) => p.id));
            setDrivewayPlanIds(drivewayPlans.map((p) => p.id));
            // checked = exempt = !is_taxable
            setExemptInsurance(insurancePlans.some((p) => p.is_taxable === false));
            setExemptDriveway(drivewayPlans.some((p) => p.is_taxable === false));

            const rentable = (servicesRes.data || []).filter(
                (s) => s.is_rentable !== false && Number(s.id) !== 7
            );
            setServicesList(rentable);
            setExemptDeliveryFee(rentable.some((s) => s.delivery_fee_is_taxable === false));
            setExemptMileage(rentable.some((s) => s.mileage_is_taxable === false));
            const baseMap = {};
            rentable.forEach((s) => {
                baseMap[s.id] = s.is_taxable === false;
            });
            setExemptBaseByService(baseMap);

            const nameById = Object.fromEntries(
                (equipmentNamesRes.data || []).map((row) => [row.id, row.name])
            );
            const FALLBACK_NAMES = {
                1: 'Wheelbarrow',
                2: 'Hand Truck',
                3: 'Working Gloves (Pair)',
                4: 'Mattress Disposal',
                5: 'TV Disposal',
                6: 'Appliance Disposal',
            };
            const equipment = (equipmentRes.data || []).map((row) => ({
                ...row,
                name: nameById[row.equipment_id] || FALLBACK_NAMES[row.equipment_id] || `Equipment ${row.equipment_id}`,
            }));
            setEquipmentList(equipment);
            const equipMap = {};
            equipment.forEach((row) => {
                equipMap[row.equipment_id] = row.is_taxable === false;
            });
            setExemptEquipment(equipMap);
        } catch (error) {
            console.error('[TaxConfigurationCard] Error loading tax config:', error);
            toast({
                title: 'Error Loading Tax Configuration',
                description: 'Using default values',
                variant: 'destructive'
            });
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async () => {
        setIsSaving(true);
        try {
            const state = parseFloat(taxState);
            const county = parseFloat(taxCounty);
            const city = parseFloat(taxCity);
            const totalRate = state + county + city;

            const { error } = await supabase
                .from('business_settings')
                .update({
                    tax_state: state,
                    tax_county: county,
                    tax_city: city,
                    tax_rate: totalRate,
                    tax_effective_date: effectiveDate
                })
                .eq('id', 1);

            if (error) throw error;

            // Persist exemptions: checked = non-taxable (is_taxable false)
            if (insurancePlanIds.length > 0) {
                const { error: insErr } = await supabase
                    .from('protection_plans')
                    .update({ is_taxable: !exemptInsurance })
                    .in('id', insurancePlanIds);
                if (insErr) throw insErr;
            }
            if (drivewayPlanIds.length > 0) {
                const { error: drvErr } = await supabase
                    .from('protection_plans')
                    .update({ is_taxable: !exemptDriveway })
                    .in('id', drivewayPlanIds);
                if (drvErr) throw drvErr;
            }

            const serviceIds = servicesList.map((s) => s.id);
            if (serviceIds.length > 0) {
                const { error: feeErr } = await supabase
                    .from('services')
                    .update({
                        delivery_fee_is_taxable: !exemptDeliveryFee,
                        mileage_is_taxable: !exemptMileage,
                    })
                    .in('id', serviceIds);
                if (feeErr) throw feeErr;

                await Promise.all(
                    servicesList.map((s) =>
                        supabase
                            .from('services')
                            .update({ is_taxable: !exemptBaseByService[s.id] })
                            .eq('id', s.id)
                    )
                );
            }

            await Promise.all(
                equipmentList.map((row) =>
                    supabase
                        .from('equipment_pricing')
                        .update({ is_taxable: !exemptEquipment[row.equipment_id] })
                        .eq('equipment_id', row.equipment_id)
                )
            );

            invalidateTaxRateCache();
            clearProtectionPlansCache();

            toast({
                title: 'Tax Configuration Updated',
                description: `New total tax rate: ${totalRate.toFixed(2)}%. Exemptions saved.`
            });
        } catch (error) {
            console.error('[TaxConfigurationCard] Error saving tax config:', error);
            toast({
                title: 'Error Saving Tax Configuration',
                description: error.message,
                variant: 'destructive'
            });
        } finally {
            setIsSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="flex justify-center items-center p-8">
                <Loader2 className="h-8 w-8 animate-spin text-yellow-400" />
            </div>
        );
    }

    const totalRate = (parseFloat(taxState) || 0) + (parseFloat(taxCounty) || 0) + (parseFloat(taxCity) || 0);

    const ExemptionCheckbox = ({ id, checked, onCheckedChange, label, hint }) => (
        <div className="flex items-start space-x-2 py-1.5">
            <Checkbox
                id={id}
                checked={checked}
                onCheckedChange={(v) => onCheckedChange(v === true)}
                className="mt-0.5 border-white/30 data-[state=checked]:bg-amber-500"
                disabled={isSaving}
            />
            <div>
                <Label htmlFor={id} className="text-white cursor-pointer text-sm font-medium">
                    {label}
                </Label>
                {hint ? <p className="text-xs text-gray-400 mt-0.5">{hint}</p> : null}
            </div>
        </div>
    );

    return (
        <div className="bg-white/5 p-6 rounded-lg border border-white/10 space-y-4">
            <div className="flex items-center justify-between mb-4">
                <div>
                    <h3 className="text-xl font-bold text-white flex items-center">
                        <Calculator className="mr-2 h-5 w-5 text-blue-400" />
                        Current Tax Configuration
                    </h3>
                    <p className="text-sm text-gray-400 mt-1">Saratoga Springs, Utah</p>
                </div>
                <div className="text-right">
                    <p className="text-3xl font-bold text-green-400">{totalRate.toFixed(2)}%</p>
                    <p className="text-xs text-gray-400">Total Tax Rate</p>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                    <Label className="text-white">Utah State Tax (%)</Label>
                    <Input
                        type="number"
                        step="0.01"
                        value={taxState}
                        onChange={(e) => setTaxState(e.target.value)}
                        className="bg-white/10 text-white border-white/20"
                        disabled={isSaving}
                    />
                </div>

                <div className="space-y-2">
                    <Label className="text-white">Utah County Tax (%)</Label>
                    <Input
                        type="number"
                        step="0.01"
                        value={taxCounty}
                        onChange={(e) => setTaxCounty(e.target.value)}
                        className="bg-white/10 text-white border-white/20"
                        disabled={isSaving}
                    />
                </div>

                <div className="space-y-2">
                    <Label className="text-white">City/Transit Tax (%)</Label>
                    <Input
                        type="number"
                        step="0.01"
                        value={taxCity}
                        onChange={(e) => setTaxCity(e.target.value)}
                        className="bg-white/10 text-white border-white/20"
                        disabled={isSaving}
                    />
                </div>

                <div className="space-y-2">
                    <Label className="text-white">Effective Date</Label>
                    <Input
                        type="date"
                        value={effectiveDate}
                        onChange={(e) => setEffectiveDate(e.target.value)}
                        className="bg-white/10 text-white border-white/20 [color-scheme:dark]"
                        disabled={isSaving}
                    />
                </div>
            </div>

            <div className="bg-blue-900/20 border border-blue-500/30 rounded-lg p-4">
                <h4 className="text-sm font-semibold text-blue-300 mb-2">Tax Breakdown</h4>
                <div className="space-y-1 text-sm text-blue-100">
                    <div className="flex justify-between">
                        <span>Utah State Tax:</span>
                        <span className="font-mono">{parseFloat(taxState || 0).toFixed(2)}%</span>
                    </div>
                    <div className="flex justify-between">
                        <span>Utah County Tax:</span>
                        <span className="font-mono">{parseFloat(taxCounty || 0).toFixed(2)}%</span>
                    </div>
                    <div className="flex justify-between">
                        <span>City/Transit Tax:</span>
                        <span className="font-mono">{parseFloat(taxCity || 0).toFixed(2)}%</span>
                    </div>
                    <div className="flex justify-between pt-2 border-t border-blue-500/30 font-bold">
                        <span>Total Combined Rate:</span>
                        <span className="font-mono text-green-400">{totalRate.toFixed(2)}%</span>
                    </div>
                </div>
            </div>

            <div className="bg-amber-900/20 border border-amber-500/30 rounded-lg p-4 space-y-3">
                <div>
                    <h4 className="text-sm font-semibold text-amber-300 mb-1">Tax Exemptions</h4>
                    <p className="text-xs text-gray-400">
                        Checked items are non-taxable. Unchecked items are taxed at the rate above on the full subtotal.
                    </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1">
                    <ExemptionCheckbox
                        id="exempt-insurance"
                        checked={exemptInsurance}
                        onCheckedChange={setExemptInsurance}
                        label="Rental Insurance (damage waiver)"
                        hint="Leave unchecked to tax insurance with the rest of the order"
                    />
                    <ExemptionCheckbox
                        id="exempt-driveway"
                        checked={exemptDriveway}
                        onCheckedChange={setExemptDriveway}
                        label="Driveway Protection"
                    />
                    <ExemptionCheckbox
                        id="exempt-delivery-fee"
                        checked={exemptDeliveryFee}
                        onCheckedChange={setExemptDeliveryFee}
                        label="Delivery Fee"
                    />
                    <ExemptionCheckbox
                        id="exempt-mileage"
                        checked={exemptMileage}
                        onCheckedChange={setExemptMileage}
                        label="Trip Mileage"
                    />
                </div>

                {servicesList.length > 0 && (
                    <div className="pt-2 border-t border-amber-500/20">
                        <p className="text-xs font-semibold text-amber-200/90 mb-2">Base Rental by Service</p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
                            {servicesList.map((s) => (
                                <ExemptionCheckbox
                                    key={s.id}
                                    id={`exempt-base-${s.id}`}
                                    checked={Boolean(exemptBaseByService[s.id])}
                                    onCheckedChange={(v) =>
                                        setExemptBaseByService((prev) => ({ ...prev, [s.id]: v }))
                                    }
                                    label={s.name || `Service ${s.id}`}
                                />
                            ))}
                        </div>
                    </div>
                )}

                {equipmentList.length > 0 && (
                    <div className="pt-2 border-t border-amber-500/20">
                        <p className="text-xs font-semibold text-amber-200/90 mb-2">Equipment &amp; Purchase Items</p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
                            {equipmentList.map((row) => (
                                <ExemptionCheckbox
                                    key={row.equipment_id}
                                    id={`exempt-equip-${row.equipment_id}`}
                                    checked={Boolean(exemptEquipment[row.equipment_id])}
                                    onCheckedChange={(v) =>
                                        setExemptEquipment((prev) => ({
                                            ...prev,
                                            [row.equipment_id]: v,
                                        }))
                                    }
                                    label={row.name || `Equipment ${row.equipment_id}`}
                                />
                            ))}
                        </div>
                    </div>
                )}
            </div>

            <Button
                onClick={handleSave}
                disabled={isSaving}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold"
            >
                {isSaving ? (
                    <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Saving Tax Configuration...
                    </>
                ) : (
                    <>
                        <Save className="mr-2 h-4 w-4" />
                        Save Tax Configuration
                    </>
                )}
            </Button>
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
                                        <Label htmlFor={`service-${service.id}`} className="text-white cursor-pointer text-sm">{formatCustomerFacingPlanName(service.name)}</Label>
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
    const [protectionPlans, setProtectionPlans] = useState([]);
    const [coupons, setCoupons] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isCouponFormOpen, setIsCouponFormOpen] = useState(false);
    const [editingCoupon, setEditingCoupon] = useState(null);
    const [addingInsurance, setAddingInsurance] = useState(false);
    const [editingInsurance, setEditingInsurance] = useState(null);
    const [insuranceFormData, setInsuranceFormData] = useState({
        name: '',
        price: '',
        description: '',
        plan_type: 'rental_insurance',
        price_unit: '/rental',
        is_taxable: true,
        selectedServices: [],
    });

    const { dumpFees, updateDumpFee } = useDumpFees({ showErrorToast: true });

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            let servicesRes = await supabase
                .from('services')
                .select('*')
                .order('display_order', { ascending: true })
                .order('id');

            const isDisplayOrderMissing =
                servicesRes.error &&
                (servicesRes.error.code === '42703' ||
                    servicesRes.error.message?.toLowerCase().includes('display_order'));

            if (isDisplayOrderMissing) {
                console.warn(
                    '[PricingManager] services.display_order missing, falling back to id ordering.',
                    servicesRes.error
                );
                servicesRes = await supabase
                    .from('services')
                    .select('*')
                    .order('id');
            }

            const [couponsRes, plansRes] = await Promise.all([
                supabase.from('coupons').select('*').order('created_at', { ascending: false }),
                supabase
                    .from('protection_plans')
                    .select('*, protection_plan_services(service_id)')
                    .order('display_order', { ascending: true }),
            ]);

            if (servicesRes.error) throw servicesRes.error;
            if (couponsRes.error) throw couponsRes.error;
            if (plansRes.error) throw plansRes.error;

            const serviceData = servicesRes.data || [];
            const regularServices = serviceData.filter(
                (s) => s.is_rentable !== false && Number(s.id) !== 7
            );
            
            // Ensure service ID 4 exists
            const hasDeliveryService = regularServices.some(s => s.id === 4);
            if (!hasDeliveryService) {
                const { data: newService, error: newServiceError } = await supabase.from('services').select('*').eq('id', 4).single();
                if (!newServiceError && newService) {
                    regularServices.push(newService);
                    regularServices.sort((a,b) => a.id - b.id);
                }
            }
            
            setServices(regularServices);

            const mappedPlans = (plansRes.data || [])
                .filter((plan) => plan.is_active !== false)
                .map((plan) => ({
                    id: plan.id,
                    plan_key: plan.plan_key,
                    plan_type: plan.plan_type,
                    name: plan.name,
                    price: Number(plan.price || 0),
                    description: plan.description || '',
                    price_unit: plan.price_unit || '/rental',
                    is_taxable: plan.is_taxable !== false,
                    is_primary: plan.is_primary === true,
                    serviceIds: (plan.protection_plan_services || []).map((row) => row.service_id),
                }));

            setProtectionPlans(mappedPlans);
            setCoupons(couponsRes.data || []);
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

    const handleSaveInsurance = async () => {
        try {
            const isPrimaryPlan = ['premium_insurance', 'driveway_protection'].includes(
                editingInsurance?.plan_key
            );

            const payload = {
                name: insuranceFormData.name,
                description: insuranceFormData.description,
                price: parseFloat(insuranceFormData.price),
                price_unit: insuranceFormData.price_unit || '/rental',
                plan_type: insuranceFormData.plan_type || 'rental_insurance',
                updated_at: new Date().toISOString(),
            };
            // is_taxable is managed under Tax Calculations → Tax Exemptions only
            if (!editingInsurance) {
                payload.is_taxable = true;
            }

            let planId = editingInsurance?.id;

            if (editingInsurance) {
                const { error } = await supabase
                    .from('protection_plans')
                    .update(payload)
                    .eq('id', planId);
                if (error) throw error;
            } else {
                const planKey = `custom_${insuranceFormData.plan_type}_${Date.now()}`;
                const { data: inserted, error } = await supabase
                    .from('protection_plans')
                    .insert([{
                        ...payload,
                        plan_key: planKey,
                        is_primary: false,
                        is_active: true,
                        display_order: 50,
                    }])
                    .select('id')
                    .single();
                if (error) throw error;
                planId = inserted.id;
            }

            await supabase
                .from('protection_plan_services')
                .delete()
                .eq('protection_plan_id', planId);

            const selectedServices = insuranceFormData.selectedServices || [];
            if (selectedServices.length > 0) {
                const { error: linkError } = await supabase
                    .from('protection_plan_services')
                    .insert(
                        selectedServices.map((serviceId) => ({
                            protection_plan_id: planId,
                            service_id: serviceId,
                        }))
                    );
                if (linkError) throw linkError;
            }

            clearProtectionPlansCache();
            toast({
                title: isPrimaryPlan ? 'Protection plan updated successfully' : 'Insurance item saved successfully',
            });

            setAddingInsurance(false);
            setEditingInsurance(null);
            setInsuranceFormData({
                name: '',
                price: '',
                description: '',
                plan_type: 'rental_insurance',
                price_unit: '/rental',
                is_taxable: true,
                selectedServices: [],
            });
            fetchData();
        } catch (error) {
            console.error('Error saving protection plan:', error);
            toast({
                title: 'Failed to save protection plan',
                description: error.message,
                variant: 'destructive',
            });
        }
    };

    const handleEditInsurance = (item) => {
        setEditingInsurance(item);
        setInsuranceFormData({
            name: item.name,
            price: item.price || '',
            description: item.description || '',
            plan_type: item.plan_type || 'rental_insurance',
            price_unit: item.price_unit || '/rental',
            is_taxable: item.is_taxable !== false,
            selectedServices: item.serviceIds || [],
        });
        setAddingInsurance(true);
    };

    const handleDeleteInsurance = async (id) => {
        if (!confirm('Are you sure you want to delete this protection plan?')) return;

        try {
            const { error } = await supabase
                .from('protection_plans')
                .update({ is_active: false, updated_at: new Date().toISOString() })
                .eq('id', id);

            if (error) throw error;
            clearProtectionPlansCache();
            toast({ title: 'Protection plan removed successfully' });
            fetchData();
        } catch (error) {
            console.error('Error deleting protection plan:', error);
            toast({
                title: 'Failed to delete protection plan',
                description: error.message,
                variant: 'destructive',
            });
        }
    };

    const handleCancelInsurance = () => {
        setAddingInsurance(false);
        setEditingInsurance(null);
        setInsuranceFormData({
            name: '',
            price: '',
            description: '',
            plan_type: 'rental_insurance',
            price_unit: '/rental',
            is_taxable: true,
            selectedServices: [],
        });
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
    const isPrimaryPlanEditing = ['premium_insurance', 'driveway_protection'].includes(
        editingInsurance?.plan_key
    );
    const rentableServices = services.filter((s) => s.is_rentable !== false && Number(s.id) !== 7);

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
                <div className="flex justify-between items-center mb-4">
                    <div>
                        <h2 className="text-2xl font-bold text-white flex items-center">
                            <Shield className="mr-2 h-6 w-6 text-purple-400" />
                            Insurance & Protection Plans
                        </h2>
                        <p className="text-sm text-gray-400 mt-1">Manage insurance and protection plan pricing</p>
                    </div>
                    <Button 
                        onClick={() => {
                            setEditingInsurance(null);
                            setInsuranceFormData({
                                name: '',
                                price: '',
                                description: '',
                                plan_type: 'rental_insurance',
                                price_unit: '/rental',
                                is_taxable: true,
                                selectedServices: [],
                            });
                            setAddingInsurance(true);
                        }} 
                        className="bg-purple-600 hover:bg-purple-700 text-white"
                        disabled={addingInsurance}
                    >
                        <Plus className="h-4 w-4 mr-2" />
                        Add Protection Plan
                    </Button>
                </div>
                <div className="space-y-4">
                    {addingInsurance && (
                        <InsuranceItemForm
                            formData={insuranceFormData}
                            setFormData={setInsuranceFormData}
                            onSave={handleSaveInsurance}
                            onCancel={handleCancelInsurance}
                            isEditing={!!editingInsurance}
                            isPrimaryPlan={isPrimaryPlanEditing}
                            rentableServices={rentableServices}
                        />
                    )}

                    {protectionPlans.length === 0 && !addingInsurance ? (
                        <div className="text-center py-8 text-gray-400 bg-gray-900/30 rounded-lg border border-gray-700 border-dashed">
                            <Shield className="h-12 w-12 mx-auto mb-3 opacity-50 text-purple-400" />
                            <p>No protection plans yet</p>
                            <p className="text-xs mt-1">Run the latest database migration or add a plan</p>
                        </div>
                    ) : (
                        protectionPlans.map((item) => (
                            <InsuranceItemCard
                                key={item.id}
                                item={item}
                                onEdit={handleEditInsurance}
                                onDelete={handleDeleteInsurance}
                                isPrimaryPlan={['premium_insurance', 'driveway_protection'].includes(item.plan_key)}
                            />
                        ))
                    )}
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
                <h2 className="text-2xl font-bold mb-4 text-white">Tax Calculations</h2>
                <p className="text-blue-200 mb-4 text-sm">Configure sales tax rates for Saratoga Springs, Utah. Changes will apply to all new bookings.</p>
                <TaxConfigurationCard />
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