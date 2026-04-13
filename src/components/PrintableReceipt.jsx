import React from 'react';
import { format, parseISO, isValid, differenceInDays, addHours } from 'date-fns';
import { Key, Repeat, FileSignature, Clock, ShieldCheck, AlertTriangle } from 'lucide-react';
import { useInsurancePricing } from '@/hooks/useInsurancePricing';

const formatTime = (timeString, isWindow = false, isSelfService = false) => {
    if (!timeString || !/^\d{2}:\d{2}/.test(timeString)) return 'N/A';
    try {
        const date = parseISO(`1970-01-01T${timeString}`);
        if (!isValid(date)) return 'N/A';

        if (isSelfService) {
            if (timeString.startsWith('08:00')) return `after ${format(date, 'h:mm a')}`;
            if (timeString.startsWith('22:00')) return `by ${format(date, 'h:mm a')}`;
        }

        if (isWindow) {
            const endTime = addHours(date, 2);
            return `between ${format(date, 'h:mm a')} - ${format(endTime, 'h:mm a')}`;
        }
        return format(date, 'h:mm a');
    } catch (e) {
        return 'N/A';
    }
};

const addonPrices = {
  drivewayProtection: 15,
};

const equipmentMeta = [
  { id: 'wheelbarrow', label: 'Wheelbarrow', price: 10 },
  { id: 'handTruck', label: 'Hand Truck', price: 15 },
  { id: 'gloves', label: 'Working Gloves (Pair)', price: 5 },
];

const AgreementText = ({ booking }) => {
    const displayName = (booking?.first_name && booking?.last_name) 
        ? `${booking.first_name} ${booking.last_name}` 
        : booking?.name;

    return (
        <div className="text-xs text-gray-600 border-t mt-8 pt-4 space-y-2">
            <h3 className="font-bold text-sm text-gray-800 flex items-center mb-2"><FileSignature className="mr-2 h-4 w-4"/>Rental Agreement Acknowledgment</h3>
            <p>The following is a summary of the key terms agreed to upon booking. For the full agreement text, please refer to your customer portal or contact support.</p>
            
            <div className="p-2 border bg-gray-50 rounded-md text-gray-700">
                <p><strong>Liability for Equipment:</strong> Customer acknowledges full responsibility for any damage, loss, or theft of all rented equipment and authorizes U-Fill Dumpsters LLC to charge the payment method on file for the full repair or replacement cost.</p>
                <p className="mt-1"><strong>Prohibited Materials:</strong> Customer agrees not to place any hazardous materials (including paints, chemicals, oils, tires, batteries) in the equipment. Fees and penalties apply for violations.</p>
                <p className="mt-1"><strong>Property Damage:</strong> Customer assumes all risk of damage to their property (driveways, lawns, etc.) from equipment placement. U-Fill Dumpsters LLC is not liable for such damages.</p>
            </div>

            <div className="flex items-center justify-between text-sm mt-4 p-3 bg-green-50 border border-green-200 rounded-lg">
                <div className="flex items-center">
                    <ShieldCheck className="h-6 w-6 text-green-600 mr-3" />
                    <div>
                        <p className="font-bold text-green-800">Electronically Signed & Agreed</p>
                        <p className="text-xs text-green-700">by {displayName}</p>
                    </div>
                </div>
                <div className="text-right">
                    <p className="font-semibold text-green-800">{format(parseISO(booking.created_at), 'PPP')}</p>
                    <p className="text-xs text-green-700">{format(parseISO(booking.created_at), 'p')}</p>
                </div>
            </div>
        </div>
    );
};

