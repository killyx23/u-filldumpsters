import React, { useState, useEffect } from 'react';
    import { motion } from 'framer-motion';
    import { supabase } from '@/lib/customSupabaseClient';
    import { toast } from '@/components/ui/use-toast';
    import { StatusBadge } from '@/components/admin/StatusBadge';
    import { format, parseISO } from 'date-fns';
    import { Clock, Hash, DollarSign, AlertTriangle, CheckCircle, Truck, ArrowUpCircle, Package, Loader2, Trash2, Map, Navigation, UploadCloud, Calendar, ChevronsUpDown } from 'lucide-react';
    import { Button } from '@/components/ui/button';
    import { Checkbox } from '@/components/ui/checkbox';
    import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
    import { Input } from '@/components/ui/input';
    import { Label } from '@/components/ui/label';
    import { SecureDeleteDialog } from '@/components/admin/SecureDeleteDialog';
    import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

    const DetailItem = ({ icon, label, value, className = '' }) => (
        <div className={`flex items-start space-x-3 ${className}`}>
            <div className="flex-shrink-0 h-6 w-6 text-yellow-400">{icon}</div>
            <div>
                <p className="text-sm font-semibold text-blue-200">{label}</p>
                <p className="text-base font-bold text-white break-all">{value || 'N/A'}</p>
            </div>
        </div>
    );

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
        const returnableEquipment = equipment.filter(item => item.equipment?.name === 'Wheelbarrow' || item.equipment?.name === 'Hand Truck');
        
        const [checklist, setChecklist] = useState(() => {
            const initialState = {
                dump_loader_clean: false,
                no_damage: false,
            };
            returnableEquipment.forEach(item => {
                if (item.equipment?.name) {
                    initialState[item.equipment.name] = false;
                }
            });
            return initialState;
        });
        const [damagePhotos, setDamagePhotos] = useState(booking.damage_photos || []);
        const [isUploading, setIsUploading] = useState(false);
        const [showFeeDialog, setShowFeeDialog] = useState(false);
        const [currentFeeType, setCurrentFeeType] = useState(null);
        const [currentItemDetails, setCurrentItemDetails] = useState(null);
        const [isFinalizeDisabled, setIsFinalizeDisabled] = useState(true);
        const fileInputRef = React.useRef(null);

        const isChecklistReady = booking.returned_at || booking.picked_up_at;

        const allChecklistItems = [
            ...returnableEquipment.map(item => ({ id: item.equipment?.name, feeType: 'unreturned_item', details: { name: item.equipment?.name, equipment_id: item.equipment_id } })),
            ...(booking.plan?.id === 2 ? [
                { id: 'dump_loader_clean', feeType: 'cleaning', details: null },
                { id: 'no_damage', feeType: 'damage', details: null }
            ] : [])
        ].filter(item => item.id);

        useEffect(() => {
            const checkFinalizeStatus = () => {
                if (!isChecklistReady) {
                    setIsFinalizeDisabled(true);
                    return;
                }
                const isAllHandled = allChecklistItems.every(item => {
                    const isChecked = checklist[item.id];
                    if (isChecked) return true;

                    const feeKey = `${item.feeType}_${item.details?.name || 'general'}`.replace(/ /g, '_');
                    const feeCharged = booking.fees && Object.keys(booking.fees).includes(feeKey);
                    
                    return feeCharged;
                });
                setIsFinalizeDisabled(!isAllHandled);
            };
            checkFinalizeStatus();
        }, [checklist, booking.fees, allChecklistItems, isChecklistReady]);

        if (!isChecklistReady) return null;

        const handleCheckChange = (id, checked) => {
            setChecklist(prev => ({ ...prev, [id]: checked }));
        };

        const handleFinalize = async () => {
            let finalStatus = 'Completed';
            const returnIssues = {};
            const equipmentToRestock = [];

            returnableEquipment.forEach(item => {
                if (!item.equipment?.name) return;
                const feeKey = `unreturned_item_${item.equipment.name.replace(/ /g, '_')}`;
                const feeCharged = booking.fees && Object.keys(booking.fees).includes(feeKey);

                if (checklist[item.equipment.name]) {
                    equipmentToRestock.push({ equipment_id: item.equipment_id, quantity: 1 });
                } else if (feeCharged) {
                    returnIssues[item.equipment.name] = { status: 'not_returned_fee_charged' };
                    finalStatus = 'flagged';
                } else {
                    returnIssues[item.equipment.name] = { status: 'not_returned' };
                    finalStatus = 'flagged';
                }
            });

            if (equipmentToRestock.length > 0) {
                const { error: rpcError } = await supabase.rpc('increment_equipment_quantities', {
                    items_to_increment: equipmentToRestock
                });

                if (rpcError) {
                    toast({ title: 'Error updating equipment inventory', description: rpcError.message, variant: 'destructive' });
                    return;
                }
            }

            if (booking.plan?.id === 2) { // Dump Loader specific checks
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
            const { data: { user } } = await supabase.auth.getUser();

            const filePath = `${user.id}/damage_reports/${booking.id}-${Date.now()}-${file.name}`;
            const { error: uploadError } = await supabase.storage.from('customer-uploads').upload(filePath, file);

            if (uploadError) {
                toast({ title: "Upload Failed", description: uploadError.message, variant: "destructive" });
            } else {
                const { data: { publicUrl } } = supabase.storage.from('customer-uploads').getPublicUrl(filePath);
                const newPhoto = { url: publicUrl, path: filePath, name: file.name };
                const newDamagePhotos = [...damagePhotos, newPhoto];
                setDamagePhotos(newDamagePhotos);
                await supabase.from('bookings').update({ damage_photos: newDamagePhotos }).eq('id', booking.id);
                toast({ title: "Photo uploaded successfully!" });
            }
            setIsUploading(false);
        };
        
        const handlePhotoDelete = async (photoToDelete) => {
            const { error: storageError } = await supabase.storage.from('customer-uploads').remove([photoToDelete.path]);
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
            const feeKey = `${feeType}_${itemDetails?.name || 'general'}`.replace(/ /g, '_');
            const feeCharged = booking.fees && Object.keys(booking.fees).includes(feeKey);

            return (
                <div className="flex items-center justify-between bg-white/5 p-3 rounded-md">
                    <div className="flex items-center">
                        <Checkbox id={id} checked={isChecked} onCheckedChange={(c) => handleCheckChange(id, c)} />
                        <label htmlFor={id} className="ml-3 text-base">{label}</label>
                    </div>
                    {!isChecked && (
                        feeCharged ? (
                            <div className="flex items-center text-green-400 text-sm">
                                <CheckCircle className="mr-2 h-4 w-4" /> Fee Charged
                            </div>
                        ) : (
                            <Button size="sm" variant="destructive" onClick={() => handleChargeClick(feeType, itemDetails)}>
                                <AlertTriangle className="mr-2 h-4 w-4" /> Charge Fee
                            </Button>
                        )
                    )}
                </div>
            );
        };

        return (
            <div className="mt-6 bg-gray-800/50 p-6 rounded-lg">
                <FeeChargeDialog open={showFeeDialog} onOpenChange={setShowFeeDialog} booking={booking} feeType={currentFeeType} itemDetails={currentItemDetails} onSuccessfulCharge={onUpdate} />
                <h4 className="text-lg font-bold text-yellow-400 mb-4">Post-Rental Checklist</h4>
                <div className="space-y-3">
                    {returnableEquipment.map(item => item.equipment?.name && renderChecklistItem(item.equipment.name, `${item.equipment.name} Returned`, 'unreturned_item', { name: item.equipment.name, equipment_id: item.equipment.id }))}
                    {booking.plan?.id === 2 && (
                        <>
                            {renderChecklistItem('dump_loader_clean', 'Dump Loader Clean', 'cleaning', null)}
                            <div className="flex items-center justify-between bg-white/5 p-3 rounded-md">
                                <div className="flex items-center">
                                    <Checkbox id="no_damage" checked={checklist['no_damage']} onCheckedChange={(c) => handleCheckChange('no_damage', c)} />
                                    <label htmlFor="no_damage" className="ml-3 text-base">No Damage</label>
                                </div>
                                {!checklist['no_damage'] && (
                                    booking.fees && Object.keys(booking.fees).some(k => k.startsWith('damage_')) ? (
                                        <div className="flex items-center text-green-400 text-sm">
                                            <CheckCircle className="mr-2 h-4 w-4" /> Damage Reported & Charged
                                        </div>
                                    ) : (
                                        <Button size="sm" variant="destructive" onClick={() => handleChargeClick('damage', null)}>
                                            <AlertTriangle className="mr-2 h-4 w-4" /> Report Damage & Charge
                                        </Button>
                                    )
                                )}
                            </div>
                        </>
                    )}
                </div>
                {!checklist['no_damage'] && (
                    <div className="mt-4 pl-8">
                        <Button onClick={() => fileInputRef.current?.click()} disabled={isUploading}>
                            <UploadCloud className="mr-2 h-5 w-5" />
                            {isUploading ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Upload Damage Photo'}
                        </Button>
                        <Input ref={fileInputRef} id="damage-photo-upload" type="file" className="hidden" onChange={handlePhotoUpload} disabled={isUploading} accept="image/*" />
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
                    <Button onClick={handleFinalize} disabled={isFinalizeDisabled}>
                        <CheckCircle className="mr-2 h-4 w-4" /> Finalize & Complete
                    </Button>
                </div>
            </div>
        );
    };

    export const ActiveRentals = ({ bookings = [], equipment = [], onUpdate }) => {
        if (bookings.length === 0) {
            return (
                <div className="text-center py-12 bg-white/5 rounded-lg">
                    <CheckCircle className="mx-auto h-12 w-12 text-green-400" />
                    <h3 className="mt-2 text-lg font-medium text-white">No Active Rentals</h3>
                    <p className="mt-1 text-sm text-gray-400">This customer has no rentals currently in progress.</p>
                </div>
            );
        }

        const handleStatusUpdate = async (bookingId, newStatus, timestampField) => {
            let updates = { status: newStatus };
            if (timestampField) {
                updates[timestampField] = new Date().toISOString();
            }
            const { error } = await supabase.from('bookings').update(updates).eq('id', bookingId);
            if (error) {
                toast({ title: `Failed to mark as ${newStatus}`, variant: 'destructive' });
            } else {
                toast({ title: `Booking marked as ${newStatus}!` });
                onUpdate();
            }
        };
        
        const handleManualStatusChange = async (bookingId, newStatus) => {
            let updates = { status: newStatus };
            switch (newStatus) {
                case 'Confirmed':
                    updates = { ...updates, delivered_at: null, picked_up_at: null, rented_out_at: null, returned_at: null };
                    break;
                case 'Delivered':
                    updates = { ...updates, picked_up_at: null, returned_at: null };
                    const booking = bookings.find(b => b.id === bookingId);
                    const timestampField = booking?.plan?.id === 2 ? 'rented_out_at' : 'delivered_at';
                    if (!booking?.[timestampField]) {
                        updates[timestampField] = new Date().toISOString();
                    }
                    break;
                case 'Completed':
                     const bookingToComplete = bookings.find(b => b.id === bookingId);
                     const completionTimestampField = bookingToComplete?.plan?.id === 2 ? 'returned_at' : 'picked_up_at';
                     if(!bookingToComplete?.[completionTimestampField]) {
                        updates[completionTimestampField] = new Date().toISOString();
                     }
                    break;
                default:
                    break;
            }

            const { error } = await supabase.from('bookings').update(updates).eq('id', bookingId);
            if (error) {
                toast({ title: 'Failed to update status', description: error.message, variant: 'destructive' });
            } else {
                toast({ title: 'Booking status updated successfully!' });
                onUpdate();
            }
        };

        return (
            <div className="space-y-8">
                {bookings.map(booking => {
                    if (!booking || !booking.plan) return null;
                    
                    const isChecklistReady = booking.returned_at || booking.picked_up_at;
                    const relevantEquipment = equipment.filter(e => e.booking_id === booking.id);
                    const distanceInfo = booking.addons?.distanceInfo;
                    
                    const paymentInfo = booking.stripe_payment_info && booking.stripe_payment_info.length > 0 ? booking.stripe_payment_info[0] : null;
                    const totalPrice = booking.total_price && typeof booking.total_price === 'number' ? booking.total_price.toFixed(2) : '0.00';

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

                            {distanceInfo && (
                                <div className="mt-4 p-4 bg-red-900/40 border border-red-500 rounded-lg">
                                    <h4 className="font-bold text-red-300 flex items-center"><AlertTriangle className="mr-2 h-5 w-5"/> Extended Delivery Red Flag</h4>
                                    <div className="grid grid-cols-2 gap-x-4 gap-y-2 mt-2 text-sm">
                                        <div className="flex items-center"><Map className="mr-2 h-4 w-4 text-red-400" />Extra Miles: <span className="font-bold ml-1">{distanceInfo.miles?.toFixed(1) || '0.0'} mi</span></div>
                                        <div className="flex items-center"><Clock className="mr-2 h-4 w-4 text-red-400" />Est. Extra Time (one-way): <span className="font-bold ml-1">{distanceInfo.duration || 'N/A'}</span></div>
                                        <div className="col-span-2 flex items-center"><Navigation className="mr-2 h-4 w-4 text-red-400" />This will require extra travel time for both delivery and pickup.</div>
                                    </div>
                                </div>
                            )}

                            <div className="mt-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                <DetailItem icon={<Package />} label="Service" value={booking.plan?.name} />
                                <DetailItem icon={<DollarSign />} label="Total Price" value={`$${totalPrice}`} />
                                <DetailItem icon={<Calendar />} label="Booked On" value={booking.created_at ? format(parseISO(booking.created_at), 'Pp') : 'N/A'} />
                                <DetailItem icon={<Clock />} label={booking.plan?.id === 2 ? 'Pickup Time' : 'Drop-off Time'} value={`${booking.drop_off_date ? format(parseISO(booking.drop_off_date), 'PPP') : 'N/A'} at ${booking.drop_off_time_slot || 'N/A'}`} />
                                <DetailItem icon={<Clock />} label={booking.plan?.id === 2 ? 'Return Time' : 'Pickup Time'} value={`${booking.pickup_date ? format(parseISO(booking.pickup_date), 'PPP') : 'N/A'} at ${booking.pickup_time_slot || 'N/A'}`} />
                                <DetailItem icon={<Hash />} label="Stripe Charge ID" value={paymentInfo?.stripe_charge_id} />
                            </div>

                            <div className="mt-6 border-t border-white/20 pt-6 flex flex-col md:flex-row justify-between items-center gap-4">
                                <div className="space-y-2">
                                    {booking.delivered_at && <DetailItem icon={<CheckCircle className="text-green-400" />} label="Delivered On" value={format(parseISO(booking.delivered_at), 'Pp')} />}
                                    {booking.picked_up_at && <DetailItem icon={<CheckCircle className="text-green-400" />} label="Picked Up On" value={format(parseISO(booking.picked_up_at), 'Pp')} />}
                                    {booking.rented_out_at && <DetailItem icon={<CheckCircle className="text-green-400" />} label="Rented Out On" value={format(parseISO(booking.rented_out_at), 'Pp')} />}
                                    {booking.returned_at && <DetailItem icon={<CheckCircle className="text-green-400" />} label="Returned On" value={format(parseISO(booking.returned_at), 'Pp')} />}
                                </div>
                               
                                <div className="flex flex-wrap items-center gap-2">
                                {booking.plan?.id !== 2 && (
                                    <>
                                        <Button size="sm" onClick={() => handleStatusUpdate(booking.id, 'Delivered', 'delivered_at')} disabled={!!booking.delivered_at}><Truck className="mr-2 h-4 w-4" /> Mark Delivered</Button>
                                        <Button size="sm" onClick={() => handleStatusUpdate(booking.id, 'pending_checklist', 'picked_up_at')} disabled={!booking.delivered_at || !!booking.picked_up_at}><CheckCircle className="mr-2 h-4 w-4" /> Mark Picked Up</Button>
                                    </>
                                )}
                                {booking.plan?.id === 2 && (
                                    <>
                                        <Button size="sm" onClick={() => handleStatusUpdate(booking.id, 'Delivered', 'rented_out_at')} disabled={!!booking.rented_out_at}>Mark as Rented</Button>
                                        <Button size="sm" onClick={() => handleStatusUpdate(booking.id, 'pending_checklist', 'returned_at')} disabled={!booking.rented_out_at || !!booking.returned_at}>Mark as Returned</Button>
                                    </>
                                )}
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <Button variant="outline" size="sm"><ChevronsUpDown className="mr-2 h-4 w-4" />Change Status</Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent className="bg-gray-800 border-gray-700 text-white">
                                        <DropdownMenuItem onClick={() => handleManualStatusChange(booking.id, 'Confirmed')}>Set to Confirmed</DropdownMenuItem>
                                        <DropdownMenuItem onClick={() => handleManualStatusChange(booking.id, 'Delivered')}>Set to Delivered/Rented</DropdownMenuItem>
                                        <DropdownMenuItem onClick={() => handleManualStatusChange(booking.id, 'pending_checklist')}>Set to Pending Checklist</DropdownMenuItem>
                                    </DropdownMenuContent>
                                </DropdownMenu>
                                 <SecureDeleteDialog bookingId={booking.id} onDeleted={onUpdate} />
                            </div>
                            </div>

                            {isChecklistReady && <PostRentalChecklist booking={booking} equipment={relevantEquipment} onUpdate={onUpdate} />}
                        </motion.div>
                    );
                })}
            </div>
        );
    };