import React from 'react';
import { format, parseISO } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Hash, User, Mail, Phone, Home, Clock, DollarSign, ShieldCheck, ShieldOff, AlertTriangle, Info, ShoppingBag, Key, Tag, Repeat, MapPin } from 'lucide-react';
import { getLatestRescheduleApproval, formatRescheduleStripeLine } from '@/utils/rescheduleApprovalDisplay';
import { formatFriendlyDateTime } from '@/utils/changeRequestNoteFormatter';
import { resolveOneWayMiles, formatMilesLabel, bookingIsCompanyDelivery } from '@/utils/bookingMileage';
import { formatCustomerFacingPlanName } from '@/utils/displayPlanName';
import { serviceOffersDrivewayProtection } from '@/utils/protectionPlans';
import { formatTimeWindow, formatTimeWindowBetween, shouldShowTimeWindow, isSelfServiceTrailer } from '@/utils/timeWindowFormatter';
import { isCustomerPickupService } from '@/utils/customerPickupService';
import {
    splitAddonEquipmentList,
    splitBookingEquipmentRows,
    resolveEquipmentId,
    getEquipmentReturnDisplay,
    formatReturnIssueStatus,
    EQUIPMENT_FRIENDLY_LABELS,
} from '@/utils/equipmentReturnDisplay';

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
      { id: 'wheelbarrow', label: 'Wheelbarrow', price: 10 },
      { id: 'handTruck', label: 'Hand Truck', price: 15 },
      { id: 'gloves', label: 'Working Gloves (Pair)', price: 5 },
    ];

    export const ReceiptDetailDialog = ({ booking, equipment, isOpen, onOpenChange }) => {
        if (!booking) return null;

        const { customers, plan, drop_off_date, pickup_date, total_price, drop_off_time_slot, pickup_time_slot, addons, notes, return_issues, fees, stripe_payment_info } = booking;
        const addonPrices = {
            insurance: Number(addons?.insurancePriceApplied || 0),
            drivewayProtection: Number(addons?.drivewayPriceApplied || 0),
        };
        const paymentInfo = Array.isArray(stripe_payment_info) ? stripe_payment_info[0] : stripe_payment_info;
        const coupon = addons?.coupon;
        const isDelivery = addons?.isDelivery || addons?.deliveryService;
        const offersDrivewayProtection = serviceOffersDrivewayProtection(plan);
        const showOneWayDistance = !bookingIsCompanyDelivery(booking);
        const showTimeWindow = shouldShowTimeWindow(plan, isDelivery);
        const isSelfService = isSelfServiceTrailer(plan, isDelivery);
        const isPickup = isCustomerPickupService(plan, addons || {});
        const pickedUpAt = isPickup
            ? (booking.rented_out_at || booking.picked_up_at)
            : (booking.picked_up_at || booking.rented_out_at);
        const timeOptions = {
            isWindow: showTimeWindow,
            isSelfService,
            serviceType: plan?.service_type,
        };

        const formatTime = (timeString, extra = {}) => {
            if (!timeString) return 'N/A';
            if (showTimeWindow) return formatTimeWindowBetween(timeString, { ...timeOptions, ...extra });
            return formatTimeWindow(timeString, { ...timeOptions, ...extra });
        };

        const rescheduleApproval = getLatestRescheduleApproval(booking);

        let subtotal = plan.price || 0;
        if (addons.insurance === 'accept') subtotal += addonPrices.insurance;
        if (offersDrivewayProtection && addons.drivewayProtection === 'accept') subtotal += addonPrices.drivewayProtection;
        if (addons.distanceInfo?.totalFee > 0) subtotal += addons.distanceInfo.totalFee;
        addons.equipment?.forEach(item => {
            const meta = equipmentMeta.find(e => e.id === item.id);
            if (meta) subtotal += meta.price * item.quantity;
        });

        const getDiscountAmount = () => {
            if (coupon && coupon.isValid) {
                if (coupon.discountType === 'fixed') {
                    return Math.min(subtotal, coupon.discountValue);
                } else if (coupon.discountType === 'percentage') {
                    return subtotal * (coupon.discountValue / 100);
                }
            }
            return 0;
        };
        const discountAmount = getDiscountAmount();

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
                            <DetailRow icon={<Info />} label="Service" value={formatCustomerFacingPlanName(plan.name)} />
                            {showOneWayDistance && (
                                <DetailRow icon={<MapPin />} label="Distance (one-way)" value={formatMilesLabel(resolveOneWayMiles(booking, customers))} />
                            )}
                            <DetailRow icon={<Clock />} label={isSelfService ? "Pickup" : "Drop-off"} value={`${format(parseISO(drop_off_date), 'PPP')} ${formatTime(drop_off_time_slot, { isReturnBy: false })}`} />
                            <DetailRow icon={<Clock />} label={isSelfService ? "Return" : "Pickup"} value={`${format(parseISO(pickup_date), 'PPP')} ${formatTime(pickup_time_slot, { isReturnBy: isSelfService })}`} />
                            {pickedUpAt && <DetailRow icon={<Clock />} label="Picked Up On" value={format(parseISO(pickedUpAt), 'Pp')} />}
                            {booking.returned_at && <DetailRow icon={<Clock />} label="Returned On" value={format(parseISO(booking.returned_at), 'Pp')} />}
                        </section>

                        {rescheduleApproval && (
                            <section>
                                <h4 className="font-bold text-lg text-emerald-400 mt-4 mb-2 flex items-center gap-2"><Repeat className="h-5 w-5" /> Reschedule Confirmation</h4>
                                <DetailRow icon={<Clock />} label="Approved" value={rescheduleApproval.at ? format(parseISO(rescheduleApproval.at), 'PPp') : 'N/A'} />
                                <DetailRow icon={<Clock />} label="Previous schedule" value={`${formatFriendlyDateTime(rescheduleApproval.original_drop_off_date, rescheduleApproval.original_drop_off_time) || 'N/A'} → ${formatFriendlyDateTime(rescheduleApproval.original_pickup_date, rescheduleApproval.original_pickup_time) || 'N/A'}`} />
                                <DetailRow icon={<Clock />} label="Approved schedule" value={`${formatFriendlyDateTime(rescheduleApproval.new_drop_off_date, rescheduleApproval.new_drop_off_time) || 'N/A'} → ${formatFriendlyDateTime(rescheduleApproval.new_pickup_date, rescheduleApproval.new_pickup_time) || 'N/A'}`} />
                                <DetailRow icon={<DollarSign />} label="Original total" value={`$${Number(rescheduleApproval.original_total || 0).toFixed(2)}`} />
                                <DetailRow icon={<DollarSign />} label="New total" value={`$${Number(rescheduleApproval.new_total || 0).toFixed(2)}`} />
                                <DetailRow icon={<DollarSign />} label="Stripe" value={formatRescheduleStripeLine(rescheduleApproval)} />
                                {rescheduleApproval.stripe_transaction_id && (
                                    <DetailRow icon={<Hash />} label="Stripe reference" value={rescheduleApproval.stripe_transaction_id} />
                                )}
                            </section>
                        )}

                        <section>
                            <h4 className="font-bold text-lg text-yellow-400 mt-4 mb-2">Add-ons & Protection</h4>
                            <DetailRow icon={addons.insurance === 'accept' ? <ShieldCheck className="text-green-400"/> : <ShieldOff className="text-red-400"/>} label="Insurance" value={addons.insurance === 'accept' ? `Accepted ($${addonPrices.insurance.toFixed(2)})` : 'Declined'} />
                            {offersDrivewayProtection && <DetailRow icon={addons.drivewayProtection === 'accept' ? <ShieldCheck className="text-green-400"/> : <ShieldOff className="text-red-400"/>} label="Driveway Protection" value={addons.drivewayProtection === 'accept' ? `Accepted ($${addonPrices.drivewayProtection.toFixed(2)})` : 'Declined'} />}
                            {addons.addressVerificationSkipped && <DetailRow icon={<AlertTriangle className="text-orange-400"/>} label="Address Verification" value="Skipped by customer" />}
                            
                            {addons.equipment && addons.equipment.length > 0 && (() => {
                                const { rentals, purchases } = splitAddonEquipmentList(addons.equipment);
                                const bookingEqRows = (equipment || []).filter((e) => e.booking_id === booking.id);
                                const { rentals: rentalRows } = splitBookingEquipmentRows(bookingEqRows);
                                const returnedAtById = new Map(
                                    rentalRows.map((row) => [
                                        Number(row.equipment_id || row.equipment?.id),
                                        row.returned_at,
                                    ])
                                );
                                const dbNameById = new Map(
                                    rentalRows.map((row) => [
                                        Number(row.equipment_id || row.equipment?.id),
                                        row.equipment?.name,
                                    ])
                                );

                                return (
                                    <div className="pt-2 space-y-3">
                                        {rentals.length > 0 && (
                                            <div>
                                                <p className="font-semibold text-blue-200 flex items-center"><ShoppingBag className="mr-2 h-5 w-5"/>Equipment Included</p>
                                                <ul className="list-disc list-inside pl-8 text-white">
                                                    {rentals.map((item) => {
                                                        const equipmentId = resolveEquipmentId(item);
                                                        const meta = equipmentMeta.find((e) => e.id === item.id);
                                                        const label =
                                                            dbNameById.get(equipmentId) ||
                                                            meta?.label ||
                                                            EQUIPMENT_FRIENDLY_LABELS[equipmentId] ||
                                                            item.id;
                                                        const display = getEquipmentReturnDisplay({
                                                            equipmentId,
                                                            equipmentName: dbNameById.get(equipmentId),
                                                            friendlyName: meta?.label || EQUIPMENT_FRIENDLY_LABELS[equipmentId],
                                                            returnedAt: returnedAtById.get(equipmentId),
                                                            returnIssues: return_issues,
                                                            bookingStatus: booking.status,
                                                        });
                                                        const toneClass =
                                                            display.tone === 'green'
                                                                ? 'text-green-300'
                                                                : display.tone === 'red'
                                                                  ? 'text-red-400 font-bold'
                                                                  : 'text-orange-300';
                                                        return (
                                                            <li key={item.id || equipmentId}>
                                                                {label} (x{item.quantity}) —{' '}
                                                                <span className={toneClass}>{display.label}</span>
                                                            </li>
                                                        );
                                                    })}
                                                </ul>
                                            </div>
                                        )}
                                        {purchases.length > 0 && (
                                            <div>
                                                <p className="font-semibold text-blue-200 flex items-center"><ShoppingBag className="mr-2 h-5 w-5"/>Purchased Items</p>
                                                <ul className="list-disc list-inside pl-8 text-white">
                                                    {purchases.map((item) => {
                                                        const equipmentId = resolveEquipmentId(item);
                                                        const meta = equipmentMeta.find((e) => e.id === item.id);
                                                        const label =
                                                            meta?.label ||
                                                            EQUIPMENT_FRIENDLY_LABELS[equipmentId] ||
                                                            item.id;
                                                        return (
                                                            <li key={item.id || equipmentId}>
                                                                {label} (x{item.quantity})
                                                            </li>
                                                        );
                                                    })}
                                                </ul>
                                            </div>
                                        )}
                                    </div>
                                );
                            })()}
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
                                    <DetailRow key={key} icon={<AlertTriangle />} label={`Issue: ${key.replace(/_/g, ' ')}`} value={formatReturnIssueStatus(value.status)} className="capitalize" />
                                ))}
                                {fees && Object.entries(fees).map(([key, value]) => (
                                    <DetailRow key={key} icon={<DollarSign />} label={`Fee: ${value.description}`} value={`$${parseFloat(value.amount).toFixed(2)}`} />
                                ))}
                            </section>
                        )}

                        <div className="border-t-2 border-yellow-400 pt-4 mt-4">
                            {discountAmount > 0 && (
                                <>
                                    <DetailRow icon={<DollarSign />} label="Subtotal" value={`$${subtotal.toFixed(2)}`} />
                                    <DetailRow icon={<Tag />} label={`Coupon (${coupon.code})`} value={`- $${discountAmount.toFixed(2)}`} className="text-green-400" />
                                </>
                            )}
                            <DetailRow icon={<DollarSign />} label="Grand Total Paid" value={`$${total_price.toFixed(2)}`} className="text-xl font-bold" />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button onClick={() => onOpenChange(false)} variant="outline">Close</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        );
    };