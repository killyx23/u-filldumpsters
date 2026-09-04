import React from 'react';
import { format, parseISO, formatDistanceToNow } from 'date-fns';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from '@/components/ui/button';
import { ScrollArea } from "@/components/ui/scroll-area";
import { DollarSign, Hash, ShieldCheck, AlertTriangle, Package, Car, Image as ImageIcon, User, Clock, FileText, CheckCircle, Repeat, Truck, Home, Mail, Phone, ExternalLink, Gift, Wallet } from 'lucide-react';
import { formatReferralWalletTxType } from '@/utils/referralWalletLabels';
import { formatLoyaltyTxLabel, formatLoyaltyTxAmount } from '@/utils/loyaltyTransactionLabels';
import { ChangeRequestNoteContent } from '@/components/admin/customer-detail/ChangeRequestNoteContent';
import { convertTo12Hour } from '@/utils/timeFormatConverter';
import { getLatestRescheduleApproval, formatRescheduleStripeLine } from '@/utils/rescheduleApprovalDisplay';
import { formatCustomerFacingPlanName } from '@/utils/displayPlanName';
import { isCustomerPickupService } from '@/utils/customerPickupService';
import {
    splitBookingEquipmentRows,
    getEquipmentReturnDisplay,
    formatReturnIssueStatus,
    isRentalEquipmentId,
} from '@/utils/equipmentReturnDisplay';

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
                {note.source === 'Change Request' ? 'Scheduling Change Request' : note.source}
            </p>
            <p className="text-xs text-gray-400">{format(parseISO(note.created_at), 'MMM d, yyyy @ h:mm a')}</p>
        </div>
        <ChangeRequestNoteContent content={note.content} source={note.source} className="text-sm" />
    </div>
);

const fmtMoney = (value) => `$${Number(value || 0).toFixed(2)}`;
const fmtType = (value) => String(value || '').replace(/_/g, ' ');

const LedgerList = ({ emptyLabel, children }) => (
    <div className="md:col-span-2 bg-black/20 rounded-lg p-3 max-h-72 overflow-y-auto space-y-2">
        {children || <p className="text-center text-blue-200 py-4">{emptyLabel}</p>}
    </div>
);

