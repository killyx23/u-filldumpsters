import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/customSupabaseClient';
import { reinstatePinTrackingPatch, expireActiveRentalAccessCodesForOrder } from '@/utils/bookingPinReinstate';
import { toast } from '@/components/ui/use-toast';
import { StatusBadge } from '@/components/admin/StatusBadge';
import { AppointmentCountdown } from '@/components/admin/customer-detail/AppointmentCountdown';
import { format, parseISO } from 'date-fns';
import { Clock, Hash, DollarSign, AlertTriangle, CheckCircle, Truck, Package, Loader2, Trash2, MapPin, UploadCloud, Calendar, ChevronsUpDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SecureDeleteDialog, SecureDamagePhotoDeleteDialog } from '@/components/admin/SecureDeleteDialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { calculateDistanceViaGoogleMaps, getBusinessAddress } from '@/utils/distanceCalculationHelper';
import { convertTo12Hour } from '@/utils/timeFormatConverter';
import { getLatestRescheduleApproval, formatRescheduleStripeLine } from '@/utils/rescheduleApprovalDisplay';
import { resolveOneWayMiles, formatMilesLabel, ensureBookingMileage } from '@/utils/bookingMileage';
import { isCustomerPickupService } from '@/utils/customerPickupService';
import { formatCustomerFacingPlanName } from '@/utils/displayPlanName';
import { resolveCustomerUploadSignedUrl } from '@/utils/verificationImageHelper';

/** Rental add-ons that must be checked back into inventory (not purchases like gloves). */
const RENTAL_EQUIPMENT_IDS = new Set([1, 2]);
const ADDON_ID_LABELS = {
    1: 'Wheelbarrow',
    2: 'Hand Truck',
    wheelbarrow: 'Wheelbarrow',
    handTruck: 'Hand Truck',
};
const DAMAGE_PHOTOS_BUCKET = 'customer-uploads';

const EQUIPMENT_DISPOSITIONS = {
    good: 'good',
    damaged: 'damaged',
    lost_stolen: 'lost_stolen',
};

function feeKeyFor(feeType, itemName = 'general') {
    return `${feeType}_${String(itemName || 'general').replace(/ /g, '_')}`;
}

/**
 * Collect returnable rental add-ons from booking_equipment rows and/or addons.equipment.
 * Gloves (id 3) and disposal SKUs are excluded.
 * `name` matches equipment.table / return_issues keys used in history.
 */
function collectReturnableEquipment(booking, equipmentRows = []) {
    const byEquipmentId = new Map();

    for (const row of equipmentRows || []) {
        const equipmentId = Number(row.equipment_id || row.equipment?.id);
        if (!Number.isFinite(equipmentId) || equipmentId <= 0) continue;
        const isRental =
            RENTAL_EQUIPMENT_IDS.has(equipmentId) ||
            String(row.equipment?.type || '').toLowerCase() === 'rental';
        if (!isRental) continue;

        const dbName = row.equipment?.name || null;
        const displayLabel = ADDON_ID_LABELS[equipmentId] || dbName || `Equipment #${equipmentId}`;
        byEquipmentId.set(equipmentId, {
            key: `eq-${equipmentId}`,
            bookingEquipmentId: row.id || null,
            equipmentId,
            name: dbName || displayLabel,
            displayLabel,
            quantity: Number(row.quantity || 1) || 1,
            returnedAt: row.returned_at || null,
        });
    }

    const addonList = Array.isArray(booking?.addons?.equipment) ? booking.addons.equipment : [];
    for (const item of addonList) {
        const equipmentId = Number(item.dbId || item.equipment_id || item.id);
        if (!Number.isFinite(equipmentId) || equipmentId <= 0) continue;
        if (!RENTAL_EQUIPMENT_IDS.has(equipmentId)) continue;
        if (byEquipmentId.has(equipmentId)) continue;

        const displayLabel =
            ADDON_ID_LABELS[equipmentId] ||
            ADDON_ID_LABELS[item.id] ||
            item.label ||
            item.name ||
            `Equipment #${equipmentId}`;
        byEquipmentId.set(equipmentId, {
            key: `eq-${equipmentId}`,
            bookingEquipmentId: null,
            equipmentId,
            name: displayLabel,
            displayLabel,
            quantity: Number(item.quantity || 1) || 1,
            returnedAt: null,
        });
    }

    return Array.from(byEquipmentId.values());
}

async function resolveDamagePhotoUrl(photo) {
    return resolveCustomerUploadSignedUrl(photo);
}

const DetailItem = ({ icon, label, value, className = '' }) => (
    <div className={`flex items-start space-x-3 ${className}`}>
        <div className="flex-shrink-0 h-6 w-6 text-yellow-400">{icon}</div>
        <div>
            <p className="text-sm font-semibold text-blue-200">{label}</p>
            <p className="text-base font-bold text-white break-all">{value || 'N/A'}</p>
        </div>
    </div>
);

