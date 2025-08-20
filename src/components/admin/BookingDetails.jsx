import React, { useState } from 'react';
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
    
    const handleExtendRental = async () => {
        setIsExtending(true);
        const dailyRate = booking.plan.id === 1 ? 50 : 150;
        
        const { error: functionError } = await supabase.functions.invoke('extend-rental', {
            body: { 
                customerId: booking.customers.stripe_customer_id, 
                days: extendDays, 
                pricePerDay: dailyRate,
                planName: booking.plan.name
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
                toast({ title: 'Rental Extended!', description: `Invoice for ${extendDays} day(s) sent.` });
                onRentalExtended();
            }
        }
        setIsExtending(false);
        setShowExtendModal(false);
    };
    
    return (
        <>
        <Dialog open={showExtendModal} onOpenChange={setShowExtendModal}>
            <DialogContent className="bg-gray-900 text-white border-yellow-400">
                <DialogHeader>
                    <DialogTitle>Extend Rental</DialogTitle>
                </DialogHeader>
                <div className="py-4 space-y-4">
                    <p>How many additional days would you like to extend this rental for?</p>
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
                <DetailItem label="Drop-off" value={`${format(parseISO(booking.drop_off_date), 'PPP')} at ${formatTime(booking.drop_off_time_slot)}`} />
                <DetailItem label="Pickup" value={`${format(parseISO(booking.pickup_date), 'PPP')} by ${formatTime(booking.pickup_time_slot)}`} />
                <DetailItem label="Total" value={`$${booking.total_price.toFixed(2)}`} />
                <DetailItem label="Stripe Payment ID" value={booking.stripe_payment_intent_id || 'N/A'} />
                {booking.delivered_at && <DetailItem label="Delivered On" value={format(parseISO(booking.delivered_at), 'Pp')} />}
                {booking.picked_up_at && <DetailItem label="Picked Up On" value={format(parseISO(booking.picked_up_at), 'Pp')} />}
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