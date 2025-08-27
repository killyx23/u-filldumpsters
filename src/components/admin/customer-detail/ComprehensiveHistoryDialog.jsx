import React from 'react';
import { format, parseISO, formatDistanceToNow } from 'date-fns';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from '@/components/ui/button';
import { ScrollArea } from "@/components/ui/scroll-area";
import { Calendar, DollarSign, Hash, ShieldCheck, ShieldOff, AlertTriangle, Package, Car, Image as ImageIcon, User, Clock, FileText, XCircle, CheckCircle, Repeat, Truck, Home, Mail, Phone, ExternalLink } from 'lucide-react';

const Section = ({ title, icon, children, className = '' }) => (
    <div className={`border-t border-white/20 pt-4 mt-4 ${className}`}>
        <h4 className="font-bold text-lg text-yellow-400 mb-3 flex items-center">{icon}{title}</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">{children}</div>
    </div>
);

const DetailItem = ({ label, value, icon, className = '' }) => (
    <div className={`flex items-start space-x-3 ${className}`}>
        <div className="flex-shrink-0 h-5 w-5 text-blue-200 mt-0.5">{icon}</div>
        <div>
            <p className="text-sm font-semibold text-blue-300">{label}</p>
            <div className="text-base text-white break-all">{value}</div>
        </div>
    </div>
);

const NoteCard = ({ note }) => (
    <div className="bg-black/20 p-3 rounded-md">
        <div className="flex justify-between items-center mb-1">
            <p className="font-semibold text-sm text-blue-200 flex items-center">
                <FileText className="mr-2 h-4 w-4" />
                {note.source}
            </p>
            <p className="text-xs text-gray-400">{format(parseISO(note.created_at), 'Pp')}</p>
        </div>
        <p className="text-white text-sm whitespace-pre-wrap">{note.content}</p>
    </div>
);

const equipmentMeta = [
  { id: 'wheelbarrow', label: 'Wheelbarrow' },
  { id: 'handTruck', label: 'Hand Truck' },
  { id: 'gloves', label: 'Working Gloves (Pair)' },
];

