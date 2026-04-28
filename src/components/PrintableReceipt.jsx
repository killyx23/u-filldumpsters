
import React, { useState, useEffect } from 'react';
import { format, parseISO, isValid, differenceInDays } from 'date-fns';
import { Key, Repeat, FileSignature, ShieldCheck } from 'lucide-react';
import { getPriceForEquipment } from '@/utils/equipmentPricingIntegration';
import { isValidEquipmentId } from '@/utils/equipmentIdValidator';
import { formatTimeWindow, shouldShowTimeWindow, isSelfServiceTrailer } from '@/utils/timeWindowFormatter';
import { calculateTaxAmount } from '@/utils/calculateTaxAmount';

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
    const [equipmentPrices, setEquipmentPrices] = useState({});
    const [loading, setLoading] = useState(true);

    // Load equipment prices from database
    useEffect(() => {
        const loadPrices = async () => {
            const prices = {};
            try {
                // Load all equipment prices (IDs 1-7)
                for (let id = 1; id <= 7; id++) {
                    if (isValidEquipmentId(id)) {
                        prices[id] = await getPriceForEquipment(id);
                    }
                }
                setEquipmentPrices(prices);
            } catch (error) {
                console.error('[PrintableReceipt] Error loading prices:', error);
            } finally {
                setLoading(false);
            }
        };

        if (booking) {
            loadPrices();
        }
    }, [booking]);
    
    if (!booking || !booking.customers || !booking.plan || loading) {
        return <div className="p-8">Loading receipt...</div>;
    }

    const { customers, plan, drop_off_date, pickup_date, drop_off_time_slot, pickup_time_slot, addons, refund_details, status: bookingStatus, was_verification_skipped, reschedule_history, return_issues } = booking;
    const { name, first_name, last_name, email, phone, street, city, state, zip, customer_id_text } = customers;
    const isDelivery = addons?.deliveryService || addons?.isDelivery;
    const coupon = addons?.coupon;
    
    const currentPlan = addons?.plan || plan;
    const serviceName = currentPlan.name;

    // Time window formatting options
    const showTimeWindow = shouldShowTimeWindow(currentPlan, isDelivery);
    const isSelfService = isSelfServiceTrailer(currentPlan, isDelivery);
    const timeOptions = {
        isWindow: showTimeWindow,
        isSelfService: isSelfService,
        serviceType: currentPlan?.service_type
    };

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

    // Calculate base service price
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

    // Protection costs
    const insuranceCost = addons.insurance === 'accept' ? Number(equipmentPrices[7] || 20) : 0;
    const drivewayProtectionCost = ((currentPlan.id === 1 || isDelivery) && addons.drivewayProtection === 'accept') ? 15 : 0;

    // Equipment costs
    let rentEquipmentCost = 0;
    let purchaseItemsCost = 0;
    const equipmentBreakdown = [];

    if (addons.equipment && Array.isArray(addons.equipment)) {
        addons.equipment.forEach(item => {
            const equipmentId = item.equipment_id || item.dbId || item.id;
            if (!equipmentId || !isValidEquipmentId(equipmentId)) return;

            const price = Number(equipmentPrices[equipmentId] || 0);
            const quantity = Number(item.quantity || 1);
            const itemTotal = price * quantity;
            
            let itemName = `Equipment #${equipmentId}`;
            if (equipmentId === 1) itemName = 'Wheelbarrow';
            else if (equipmentId === 2) itemName = 'Hand Truck';
            else if (equipmentId === 3) itemName = 'Working Gloves (Pair)';

            equipmentBreakdown.push({
                id: equipmentId,
                name: itemName,
                quantity,
                price,
                total: itemTotal,
                isPurchase: equipmentId === 3
            });

            if (equipmentId === 3) {
                purchaseItemsCost += itemTotal;
            } else {
                rentEquipmentCost += itemTotal;
            }
        });
    }

    // Disposal costs
    const mattressCount = addons.mattressDisposal || 0;
    const tvCount = addons.tvDisposal || 0;
    const applianceCount = addons.applianceDisposal || 0;

    const mattressCost = mattressCount > 0 ? Number(equipmentPrices[4] || 25) * mattressCount : 0;
    const tvCost = tvCount > 0 ? Number(equipmentPrices[5] || 15) * tvCount : 0;
    const applianceCost = applianceCount > 0 ? Number(equipmentPrices[6] || 35) * applianceCount : 0;
    const disposalCost = mattressCost + tvCost + applianceCost;

    // Subtotal before discount
    const subtotalBeforeDiscount = baseServicePrice + deliveryChargeFlat + tripMileageCost + 
                                    insuranceCost + drivewayProtectionCost + 
                                    rentEquipmentCost + purchaseItemsCost + disposalCost;

    // Discount
    let discountAmount = 0;
    if (coupon && coupon.isValid) {
        if (coupon.discountType === 'fixed') {
            discountAmount = Number(coupon.discountValue || 0);
        } else if (coupon.discountType === 'percentage') {
            discountAmount = (subtotalBeforeDiscount * Number(coupon.discountValue || 0)) / 100;
        }
    }

    const subtotal = Math.max(0, subtotalBeforeDiscount - discountAmount);
    
    // Use tax rate from booking record if available, otherwise calculate
    const taxRateUsed = booking.tax_rate_used || 7.45;
    const taxAmount = booking.tax_amount || calculateTaxAmount(subtotal, taxRateUsed);
    const calculatedTotal = subtotal + taxAmount;

    const hasReturnIssues = return_issues && Object.keys(return_issues).length > 0;
    const freeMiles = currentPlan.id === 1 ? 30 : 0;
    const totalMiles = addons.distanceInfo?.miles || addons.distanceInfo?.roundTripMiles || addons.deliveryDistance || 0;
    const isDeliveryServiceForFees = currentPlan.id === 1 || currentPlan.id === 4 || (currentPlan.id === 2 && isDelivery);

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

                {isSelfService && !isCancelledAndRefunded && (
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
                    <h3 className="font-bold text-lg mb-4 border-b pb-2">Price Breakdown</h3>
                    
                    {/* Service Details */}
                    <div className="mb-4 p-3 bg-gray-50 rounded">
                        <p className="font-semibold text-lg">{serviceName}</p>
                        {reschedule_history && reschedule_history.length > 0 && (
                            <div className="text-xs text-gray-500 mt-1 p-2 bg-gray-100 rounded">
                                <p className="font-bold">Original Dates:</p>
                                <p>Drop-off: {format(parseISO(reschedule_history[0].from_drop_off_date), 'MMM d, yyyy')} - {formatTimeWindow(reschedule_history[0].from_drop_off_time, timeOptions)}</p>
                                <p>Pickup: {format(parseISO(reschedule_history[0].from_pickup_date), 'MMM d, yyyy')} - {formatTimeWindow(reschedule_history[0].from_pickup_time, timeOptions)}</p>
                            </div>
                        )}
                        <p className="text-sm text-gray-600 mt-1">{showTimeWindow ? "Delivery" : "Pickup"}: {isPendingReview ? pendingReason : `${format(parseISO(drop_off_date), 'MMM d, yyyy')} - ${formatTimeWindow(drop_off_time_slot, timeOptions)}`}</p>
                        {currentPlan.id !== 3 && <p className="text-sm text-gray-600">{isSelfService ? "Return" : "Pickup"}: {isPendingReview ? pendingReason : `${format(parseISO(pickup_date), 'MMM d, yyyy')} - ${formatTimeWindow(pickup_time_slot, timeOptions)}`}</p>}
                    </div>

                    {/* 8-Category Breakdown */}
                    <table className="w-full text-sm mb-4">
                        <tbody>
                            {/* 1. Service Costs */}
                            {baseServicePrice > 0 && (
                                <>
                                    <tr className="bg-blue-50">
                                        <td colSpan="2" className="py-2 px-3 font-bold">📦 Service Costs</td>
                                    </tr>
                                    <tr className="border-b">
                                        <td className="py-1 px-6">Base Rental ({duration} {duration === 1 ? 'day' : 'days'})</td>
                                        <td className="text-right py-1 pr-3">${baseServicePrice.toFixed(2)}</td>
                                    </tr>
                                </>
                            )}
                            
                            {deliveryChargeFlat > 0 && (
                                <tr className="border-b">
                                    <td className="py-1 px-6">Base Delivery Fee</td>
                                    <td className="text-right py-1 pr-3">${deliveryChargeFlat.toFixed(2)}</td>
                                </tr>
                            )}
                            
                            {tripMileageCost > 0 && (
                                <tr className="border-b">
                                    <td className="py-1 px-6">Mileage Charge ({totalMiles.toFixed(2)} miles{freeMiles > 0 ? `, ${freeMiles} free` : ''})</td>
                                    <td className="text-right py-1 pr-3">${tripMileageCost.toFixed(2)}</td>
                                </tr>
                            )}

                            {/* 2. Protection Options */}
                            {(insuranceCost > 0 || drivewayProtectionCost > 0) && (
                                <>
                                    <tr className="bg-blue-50">
                                        <td colSpan="2" className="py-2 px-3 font-bold">🛡️ Protection Options</td>
                                    </tr>
                                    {insuranceCost > 0 && (
                                        <tr className="border-b">
                                            <td className="py-1 px-6">Rental Insurance</td>
                                            <td className="text-right py-1 pr-3">${insuranceCost.toFixed(2)}</td>
                                        </tr>
                                    )}
                                    {drivewayProtectionCost > 0 && (
                                        <tr className="border-b">
                                            <td className="py-1 px-6">Driveway Protection</td>
                                            <td className="text-right py-1 pr-3">${drivewayProtectionCost.toFixed(2)}</td>
                                        </tr>
                                    )}
                                </>
                            )}

                            {/* 3. Rent Equipment */}
                            {equipmentBreakdown.filter(e => !e.isPurchase).length > 0 && (
                                <>
                                    <tr className="bg-blue-50">
                                        <td colSpan="2" className="py-2 px-3 font-bold">🚚 Rent Equipment</td>
                                    </tr>
                                    {equipmentBreakdown.filter(e => !e.isPurchase).map((item, idx) => {
                                        const issue = return_issues ? return_issues[item.name] : null;
                                        return (
                                            <tr key={idx} className="border-b">
                                                <td className="py-1 px-6">
                                                    {item.name} (x{item.quantity})
                                                    {issue && <span className="text-red-600 font-bold ml-2">({issue.status.replace(/_/g, ' ')})</span>}
                                                </td>
                                                <td className="text-right py-1 pr-3">${item.total.toFixed(2)}</td>
                                            </tr>
                                        );
                                    })}
                                </>
                            )}

                            {/* 4. Items for Purchase */}
                            {equipmentBreakdown.filter(e => e.isPurchase).length > 0 && (
                                <>
                                    <tr className="bg-blue-50">
                                        <td colSpan="2" className="py-2 px-3 font-bold">🛒 Items for Purchase</td>
                                    </tr>
                                    {equipmentBreakdown.filter(e => e.isPurchase).map((item, idx) => (
                                        <tr key={idx} className="border-b">
                                            <td className="py-1 px-6">{item.name} (x{item.quantity})</td>
                                            <td className="text-right py-1 pr-3">${item.total.toFixed(2)}</td>
                                        </tr>
                                    ))}
                                </>
                            )}

                            {/* 5. Disposal Items */}
                            {(mattressCount > 0 || tvCount > 0 || applianceCount > 0) && (
                                <>
                                    <tr className="bg-blue-50">
                                        <td colSpan="2" className="py-2 px-3 font-bold">♻️ Disposal Items</td>
                                    </tr>
                                    {mattressCount > 0 && (
                                        <tr className="border-b">
                                            <td className="py-1 px-6">Mattress Disposal (x{mattressCount})</td>
                                            <td className="text-right py-1 pr-3">${mattressCost.toFixed(2)}</td>
                                        </tr>
                                    )}
                                    {tvCount > 0 && (
                                        <tr className="border-b">
                                            <td className="py-1 px-6">TV Disposal (x{tvCount})</td>
                                            <td className="text-right py-1 pr-3">${tvCost.toFixed(2)}</td>
                                        </tr>
                                    )}
                                    {applianceCount > 0 && (
                                        <tr className="border-b">
                                            <td className="py-1 px-6">Appliance Disposal (x{applianceCount})</td>
                                            <td className="text-right py-1 pr-3">${applianceCost.toFixed(2)}</td>
                                        </tr>
                                    )}
                                </>
                            )}

                            {/* 6. Discounts */}
                            {discountAmount > 0 && !isCancelledAndRefunded && (
                                <>
                                    <tr className="bg-green-50">
                                        <td colSpan="2" className="py-2 px-3 font-bold text-green-700">🏷️ Discounts</td>
                                    </tr>
                                    <tr className="border-b">
                                        <td className="py-1 px-6 text-green-700">Coupon ({coupon.code})</td>
                                        <td className="text-right py-1 pr-3 text-green-700 font-semibold">-${discountAmount.toFixed(2)}</td>
                                    </tr>
                                </>
                            )}

                            {/* 7. Totals */}
                            <tr className="border-t-2 border-gray-400">
                                <td className="py-2 px-3 font-bold">Subtotal</td>
                                <td className="text-right py-2 pr-3 font-bold">${subtotal.toFixed(2)}</td>
                            </tr>
                            <tr>
                                <td className="py-1 px-3 font-semibold">Tax ({taxRateUsed.toFixed(2)}%)</td>
                                <td className="text-right py-1 pr-3 font-semibold">${taxAmount.toFixed(2)}</td>
                            </tr>
                            <tr className="border-t-2 border-gray-400 bg-gray-100">
                                <td className="py-2 px-3 font-bold text-lg">Total</td>
                                <td className="text-right py-2 pr-3 font-bold text-lg text-green-600">${calculatedTotal.toFixed(2)}</td>
                            </tr>

                            {isCancelledAndRefunded && (
                                <>
                                    <tr className="border-t">
                                        <td className="py-1 px-3">Cancellation Fee</td>
                                        <td className="text-right py-1 pr-3 text-red-600">-${(calculatedTotal - (refund_details.amount || 0)).toFixed(2)}</td>
                                    </tr>
                                    <tr className="bg-green-50">
                                        <td className="py-2 px-3 font-bold">Amount Refunded</td>
                                        <td className="text-right py-2 pr-3 font-bold text-green-600">${(refund_details.amount || 0).toFixed(2)}</td>
                                    </tr>
                                </>
                            )}
                        </tbody>
                    </table>

                    {/* 8. Landfill/Disposal Fees */}
                    {isDeliveryServiceForFees && !isCancelledAndRefunded && (
                        <div className="mt-4 p-3 bg-yellow-50 border border-yellow-300 rounded">
                            <p className="font-bold text-sm">🏗️ Landfill/Disposal Fees (TBD)</p>
                            <p className="text-xs text-gray-700 mt-1">Pending dump fees will be calculated based on actual waste processed and charged separately.</p>
                        </div>
                    )}

                    {hasReturnIssues && (
                        <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-md">
                            <h4 className="font-bold text-lg mb-2 text-red-800 flex items-center">Post-Rental Issues</h4>
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
