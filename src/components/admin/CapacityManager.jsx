import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';
import { Loader2, Plus, Edit, Trash2, Save, Package, Link2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const OCCUPANCY_MODELS = ['range', 'dropoff_only', 'dropoff_and_pickup_only', 'same_day'];
const INHERIT_VALUE = '__inherit__';

// ─────────────────────────────────────────────────────────────────────────
// Resources (inventory_items)
// ─────────────────────────────────────────────────────────────────────────

const ResourceForm = ({ resource, open, onSave, onCancel }) => {
    const [name, setName] = useState('');
    const [type, setType] = useState('');
    const [totalQuantity, setTotalQuantity] = useState('1');
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        if (open) {
            setName(resource?.name || '');
            setType(resource?.type || '');
            setTotalQuantity(String(resource?.total_quantity ?? '1'));
        }
    }, [resource, open]);

    const handleSave = async () => {
        if (!name.trim()) {
            toast({ title: 'Validation Error', description: 'Name is required.', variant: 'destructive' });
            return;
        }
        const qty = Number(totalQuantity);
        if (!Number.isFinite(qty) || qty < 0) {
            toast({ title: 'Validation Error', description: 'Total quantity must be a non-negative number.', variant: 'destructive' });
            return;
        }
        setIsSaving(true);
        await onSave({ ...resource, name: name.trim(), type: type.trim() || null, total_quantity: qty });
        setIsSaving(false);
    };

    return (
        <DialogContent className="bg-gray-900 border-yellow-400 text-white">
            <DialogHeader>
                <DialogTitle>{resource ? 'Edit Resource' : 'Add Resource'}</DialogTitle>
                <DialogDescription>
                    A physical asset that gets scheduled — a trailer, a dumpster bin, a piece of equipment.
                </DialogDescription>
            </DialogHeader>
            <div className="py-4 space-y-4">
                <div>
                    <Label htmlFor="res-name">Name</Label>
                    <Input id="res-name" value={name} onChange={(e) => setName(e.target.value)} className="bg-white/10" placeholder="e.g. Roll-off Trailer" />
                </div>
                <div>
                    <Label htmlFor="res-type">Type</Label>
                    <Input id="res-type" value={type} onChange={(e) => setType(e.target.value)} className="bg-white/10" placeholder="e.g. trailer, dumpster, excavator" />
                </div>
                <div>
                    <Label htmlFor="res-qty">Total Quantity Owned</Label>
                    <Input id="res-qty" type="number" min="0" value={totalQuantity} onChange={(e) => setTotalQuantity(e.target.value)} className="bg-white/10" />
                    <p className="text-xs text-gray-400 mt-1">How many of this physical asset you own — this is the hard capacity ceiling.</p>
                </div>
            </div>
            <DialogFooter>
                <DialogClose asChild><Button variant="ghost" onClick={onCancel}>Cancel</Button></DialogClose>
                <Button onClick={handleSave} disabled={isSaving}>
                    {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                    Save Resource
                </Button>
            </DialogFooter>
        </DialogContent>
    );
};

// ─────────────────────────────────────────────────────────────────────────
// Per-service requirements (inventory_rules)
// ─────────────────────────────────────────────────────────────────────────

