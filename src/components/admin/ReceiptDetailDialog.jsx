import React from 'react';
import { format, parseISO } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Hash, User, Mail, Phone, Home, Clock, DollarSign, ShieldCheck, ShieldOff, AlertTriangle, Info, ShoppingBag, Key } from 'lucide-react';

const DetailRow = ({ icon, label, value, className = '' }) => (
    <div className={`flex items-start py-2 border-b border-white/10 ${className}`}>
        <div className="w-1/3 flex items-center text-blue-200">
            {icon}
            <span className="font-semibold ml-2">{label}</span>
        </div>
        <div className="w-2/3 text-white break-words">{value}</div>
    </div>
);

const equipmentMeta = [
  { id: 'wheelbarrow', label: 'Wheelbarrow' },
  { id: 'handTruck', label: 'Hand Truck' },
  { id: 'gloves', label: 'Working Gloves (Pair)' },
];

export const ReceiptDetailDialog = ({ booking, equipment, isOpen, onOpenChange }) => {
    if (!booking) return null;

    const { customers, plan, drop_off_date, pickup_date, total_price, drop_off_time_slot, pickup_time_slot, addons, notes, return_issues, fees, stripe_payment_info } = booking;
    const paymentInfo = Array.isArray(stripe_payment_info) ? stripe_payment_info[0] : stripe_payment_info;

    const formatTime = (timeString) => {
        if (!timeString) return 'N/A';
        try {
            const date = new Date(`1970-01-01T${timeString}`);
            return format(date, 'h:mm a');
        } catch (e) {
            return 'N/A';
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="bg-gray-900 border-yellow-400 text-white max-w-2xl">
                <DialogHeader>
                    <DialogTitle>Detailed Receipt - Booking #{booking.id}</DialogTitle>
                    <DialogDescription>
                        For {customers.name} on {format(parseISO(booking.created_at), 'PPP')}
                    </DialogDescription>
                </DialogHeader>
                <div className="py-4 space-y-4 max-h-[70vh] overflow-y-auto pr-4">
                    <section>
                        <h4 className="font-bold text-lg text-yellow-400 mb-2">Customer & Booking Information</h4>
                        <DetailRow icon={<Key />} label="Customer ID" value={customers.customer_id_text || 'N/A'} />
                        <DetailRow icon={<User />} label="Customer" value={customers.name} />
                        <DetailRow icon={<Mail />} label="Email" value={customers.email} />
                        <DetailRow icon={<Phone />} label="Phone" value={customers.phone} />
                        <DetailRow icon={<Home />} label="Address" value={`${customers.street}, ${customers.city}, ${customers.state} ${customers.zip}`} />
                        <DetailRow icon={<Hash />} label="Stripe Customer ID" value={paymentInfo?.stripe_customer_id || 'N/A'} />
                        <DetailRow icon={<Hash />} label="Payment Intent ID" value={paymentInfo?.stripe_payment_intent_id || 'N/A'} />
                        <DetailRow icon={<Hash />} label="Stripe Charge ID" value={paymentInfo?.stripe_charge_id || 'N/A'} />
                    </section>

                    <section>
                        <h4 className="font-bold text-lg text-yellow-400 mt-4 mb-2">Rental Details</h4>
                        <DetailRow icon={<Info />} label="Service" value={plan.name} />
                        <DetailRow icon={<Clock />} label={plan.id === 2 ? "Pickup" : "Drop-off"} value={`${format(parseISO(drop_off_date), 'PPP')} at ${formatTime(drop_off_time_slot)}`} />
                        <DetailRow icon={<Clock />} label={plan.id === 2 ? "Return" : "Pickup"} value={`${format(parseISO(pickup_date), 'PPP')} by ${formatTime(pickup_time_slot)}`} />
                        {booking.rented_out_at && <DetailRow icon={<Clock />} label="Actual Rented Out" value={format(parseISO(booking.rented_out_at), 'Pp')} />}
                        {booking.returned_at && <DetailRow icon={<Clock />} label="Actual Returned" value={format(parseISO(booking.returned_at), 'Pp')} />}
                    </section>

                    <section>
                        <h4 className="font-bold text-lg text-yellow-400 mt-4 mb-2">Add-ons & Protection</h4>
                        <DetailRow icon={addons.insurance === 'accept' ? <ShieldCheck className="text-green-400"/> : <ShieldOff className="text-red-400"/>} label="Insurance" value={addons.insurance === 'accept' ? 'Accepted' : 'Declined'} />
                        {plan.id !== 2 && <DetailRow icon={addons.drivewayProtection === 'accept' ? <ShieldCheck className="text-green-400"/> : <ShieldOff className="text-red-400"/>} label="Driveway Protection" value={addons.drivewayProtection === 'accept' ? 'Accepted' : 'Declined'} />}
                        {addons.addressVerificationSkipped && <DetailRow icon={<AlertTriangle className="text-orange-400"/>} label="Address Verification" value="Skipped by customer" />}
                        
                        {addons.equipment && addons.equipment.length > 0 && (
                            <div className="pt-2">
                                <p className="font-semibold text-blue-200 flex items-center"><ShoppingBag className="mr-2 h-5 w-5"/>Equipment</p>
                                <ul className="list-disc list-inside pl-8 text-white">
                                    {addons.equipment.map(item => {
                                        const meta = equipmentMeta.find(e => e.id === item.id);
                                        return <li key={item.id}>{meta?.label || item.id} (x{item.quantity})</li>
                                    })}
                                </ul>
                            </div>
                        )}
                    </section>

                    {notes && (
                        <section>
                            <h4 className="font-bold text-lg text-yellow-400 mt-4 mb-2">Customer Notes</h4>
                            <p className="text-blue-200 italic bg-white/5 p-3 rounded-md">"{notes}"</p>
                        </section>
                    )}

                    {(return_issues || fees) && (
                        <section>
                            <h4 className="font-bold text-lg text-red-400 mt-4 mb-2">Issues & Additional Fees</h4>
                            {return_issues && Object.entries(return_issues).map(([key, value]) => (
                                <DetailRow key={key} icon={<AlertTriangle />} label={`Issue: ${key}`} value={value.status.replace(/_/g, ' ')} className="capitalize" />
                            ))}
                            {fees && Object.entries(fees).map(([key, value]) => (
                                <DetailRow key={key} icon={<DollarSign />} label={`Fee: ${value.description}`} value={`${parseFloat(value.amount).toFixed(2)}`} />
                            ))}
                        </section>
                    )}

                    <div className="border-t-2 border-yellow-400 pt-4 mt-4">
                        <DetailRow icon={<DollarSign />} label="Grand Total Paid" value={`${total_price.toFixed(2)}`} className="text-xl font-bold" />
                    </div>
                </div>
                <DialogFooter>
                    <Button onClick={() => onOpenChange(false)} variant="outline">Close</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};