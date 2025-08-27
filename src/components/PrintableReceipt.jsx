import React from 'react';
import { format, parseISO } from 'date-fns';
import { Key } from 'lucide-react';

const formatTime = (timeString) => {
    if (!timeString) return 'N/A';
    try {
        const date = new Date(`1970-01-01T${timeString}`);
        return format(date, 'h:mm a');
    } catch (e) {
        return 'N/A';
    }
};

const addonPrices = {
  insurance: 15,
  drivewayProtection: 10,
  equipment: {
    wheelbarrow: 20,
    handTruck: 15,
    gloves: 5,
  },
};

const equipmentMeta = [
  { id: 'wheelbarrow', label: 'Wheelbarrow', price: addonPrices.equipment.wheelbarrow },
  { id: 'handTruck', label: 'Hand Truck', price: addonPrices.equipment.handTruck },
  { id: 'gloves', label: 'Working Gloves (Pair)', price: addonPrices.equipment.gloves },
];


export const PrintableReceipt = React.forwardRef(({ booking }, ref) => {
    if (!booking || !booking.customers) return null;

    const { customers, plan, drop_off_date, pickup_date, total_price, drop_off_time_slot, pickup_time_slot, addons, refund_details, status: bookingStatus, was_verification_skipped } = booking;
    const { name, email, phone, street, city, state, zip, customer_id_text } = customers;

    const fullAddress = `${street}, ${city}, ${state} ${zip}`;

    const isCancelledAndRefunded = bookingStatus === 'Cancelled' && refund_details;
    const isPendingReview = bookingStatus === 'pending_review' || bookingStatus === 'pending_verification';

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
                        <p>{name}</p>
                        <p>{plan.id !== 2 ? fullAddress : "N/A (Trailer Rental)"}</p>
                        <p>{email}</p>
                        <p>{phone}</p>
                    </div>
                    <div className="text-right">
                        <p><span className="font-bold">Booking ID:</span> {booking.id}</p>
                        <p><span className="font-bold">Payment Date:</span> {format(parseISO(booking.created_at), 'PPP')}</p>
                        {isCancelledAndRefunded && (
                            <p className="text-red-600"><span className="font-bold">Refund Date:</span> {format(parseISO(refund_details.created_at), 'PPP')}</p>
                        )}
                        {isPendingReview && <p className="font-bold text-orange-600">Status: Pending Manual Review</p>}
                    </div>
                </section>
                
                <section className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-md" style={{ pageBreakInside: 'avoid' }}>
                    <h3 className="font-bold text-lg mb-2 text-yellow-800 flex items-center">
                        <Key className="mr-2 h-5 w-5"/> Customer Portal Login Information
                    </h3>
                    <p className="text-sm">Use the following credentials to access the Customer Portal to view your booking status, add notes, or upload files.</p>
                    <p className="mt-2"><strong>Customer ID:</strong> <span className="font-mono bg-gray-200 p-1 rounded">{customer_id_text}</span></p>
                    <p><strong>Phone Number:</strong> <span className="font-mono bg-gray-200 p-1 rounded">{phone}</span></p>
                </section>

                {plan.id === 2 && !isCancelledAndRefunded && !isPendingReview && (
                    <section className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-md" style={{ pageBreakInside: 'avoid' }}>
                        <h3 className="font-bold text-lg mb-2 text-blue-800">Dump Loader Trailer Rental Instructions</h3>
                        <div className="text-sm text-gray-700 space-y-2">
                            <p><strong>Pickup Location:</strong> Your rental trailer is scheduled for pickup at <span className="font-semibold">227 W. Casi Way, Saratoga Springs, UT 84045.</span></p>
                            <p><strong>Pickup & Return Times:</strong> The rental is available for pickup starting at <span className="font-semibold">8:00 a.m.</span> on your scheduled pickup date. The trailer must be returned to the same location no later than <span className="font-semibold">10:00 p.m.</span> on the designated return date.</p>
                            <p><strong>Cleaning Requirement:</strong> To ensure a smooth process for all our customers, the trailer must be returned clean and free of debris. Failure to do so may result in the assessment of cleaning fines. Thank you for your cooperation and your rental.</p>
                        </div>
                    </section>
                )}

                <section>
                    <h3 className="font-bold text-lg mb-2 border-b pb-2">Order Summary</h3>
                    <table className="w-full">
                        <thead>
                            <tr className="border-b">
                                <th className="text-left py-2">Item</th>
                                <th className="text-right py-2">Total</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr className="border-b">
                                <td className="py-2">
                                    <p className="font-semibold">{plan.name}</p>
                                    <p className="text-sm text-gray-600">
                                        {plan.id === 2 ? "Pickup" : "Drop-off"}: {format(parseISO(drop_off_date), 'MMM d, yyyy')} at {formatTime(drop_off_time_slot)}
                                    </p>
                                    <p className="text-sm text-gray-600">
                                        {plan.id === 2 ? "Return" : "Pickup"}: {format(parseISO(pickup_date), 'MMM d, yyyy')} by {formatTime(pickup_time_slot)}
                                    </p>
                                </td>
                                <td className="text-right py-2 align-top">${booking.plan.price.toFixed(2)}</td>
                            </tr>
                            {addons.distanceInfo?.fee > 0 && (
                                <tr className="border-b"><td className="py-2 pl-4">{`Extended Delivery Fee (${addons.distanceInfo.miles.toFixed(1)} miles)`}</td><td className="text-right py-2">${addons.distanceInfo.fee.toFixed(2)}</td></tr>
                            )}
                            {addons.insurance === 'accept' && (
                                <tr className="border-b"><td className="py-2 pl-4">Rental Insurance</td><td className="text-right py-2">${addonPrices.insurance.toFixed(2)}</td></tr>
                            )}
                            {plan.id !== 2 && addons.drivewayProtection === 'accept' && (
                                <tr className="border-b"><td className="py-2 pl-4">Driveway Protection</td><td className="text-right py-2">${addonPrices.drivewayProtection.toFixed(2)}</td></tr>
                            )}
                            {addons.equipment && addons.equipment.map(item => {
                                const meta = equipmentMeta.find(e => e.id === item.id);
                                if (!meta) return null;
                                return (
                                    <tr key={item.id} className="border-b">
                                        <td className="py-2 pl-4">{meta.label} (x{item.quantity})</td>
                                        <td className="text-right py-2">${(meta.price * item.quantity).toFixed(2)}</td>
                                    </tr>
                                )
                            })}
                        </tbody>
                        <tfoot>
                            {!isCancelledAndRefunded ? (
                                <tr>
                                    <td className="text-right font-bold py-3" colSpan="1">Grand Total:</td>
                                    <td className="text-right font-bold py-3">${total_price.toFixed(2)}</td>
                                </tr>
                            ) : (
                                <>
                                    <tr>
                                        <td className="text-right font-bold pt-3" colSpan="1">Original Total:</td>
                                        <td className="text-right font-bold pt-3">${total_price.toFixed(2)}</td>
                                    </tr>
                                    <tr>
                                        <td className="text-right font-bold" colSpan="1">Cancellation Fee:</td>
                                        <td className="text-right font-bold text-red-600">- ${(total_price - refund_details.amount).toFixed(2)}</td>
                                    </tr>
                                    <tr>
                                        <td className="text-right font-bold py-3 border-t" colSpan="1">Amount Refunded:</td>
                                        <td className="text-right font-bold py-3 border-t text-green-600">${refund_details.amount.toFixed(2)}</td>
                                    </tr>
                                </>
                            )}
                        </tfoot>
                    </table>
                </section>
                {addons.notes && (
                    <section className="mt-6" style={{ pageBreakInside: 'avoid' }}>
                        <h3 className="font-bold text-lg mb-2 border-b pb-2">Customer Notes</h3>
                        <p className="text-gray-700 italic">"{addons.notes}"</p>
                    </section>
                )}
            </div>
            
            <footer className="text-xs text-gray-500 pt-4 mt-6 border-t" style={{ pageBreakInside: 'avoid' }}>
                <h3 className="font-bold text-sm mb-2">Disclaimers & Acknowledgements</h3>
                {was_verification_skipped && (
                    <p className="mb-2 font-bold text-orange-700"><strong>Incomplete Verification:</strong> Customer acknowledges that by not providing a valid driver's license and/or license plate of the towing vehicle, this booking is subject to manual review. This may result in delays or cancellation. If cancelled due to failure to verify, applicable cancellation fees will be deducted from any refund as per the rental agreement.</p>
                )}
                {addons.insurance === 'decline' && (
                    <p className="mb-2"><strong>Insurance Declined:</strong> Customer acknowledges and agrees they are fully responsible for any and all damages that may occur to the rental unit, trailer, and all its components during the rental period.</p>
                )}
                {plan.id !== 2 && addons.drivewayProtection === 'decline' && (
                    <p className="mb-2"><strong>Driveway Protection Declined:</strong> Customer assumes full liability for any damage, including but not limited to scratches, cracks, or stains, that may occur to the driveway or any other property surface during delivery and pickup.</p>
                )}
                {addons.addressVerificationSkipped && (
                     <p className="mb-2"><strong>Address Verification Skipped:</strong> Customer has proceeded with an unverified address and assumes all risks and associated costs resulting from potential delays or cancellation due to an inaccurate or unserviceable address.</p>
                )}
                 <p className="text-center mt-4">Thank you for your business! | U-Fill Dumpsters</p>
            </footer>
        </div>
    );
});