const RequirementForm = ({ requirement, services, resources, open, onSave, onCancel }) => {
    const [serviceId, setServiceId] = useState('');
    const [resourceId, setResourceId] = useState('');
    const [quantityRequired, setQuantityRequired] = useState('1');
    const [occupancyModel, setOccupancyModel] = useState(INHERIT_VALUE);
    const [schedulingGranularity, setSchedulingGranularity] = useState('day');
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        if (open) {
            setServiceId(requirement?.service_id ? String(requirement.service_id) : '');
            setResourceId(requirement?.inventory_item_id ? String(requirement.inventory_item_id) : '');
            setQuantityRequired(String(requirement?.quantity_required ?? '1'));
            setOccupancyModel(requirement?.occupancy_model || INHERIT_VALUE);
            setSchedulingGranularity(requirement?.scheduling_granularity || 'day');
        }
    }, [requirement, open]);

    const selectedService = services.find((s) => String(s.id) === serviceId);

    const handleSave = async () => {
        if (!serviceId || !resourceId) {
            toast({ title: 'Validation Error', description: 'Service and resource are required.', variant: 'destructive' });
            return;
        }
        const qty = Number(quantityRequired);
        if (!Number.isFinite(qty) || qty < 1) {
            toast({ title: 'Validation Error', description: 'Quantity required must be at least 1.', variant: 'destructive' });
            return;
        }
        if (schedulingGranularity === 'slot' && occupancyModel !== 'dropoff_only' && occupancyModel !== 'dropoff_and_pickup_only') {
            toast({
                title: 'Incompatible Combination',
                description: 'Slot granularity only makes sense with a "Drop-off only" or "Drop-off & pickup only" occupancy model — otherwise the resource never gets released mid-rental for it to mean anything.',
                variant: 'destructive',
            });
            return;
        }
        setIsSaving(true);
        await onSave({
            ...requirement,
            service_id: Number(serviceId),
            inventory_item_id: Number(resourceId),
            quantity_required: qty,
            occupancy_model: occupancyModel === INHERIT_VALUE ? null : occupancyModel,
            scheduling_granularity: schedulingGranularity,
        });
        setIsSaving(false);
    };

    return (
        <DialogContent className="bg-gray-900 border-yellow-400 text-white">
            <DialogHeader>
                <DialogTitle>{requirement ? 'Edit Requirement' : 'Add Requirement'}</DialogTitle>
                <DialogDescription>
                    How many units of a resource a service consumes, and how it occupies that resource.
                </DialogDescription>
            </DialogHeader>
            <div className="py-4 space-y-4">
                <div>
                    <Label>Service</Label>
                    <Select value={serviceId} onValueChange={setServiceId} disabled={Boolean(requirement)}>
                        <SelectTrigger className="bg-white/10"><SelectValue placeholder="Select a service" /></SelectTrigger>
                        <SelectContent className="bg-gray-800 border-gray-700 text-white">
                            {services.map((s) => (
                                <SelectItem key={s.id} value={String(s.id)}>{s.name} (#{s.id})</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                <div>
                    <Label>Resource</Label>
                    <Select value={resourceId} onValueChange={setResourceId} disabled={Boolean(requirement)}>
                        <SelectTrigger className="bg-white/10"><SelectValue placeholder="Select a resource" /></SelectTrigger>
                        <SelectContent className="bg-gray-800 border-gray-700 text-white">
                            {resources.map((r) => (
                                <SelectItem key={r.id} value={String(r.id)}>{r.name} (owned: {r.total_quantity})</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                <div>
                    <Label htmlFor="req-qty">Quantity Required</Label>
                    <Input id="req-qty" type="number" min="1" value={quantityRequired} onChange={(e) => setQuantityRequired(e.target.value)} className="bg-white/10" />
                </div>
                <div>
                    <Label>Occupancy Model</Label>
                    <Select value={occupancyModel} onValueChange={setOccupancyModel}>
                        <SelectTrigger className="bg-white/10"><SelectValue /></SelectTrigger>
                        <SelectContent className="bg-gray-800 border-gray-700 text-white">
                            <SelectItem value={INHERIT_VALUE}>
                                Inherit from service{selectedService ? ` (${selectedService.occupancy_model})` : ''}
                            </SelectItem>
                            {OCCUPANCY_MODELS.map((m) => (
                                <SelectItem key={m} value={m}>{m}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <p className="text-xs text-gray-400 mt-1">
                        range = occupied every day of the rental. dropoff_only / dropoff_and_pickup_only = occupied only on the touch-point day(s). same_day = drop-off and pickup are the same day.
                    </p>
                </div>
                <div>
                    <Label>Scheduling Granularity</Label>
                    <Select value={schedulingGranularity} onValueChange={setSchedulingGranularity}>
                        <SelectTrigger className="bg-white/10"><SelectValue /></SelectTrigger>
                        <SelectContent className="bg-gray-800 border-gray-700 text-white">
                            <SelectItem value="day">Day — blocks the whole day, like a rental sitting on-site</SelectItem>
                            <SelectItem value="slot">Slot — blocks only the generated time window, like a short delivery run</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
            </div>
            <DialogFooter>
                <DialogClose asChild><Button variant="ghost" onClick={onCancel}>Cancel</Button></DialogClose>
                <Button onClick={handleSave} disabled={isSaving}>
                    {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                    Save Requirement
                </Button>
            </DialogFooter>
        </DialogContent>
    );
};

// ─────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────

export const CapacityManager = () => {
    const [resources, setResources] = useState([]);
    const [requirements, setRequirements] = useState([]);
    const [services, setServices] = useState([]);
    const [loading, setLoading] = useState(true);

    const [isResourceFormOpen, setIsResourceFormOpen] = useState(false);
    const [editingResource, setEditingResource] = useState(null);
    const [isRequirementFormOpen, setIsRequirementFormOpen] = useState(false);
    const [editingRequirement, setEditingRequirement] = useState(null);

    const fetchAll = useCallback(async () => {
        setLoading(true);
        const [resourcesRes, requirementsRes, servicesRes] = await Promise.all([
            supabase.from('inventory_items').select('*').order('id'),
            supabase
                .from('inventory_rules')
                .select('*, services(id, name, occupancy_model), inventory_items(id, name, total_quantity)')
                .order('service_id'),
            supabase.from('services').select('id, name, occupancy_model').order('id'),
        ]);

        if (resourcesRes.error) {
            toast({ title: 'Failed to load resources', description: resourcesRes.error.message, variant: 'destructive' });
        } else {
            setResources(resourcesRes.data || []);
        }

        if (requirementsRes.error) {
            toast({ title: 'Failed to load requirements', description: requirementsRes.error.message, variant: 'destructive' });
        } else {
            setRequirements(requirementsRes.data || []);
        }

        if (servicesRes.error) {
            toast({ title: 'Failed to load services', description: servicesRes.error.message, variant: 'destructive' });
        } else {
            setServices(servicesRes.data || []);
        }

        setLoading(false);
    }, []);

    useEffect(() => {
        fetchAll();
    }, [fetchAll]);

    // Resources CRUD
    const handleSaveResource = async (data) => {
        const payload = { name: data.name, type: data.type, total_quantity: data.total_quantity };
        const query = data.id
            ? supabase.from('inventory_items').update(payload).eq('id', data.id)
            : supabase.from('inventory_items').insert([payload]);
        const { error } = await query;
        if (error) {
            toast({ title: 'Failed to save resource', description: error.message, variant: 'destructive' });
        } else {
            toast({ title: `Resource ${data.id ? 'updated' : 'created'} successfully!` });
            setIsResourceFormOpen(false);
            setEditingResource(null);
            fetchAll();
        }
    };

    const handleDeleteResource = async (resource) => {
        const inUse = requirements.some((r) => r.inventory_item_id === resource.id);
        if (inUse) {
            toast({
                title: 'Resource In Use',
                description: `${resource.name} is still required by at least one service. Remove those requirements first.`,
                variant: 'destructive',
            });
            return;
        }
        if (!window.confirm(`Delete resource "${resource.name}"? This cannot be undone.`)) return;
        const { error } = await supabase.from('inventory_items').delete().eq('id', resource.id);
        if (error) {
            toast({ title: 'Failed to delete resource', description: error.message, variant: 'destructive' });
        } else {
            toast({ title: 'Resource deleted successfully' });
            fetchAll();
        }
    };

    // Requirements CRUD
    const handleSaveRequirement = async (data) => {
        const payload = {
            service_id: data.service_id,
            inventory_item_id: data.inventory_item_id,
            quantity_required: data.quantity_required,
            occupancy_model: data.occupancy_model,
            scheduling_granularity: data.scheduling_granularity,
        };
        const query = data.id
            ? supabase.from('inventory_rules').update(payload).eq('id', data.id)
            : supabase.from('inventory_rules').insert([payload]);
        const { error } = await query;
        if (error) {
            const description = error.code === '23505'
                ? 'This service already has a requirement for that resource. Edit the existing one instead.'
                : error.message;
            toast({ title: 'Failed to save requirement', description, variant: 'destructive' });
        } else {
            toast({ title: `Requirement ${data.id ? 'updated' : 'created'} successfully!` });
            setIsRequirementFormOpen(false);
            setEditingRequirement(null);
            fetchAll();
        }
    };

    const handleDeleteRequirement = async (requirement) => {
        if (!window.confirm(`Remove the ${requirement.inventory_items?.name} requirement from ${requirement.services?.name}? Existing reservations for past bookings are untouched, but new bookings will no longer reserve it.`)) return;
        const { error } = await supabase.from('inventory_rules').delete().eq('id', requirement.id);
        if (error) {
            toast({ title: 'Failed to delete requirement', description: error.message, variant: 'destructive' });
        } else {
            toast({ title: 'Requirement deleted successfully' });
            fetchAll();
        }
    };

    if (loading) {
        return <div className="flex justify-center items-center h-64"><Loader2 className="h-16 w-16 animate-spin text-yellow-400" /></div>;
    }

    return (
        <div className="space-y-8">
            <div className="bg-white/10 p-6 rounded-2xl">
                <div className="flex justify-between items-center mb-4">
                    <div className="flex items-center gap-2">
                        <Package className="h-6 w-6 text-yellow-400" />
                        <h2 className="text-2xl font-bold">Resources</h2>
                    </div>
                    <Button onClick={() => { setEditingResource(null); setIsResourceFormOpen(true); }}>
                        <Plus className="mr-2 h-4 w-4" /> Add Resource
                    </Button>
                </div>
                <p className="text-sm text-blue-200 mb-4">
                    The physical assets that get scheduled — trailers, dumpster bins, equipment. Total quantity is the hard ceiling every booking is checked against.
                </p>
                <Table>
                    <TableHeader>
                        <TableRow className="border-white/10 hover:bg-transparent">
                            <TableHead className="text-gray-300">Name</TableHead>
                            <TableHead className="text-gray-300">Type</TableHead>
                            <TableHead className="text-gray-300">Total Owned</TableHead>
                            <TableHead className="text-gray-300 text-right">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {resources.length === 0 ? (
                            <TableRow><TableCell colSpan={4} className="text-center text-gray-400 py-6">No resources yet.</TableCell></TableRow>
                        ) : resources.map((r) => (
                            <TableRow key={r.id} className="border-white/10">
                                <TableCell className="font-medium text-white">{r.name}</TableCell>
                                <TableCell className="text-gray-300">{r.type || '—'}</TableCell>
                                <TableCell className="text-gray-300">{r.total_quantity}</TableCell>
                                <TableCell className="text-right space-x-2">
                                    <Button variant="outline" size="sm" onClick={() => { setEditingResource(r); setIsResourceFormOpen(true); }}>
                                        <Edit className="h-4 w-4" />
                                    </Button>
                                    <Button variant="destructive" size="sm" onClick={() => handleDeleteResource(r)}>
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>

            <div className="bg-white/10 p-6 rounded-2xl">
                <div className="flex justify-between items-center mb-4">
                    <div className="flex items-center gap-2">
                        <Link2 className="h-6 w-6 text-yellow-400" />
                        <h2 className="text-2xl font-bold">Service Requirements</h2>
                    </div>
                    <Button onClick={() => { setEditingRequirement(null); setIsRequirementFormOpen(true); }} disabled={resources.length === 0}>
                        <Plus className="mr-2 h-4 w-4" /> Add Requirement
                    </Button>
                </div>
                <p className="text-sm text-blue-200 mb-4">
                    Which resources each service consumes, how much, and how it occupies them. This is what both the booking calendar and the write-time capacity guard read — a service with no rows here is <span className="text-orange-300 font-semibold">never capacity-checked</span>.
                </p>
                <Table>
                    <TableHeader>
                        <TableRow className="border-white/10 hover:bg-transparent">
                            <TableHead className="text-gray-300">Service</TableHead>
                            <TableHead className="text-gray-300">Resource</TableHead>
                            <TableHead className="text-gray-300">Qty</TableHead>
                            <TableHead className="text-gray-300">Occupancy</TableHead>
                            <TableHead className="text-gray-300">Granularity</TableHead>
                            <TableHead className="text-gray-300 text-right">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {requirements.length === 0 ? (
                            <TableRow><TableCell colSpan={6} className="text-center text-gray-400 py-6">No requirements yet — every service's availability is unchecked.</TableCell></TableRow>
                        ) : requirements.map((r) => (
                            <TableRow key={r.id} className="border-white/10">
                                <TableCell className="font-medium text-white">{r.services?.name || `#${r.service_id}`}</TableCell>
                                <TableCell className="text-gray-300">{r.inventory_items?.name || `#${r.inventory_item_id}`}</TableCell>
                                <TableCell className="text-gray-300">{r.quantity_required}</TableCell>
                                <TableCell className="text-gray-300">
                                    {r.occupancy_model || <span className="italic text-gray-500">inherit ({r.services?.occupancy_model})</span>}
                                </TableCell>
                                <TableCell className="text-gray-300 capitalize">{r.scheduling_granularity}</TableCell>
                                <TableCell className="text-right space-x-2">
                                    <Button variant="outline" size="sm" onClick={() => { setEditingRequirement(r); setIsRequirementFormOpen(true); }}>
                                        <Edit className="h-4 w-4" />
                                    </Button>
                                    <Button variant="destructive" size="sm" onClick={() => handleDeleteRequirement(r)}>
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>

            <Dialog open={isResourceFormOpen} onOpenChange={setIsResourceFormOpen}>
                <ResourceForm
                    open={isResourceFormOpen}
                    resource={editingResource}
                    onSave={handleSaveResource}
                    onCancel={() => { setIsResourceFormOpen(false); setEditingResource(null); }}
                />
            </Dialog>

            <Dialog open={isRequirementFormOpen} onOpenChange={setIsRequirementFormOpen}>
                <RequirementForm
                    open={isRequirementFormOpen}
                    requirement={editingRequirement}
                    services={services}
                    resources={resources}
                    onSave={handleSaveRequirement}
                    onCancel={() => { setIsRequirementFormOpen(false); setEditingRequirement(null); }}
                />
            </Dialog>
        </div>
    );
};
