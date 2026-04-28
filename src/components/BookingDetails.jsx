
import React, { useState, useEffect } from 'react';
import { format, parseISO, addDays } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Edit, Trash2, Send, Truck, CheckCircle, PlusCircle, Loader2 } from 'lucide-react';
import { DetailItem } from '@/components/admin/DetailItem';
import { StatusBadge } from '@/components/admin/StatusBadge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';

const formatTime = (timeString) => {
    if (!timeString) return 'N/A';
    // Handle delivery service time windows
    if (timeString === '06:00') return '6:00 AM - 8:00 AM';
    if (timeString === '22:00') return '10:00 PM - 11:30 PM';
    
    try {
        const [hour, minute] = timeString.split(':');
        const date = new Date(0);
        date.setUTCHours(parseInt(hour, 10));
        date.setUTCMinutes(parseInt(minute, 10));
        if (isNaN(date.getTime())) return 'Invalid Time';
        return format(date, 'h:mm a');
    } catch (e) {
        return 'Invalid Time';
    }
};

export const BookingDetails = ({ booking, onEdit, onDelete, onSendConfirmation, onStatusUpdate, onRentalExtended }) => {
    const [showExtendModal, setShowExtendModal] = useState(false);
    const [extendDays, setExtendDays] = useState(1);
    const [isExtending, setIsExtending] = useState(false);
    const [disposalFees, setDisposalFees] = useState({
        mattressFee: null,
        tvFee: null,
        applianceFee: null
    });
    const [loadingFees, setLoadingFees] = useState(true);
    
    // Fetch disposal fees from equipment_pricing table
    useEffect(() => {
        const fetchDisposalFees = async () => {
            setLoadingFees(true);
            try {
                const { data, error } = await supabase
                    .from('equipment_pricing')
                    .select('equipment_id, base_price')
                    .in('equipment_id', [4, 5, 6]);

                if (error) {
                    console.error('[BookingDetails] Error fetching disposal fees:', error);
                    // Set fallback values on error
                    setDisposalFees({
                        mattressFee: 25,
                        tvFee: 15,
                        applianceFee: 35
                    });
                } else if (data && data.length > 0) {
                    const fees = {};
                    data.forEach(item => {
                        if (item.equipment_id === 4) fees.mattressFee = Number(item.base_price);
                        if (item.equipment_id === 5) fees.tvFee = Number(item.base_price);
                        if (item.equipment_id === 6) fees.applianceFee = Number(item.base_price);
                    });
                    setDisposalFees(fees);
                }
            } catch (err) {
                console.error('[BookingDetails] Exception fetching disposal fees:', err);
                // Set fallback values on exception
                setDisposalFees({
                    mattressFee: 25,
                    tvFee: 15,
                    applianceFee: 35
                });
            } finally {
                setLoadingFees(false);
            }
        };

        fetchDisposalFees();
    }, []);
    
    const handleExtendRental = async () => {
        setIsExtending(true);
        const extensionFee = 75; // Flat extension fee
        
        const { error: functionError } = await supabase.functions.invoke('extend-rental', {
            body: { 
                customerId: booking.customers.stripe_customer_id, 
                days: extendDays, 
                pricePerDay: extensionFee, // Using the flat fee here for invoicing
                planName: `${booking.plan.name} Extension`
            }
        });
        
        if (functionError) {
            toast({ title: 'Failed to extend rental', description: functionError.message, variant: 'destructive'});
        } else {
            const newPickupDate = addDays(new Date(booking.pickup_date), extendDays);
            const { error: updateError } = await supabase
                .from('bookings')
                .update({ pickup_date: newPickupDate.toISOString().split('T')[0] })
                .eq('id', booking.id);

            if (updateError) {
                 toast({ title: 'Invoice sent, but failed to update booking date', variant: 'destructive'});
            } else {
                toast({ title: 'Rental Extended!', description: `Invoice for extension sent.` });
                onRentalExtended();
            }
        }
        setIsExtending(false);
        setShowExtendModal(false);
    };

    const isDeliveryService = booking.plan.id === 2 && booking.addons?.distanceInfo?.deliveryService;
    
    return (
        <>
        <Dialog open={showExtendModal} onOpenChange={setShowExtendModal}>
            <DialogContent className="bg-gray-900 text-white border-yellow-400">
                <DialogHeader>
                    <DialogTitle>Extend Rental</DialogTitle>
                </DialogHeader>
                <div className="py-4 space-y-4">
                    <p>Select number of additional days. An extension fee of $75 will be invoiced.</p>
                    <div>
                        <Label htmlFor="extend-days">Additional Days</Label>
                        <Input id="extend-days" type="number" min="1" value={extendDays} onChange={(e) => setExtendDays(parseInt(e.target.value))} className="bg-white/10" />
                    </div>
                </div>
                <DialogFooter>
                    <DialogClose asChild><Button variant="ghost">Cancel</Button></DialogClose>
                    <Button onClick={handleExtendRental} disabled={isExtending}>
                        {isExtending ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <PlusCircle className="mr-2 h-4 w-4" />}
                        Extend & Invoice
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    
        <div>
            <div className="flex justify-between items-start">
                <h3 className="text-2xl font-bold text-yellow-400 mb-4">{booking.name}</h3>
                <StatusBadge status={booking.status} />
            </div>
            <div className="space-y-3 text-sm">
                <DetailItem label="Email" value={booking.email} />
                <DetailItem label="Phone" value={booking.phone} />
                <DetailItem label="Address" value={`${booking.street}, ${booking.city}, ${booking.state} ${booking.zip}`} />
                <DetailItem label="Service" value={booking.plan.name} />
                {isDeliveryService && <DetailItem label="Service Type" value="Delivery Service" />}
                <DetailItem label={isDeliveryService ? "Delivery" : "Drop-off"} value={`${format(parseISO(booking.drop_off_date), 'PPP')} at ${formatTime(booking.drop_off_time_slot)}`} />
                <DetailItem label="Pickup" value={`${format(parseISO(booking.pickup_date), 'PPP')} by ${formatTime(booking.pickup_time_slot)}`} />
                <DetailItem label="Total" value={`$${booking.total_price.toFixed(2)}`} />
                {isDeliveryService && booking.addons.distanceInfo.totalFee && <DetailItem label="Delivery Fee" value={`$${booking.addons.distanceInfo.totalFee.toFixed(2)}`} />}
                <DetailItem label="Stripe Payment ID" value={booking.stripe_payment_intent_id || 'N/A'} />
                {booking.delivered_at && <DetailItem label="Delivered On" value={format(parseISO(booking.delivered_at), 'Pp')} />}
                {booking.picked_up_at && <DetailItem label="Picked Up On" value={format(parseISO(booking.picked_up_at), 'Pp')} />}
                
                {/* Prohibited Materials Section with Dynamic Disposal Fees */}
                <div className="pt-2">
                    <p className="font-semibold text-blue-200">Prohibited Materials:</p>
                    <p className="text-white bg-white/5 p-2 rounded-md mt-1">
                        {loadingFees ? (
                            <span className="flex items-center">
                                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                Loading disposal fees...
                            </span>
                        ) : (
                            <>
                                Mattresses and TVs can be taken to the dump, but they require an extra ${disposalFees.mattressFee || 'N/A'} for each mattress and ${disposalFees.tvFee || 'N/A'} for each TV. Appliances require ${disposalFees.applianceFee || 'N/A'} for each appliance. Please refer to our user agreement for a complete list of restricted items.
                            </>
                        )}
                    </p>
                </div>
                
                {booking.notes && <div className="pt-2"><p className="font-semibold text-blue-200">Notes:</p><p className="text-white bg-white/5 p-2 rounded-md mt-1 whitespace-pre-wrap">{booking.notes}</p></div>}
            </div>
            <div className="mt-6 space-y-2">
                <p className="font-semibold text-blue-200">Actions:</p>
                <div className="flex flex-wrap gap-2">
                    <Button onClick={() => onStatusUpdate(booking.id, 'Delivered', 'delivered_at')} disabled={booking.status === 'Delivered' || booking.status === 'Completed'} className="bg-cyan-600 hover:bg-cyan-700"><Truck className="mr-2 h-4 w-4" /> Mark Delivered</Button>
                    <Button onClick={() => onStatusUpdate(booking.id, 'Completed', 'picked_up_at')} disabled={booking.status !== 'Delivered'} className="bg-purple-600 hover:bg-purple-700"><CheckCircle className="mr-2 h-4 w-4" /> Mark Picked Up</Button>
                </div>
                <div className="flex flex-wrap gap-2 pt-2">
                    <Button onClick={() => setShowExtendModal(true)} className="bg-orange-500 hover:bg-orange-600" disabled={!booking.customers?.stripe_customer_id}><PlusCircle className="mr-2 h-4 w-4" /> Extend Rental</Button>
                    <Button onClick={onSendConfirmation} className="bg-green-500 hover:bg-green-600"><Send className="mr-2 h-4 w-4" /> Resend Confirmation</Button>
                    <Button onClick={onEdit} className="bg-blue-500 hover:bg-blue-600"><Edit className="mr-2 h-4 w-4" /> Edit</Button>
                    <Button onClick={onDelete} variant="destructive"><Trash2 className="mr-2 h-4 w-4" /> Delete</Button>
                </div>
            </div>
        </div>
        </>
    );
};