const DistanceWarning = ({ booking, customer }) => {
    const [distance, setDistance] = useState(
        booking.distance_miles || booking.addons?.distanceInfo?.miles || customer?.distance_miles || null
    );
    const [travelTime, setTravelTime] = useState(booking.addons?.distanceInfo?.duration || customer?.travel_time_minutes || null);

    useEffect(() => {
        if (!distance && booking) {
            const address = booking.delivery_address?.formatted_address || `${booking.street}, ${booking.city}, ${booking.state} ${booking.zip}`;
            if(address && address.length > 10) {
                getBusinessAddress().then(origin => {
                    calculateDistanceViaGoogleMaps(origin, address).then(res => {
                        setDistance(res.distance);
                        setTravelTime(res.travelTime);
                    }).catch(e => console.error("Distance calculation error:", e));
                });
            }
        }
    }, [booking, distance]);

    if (!distance || distance <= 30) return null;

    return (
        <div className="mt-4 p-4 bg-red-900/40 border border-red-500 rounded-lg">
            <h4 className="font-bold text-red-300 flex items-center text-sm">
                <AlertTriangle className="mr-2 h-4 w-4"/> Extended Delivery Red Flag
            </h4>
            <div className="flex gap-4 mt-2 text-sm text-red-200">
                <span className="flex items-center"><MapPin className="mr-1 h-4 w-4 text-red-400" /> {Number(distance).toFixed(1)} mi</span>
                <span className="flex items-center"><Clock className="mr-1 h-4 w-4 text-red-400" /> {travelTime} mins</span>
                <span className="flex items-center">Requires extra travel time for delivery & pickup</span>
            </div>
        </div>
    );
};