export const PrintableReceipt = React.forwardRef(({ booking }, ref) => {
    const { insurancePrice } = useInsurancePricing();
    
    if (!booking || !booking.customers || !booking.plan) return null;

    const { customers, plan, drop_off_date, pickup_date, drop_off_time_slot, pickup_time_slot, addons, refund_details, status: bookingStatus, was_verification_skipped, reschedule_history, return_issues } = booking;
    const { name, first_name, last_name, email, phone, street, city, state, zip, customer_id_text } = customers;
    const isDelivery = addons?.deliveryService || addons?.isDelivery;
    const coupon = addons?.coupon;
    
    const currentPlan = addons?.plan || plan;
    const serviceName = currentPlan.name;
    const isSelfServiceTrailer = currentPlan.service_type === 'hourly' && !isDelivery;
    const isWindowService = currentPlan.service_type === 'window' || currentPlan.service_type === 'material_delivery';

    const displayName = (first_name && last_name) ? `${first_name} ${last_name}` : name;
    const fullAddress = street && city ? `${street}, ${city}, ${state} ${zip}` : "N/A";

    const isCancelledAndRefunded = bookingStatus === 'Cancelled' && refund_details;
    const isPendingReview = bookingStatus === 'pending_verification' || bookingStatus === 'pending_review';
    const isRescheduled = bookingStatus === 'Rescheduled';

    const getPendingReason = () => {
        if (!isPendingReview) return '';
        if (reschedule_history && reschedule_history.length > 0) return 'Pending Reschedule Approval';
        if (was_verification_skipped) return 'Pending Initial Verification';
        return 'Pending Manual Review';
    };
    const pendingReason = getPendingReason();
    
    const dropOff = parseISO(drop_off_date);
    const pickup = parseISO(pickup_date);
    const duration = isValid(dropOff) && isValid(pickup) ? differenceInDays(pickup, dropOff) + 1 : 1;

    let baseServicePrice = currentPlan.base_price || 0;
    if (currentPlan.id === 1 && duration === 7) {
        baseServicePrice = 500;
    } else if (currentPlan.id === 1) {
        baseServicePrice = currentPlan.base_price + (Math.max(0, duration - 1) * 50);
    } else if (currentPlan.id === 2 || currentPlan.id === 4) {
        baseServicePrice = (currentPlan.base_price || 0) * duration;
    }

    const deliveryChargeFlat = isDelivery ? (addons.deliveryFee || 0) : 0;
    const tripMileageCost = isDelivery ? (addons.distanceInfo?.mileageFee || addons.mileageCharge || 0) : 0;

    let addonsTotal = 0;
    if (addons.insurance === 'accept') addonsTotal += insurancePrice;
    if ((currentPlan.id === 1 || isDelivery) && addons.drivewayProtection === 'accept') addonsTotal += addonPrices.drivewayProtection;
    
    addons.equipment?.forEach(item => {
        const meta = equipmentMeta.find(e => e.id === item.id);
        if (meta) addonsTotal += meta.price * item.quantity;
    });

    const mattressDisposalCount = addons.mattressDisposal || 0;
    const tvDisposalCount = addons.tvDisposal || 0;
    const applianceDisposalCount = addons.applianceDisposal || 0;

    if (mattressDisposalCount > 0) addonsTotal += 25 * mattressDisposalCount;
    if (tvDisposalCount > 0) addonsTotal += 15 * tvDisposalCount;
    if (applianceDisposalCount > 0) addonsTotal += 35 * applianceDisposalCount;

    const subtotal = baseServicePrice + deliveryChargeFlat + tripMileageCost + addonsTotal;

    const getDiscountAmount = () => {
        if (coupon && coupon.isValid) {
            if (coupon.discountType === 'fixed') return coupon.discountValue;
            else if (coupon.discountType === 'percentage') return subtotal * (coupon.discountValue / 100);
        }
        return 0;
    };
    
    const discountAmount = getDiscountAmount();
    const calculatedTotal = subtotal - discountAmount;
    const hasReturnIssues = return_issues && Object.keys(return_issues).length > 0;
    const freeMiles = currentPlan.id === 1 ? 30 : 0;
    const totalMiles = addons.distanceInfo?.miles || addons.distanceInfo?.roundTripMiles || addons.deliveryDistance || 0;

    return (
        <div ref={ref} className="p-8 font-sans text-gray-800 bg-white" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
            <div style={{ flexGrow: 1 }}>
                <header className="flex justify-between items-center pb-4 border-b">
                    <div>
                        <h1 className="text-3xl font-bold text-blue-800">U-Fill Dumpsters</h1>
                        <p>Saratoga Springs, Utah</p>
                    </div>
                    <h2 className={`text-2xl font-semibold ${isCancelledAndRefunded ? 'text-red-600' : ''}`}>
                        {isCancelledAndRefunded ? 'Refund Receipt' : 'Booking Receipt'}
                    </h2>
                </header>
                <section className="grid grid-cols-2 gap-8 my-6">
                    <div>
                        <h3 className="font-bold text-lg mb-2">Billed To:</h3>
                        <p>{displayName}</p>
                        <p>{fullAddress}</p>
                        <p>{email}</p>
                        <p>{phone}</p>
                    </div>
                    <div className="text-right">
                        <p><span className="font-bold">Booking ID:</span> {booking.id}</p>
                        <p><span className="font-bold">Payment Date:</span> {format(parseISO(booking.created_at), 'PPP')}</p>
                        {isCancelledAndRefunded && <p className="text-red-600"><span className="font-bold">Refund Date:</span> {format(parseISO(refund_details.created_at), 'PPP')}</p>}
                        {isPendingReview && <p className="font-bold text-orange-600">Status: {pendingReason}</p>}
                        {isRescheduled && <p className="font-bold text-blue-600 flex items-center justify-end"><Repeat className="mr-2 h-4 w-4"/> Status: Rescheduled</p>}
                    </div>
                </section>
                
                <section className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-md" style={{ pageBreakInside: 'avoid' }}>
                    <h3 className="font-bold text-lg mb-2 text-yellow-800 flex items-center"><Key className="mr-2 h-5 w-5"/> Customer Portal Login Information</h3>
                    <p className="text-sm">Use the following credentials to access the Customer Portal to view your booking status, add notes, or upload files.</p>
                    <p className="mt-2"><strong>Customer ID:</strong> <span className="font-mono bg-gray-200 p-1 rounded">{customer_id_text}</span></p>
                    <p><strong>Phone Number:</strong> <span className="font-mono bg-gray-200 p-1 rounded">{phone}</span></p>
                </section>

                {isSelfServiceTrailer && !isCancelledAndRefunded && (
                    <section className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-md" style={{ pageBreakInside: 'avoid' }}>
                        <h3 className="font-bold text-lg mb-2 text-blue-800">Dump Loader Trailer Rental Instructions</h3>
                        {isPendingReview ? (
                            <p className="font-semibold text-orange-700">Your booking is currently under review. Pickup location and instructions will be provided once your booking is confirmed. Please check your Customer Portal for updates.</p>
                        ) : (
                            <div className="text-sm text-gray-700 space-y-2">
                                <p><strong>Pickup Location:</strong> Your rental trailer is scheduled for pickup at <span className="font-semibold">227 W. Casi Way, Saratoga Springs, UT 84045.</span></p>
                                <p><strong>Pickup & Return Times:</strong> The rental is available for pickup starting at <span className="font-semibold">8:00 a.m.</span> on your scheduled pickup date. The trailer must be returned to the same location no later than <span className="font-semibold">10:00 p.m.</span> on the designated return date.</p>
                                <p><strong>Cleaning Requirement:</strong> To ensure a smooth process for all our customers, the trailer must be returned clean and free of debris. Failure to do so may result in the assessment of cleaning fines. Thank you for your cooperation and your rental.</p>
                            </div>
                        )}
                    </section>
                )}

                <section style={{ pageBreakInside: 'avoid' }}>
                    <h3 className="font-bold text-lg mb-2 border-b pb-2">Order Summary</h3>
                    <table className="w-full">
                        <thead>
                            <tr className="border-b"><th className="text-left py-2">Item</th><th className="text-right py-2">Total</th></tr>
                        </thead>
                        <tbody>
                            <tr className="border-b">
                                <td className="py-2">
                                    <p className="font-semibold">{serviceName}</p>
                                    {reschedule_history && reschedule_history.length > 0 && (
                                        <div className="text-xs text-gray-500 mt-1 p-2 bg-gray-100 rounded">
                                            <p className="font-bold">Original Dates:</p>
                                            <p>Drop-off: {format(parseISO(reschedule_history[0].from_drop_off_date), 'MMM d, yyyy')} - {formatTime(reschedule_history[0].from_drop_off_time, isWindowService, isSelfServiceTrailer)}</p>
                                            <p>Pickup: {format(parseISO(reschedule_history[0].from_pickup_date), 'MMM d, yyyy')} - {formatTime(reschedule_history[0].from_pickup_time, isWindowService, isSelfServiceTrailer)}</p>
                                        </div>
                                    )}
                                    <p className="text-sm text-gray-600 mt-1">{isWindowService ? "Delivery" : "Pickup"}: {isPendingReview ? pendingReason : `${format(parseISO(drop_off_date), 'MMM d, yyyy')} - ${formatTime(drop_off_time_slot, isWindowService, isSelfServiceTrailer)}`}</p>
                                    {currentPlan.id !== 3 && <p className="text-sm text-gray-600">{isSelfServiceTrailer ? "Return" : "Pickup"}: {isPendingReview ? pendingReason : `${format(parseISO(pickup_date), 'MMM d, yyyy')} - ${formatTime(pickup_time_slot, isWindowService, isSelfServiceTrailer)}`}</p>}
                                </td>
                                <td className="text-right py-2 align-top">${baseServicePrice.toFixed(2)}</td>
                            </tr>
                            {deliveryChargeFlat > 0 && <tr className="border-b"><td className="py-2 pl-4">Delivery Fee (Flat)</td><td className="text-right py-2">${deliveryChargeFlat.toFixed(2)}</td></tr>}
                            {tripMileageCost > 0 && <tr className="border-b"><td className="py-2 pl-4">{`Mileage Charge (${totalMiles.toFixed(2)} miles total${freeMiles > 0 ? `, ${freeMiles} free` : ''})`}</td><td className="text-right py-2">${tripMileageCost.toFixed(2)}</td></tr>}
                            {addons.insurance === 'accept' && <tr className="border-b"><td className="py-2 pl-4">Rental Insurance</td><td className="text-right py-2">${insurancePrice.toFixed(2)}</td></tr>}
                            {(currentPlan.id === 1 || isDelivery) && addons.drivewayProtection === 'accept' && <tr className="border-b"><td className="py-2 pl-4">Driveway Protection</td><td className="text-right py-2">${addonPrices.drivewayProtection.toFixed(2)}</td></tr>}
                            {addons.equipment && addons.equipment.map(item => {
                                const meta = equipmentMeta.find(e => e.id === item.id);
                                if (!meta) return null;
                                const issue = return_issues ? return_issues[meta.label] : null;
                                return (
                                    <tr key={item.id} className="border-b">
                                        <td className="py-2 pl-4">{meta.label} (x{item.quantity}){issue && <span className="text-red-600 font-bold ml-2">({issue.status.replace(/_/g, ' ')})</span>}</td>
                                        <td className="text-right py-2">${(meta.price * item.quantity).toFixed(2)}</td>
                                    </tr>
                                )
                            })}
                            {mattressDisposalCount > 0 && <tr className="border-b"><td className="py-2 pl-4">Mattress Disposal (x{mattressDisposalCount})</td><td className="text-right py-2">${(25 * mattressDisposalCount).toFixed(2)}</td></tr>}
                            {tvDisposalCount > 0 && <tr className="border-b"><td className="py-2 pl-4">TV Disposal (x{tvDisposalCount})</td><td className="text-right py-2">${(15 * tvDisposalCount).toFixed(2)}</td></tr>}
                            {applianceDisposalCount > 0 && <tr className="border-b"><td className="py-2 pl-4">Appliance Disposal (x{applianceDisposalCount})</td><td className="text-right py-2">${(35 * applianceDisposalCount).toFixed(2)}</td></tr>}
                        </tbody>
                        <tfoot>
                            {discountAmount > 0 && !isCancelledAndRefunded && (
                                <tr><td className="text-right font-bold pt-3" colSpan="1">Subtotal:</td><td className="text-right font-bold pt-3">${subtotal.toFixed(2)}</td></tr>
                            )}
                            {discountAmount > 0 && !isCancelledAndRefunded && (
                                <tr><td className="text-right font-bold text-green-600" colSpan="1">Coupon Discount ({coupon.code}):</td><td className="text-right font-bold text-green-600">- ${discountAmount.toFixed(2)}</td></tr>
                            )}
                            {!isCancelledAndRefunded ? (
                                <tr><td className="text-right font-bold py-3" colSpan="1">Grand Total:</td><td className="text-right font-bold py-3">${calculatedTotal.toFixed(2)}</td></tr>
                            ) : (
                                <>
                                    <tr><td className="text-right font-bold pt-3" colSpan="1">Original Total:</td><td className="text-right font-bold pt-3">${calculatedTotal.toFixed(2)}</td></tr>
                                    <tr><td className="text-right font-bold" colSpan="1">Cancellation Fee:</td><td className="text-right font-bold text-red-600">- ${(calculatedTotal - (refund_details.amount || 0)).toFixed(2)}</td></tr>
                                    <tr><td className="text-right font-bold py-3 border-t" colSpan="1">Amount Refunded:</td><td className="text-right font-bold py-3 border-t text-green-600">${(refund_details.amount || 0).toFixed(2)}</td></tr>
                                </>
                            )}
                        </tfoot>
                    </table>
                    {hasReturnIssues && (
                        <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-md">
                            <h4 className="font-bold text-lg mb-2 text-red-800 flex items-center"><AlertTriangle className="mr-2 h-5 w-5"/> Post-Rental Issues</h4>
                            <ul className="list-disc list-inside text-red-700">
                                {Object.entries(return_issues).map(([key, value]) => <li key={key} className="capitalize">{key.replace(/_/g, ' ')}: {value.status.replace(/_/g, ' ')}</li>)}
                            </ul>
                        </div>
                    )}
                </section>
                {addons.notes && (
                    <section className="mt-6" style={{ pageBreakInside: 'avoid' }}>
                        <h3 className="font-bold text-lg mb-2 border-b pb-2">Customer Notes</h3>
                        <p className="text-gray-700 italic">"{addons.notes}"</p>
                    </section>
                )}
            </div>
            
            <footer className="text-xs text-gray-500 pt-4 mt-6" style={{ pageBreakInside: 'avoid' }}>
                <h3 className="font-bold text-sm mb-2 border-t pt-4">Disclaimers & Acknowledgements</h3>
                {was_verification_skipped && <p className="mb-2 font-bold text-orange-700"><strong>Incomplete Verification:</strong> Customer acknowledges that by not providing a valid driver's license and/or license plate of the towing vehicle, this booking is subject to manual review. This may result in delays or cancellation. If cancelled due to failure to verify, applicable cancellation fees will be deducted from any refund as per the rental agreement.</p>}
                {addons.insurance === 'decline' && <p className="mb-2"><strong>Insurance Declined:</strong> Customer acknowledges and agrees they are fully responsible for any and all damages that may occur to the rental unit, trailer, and all its components during the rental period.</p>}
                {(currentPlan.id === 1 || isDelivery) && addons.drivewayProtection === 'decline' && <p className="mb-2"><strong>Driveway Protection Declined:</strong> Customer assumes full liability for any damage, including but not limited to scratches, cracks, or stains, that may occur to the driveway or any other property surface during delivery and pickup.</p>}
                {addons.addressVerificationSkipped && <p className="mb-2"><strong>Address Verification Skipped:</strong> Customer has proceeded with an unverified address and assumes all risks and associated costs resulting from potential delays or cancellation due to an inaccurate or unserviceable address.</p>}
                 <AgreementText booking={booking} />
                 <p className="text-center mt-4 pt-4 border-t">Thank you for your business! | U-Fill Dumpsters</p>
            </footer>
        </div>
    );
});