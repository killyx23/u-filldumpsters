import React, { useState } from 'react';
    import { motion } from 'framer-motion';
    import { supabase } from '@/lib/customSupabaseClient';
    import { toast } from '@/components/ui/use-toast';
    import { StatusBadge } from '@/components/admin/StatusBadge';
    import { format, parseISO } from 'date-fns';
    import { Clock, Hash, DollarSign, AlertTriangle, CheckCircle, Truck, ArrowUpCircle, Package, ImagePlus, Loader2, Trash2 } from 'lucide-react';
    import { Button } from '@/components/ui/button';
    import { Checkbox } from '@/components/ui/checkbox';
    import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
    import { Input } from '@/components/ui/input';
    import { Label } from '@/components/ui/label';

    const DetailItem = ({ icon, label, value, className = '' }) => (
        <div className={`flex items-start space-x-3 ${className}`}>
            <div className="flex-shrink-0 h-6 w-6 text-yellow-400">{icon}</div>
            <div>
                <p className="text-sm font-semibold text-blue-200">{label}</p>
                <p className="text-base font-bold text-white break-all">{value}</p>
            </div>
        </div>
    );

    const ActionButtons = ({ booking, onUpdate }) => {
        const isDumpLoader = booking.plan.id === 2;

        const handleUpdate = async (updates) => {
            const { data, error } = await supabase
                .from('bookings')
                .update(updates)
                .eq('id', booking.id)
                .select()
                .single();

            if (error) {
                toast({ title: "Error updating status", description: error.message, variant: "destructive" });
            } else {
                toast({ title: "Status updated successfully!" });
                onUpdate();
            }
        };

        const renderButtons = () => {
            if (isDumpLoader) {
                // "Mark as Picked Up" by customer
                if (booking.status === 'Confirmed' && !booking.rented_out_at) {
                    return <Button onClick={() => handleUpdate({ rented_out_at: new Date().toISOString(), status: 'waiting_to_be_returned' })}><Truck className="mr-2 h-4 w-4" /> Mark as Picked Up</Button>;
                }
                // "Mark as Returned" by customer
                if (booking.status === 'waiting_to_be_returned' && !booking.returned_at) {
                    return <Button onClick={() => handleUpdate({ returned_at: new Date().toISOString() })}><ArrowUpCircle className="mr-2 h-4 w-4" /> Mark as Returned</Button>;
                }
            } else { // 16yd Dumpster
                // "Mark as Delivered" by staff
                if (booking.status === 'Confirmed' && !booking.delivered_at) {
                    return <Button onClick={() => handleUpdate({ delivered_at: new Date().toISOString(), status: 'Delivered' })}><Truck className="mr-2 h-4 w-4" /> Mark as Delivered</Button>;
                }
                // "Mark as Picked Up" by staff
                if (booking.status === 'Delivered' && !booking.picked_up_at) {
                    return <Button onClick={() => handleUpdate({ picked_up_at: new Date().toISOString() })}><ArrowUpCircle className="mr-2 h-4 w-4" /> Mark as Picked Up</Button>;
                }
            }
            return null;
        };

        return <div className="flex gap-2">{renderButtons()}</div>;
    };

    const FeeChargeDialog = ({ open, onOpenChange, booking, feeType, itemDetails, onSuccessfulCharge }) => {
        const [amount, setAmount] = useState('');
        const [description, setDescription] = useState('');
        const [isCharging, setIsCharging] = useState(false);

        const feeDefaults = {
            unreturned_item: { title: "Charge for Unreturned Item", defaultDescription: `Fee for unreturned rental item: ${itemDetails?.name || ''}` },
            cleaning: { title: "Charge Cleaning Fee", defaultDescription: "Standard cleaning fee for dump loader.", defaultAmount: "20.00" },
            damage: { title: "Charge for Damages", defaultDescription: "Cost of repairs for damages incurred during rental." }
        };

        const currentFee = feeDefaults[feeType] || {};

        React.useEffect(() => {
            if (open) {
                setAmount(currentFee.defaultAmount || '');
                setDescription(currentFee.defaultDescription || '');
            }
        }, [open, feeType, currentFee.defaultAmount, currentFee.defaultDescription]);

        const handleCharge = async () => {
            if (!amount || !description) {
                toast({ title: "Missing Information", description: "Please provide both an amount and a description.", variant: "destructive" });
                return;
            }
            setIsCharging(true);
            try {
                const { data, error } = await supabase.functions.invoke('charge-customer', {
                    body: {
                        customerId: booking.customer_id,
                        amount: parseFloat(amount),
                        description,
                        bookingId: booking.id,
                        feeType: `${feeType}_${itemDetails?.name || 'general'}`.replace(/ /g, '_')
                    }
                });

                if (error) throw error;

                toast({ title: "Success", description: data.message });
                onSuccessfulCharge();
                onOpenChange(false);
            } catch (error) {
                toast({ title: "Charging Failed", description: error.message, variant: "destructive" });
            } finally {
                setIsCharging(false);
            }
        };

        return (
            <Dialog open={open} onOpenChange={onOpenChange}>
                <DialogContent className="bg-gray-900 text-white border-yellow-400">
                    <DialogHeader>
                        <DialogTitle>{currentFee.title}</DialogTitle>
                        <DialogDescription>Charge the customer's card on file for additional fees.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div>
                            <Label htmlFor="amount">Amount (USD)</Label>
                            <Input id="amount" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g., 20.00" className="bg-white/20" />
                        </div>
                        <div>
                            <Label htmlFor="description">Description</Label>
                            <Input id="description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Reason for the charge" className="bg-white/20" />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
                        <Button onClick={handleCharge} disabled={isCharging}>
                            {isCharging ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <DollarSign className="mr-2 h-4 w-4" />}
                            Charge Customer
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        );
    };

    const PostRentalChecklist = ({ booking, equipment, onUpdate }) => {
        const [checklist, setChecklist] = useState({
            ...equipment.reduce((acc, item) => ({ ...acc, [item.equipment.name]: true }), {}),
            dump_loader_clean: true,
            no_damage: true,
        });
        const [damagePhotos, setDamagePhotos] = useState(booking.damage_photos || []);
        const [isUploading, setIsUploading] = useState(false);
        const [showFeeDialog, setShowFeeDialog] = useState(false);
        const [currentFeeType, setCurrentFeeType] = useState(null);
        const [currentItemDetails, setCurrentItemDetails] = useState(null);

        const isChecklistReady = booking.returned_at || booking.picked_up_at;
        if (!isChecklistReady) return null;

        const handleCheckChange = (id, checked) => {
            setChecklist(prev => ({ ...prev, [id]: checked }));
        };

        const handleFinalize = async () => {
            let finalStatus = 'Completed';
            const returnIssues = {};

            const equipmentToReturn = [];

            equipment.forEach(item => {
                if (checklist[item.equipment.name] === false) {
                    returnIssues[item.equipment.name] = { status: 'not_returned' };
                    finalStatus = 'flagged';
                } else {
                    equipmentToReturn.push({id: item.id, returned_at: new Date().toISOString()});
                }
            });
            
            if (equipmentToReturn.length > 0) {
                const { error: returnError } = await supabase.from('booking_equipment').upsert(equipmentToReturn);
                if (returnError) {
                    toast({ title: 'Error updating equipment return status', description: returnError.message, variant: 'destructive'});
                    return;
                }
            }


            if (booking.plan.id === 2) { // Dump Loader specific checks
                if (checklist['dump_loader_clean'] === false) {
                    returnIssues['dump_loader_clean'] = { status: 'not_clean' };
                    finalStatus = 'flagged';
                }
                if (checklist['no_damage'] === false) {
                    returnIssues['no_damage'] = { status: 'damaged', photos: damagePhotos };
                    finalStatus = 'flagged';
                }
            }

            const { error } = await supabase
                .from('bookings')
                .update({ status: finalStatus, return_issues: returnIssues, damage_photos: damagePhotos })
                .eq('id', booking.id);
                
            if (error) {
                toast({ title: "Error finalizing checklist", description: error.message, variant: "destructive" });
            } else {
                toast({ title: "Checklist finalized and status updated!" });
                onUpdate();
            }
        };
        
        const handlePhotoUpload = async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            setIsUploading(true);
            const { data: user, error: userError } = await supabase.auth.getUser();
            if (userError || !user) {
                toast({ title: "Authentication Error", description: "Could not identify user for upload.", variant: "destructive" });
                setIsUploading(false);
                return;
            }

            const filePath = `${user.user.id}/${booking.id}-${Date.now()}-${file.name}`;
            const { error: uploadError } = await supabase.storage.from('damage-reports').upload(filePath, file);

            if (uploadError) {
                toast({ title: "Upload Failed", description: uploadError.message, variant: "destructive" });
            } else {
                const { data: { publicUrl } } = supabase.storage.from('damage-reports').getPublicUrl(filePath);
                const newPhoto = { url: publicUrl, path: filePath, name: file.name };
                const newDamagePhotos = [...damagePhotos, newPhoto];
                setDamagePhotos(newDamagePhotos);
                await supabase.from('bookings').update({ damage_photos: newDamagePhotos }).eq('id', booking.id);
                toast({ title: "Photo uploaded successfully!" });
            }
            setIsUploading(false);
        };
        
        const handlePhotoDelete = async (photoToDelete) => {
            const { error: storageError } = await supabase.storage.from('damage-reports').remove([photoToDelete.path]);
            if(storageError) {
                toast({ title: "Deletion Failed", description: storageError.message, variant: "destructive" });
                return;
            }
            const newDamagePhotos = damagePhotos.filter(p => p.path !== photoToDelete.path);
            setDamagePhotos(newDamagePhotos);
            await supabase.from('bookings').update({ damage_photos: newDamagePhotos }).eq('id', booking.id);
            toast({title: "Photo deleted successfully!"});
        };

        const handleChargeClick = (feeType, itemDetails = null) => {
            setCurrentFeeType(feeType);
            setCurrentItemDetails(itemDetails);
            setShowFeeDialog(true);
        };

        const renderChecklistItem = (id, label, feeType, itemDetails) => {
            const isChecked = checklist[id];
            return (
                <div className="flex items-center justify-between bg-white/5 p-3 rounded-md">
                    <div className="flex items-center">
                        <Checkbox id={id} checked={isChecked} onCheckedChange={(c) => handleCheckChange(id, c)} />
                        <label htmlFor={id} className="ml-3 text-base">{label}</label>
                    </div>
                    {!isChecked && (
                        <Button size="sm" variant="destructive" onClick={() => handleChargeClick(feeType, itemDetails)}>
                            <AlertTriangle className="mr-2 h-4 w-4" /> Charge Fee
                        </Button>
                    )}
                </div>
            );
        };

        return (
            <div className="mt-6 bg-gray-800/50 p-6 rounded-lg">
                <FeeChargeDialog open={showFeeDialog} onOpenChange={setShowFeeDialog} booking={booking} feeType={currentFeeType} itemDetails={currentItemDetails} onSuccessfulCharge={onUpdate} />
                <h4 className="text-lg font-bold text-yellow-400 mb-4">Post-Rental Checklist</h4>
                <div className="space-y-3">
                    {equipment.map(item => renderChecklistItem(item.equipment.name, `${item.equipment.name} Returned`, 'unreturned_item', { name: item.equipment.name }))}
                    {booking.plan.id === 2 && (
                        <>
                            {renderChecklistItem('dump_loader_clean', 'Dump Loader Clean', 'cleaning', null)}
                            <div className="flex items-center justify-between bg-white/5 p-3 rounded-md">
                                <div className="flex items-center">
                                    <Checkbox id="no_damage" checked={checklist['no_damage']} onCheckedChange={(c) => handleCheckChange('no_damage', c)} />
                                    <label htmlFor="no_damage" className="ml-3 text-base">No Damage</label>
                                </div>
                                {!checklist['no_damage'] && (
                                    <Button size="sm" variant="destructive" onClick={() => handleChargeClick('damage', null)}>
                                        <AlertTriangle className="mr-2 h-4 w-4" /> Report Damage & Charge
                                    </Button>
                                )}
                            </div>
                        </>
                    )}
                </div>
                {!checklist['no_damage'] && (
                    <div className="mt-4 pl-8">
                        <Label htmlFor="damage-photo-upload" className="flex items-center cursor-pointer text-blue-300 hover:text-yellow-400">
                            <ImagePlus className="mr-2 h-5 w-5" />
                            {isUploading ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Upload Damage Photo'}
                        </Label>
                        <Input id="damage-photo-upload" type="file" className="hidden" onChange={handlePhotoUpload} disabled={isUploading} />
                        <div className="mt-2 space-y-2">
                            {damagePhotos.map((photo, index) => (
                                <div key={index} className="text-sm text-green-400 flex items-center justify-between">
                                    <div className="flex items-center">
                                        <CheckCircle className="h-4 w-4 mr-2" />
                                        <a href={photo.url} target="_blank" rel="noopener noreferrer" className="underline">{photo.name}</a>
                                    </div>
                                    <Button size="icon" variant="ghost" className="h-6 w-6 text-red-400 hover:bg-red-500/20" onClick={() => handlePhotoDelete(photo)}>
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
                <div className="mt-6 flex justify-end">
                    <Button onClick={handleFinalize}>
                        <CheckCircle className="mr-2 h-4 w-4" /> Finalize & Complete
                    </Button>
                </div>
            </div>
        );
    };

    export const ActiveRentals = ({ bookings, equipment, onUpdate }) => {
        if (!bookings || bookings.length === 0) return null;

        return (
            <div className="space-y-8">
                {bookings.map(booking => {
                    const isChecklistReady = booking.returned_at || booking.picked_up_at;
                    const relevantEquipment = equipment.filter(e => e.booking_id === booking.id);

                    return (
                        <motion.div
                            key={booking.id}
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.5 }}
                            className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 shadow-2xl border border-white/20"
                        >
                            <div className="flex justify-between items-start">
                                <div>
                                    <h3 className="text-2xl font-bold text-white">Active Rental Details</h3>
                                    <p className="text-blue-200">Booking ID: {booking.id}</p>
                                </div>
                                <StatusBadge status={booking.status} />
                            </div>

                            <div className="mt-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                <DetailItem icon={<Package />} label="Service" value={booking.plan.name} />
                                <DetailItem icon={<DollarSign />} label="Total Price" value={`$${booking.total_price.toFixed(2)}`} />
                                <DetailItem icon={<Hash />} label="Stripe Payment ID" value={booking.stripe_payment_intent_id || 'N/A'} />
                                <DetailItem icon={<Clock />} label={booking.plan.id === 2 ? 'Pickup Time' : 'Drop-off Time'} value={`${format(parseISO(booking.drop_off_date), 'PPP')} at ${booking.drop_off_time_slot}`} />
                                <DetailItem icon={<Clock />} label={booking.plan.id === 2 ? 'Return Time' : 'Pickup Time'} value={`${format(parseISO(booking.pickup_date), 'PPP')} at ${booking.pickup_time_slot}`} />
                            </div>

                            <div className="mt-6 border-t border-white/20 pt-6 flex flex-col md:flex-row justify-between items-center gap-4">
                                <div className="space-y-2">
                                    {booking.delivered_at && <DetailItem icon={<CheckCircle className="text-green-400" />} label="Delivered On" value={format(parseISO(booking.delivered_at), 'Pp')} />}
                                    {booking.picked_up_at && <DetailItem icon={<CheckCircle className="text-green-400" />} label="Picked Up On" value={format(parseISO(booking.picked_up_at), 'Pp')} />}
                                    {booking.rented_out_at && <DetailItem icon={<CheckCircle className="text-green-400" />} label="Rented Out On" value={format(parseISO(booking.rented_out_at), 'Pp')} />}
                                    {booking.returned_at && <DetailItem icon={<CheckCircle className="text-green-400" />} label="Returned On" value={format(parseISO(booking.returned_at), 'Pp')} />}
                                </div>
                                <ActionButtons booking={booking} onUpdate={onUpdate} />
                            </div>

                            {isChecklistReady && <PostRentalChecklist booking={booking} equipment={relevantEquipment} onUpdate={onUpdate} />}
                        </motion.div>
                    );
                })}
            </div>
        );
    };