const FeeChargeDialog = ({ open, onOpenChange, booking, feeType, itemDetails, onSuccessfulCharge }) => {
    const [amount, setAmount] = useState('');
    const [description, setDescription] = useState('');
    const [isCharging, setIsCharging] = useState(false);

    const itemLabel = itemDetails?.displayLabel || itemDetails?.name || '';
    const feeDefaults = {
        unreturned_item: {
            title: 'Charge Replacement (Not Returned)',
            defaultDescription: `Replacement fee for unreturned rental item: ${itemLabel}`,
        },
        cleaning: {
            title: 'Charge Cleaning Fee',
            defaultDescription: 'Standard cleaning fee for dump trailer.',
            defaultAmount: '20.00',
        },
        damage: {
            title: itemLabel ? `Charge Damage: ${itemLabel}` : 'Charge for Damages',
            defaultDescription: itemLabel
                ? `Cost of repairs for damaged rental item: ${itemLabel}`
                : 'Cost of repairs for damages incurred during rental.',
        },
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
                    feeType: feeKeyFor(feeType, itemDetails?.name || 'general'),
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

const DamagePhotoPreviewDialog = ({ open, onOpenChange, photo, signedUrl, loading }) => (
    <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="bg-gray-900 text-white border-cyan-500 max-w-3xl">
            <DialogHeader>
                <DialogTitle>{photo?.name || 'Damage Photo'}</DialogTitle>
                <DialogDescription>In-app preview (signed URL).</DialogDescription>
            </DialogHeader>
            <div className="min-h-[200px] flex items-center justify-center bg-black/40 rounded-md overflow-hidden">
                {loading ? (
                    <Loader2 className="h-8 w-8 animate-spin text-cyan-300" />
                ) : signedUrl ? (
                    <img src={signedUrl} alt={photo?.name || 'Damage photo'} className="max-h-[70vh] max-w-full object-contain" />
                ) : (
                    <p className="text-red-300 text-sm">Could not load photo preview.</p>
                )}
            </div>
            <DialogFooter>
                <Button variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>
);

const PostRentalChecklist = ({ booking, equipment, onUpdate, customer = null }) => {
    const returnableEquipment = React.useMemo(
        () => collectReturnableEquipment(booking, equipment),
        [booking, equipment]
    );

    const [trailerChecks, setTrailerChecks] = useState({ dump_loader_clean: false, no_damage: false });
    const [dispositions, setDispositions] = useState({});
    const [damagePhotos, setDamagePhotos] = useState(booking.damage_photos || []);
    const [isUploading, setIsUploading] = useState(false);
    const [isFinalizing, setIsFinalizing] = useState(false);
    const [showFeeDialog, setShowFeeDialog] = useState(false);
    const [currentFeeType, setCurrentFeeType] = useState(null);
    const [currentItemDetails, setCurrentItemDetails] = useState(null);
    const [previewPhoto, setPreviewPhoto] = useState(null);
    const [previewUrl, setPreviewUrl] = useState(null);
    const [previewLoading, setPreviewLoading] = useState(false);
    const [photoPendingDelete, setPhotoPendingDelete] = useState(null);
    const fileInputRef = React.useRef(null);

    const isChecklistReady = booking.status === 'pending_checklist';
    const isDumpTrailer = booking.plan?.id === 2;
    const fees = booking.fees || {};

    useEffect(() => {
        setDamagePhotos(booking.damage_photos || []);
    }, [booking.damage_photos]);

    useEffect(() => {
        setDispositions((prev) => {
            const next = { ...prev };
            for (const item of returnableEquipment) {
                if (next[item.key]) continue;
                if (item.returnedAt) next[item.key] = EQUIPMENT_DISPOSITIONS.good;
            }
            return next;
        });
    }, [returnableEquipment]);

    const hasFee = (feeType, itemName = 'general') =>
        Object.prototype.hasOwnProperty.call(fees, feeKeyFor(feeType, itemName));

    const hasTrailerDamageFee = () =>
        Object.keys(fees).some((k) => k === 'damage_general' || (k.startsWith('damage_') && !returnableEquipment.some((eq) => feeKeyFor('damage', eq.name) === k)));

    const isEquipmentHandled = (item) => {
        const disposition = dispositions[item.key];
        if (disposition === EQUIPMENT_DISPOSITIONS.good) return true;
        if (disposition === EQUIPMENT_DISPOSITIONS.damaged) return hasFee('damage', item.name);
        if (disposition === EQUIPMENT_DISPOSITIONS.lost_stolen) return hasFee('unreturned_item', item.name);
        return false;
    };

    const isTrailerHandled = () => {
        if (!isDumpTrailer) return true;
        const cleanOk = trailerChecks.dump_loader_clean || hasFee('cleaning', 'general');
        const damageOk = trailerChecks.no_damage || hasTrailerDamageFee() || hasFee('damage', 'general');
        return cleanOk && damageOk;
    };

    const isFinalizeDisabled =
        !isChecklistReady ||
        isFinalizing ||
        !returnableEquipment.every(isEquipmentHandled) ||
        !isTrailerHandled();

    if (!isChecklistReady) return null;

    const setDisposition = (itemKey, value) => {
        setDispositions((prev) => ({ ...prev, [itemKey]: value }));
    };

    const handleChargeClick = (feeType, itemDetails = null) => {
        setCurrentFeeType(feeType);
        setCurrentItemDetails(itemDetails);
        setShowFeeDialog(true);
    };

    const openPhotoPreview = async (photo) => {
        setPreviewPhoto(photo);
        setPreviewUrl(null);
        setPreviewLoading(true);
        try {
            const url = await resolveDamagePhotoUrl(photo);
            setPreviewUrl(url);
            if (!url) {
                toast({ title: 'Preview failed', description: 'Could not create a signed URL for this photo.', variant: 'destructive' });
            }
        } finally {
            setPreviewLoading(false);
        }
    };

    const handleFinalize = async () => {
        setIsFinalizing(true);
        let finalStatus = 'Completed';
        const returnIssues = {};
        const equipmentToRestock = [];
        const returnedAtIds = [];

        for (const item of returnableEquipment) {
            const disposition = dispositions[item.key];
            if (disposition === EQUIPMENT_DISPOSITIONS.good) {
                equipmentToRestock.push({
                    equipment_id: item.equipmentId,
                    quantity: item.quantity || 1,
                });
                if (item.bookingEquipmentId) returnedAtIds.push(item.bookingEquipmentId);
            } else if (disposition === EQUIPMENT_DISPOSITIONS.damaged) {
                returnIssues[item.name] = { status: 'damaged' };
                finalStatus = 'flagged';
            } else if (disposition === EQUIPMENT_DISPOSITIONS.lost_stolen) {
                returnIssues[item.name] = { status: 'lost_stolen' };
                finalStatus = 'flagged';
            }
        }

        if (equipmentToRestock.length > 0) {
            const { error: rpcError } = await supabase.rpc('increment_equipment_quantities', {
                items_to_increment: equipmentToRestock,
            });
            if (rpcError) {
                setIsFinalizing(false);
                return toast({
                    title: 'Error updating equipment inventory',
                    description: rpcError.message,
                    variant: 'destructive',
                });
            }
        }

        if (returnedAtIds.length > 0) {
            const { error: returnedError } = await supabase
                .from('booking_equipment')
                .update({ returned_at: new Date().toISOString() })
                .in('id', returnedAtIds);
            if (returnedError) {
                console.warn('[PostRentalChecklist] returned_at update failed:', returnedError);
            }
        }

        if (isDumpTrailer) {
            if (!trailerChecks.dump_loader_clean) {
                returnIssues.dump_loader_clean = { status: 'not_clean' };
                finalStatus = 'flagged';
            }
            if (!trailerChecks.no_damage) {
                returnIssues.no_damage = { status: 'damaged', photos: damagePhotos };
                finalStatus = 'flagged';
            }
        }

        const { error } = await supabase
            .from('bookings')
            .update({ status: finalStatus, return_issues: returnIssues, damage_photos: damagePhotos })
            .eq('id', booking.id);

        if (error) {
            toast({ title: 'Error finalizing checklist', description: error.message, variant: 'destructive' });
        } else {
            try {
                await ensureBookingMileage(
                    { ...booking, status: finalStatus },
                    { customer, source: 'booking_complete', recalculateIfMissing: true }
                );
            } catch (mileageErr) {
                console.warn('[ActiveRentals] mileage log on finalize failed:', mileageErr);
            }
            toast({ title: 'Checklist finalized and status updated!' });
            onUpdate();
        }
        setIsFinalizing(false);
    };

    const handlePhotoUpload = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setIsUploading(true);
        const {
            data: { user },
        } = await supabase.auth.getUser();
        if (!user?.id) {
            setIsUploading(false);
            return toast({ title: 'Upload Failed', description: 'You must be signed in to upload.', variant: 'destructive' });
        }

        const filePath = `${user.id}/damage_reports/${booking.id}-${Date.now()}-${file.name}`;
        const { error: uploadError } = await supabase.storage.from(DAMAGE_PHOTOS_BUCKET).upload(filePath, file);

        if (uploadError) {
            toast({ title: 'Upload Failed', description: uploadError.message, variant: 'destructive' });
        } else {
            const signed = await resolveDamagePhotoUrl({ path: filePath });
            const newDamagePhotos = [
                ...damagePhotos,
                { path: filePath, name: file.name, ...(signed ? { url: signed } : {}) },
            ];
            setDamagePhotos(newDamagePhotos);
            await supabase.from('bookings').update({ damage_photos: newDamagePhotos }).eq('id', booking.id);
            toast({ title: 'Photo uploaded successfully!' });
        }
        setIsUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const handlePhotoDeleteRequest = (photoToDelete) => {
        setPhotoPendingDelete(photoToDelete);
    };

    const handlePhotoDeleteConfirmed = async (photoToDelete) => {
        if (!photoToDelete) return;
        if (photoToDelete.path) {
            const { error: storageError } = await supabase.storage.from(DAMAGE_PHOTOS_BUCKET).remove([photoToDelete.path]);
            if (storageError) {
                throw new Error(storageError.message || 'Storage deletion failed.');
            }
        }
        const newDamagePhotos = damagePhotos.filter((p) => p.path !== photoToDelete.path);
        setDamagePhotos(newDamagePhotos);
        const { error: updateError } = await supabase
            .from('bookings')
            .update({ damage_photos: newDamagePhotos })
            .eq('id', booking.id);
        if (updateError) {
            throw new Error(updateError.message || 'Failed to update booking photos.');
        }
        setPhotoPendingDelete(null);
    };

    const renderEquipmentRow = (item) => {
        const disposition = dispositions[item.key] || '';
        const damageCharged = hasFee('damage', item.name);
        const replacementCharged = hasFee('unreturned_item', item.name);

        return (
            <div key={item.key} className="bg-white/5 p-3 rounded-md space-y-3">
                <div className="flex items-center justify-between gap-3">
                    <p className="text-base font-semibold text-white">
                        {item.displayLabel}
                        {item.quantity > 1 ? ` (x${item.quantity})` : ''}
                    </p>
                    {disposition === EQUIPMENT_DISPOSITIONS.good && (
                        <span className="text-green-400 text-sm flex items-center">
                            <CheckCircle className="mr-1 h-4 w-4" /> Will restock
                        </span>
                    )}
                </div>
                <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2 sm:gap-4 text-sm">
                    {[
                        { value: EQUIPMENT_DISPOSITIONS.good, label: 'Received, no damage' },
                        { value: EQUIPMENT_DISPOSITIONS.damaged, label: 'Damaged' },
                        { value: EQUIPMENT_DISPOSITIONS.lost_stolen, label: 'Not returned (lost / stolen)' },
                    ].map((option) => (
                        <label key={option.value} className="inline-flex items-center gap-2 cursor-pointer">
                            <input
                                type="radio"
                                name={`disposition-${item.key}`}
                                value={option.value}
                                checked={disposition === option.value}
                                onChange={() => setDisposition(item.key, option.value)}
                                className="h-4 w-4 accent-yellow-400"
                            />
                            <span>{option.label}</span>
                        </label>
                    ))}
                </div>
                {disposition === EQUIPMENT_DISPOSITIONS.damaged && (
                    <div className="flex justify-end">
                        {damageCharged ? (
                            <div className="flex items-center text-green-400 text-sm">
                                <CheckCircle className="mr-2 h-4 w-4" /> Damage fee charged
                            </div>
                        ) : (
                            <Button
                                size="sm"
                                variant="destructive"
                                onClick={() =>
                                    handleChargeClick('damage', {
                                        name: item.name,
                                        displayLabel: item.displayLabel,
                                        equipment_id: item.equipmentId,
                                    })
                                }
                            >
                                <AlertTriangle className="mr-2 h-4 w-4" /> Charge damage
                            </Button>
                        )}
                    </div>
                )}
                {disposition === EQUIPMENT_DISPOSITIONS.lost_stolen && (
                    <div className="flex justify-end">
                        {replacementCharged ? (
                            <div className="flex items-center text-green-400 text-sm">
                                <CheckCircle className="mr-2 h-4 w-4" /> Replacement fee charged
                            </div>
                        ) : (
                            <Button
                                size="sm"
                                variant="destructive"
                                onClick={() =>
                                    handleChargeClick('unreturned_item', {
                                        name: item.name,
                                        displayLabel: item.displayLabel,
                                        equipment_id: item.equipmentId,
                                    })
                                }
                            >
                                <AlertTriangle className="mr-2 h-4 w-4" /> Charge replacement
                            </Button>
                        )}
                    </div>
                )}
            </div>
        );
    };

    const renderTrailerCheck = (id, label, feeType) => {
        const isChecked = !!trailerChecks[id];
        const feeCharged =
            feeType === 'damage' ? hasTrailerDamageFee() || hasFee('damage', 'general') : hasFee(feeType, 'general');

        return (
            <div className="flex items-center justify-between bg-white/5 p-3 rounded-md gap-3">
                <div className="flex items-center">
                    <Checkbox
                        id={id}
                        checked={isChecked}
                        onCheckedChange={(c) => setTrailerChecks((prev) => ({ ...prev, [id]: !!c }))}
                    />
                    <label htmlFor={id} className="ml-3 text-base">
                        {label}
                    </label>
                </div>
                {!isChecked &&
                    (feeCharged ? (
                        <div className="flex items-center text-green-400 text-sm">
                            <CheckCircle className="mr-2 h-4 w-4" /> Fee Charged
                        </div>
                    ) : (
                        <Button size="sm" variant="destructive" onClick={() => handleChargeClick(feeType, null)}>
                            <AlertTriangle className="mr-2 h-4 w-4" /> Charge Fee
                        </Button>
                    ))}
            </div>
        );
    };

    return (
        <div className="mt-6 bg-gray-800/50 p-6 rounded-lg">
            <FeeChargeDialog
                open={showFeeDialog}
                onOpenChange={setShowFeeDialog}
                booking={booking}
                feeType={currentFeeType}
                itemDetails={currentItemDetails}
                onSuccessfulCharge={onUpdate}
            />
            <DamagePhotoPreviewDialog
                open={!!previewPhoto}
                onOpenChange={(open) => {
                    if (!open) {
                        setPreviewPhoto(null);
                        setPreviewUrl(null);
                    }
                }}
                photo={previewPhoto}
                signedUrl={previewUrl}
                loading={previewLoading}
            />
            <SecureDamagePhotoDeleteDialog
                open={!!photoPendingDelete}
                photo={photoPendingDelete}
                onClose={() => setPhotoPendingDelete(null)}
                onConfirmDelete={handlePhotoDeleteConfirmed}
            />
            <h4 className="text-lg font-bold text-yellow-400 mb-4">Post-Rental Checklist</h4>
            <div className="space-y-3">
                {returnableEquipment.length === 0 ? (
                    <p className="text-sm text-blue-200">No rental add-on equipment on this booking.</p>
                ) : (
                    returnableEquipment.map(renderEquipmentRow)
                )}
                {isDumpTrailer && (
                    <>
                        {renderTrailerCheck('dump_loader_clean', 'Dump Trailer Clean', 'cleaning')}
                        {renderTrailerCheck(
                            'no_damage',
                            'No Damage (Sure Track Trailer & Dumpster)',
                            'damage'
                        )}
                    </>
                )}
            </div>
            {isDumpTrailer && !trailerChecks.no_damage && (
                <div className="mt-4 pl-2 sm:pl-8">
                    <Button onClick={() => fileInputRef.current?.click()} disabled={isUploading}>
                        <UploadCloud className="mr-2 h-5 w-5" />
                        {isUploading ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Upload Damage Photo'}
                    </Button>
                    <Input
                        ref={fileInputRef}
                        id="damage-photo-upload"
                        type="file"
                        className="hidden"
                        onChange={handlePhotoUpload}
                        disabled={isUploading}
                        accept="image/*"
                    />
                    <div className="mt-2 space-y-2">
                        {damagePhotos.map((photo, index) => (
                            <div key={photo.path || index} className="text-sm text-green-400 flex items-center justify-between gap-2">
                                <button
                                    type="button"
                                    className="flex items-center underline text-left hover:text-green-300"
                                    onClick={() => openPhotoPreview(photo)}
                                >
                                    <CheckCircle className="h-4 w-4 mr-2 shrink-0" />
                                    {photo.name || `Photo ${index + 1}`}
                                </button>
                                <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-6 w-6 text-red-400 hover:bg-red-500/20"
                                    title="Admin delete this photo (password required)"
                                    onClick={() => handlePhotoDeleteRequest(photo)}
                                >
                                    <Trash2 className="h-4 w-4" />
                                </Button>
                            </div>
                        ))}
                    </div>
                </div>
            )}
            <div className="mt-6 flex justify-end">
                <Button onClick={handleFinalize} disabled={isFinalizeDisabled}>
                    {isFinalizing ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                        <CheckCircle className="mr-2 h-4 w-4" />
                    )}
                    Finalize & Complete
                </Button>
            </div>
        </div>
    );
};

export const ActiveRentals = ({ bookings = [], equipment = [], onUpdate, customer = {} }) => {
    const [pinStatusByOrder, setPinStatusByOrder] = useState({});

    useEffect(() => {
        const pickupIds = (bookings || [])
            .filter((b) => isCustomerPickupService(b.plan, b.addons || {}))
            .map((b) => b.id);
        if (!pickupIds.length) {
            setPinStatusByOrder({});
            return;
        }
        let cancelled = false;
        (async () => {
            const { data } = await supabase
                .from('rental_access_codes')
                .select('order_id, status, lock_confirmed_at, pin_type, access_pin')
                .in('order_id', pickupIds)
                .eq('status', 'active');
            if (cancelled) return;
            const map = {};
            for (const row of data || []) {
                map[row.order_id] = row;
            }
            setPinStatusByOrder(map);
        })();
        return () => { cancelled = true; };
    }, [bookings]);
    if (bookings.length === 0) {
        return (
            <div className="text-center py-12 bg-white/5 rounded-lg">
                <CheckCircle className="mx-auto h-12 w-12 text-green-400" />
                <h3 className="mt-2 text-lg font-medium text-white">No Active Rentals</h3>
                <p className="mt-1 text-sm text-gray-400">This customer has no rentals currently in progress.</p>
            </div>
        );
    }

    const syncMileageAfterStatus = async (bookingId, source = 'booking_complete') => {
        const booking = bookings.find((b) => b.id === bookingId);
        if (!booking) return;
        try {
            await ensureBookingMileage(booking, {
                customer,
                source,
                recalculateIfMissing: true,
            });
        } catch (mileageErr) {
            console.warn('[ActiveRentals] mileage log on status update failed:', mileageErr);
        }
    };

    const STATUS_UPDATE_SELECT =
        'id, status, rented_out_at, delivered_at, returned_at, picked_up_at';

    const handleStatusUpdate = async (bookingId, newStatus, timestampField) => {
        let updates = { status: newStatus };
        if (timestampField) updates[timestampField] = new Date().toISOString();
        const { data, error } = await supabase
            .from('bookings')
            .update(updates)
            .eq('id', bookingId)
            .select(STATUS_UPDATE_SELECT)
            .maybeSingle();
        if (error) {
            toast({
                title: `Failed to mark as ${newStatus}`,
                description: error.message,
                variant: 'destructive',
            });
            return;
        }
        if (!data) {
            toast({
                title: `Failed to mark as ${newStatus}`,
                description: 'Update was blocked (no row returned). Check admin MFA/session permissions.',
                variant: 'destructive',
            });
            return;
        }
        if (['pending_checklist', 'Completed', 'flagged'].includes(newStatus)) {
            await syncMileageAfterStatus(bookingId, 'booking_complete');
        }
        toast({ title: `Booking marked as ${newStatus}!` });
        onUpdate();
    };
    
    const handleManualStatusChange = async (bookingId, newStatus) => {
        const booking = bookings.find((b) => b.id === bookingId);
        const previousStatus = booking?.status ?? null;

        let updates = { status: newStatus };
        switch (newStatus) {
            case 'Confirmed': updates = { ...updates, delivered_at: null, picked_up_at: null, rented_out_at: null, returned_at: null }; break;
            case 'Delivered':
                 updates = { ...updates, picked_up_at: null, returned_at: null };
                 const bookingForDelivered = bookings.find(b => b.id === bookingId);
                 const timestampField = isCustomerPickupService(bookingForDelivered?.plan, bookingForDelivered?.addons || {}) ? 'rented_out_at' : 'delivered_at';
                 if (!bookingForDelivered?.[timestampField]) updates[timestampField] = new Date().toISOString();
                break;
            case 'pending_checklist':
                 const bookingToComplete = bookings.find(b => b.id === bookingId);
                 const completionTimestampField = isCustomerPickupService(bookingToComplete?.plan, bookingToComplete?.addons || {}) ? 'returned_at' : 'picked_up_at';
                 if(!bookingToComplete?.[completionTimestampField]) updates[completionTimestampField] = new Date().toISOString();
                break;
            default: break;
        }

        if (newStatus === 'Confirmed') {
            Object.assign(updates, reinstatePinTrackingPatch(previousStatus, 'Confirmed'));
        }

        const { data, error } = await supabase
            .from('bookings')
            .update(updates)
            .eq('id', bookingId)
            .select(STATUS_UPDATE_SELECT)
            .maybeSingle();
        if (error) {
            toast({ title: 'Failed to update status', description: error.message, variant: 'destructive' });
            return;
        }
        if (!data) {
            toast({
                title: 'Failed to update status',
                description: 'Update was blocked (no row returned). Check admin MFA/session permissions.',
                variant: 'destructive',
            });
            return;
        }
        if (newStatus === 'Confirmed' && previousStatus === 'pending_review') {
            await expireActiveRentalAccessCodesForOrder(bookingId);
        }
        if (['pending_checklist', 'Completed', 'flagged'].includes(newStatus)) {
            await syncMileageAfterStatus(bookingId, 'booking_complete');
        }
        toast({ title: 'Booking status updated successfully!' });
        onUpdate();
    };

    return (
        <div className="space-y-8">
            {bookings.map(booking => {
                if (!booking || !booking.plan) return null;
                
                const relevantEquipment = equipment.filter(e => e.booking_id === booking.id);
                
                const paymentInfo = Array.isArray(booking.stripe_payment_info) ? booking.stripe_payment_info[0] : booking.stripe_payment_info;
                const stripeChargeId = paymentInfo?.stripe_charge_id || booking.payment_intent || booking.client_secret || 'N/A';
                
                const totalPrice = booking.total_price && typeof booking.total_price === 'number' ? booking.total_price.toFixed(2) : '0.00';
                const loyaltyPointsEarned = Number(booking.addons?.loyaltyPointsEarned || 0);
                const loyaltyPointsReversed = Number(booking.addons?.loyaltyPointsReversedOnCancel || 0);
                const loyaltyPointsRedeemed = Number(booking.addons?.loyaltyPointsToRedeem || 0);
                const referralDollarsPending = Number(booking.addons?.referralDollarsPending || 0);
                const referralDollarsRedeemed = Number(booking.addons?.referralDollarsToRedeem || 0);
                const rescheduleApproval = getLatestRescheduleApproval(booking);
                const dropOffTimeLabel = convertTo12Hour(booking.drop_off_time_slot) || booking.drop_off_time_slot || 'N/A';
                const pickupTimeLabel = convertTo12Hour(booking.pickup_time_slot) || booking.pickup_time_slot || 'N/A';
                const oneWayMiles = resolveOneWayMiles(booking, customer);
                const isPickup = isCustomerPickupService(booking.plan, booking.addons || {});

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
                            <div className="flex flex-col items-end">
                                <StatusBadge status={booking.status} booking={booking} />
                                <AppointmentCountdown booking={booking} />
                            </div>
                        </div>

                        {isPickup && booking.pin_generated_at && pinStatusByOrder[booking.id] && !pinStatusByOrder[booking.id].lock_confirmed_at && (
                            <div className="mt-3 flex items-center gap-2 rounded-lg border border-amber-500/50 bg-amber-950/40 px-3 py-2 text-sm text-amber-200">
                                <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                                <span>
                                    PIN not confirmed on lock
                                    {pinStatusByOrder[booking.id].access_pin
                                        ? ` (${pinStatusByOrder[booking.id].access_pin})`
                                        : ''}
                                    — bridge delivery pending. Watchdog will retry; AlgoPIN fallback in the final hour.
                                </span>
                            </div>
                        )}

                        <DistanceWarning booking={booking} customer={customer} />

                        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                            <DetailItem icon={<Package />} label="Service" value={formatCustomerFacingPlanName(booking.plan?.name)} />
                            <DetailItem icon={<DollarSign />} label="Total Price" value={`$${totalPrice}`} />
                            <DetailItem icon={<Calendar />} label="Booked On" value={booking.created_at ? format(parseISO(booking.created_at), 'Pp') : 'N/A'} />
                            <DetailItem icon={<Clock />} label={isPickup ? 'Pickup Time' : 'Drop-off Time'} value={`${booking.drop_off_date ? format(parseISO(booking.drop_off_date), 'PPP') : 'N/A'} at ${dropOffTimeLabel}`} />
                            <DetailItem icon={<Clock />} label={isPickup ? 'Return Time' : 'Pickup Time'} value={`${booking.pickup_date ? format(parseISO(booking.pickup_date), 'PPP') : 'N/A'} at ${pickupTimeLabel}`} />
                            <DetailItem icon={<MapPin />} label="Distance (one-way)" value={formatMilesLabel(oneWayMiles)} />
                            <DetailItem icon={<Hash />} label="Stripe Charge ID" value={stripeChargeId} />
                        </div>

                        {rescheduleApproval && (
                            <div className="mt-4 bg-emerald-950/40 border border-emerald-500/40 rounded-lg p-4">
                                <p className="text-sm font-semibold text-emerald-300 mb-2">Reschedule Approval</p>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs text-gray-200">
                                    <p>Original total: <span className="font-semibold text-white">${Number(rescheduleApproval.original_total || 0).toFixed(2)}</span></p>
                                    <p>New total: <span className="font-semibold text-white">${Number(rescheduleApproval.new_total || 0).toFixed(2)}</span></p>
                                    <p>Stripe: <span className="font-semibold text-emerald-200">{formatRescheduleStripeLine(rescheduleApproval)}</span></p>
                                    {rescheduleApproval.stripe_transaction_id && (
                                        <p>Stripe ref: <span className="font-semibold text-white break-all">{rescheduleApproval.stripe_transaction_id}</span></p>
                                    )}
                                    {rescheduleApproval.at && (
                                        <p>Approved: <span className="font-semibold text-white">{format(parseISO(rescheduleApproval.at), 'PPp')}</span></p>
                                    )}
                                </div>
                            </div>
                        )}

                        <div className="mt-4 bg-black/20 border border-white/10 rounded-lg p-4">
                            <p className="text-sm font-semibold text-yellow-400 mb-2">Rewards & Referrals for this booking</p>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2 text-xs text-gray-200">
                                {booking.status === 'Cancelled' || loyaltyPointsReversed > 0 ? (
                                    <p>Points reversed (cancelled): <span className="font-semibold text-red-300">-{loyaltyPointsReversed || loyaltyPointsEarned}</span></p>
                                ) : (
                                    <p>Points earned: <span className="font-semibold text-white">{loyaltyPointsEarned}</span></p>
                                )}
                                <p>Points redeemed: <span className="font-semibold text-white">{loyaltyPointsRedeemed}</span></p>
                                <p>Referral pending: <span className="font-semibold text-orange-300">${referralDollarsPending.toFixed(2)}</span></p>
                                <p>Referral redeemed: <span className="font-semibold text-green-300">${referralDollarsRedeemed.toFixed(2)}</span></p>
                            </div>
                        </div>

                        <div className="mt-6 border-t border-white/20 pt-6 flex flex-col md:flex-row justify-between items-center gap-4">
                            <div className="space-y-2">
                                {booking.delivered_at && <DetailItem icon={<CheckCircle className="text-green-400" />} label="Delivered On" value={format(parseISO(booking.delivered_at), 'Pp')} />}
                                {booking.picked_up_at && <DetailItem icon={<CheckCircle className="text-green-400" />} label="Picked Up On" value={format(parseISO(booking.picked_up_at), 'Pp')} />}
                                {booking.rented_out_at && (
                                  <DetailItem
                                    icon={<CheckCircle className="text-green-400" />}
                                    label={booking.rental_started_notified_at ? 'Rented Out On (lock detected)' : 'Rented Out On'}
                                    value={format(parseISO(booking.rented_out_at), 'Pp')}
                                  />
                                )}
                                {booking.returned_at && (
                                  <DetailItem
                                    icon={<CheckCircle className="text-green-400" />}
                                    label={booking.return_notified_at ? 'Returned On (lock detected)' : 'Returned On'}
                                    value={format(parseISO(booking.returned_at), 'Pp')}
                                  />
                                )}
                                {isPickup && !booking.rented_out_at && (
                                  <p className="text-xs text-blue-200/80 italic">Waiting for first unlock via Wi-Fi bridge — or mark rented manually.</p>
                                )}
                                {isPickup && booking.rented_out_at && !booking.returned_at && (
                                  <p className="text-xs text-blue-200/80 italic">Rental in progress. Final lock at/after return time will mark Returned automatically.</p>
                                )}
                            </div>
                           
                            <div className="flex flex-wrap items-center gap-2">
                            {!isPickup && (
                                <>
                                    <Button size="sm" onClick={() => handleStatusUpdate(booking.id, 'Delivered', 'delivered_at')} disabled={!!booking.delivered_at}><Truck className="mr-2 h-4 w-4" /> Mark Delivered</Button>
                                    <Button size="sm" onClick={() => handleStatusUpdate(booking.id, 'pending_checklist', 'picked_up_at')} disabled={!booking.delivered_at || !!booking.picked_up_at}><CheckCircle className="mr-2 h-4 w-4" /> Mark Picked Up</Button>
                                </>
                            )}
                            {isPickup && (
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

                        <PostRentalChecklist booking={booking} equipment={relevantEquipment} onUpdate={onUpdate} customer={customer} />
                    </motion.div>
                );
            })}
        </div>
    );
};