export const ComprehensiveHistoryDialog = ({ isOpen, onOpenChange, customer, bookings, equipment, notes }) => {
    if (!customer) return null;

    const totalSpent = bookings.reduce((acc, b) => {
        const bookingTotal = b.total_price || 0;
        const feesTotal = b.fees ? Object.values(b.fees).reduce((feeAcc, fee) => feeAcc + (fee.amount || 0), 0) : 0;
        return acc + bookingTotal + feesTotal;
    }, 0);

    const customerSince = formatDistanceToNow(parseISO(customer.created_at), { addSuffix: true });
    
    const equipmentRentalCount = equipment.reduce((acc, item) => {
        acc[item.equipment.name] = (acc[item.equipment.name] || 0) + item.quantity;
        return acc;
    }, {});


    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="bg-gradient-to-br from-gray-900 via-gray-900 to-black border-yellow-400 text-white max-w-5xl">
                <DialogHeader>
                    <DialogTitle>Comprehensive History: {customer.name}</DialogTitle>
                    <DialogDescription>
                        Customer since {format(parseISO(customer.created_at), 'PPP')} ({customerSince}).
                    </DialogDescription>
                </DialogHeader>
                <ScrollArea className="max-h-[80vh] py-4 pr-6">
                    <div className="space-y-6">
                        {/* Summary Section */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                            <div className="bg-white/10 p-4 rounded-lg"><p className="text-sm text-blue-200">Total Bookings</p><p className="text-2xl font-bold">{bookings.length}</p></div>
                            <div className="bg-white/10 p-4 rounded-lg"><p className="text-sm text-blue-200">Total Spent</p><p className="text-2xl font-bold text-green-400">${totalSpent.toFixed(2)}</p></div>
                            <div className="bg-white/10 p-4 rounded-lg"><p className="text-sm text-blue-200">Red Flags</p><p className="text-2xl font-bold text-red-400">{(customer.unverified_address ? 1 : 0) + (customer.has_incomplete_verification ? 1 : 0)}</p></div>
                            <div className="bg-white/10 p-4 rounded-lg"><p className="text-sm text-blue-200">Repeat Customer</p><p className="text-2xl font-bold">{bookings.length > 1 ? 'Yes' : 'No'}</p></div>
                        </div>

                        <Section title="Customer Details & Status" icon={<User className="mr-2 h-5 w-5"/>}>
                            <DetailItem icon={<User />} label="Name" value={customer.name} />
                             <DetailItem icon={<Mail />} label="Email" value={<a href={`mailto:${customer.email}`} className="hover:underline">{customer.email}</a>} />
                            <DetailItem icon={<Phone />} label="Phone" value={<a href={`tel:${customer.phone}`} className="hover:underline">{customer.phone}</a>} />
                            <DetailItem icon={<Home />} label="Address" value={`${customer.street}, ${customer.city}, ${customer.state} ${customer.zip}`} />
                             <DetailItem icon={<Car />} label="License Plate" value={customer.license_plate || 'Not Provided'} />
                             <DetailItem icon={<ImageIcon />} label="License Images" value={
                                <div className="flex flex-wrap gap-2">
                                    {customer.license_image_urls?.length > 0 ? customer.license_image_urls.map((img, idx) => (
                                        <a key={idx} href={img.url} target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:underline flex items-center text-sm">
                                            Image {idx + 1} <ExternalLink className="ml-1 h-3 w-3" />
                                        </a>
                                    )) : 'None provided'}
                                </div>
                            }/>
                            <DetailItem icon={<AlertTriangle className={!customer.unverified_address ? "text-green-400" : "text-orange-400"} />} label="Address Verified" value={!customer.unverified_address ? 'Yes' : 'No (Flagged)'} />
                            <DetailItem icon={<AlertTriangle className={!customer.has_incomplete_verification ? "text-green-400" : "text-red-400"} />} label="Vehicle Info Complete" value={!customer.has_incomplete_verification ? 'Yes' : 'No (Flagged)'} />
                        </Section>

                        <Section title="Communication Log" icon={<FileText className="mr-2 h-5 w-5"/>} className="md:grid-cols-1">
                             <div className="bg-black/20 rounded-lg p-2 max-h-60 overflow-y-auto space-y-2">
                                {notes && notes.length > 0 ? notes.map(note => <NoteCard key={note.id} note={note} />) : <p className="text-center text-blue-200 py-4">No notes found.</p>}
                             </div>
                        </Section>

                        {bookings.map((booking, index) => {
                             const paymentInfo = Array.isArray(booking.stripe_payment_info) ? booking.stripe_payment_info[0] : booking.stripe_payment_info;
                             const relevantEquipment = equipment.filter(e => e.booking_id === booking.id);
                             return (
                                <div key={booking.id} className="bg-white/5 p-4 rounded-lg border-l-4 border-blue-500">
                                <div className="flex justify-between items-center mb-2">
                                    <h3 className="font-bold text-xl text-white">{booking.plan.name}</h3>
                                    <p className="text-sm text-blue-200">{format(parseISO(booking.created_at), 'PPP, p')}</p>
                                </div>
                                <p className="text-xs text-gray-400 mb-4">Booking ID: {booking.id}</p>
                                
                                <Section title="Rental Details" icon={<Truck className="mr-2 h-5 w-5"/>}>
                                    <DetailItem icon={<Clock />} label="Start Date" value={`${format(parseISO(booking.drop_off_date), 'PPP')} @ ${booking.drop_off_time_slot}`} />
                                    <DetailItem icon={<Clock />} label="End Date" value={`${format(parseISO(booking.pickup_date), 'PPP')} @ ${booking.pickup_time_slot}`} />
                                    <DetailItem icon={<DollarSign />} label="Base Price" value={`$${booking.total_price.toFixed(2)}`} />
                                     <DetailItem icon={<CheckCircle className={booking.returned_at || booking.picked_up_at ? "text-green-400" : "text-gray-500"} />} label="Returned/Picked Up" value={booking.returned_at ? format(parseISO(booking.returned_at), 'Pp') : booking.picked_up_at ? format(parseISO(booking.picked_up_at), 'Pp') : 'N/A'} />
                                </Section>

                                 <Section title="Payment & Stripe IDs" icon={<Hash className="mr-2 h-5 w-5"/>}>
                                     <DetailItem icon={<Hash />} label="Customer ID" value={paymentInfo?.stripe_customer_id || 'N/A'} />
                                     <DetailItem icon={<Hash />} label="Payment Intent ID" value={paymentInfo?.stripe_payment_intent_id || 'N/A'} />
                                     <DetailItem icon={<Hash />} label="Charge ID" value={paymentInfo?.stripe_charge_id || 'N/A'} />
                                </Section>

                                <Section title="Add-ons & Equipment" icon={<Package className="mr-2 h-5 w-5"/>}>
                                     <DetailItem icon={<ShieldCheck />} label="Insurance" value={booking.addons.insurance === 'accept' ? 'Accepted' : 'Declined'} />
                                     {booking.plan.id !== 2 && <DetailItem icon={<ShieldCheck />} label="Driveway Protection" value={booking.addons.drivewayProtection === 'accept' ? 'Accepted' : 'Declined'} />}
                                     <div className="md:col-span-2">
                                        <DetailItem icon={<Package />} label="Rented Equipment" value={
                                            relevantEquipment.length > 0 ? (
                                                <ul className="list-disc list-inside">
                                                    {relevantEquipment.map(item => <li key={item.id}>{item.equipment.name} (x{item.quantity}) - {item.returned_at ? <span className="text-green-300">Returned</span> : <span className="text-red-400">Not Returned</span>}</li>)}
                                                </ul>
                                            ) : "None"
                                        } />
                                     </div>
                                </Section>

                                {(booking.fees && Object.keys(booking.fees).length > 0) || (booking.return_issues && Object.keys(booking.return_issues).length > 0) ? (
                                <Section title="Fees & Return Issues" icon={<AlertTriangle className="mr-2 h-5 w-5"/>}>
                                    {booking.fees && Object.values(booking.fees).map((fee, i) => (
                                        <DetailItem key={`fee-${i}`} icon={<DollarSign className="text-orange-400"/>} label={`Fee: ${fee.description}`} value={`$${fee.amount.toFixed(2)}`} />
                                    ))}
                                     {booking.return_issues && Object.keys(booking.return_issues).map((issue, i) => (
                                         <DetailItem key={`issue-${i}`} icon={<AlertTriangle className="text-red-400"/>} label={`Issue: ${issue.replace(/_/g, ' ')}`} value={booking.return_issues[issue].status.replace(/_/g, ' ')} className="capitalize" />
                                     ))}
                                </Section>
                                ) : null}

                                </div>
                             )
                        })}

                         <Section title="Lifetime Equipment Rentals" icon={<Repeat className="mr-2 h-5 w-5"/>}>
                                {Object.keys(equipmentRentalCount).length > 0 ? Object.entries(equipmentRentalCount).map(([name, count]) => (
                                    <DetailItem key={name} icon={<Package/>} label={name} value={`${count} time(s)`} />
                                )) : <p className="text-blue-200 col-span-2">No equipment rented yet.</p>}
                         </Section>
                    </div>
                </ScrollArea>
                <DialogFooter>
                    <Button onClick={() => onOpenChange(false)} variant="outline">Close</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};