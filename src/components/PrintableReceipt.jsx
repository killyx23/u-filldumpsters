import React from 'react';
import { format, parseISO } from 'date-fns';

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

    const { customers, plan, drop_off_date, pickup_date, total_price, drop_off_time_slot, pickup_time_slot, addons } = booking;
    const { name, email, phone, street, city, state, zip } = customers;

    const fullAddress = `${street}, ${city}, ${state} ${zip}`;

    return (
        <div ref={ref} className="p-8 font-sans text-gray-800 bg-white">
            <header className="flex justify-between items-center pb-4 border-b">
                <div>
                    <h1 className="text-3xl font-bold text-blue-800">U-Fill Dumpsters</h1>
                    <p>Saratoga Springs, Utah</p>
                </div>
                <h2 className="text-2xl font-semibold">Booking Receipt</h2>
            </header>
            <section className="grid grid-cols-2 gap-8 my-6">
                <div>
                    <h3 className="font-bold text-lg mb-2">Billed To:</h3>
                    <p>{name}</p>
                    <p>{fullAddress}</p>
                    <p>{email}</p>
                    <p>{phone}</p>
                </div>
                <div className="text-right">
                    <p><span className="font-bold">Booking ID:</span> {booking.id}</p>
                    <p><span className="font-bold">Payment Date:</span> {format(parseISO(booking.created_at), 'PPP')}</p>
                </div>
            </section>
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
                        {addons.insurance === 'accept' && (
                             <tr className="border-b"><td className="py-2 pl-4">Rental Insurance</td><td className="text-right py-2">${addonPrices.insurance.toFixed(2)}</td></tr>
                        )}
                        {addons.drivewayProtection === 'accept' && (
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
                        <tr>
                            <td className="text-right font-bold py-3" colSpan="1">Grand Total:</td>
                            <td className="text-right font-bold py-3">${total_price.toFixed(2)}</td>
                        </tr>
                    </tfoot>
                </table>
            </section>
             {addons.notes && (
                <section className="mt-6">
                    <h3 className="font-bold text-lg mb-2 border-b pb-2">Customer Notes</h3>
                    <p className="text-gray-700 italic">"{addons.notes}"</p>
                </section>
            )}
             <footer className="text-xs text-gray-500 pt-4 mt-4 border-t">
                <h3 className="font-bold text-sm mb-2">Disclaimers & Acknowledgements</h3>
                 {addons.insurance === 'decline' && (
                    <p className="mb-2"><strong>Insurance Declined:</strong> Customer acknowledges and agrees they are fully responsible for any and all damages that may occur to the rental unit, trailer, and all its components during the rental period.</p>
                )}
                {addons.drivewayProtection === 'decline' && (
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