export const ComprehensiveHistoryDialog = ({
    isOpen,
    onOpenChange,
    customer,
    bookings,
    equipment,
    notes,
    loyaltySummary = null,
    referralWallet = null,
    loyaltyTransactions = [],
    referralWalletTransactions = [],
    referrals = [],
}) => {
    if (!customer) return null;

    const totalSpent = bookings.reduce((acc, b) => {
        if (b.status === 'Cancelled') return acc;
        const bookingTotal = b.total_price || 0;
        const feesTotal = b.fees ? Object.values(b.fees).reduce((feeAcc, fee) => feeAcc + (fee.amount || 0), 0) : 0;
        return acc + bookingTotal + feesTotal;
    }, 0);

    const customerSince = formatDistanceToNow(parseISO(customer.created_at), { addSuffix: true });

    const equipmentRentalCount = equipment.reduce((acc, item) => {
        const id = item.equipment_id || item.equipment?.id;
        if (!isRentalEquipmentId(id)) return acc;
        const name = item.equipment?.name || `Equipment #${id}`;
        acc[name] = (acc[name] || 0) + item.quantity;
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
                            <DetailItem icon={<AlertTriangle className={!customer.unverified_address ? "text-green-400" : "text-orange-400"} />} label="Address Verified" value={!customer.unverified_address ? 'Yes (Globally)' : 'No (Flagged on at least one booking)'} />
                            <DetailItem icon={<AlertTriangle className={!customer.has_incomplete_verification ? "text-green-400" : "text-red-400"} />} label="Vehicle Info Complete" value={!customer.has_incomplete_verification ? 'Yes (Globally)' : 'No (Flagged on at least one booking)'} />
                        </Section>

                        <Section title="Rewards Balances" icon={<Gift className="mr-2 h-5 w-5"/>}>
                            <DetailItem icon={<Gift />} label="Points Balance" value={Number(loyaltySummary?.points_balance || 0)} />
                            <DetailItem icon={<Gift />} label="Points Earned (lifetime)" value={Number(loyaltySummary?.total_points_earned || 0)} />
                            <DetailItem icon={<Gift />} label="Points Redeemed (lifetime)" value={Number(loyaltySummary?.total_points_redeemed || 0)} />
                            <DetailItem icon={<Wallet />} label="Referral Dollars Pending" value={fmtMoney(referralWallet?.pending_balance)} />
                            <DetailItem icon={<Wallet />} label="Referral Dollars Available" value={fmtMoney(referralWallet?.available_balance)} />
                            <DetailItem icon={<Wallet />} label="Referral Dollars Earned" value={fmtMoney(referralWallet?.total_earned)} />
                            <DetailItem icon={<Wallet />} label="Referral Dollars Redeemed" value={fmtMoney(referralWallet?.total_redeemed)} />
                        </Section>

                        <Section title="Loyalty Points Ledger" icon={<Gift className="mr-2 h-5 w-5"/>} className="md:grid-cols-1">
                            <LedgerList emptyLabel="No loyalty point transactions.">
                                {loyaltyTransactions.length > 0 && loyaltyTransactions.map((tx) => {
                                    const { debit, signedLabel } = formatLoyaltyTxAmount(tx);
                                    return (
                                    <div key={tx.id} className="bg-black/30 border border-white/10 rounded p-2 text-sm">
                                        <div className="flex justify-between gap-2">
                                            <span className="text-blue-200">{formatLoyaltyTxLabel(tx)}</span>
                                            <span className={`font-semibold ${debit ? 'text-red-300' : 'text-yellow-300'}`}>{signedLabel} pts</span>
                                        </div>
                                        <p className="text-xs text-gray-400 mt-1">
                                            {tx.booking_id ? `Booking #${tx.booking_id} • ` : ''}
                                            {tx.created_at ? format(parseISO(tx.created_at), 'Pp') : 'N/A'}
                                        </p>
                                        {tx.notes && <p className="text-xs text-gray-300 mt-1">{tx.notes}</p>}
                                    </div>
                                    );
                                })}
                            </LedgerList>
                        </Section>

                        <Section title="Referral Dollar Ledger" icon={<Wallet className="mr-2 h-5 w-5"/>} className="md:grid-cols-1">
                            <LedgerList emptyLabel="No referral wallet transactions.">
                                {referralWalletTransactions.length > 0 && referralWalletTransactions.map((tx) => (
                                    <div key={tx.id} className="bg-black/30 border border-white/10 rounded p-2 text-sm">
                                        <div className="flex justify-between gap-2">
                                            <span className="text-emerald-200">{formatReferralWalletTxType(tx.transaction_type)}</span>
                                            <span className="font-semibold text-emerald-300">{fmtMoney(tx.amount)}</span>
                                        </div>
                                        <p className="text-xs text-gray-400 mt-1">
                                            {tx.booking_id ? `Booking #${tx.booking_id} • ` : ''}
                                            {tx.referral_id ? `Referral #${tx.referral_id} • ` : ''}
                                            {tx.created_at ? format(parseISO(tx.created_at), 'Pp') : 'N/A'}
                                        </p>
                                        <p className="text-xs text-gray-400">
                                            After: pending {fmtMoney(tx.pending_balance_after)} • available {fmtMoney(tx.available_balance_after)}
                                        </p>
                                        {tx.notes && <p className="text-xs text-gray-300 mt-1">{tx.notes}</p>}
                                    </div>
                                ))}
                            </LedgerList>
                        </Section>

                        <Section title="Referral Codes" icon={<Hash className="mr-2 h-5 w-5"/>} className="md:grid-cols-1">
                            <LedgerList emptyLabel="No referral codes.">
                                {referrals.length > 0 && referrals.map((ref) => (
                                    <div key={ref.id} className="bg-black/30 border border-white/10 rounded p-2 text-sm">
                                        <div className="flex justify-between gap-2">
                                            <span className="font-mono text-blue-200">{ref.referral_code}</span>
                                            <span className="capitalize text-yellow-300">{fmtType(ref.status)}</span>
                                        </div>
                                        <p className="text-xs text-gray-400 mt-1">
                                            Referee: {ref.referee_email || (ref.referee_customer_id ? `Customer #${ref.referee_customer_id}` : 'N/A')}
                                        </p>
                                        <p className="text-xs text-gray-400">
                                            Pending booking: {ref.pending_booking_id || 'N/A'} • Completed booking: {ref.completed_booking_id || 'N/A'}
                                        </p>
                                        <p className="text-xs text-gray-400">
                                            Bonus awarded: {fmtMoney(ref.referrer_bonus_dollars_awarded)}
                                            {ref.reward_activated_at ? ` • Activated: ${format(parseISO(ref.reward_activated_at), 'Pp')}` : ''}
                                        </p>
                                        <p className="text-xs text-gray-500">
                                            Created: {ref.created_at ? format(parseISO(ref.created_at), 'Pp') : 'N/A'}
                                            {ref.completed_at ? ` • Completed: ${format(parseISO(ref.completed_at), 'Pp')}` : ''}
                                        </p>
                                    </div>
                                ))}
                            </LedgerList>
                        </Section>

                        <Section title="Stripe Payment IDs" icon={<Hash className="mr-2 h-5 w-5" />}>
                            <DetailItem icon={<Hash />} label="Customer ID" value={customer.stripe_customer_id || 'N/A'} />
                            <DetailItem icon={<Hash />} label="Last Payment Intent ID" value={customer.stripe_payment_intent_id || 'N/A'} />
                            <DetailItem icon={<Hash />} label="Last Charge ID" value={customer.stripe_charge_id || 'N/A'} />
                        </Section>

                        <Section title="Communication Log" icon={<FileText className="mr-2 h-5 w-5"/>} className="md:grid-cols-1">
                            <div className="bg-black/20 rounded-lg p-2 max-h-60 overflow-y-auto space-y-2">
                                {notes && notes.length > 0 ? notes.map(note => <NoteCard key={note.id} note={note} />) : <p className="text-center text-blue-200 py-4">No notes found.</p>}
                            </div>
                        </Section>

                        {bookings.map((booking) => {
                            const paymentInfo = Array.isArray(booking.stripe_payment_info) ? booking.stripe_payment_info[0] : booking.stripe_payment_info;
                            const relevantEquipment = equipment.filter(e => e.booking_id === booking.id);
                            const { rentals: rentalEquipment, purchases: purchasedEquipment } =
                                splitBookingEquipmentRows(relevantEquipment);
                            const rescheduleApproval = getLatestRescheduleApproval(booking);
                            return (
                                <div key={booking.id} className="bg-white/5 p-4 rounded-lg border-l-4 border-blue-500">
                                    <div className="flex justify-between items-center mb-2">
                                        <h3 className="font-bold text-xl text-white">{formatCustomerFacingPlanName(booking.plan.name)}</h3>
                                        <p className="text-sm text-blue-200">{format(parseISO(booking.created_at), 'PPP, p')}</p>
                                    </div>
                                    <p className="text-xs text-gray-400 mb-4">Booking ID: {booking.id}</p>

                                    <Section title="Rental Details" icon={<Truck className="mr-2 h-5 w-5"/>}>
                                        <DetailItem icon={<Clock />} label="Start Date" value={`${format(parseISO(booking.drop_off_date), 'PPP')} @ ${convertTo12Hour(booking.drop_off_time_slot) || booking.drop_off_time_slot || 'N/A'}`} />
                                        <DetailItem icon={<Clock />} label="End Date" value={`${format(parseISO(booking.pickup_date), 'PPP')} @ ${convertTo12Hour(booking.pickup_time_slot) || booking.pickup_time_slot || 'N/A'}`} />
                                        {rescheduleApproval && (
                                            <DetailItem
                                                icon={<Repeat />}
                                                label="Reschedule"
                                                value={`${formatRescheduleStripeLine(rescheduleApproval)} · $${Number(rescheduleApproval.new_total || 0).toFixed(2)}`}
                                                className="md:col-span-2"
                                            />
                                        )}
                                        <DetailItem icon={<DollarSign />} label="Base Price" value={`$${booking.total_price.toFixed(2)}`} />
                                        {(() => {
                                            const isPickup = isCustomerPickupService(booking.plan, booking.addons || {});
                                            const pickedUpAt = isPickup
                                                ? (booking.rented_out_at || booking.picked_up_at)
                                                : (booking.picked_up_at || booking.rented_out_at);
                                            return (
                                                <>
                                                    <DetailItem
                                                        icon={<CheckCircle className={pickedUpAt ? 'text-green-400' : 'text-gray-500'} />}
                                                        label="Picked Up On"
                                                        value={pickedUpAt ? format(parseISO(pickedUpAt), 'Pp') : 'N/A'}
                                                    />
                                                    <DetailItem
                                                        icon={<CheckCircle className={booking.returned_at ? 'text-green-400' : 'text-gray-500'} />}
                                                        label="Returned On"
                                                        value={booking.returned_at ? format(parseISO(booking.returned_at), 'Pp') : 'N/A'}
                                                    />
                                                </>
                                            );
                                        })()}
                                    </Section>

                                    <Section title="Booking-Specific Payment IDs" icon={<Hash className="mr-2 h-5 w-5"/>}>
                                        <DetailItem icon={<Hash />} label="Payment Intent ID" value={paymentInfo?.stripe_payment_intent_id || 'N/A'} />
                                        <DetailItem icon={<Hash />} label="Charge ID" value={paymentInfo?.stripe_charge_id || 'N/A'} />
                                    </Section>

                                    <Section title="Add-ons & Equipment" icon={<Package className="mr-2 h-5 w-5"/>}>
                                        <DetailItem
                                          icon={<ShieldCheck />}
                                          label="Insurance"
                                          value={
                                            booking.status === 'Cancelled' && booking.addons.insurance === 'accept'
                                              ? 'Cancelled (was accepted)'
                                              : booking.addons.insurance === 'accept' ? 'Accepted' : 'Declined'
                                          }
                                        />
                                        {Number(booking.plan.id) === 1 && (
                                          <DetailItem
                                            icon={<ShieldCheck />}
                                            label="Driveway Protection"
                                            value={
                                              booking.status === 'Cancelled' && booking.addons.drivewayProtection === 'accept'
                                                ? 'Cancelled (was accepted)'
                                                : booking.addons.drivewayProtection === 'accept' ? 'Accepted' : 'Declined'
                                            }
                                          />
                                        )}
                                        <div className="md:col-span-2">
                                            <DetailItem icon={<Package />} label="Rented Equipment" value={
                                                rentalEquipment.length > 0 ? (
                                                    <ul className="list-disc list-inside">
                                                        {rentalEquipment.map(item => {
                                                            const display = getEquipmentReturnDisplay({
                                                                equipmentId: item.equipment_id || item.equipment?.id,
                                                                equipmentName: item.equipment?.name,
                                                                returnedAt: item.returned_at,
                                                                returnIssues: booking.return_issues,
                                                                bookingStatus: booking.status,
                                                            });
                                                            const toneClass =
                                                                display.tone === 'green'
                                                                    ? 'text-green-300'
                                                                    : display.tone === 'red'
                                                                      ? 'text-red-400 font-bold'
                                                                      : 'text-orange-300';
                                                            return (
                                                                <li key={item.id}>
                                                                    {item.equipment?.name} (x{item.quantity}) -{' '}
                                                                    <span className={toneClass}>{display.label}</span>
                                                                </li>
                                                            );
                                                        })}
                                                    </ul>
                                                ) : "None"
                                            } />
                                        </div>
                                        {purchasedEquipment.length > 0 && (
                                            <div className="md:col-span-2">
                                                <DetailItem icon={<Package />} label="Purchased Items" value={
                                                    <ul className="list-disc list-inside">
                                                        {purchasedEquipment.map(item => (
                                                            <li key={item.id}>
                                                                {item.equipment?.name} (x{item.quantity})
                                                            </li>
                                                        ))}
                                                    </ul>
                                                } />
                                            </div>
                                        )}
                                    </Section>

                                    {(booking.fees && Object.keys(booking.fees).length > 0) || (booking.return_issues && Object.keys(booking.return_issues).length > 0) ? (
                                        <Section title="Fees & Return Issues" icon={<AlertTriangle className="mr-2 h-5 w-5"/>}>
                                            {booking.fees && Object.values(booking.fees).map((fee, i) => (
                                                <DetailItem key={`fee-${i}`} icon={<DollarSign className="text-orange-400"/>} label={`Fee: ${fee.description}`} value={`$${fee.amount.toFixed(2)}`} />
                                            ))}
                                            {booking.return_issues && Object.keys(booking.return_issues).map((issue, i) => (
                                                <DetailItem key={`issue-${i}`} icon={<AlertTriangle className="text-red-400"/>} label={`Issue: ${issue.replace(/_/g, ' ')}`} value={formatReturnIssueStatus(booking.return_issues[issue].status)} className="capitalize" />
                                            ))}
                                        </Section>
                                    ) : null}
                                </div>
                            );
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
