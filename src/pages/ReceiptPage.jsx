import React, { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { supabase } from '@/lib/customSupabaseClient';
import { Loader2, XCircle, Home, Receipt, AlertTriangle, Download, Package, Truck, Wrench } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Helmet } from 'react-helmet';
import { getDumpFeeForService } from '@/utils/getDumpFeeForService';
import { calculateRoundTripDistance, getBusinessAddress } from '@/utils/distanceCalculationHelper';

const LANDFILL_ADDRESS = "800 S Allen Ranch Rd, Fairfield, UT 84013";

const ReceiptPage = () => {
    const [searchParams] = useSearchParams();
    const [status, setStatus] = useState('loading');
    const [error, setError] = useState('');
    const [bookingData, setBookingData] = useState(null);
    const [dumpFeeInfo, setDumpFeeInfo] = useState(null);
    const [receiptDetails, setReceiptDetails] = useState(null);
    const [calculatingMileage, setCalculatingMileage] = useState(true);

    useEffect(() => {
        const bookingId = searchParams.get('bookingId');

        if (!bookingId) {
            setStatus('error');
            setError('No booking ID provided. Please check the link and try again.');
            return;
        }

        const fetchDetailsAndCalculate = async () => {
            try {
                // Fetch complete booking data with all fields
                const { data: booking, error: bError } = await supabase
                    .from('bookings')
                    .select('*, customers(*)')
                    .eq('id', bookingId)
                    .single();

                if (bError) throw new Error('Could not fetch booking details.');
                if (!booking) throw new Error('Booking not found.');

                setBookingData(booking);

                // Extract service information
                let resolvedServiceId = null;
                let serviceName = 'Service';
                let basePrice = 0;
                let deliveryFee = 0;
                let mileageRate = 0.85; // Default rate

                if (booking.plan) {
                    if (booking.plan.service_id) {
                        resolvedServiceId = booking.plan.service_id;
                    } else if (booking.plan.id) {
                        resolvedServiceId = booking.plan.id;
                    }
                    serviceName = booking.plan.name || booking.plan.title || 'Service';
                    basePrice = parseFloat(booking.plan.price || booking.plan.base_price || 0);
                    deliveryFee = parseFloat(booking.plan.delivery_fee || 0);
                    mileageRate = parseFloat(booking.plan.mileage_rate || 0.85);
                }

                // Check for delivery service upgrade
                if (booking.addons?.deliveryService && resolvedServiceId === 2) {
                    resolvedServiceId = 4;
                }

                // Fetch dump fee info
                if (resolvedServiceId) {
                    const df = await getDumpFeeForService(resolvedServiceId);
                    if (df) setDumpFeeInfo(df);
                }

                // Parse ALL add-ons from the addons JSONB field
                const equipmentAddons = [];
                const disposalAddons = [];
                let insuranceAddon = null;

                if (booking.addons && typeof booking.addons === 'object') {
                    Object.entries(booking.addons).forEach(([key, value]) => {
                        const keyLower = key.toLowerCase();
                        
                        // Skip metadata fields
                        if (keyLower.includes('delivery') || 
                            keyLower.includes('verification') || 
                            keyLower.includes('address') ||
                            keyLower.includes('pending')) {
                            return;
                        }

                        // Parse value - could be object {price: X, quantity: Y} or just a number
                        let itemName = key;
                        let itemPrice = 0;
                        let itemQuantity = 1;

                        if (typeof value === 'object' && value !== null) {
                            itemName = value.name || key;
                            itemPrice = parseFloat(value.price || value.unit_price || 0);
                            itemQuantity = parseInt(value.quantity || 1);
                        } else {
                            itemPrice = parseFloat(value || 0);
                        }

                        // Categorize the addon
                        if (keyLower.includes('insurance')) {
                            insuranceAddon = {
                                name: itemName,
                                quantity: itemQuantity,
                                unitPrice: itemPrice,
                                total: itemPrice * itemQuantity
                            };
                        } else if (keyLower.includes('disposal')) {
                            disposalAddons.push({
                                name: itemName,
                                quantity: itemQuantity,
                                unitPrice: itemPrice,
                                total: itemPrice * itemQuantity
                            });
                        } else if (keyLower.includes('truck') || 
                                   keyLower.includes('gloves') || 
                                   keyLower.includes('cart') ||
                                   keyLower.includes('equipment')) {
                            equipmentAddons.push({
                                name: itemName,
                                quantity: itemQuantity,
                                unitPrice: itemPrice,
                                total: itemPrice * itemQuantity
                            });
                        } else {
                            // Default to equipment
                            equipmentAddons.push({
                                name: itemName,
                                quantity: itemQuantity,
                                unitPrice: itemPrice,
                                total: itemPrice * itemQuantity
                            });
                        }
                    });
                }

                // Also check booking_equipment table for additional items
                const { data: bookingEquipment } = await supabase
                    .from('booking_equipment')
                    .select('*, equipment(*)')
                    .eq('booking_id', bookingId);

                if (bookingEquipment && bookingEquipment.length > 0) {
                    bookingEquipment.forEach(be => {
                        const equipName = be.equipment?.name || 'Equipment Item';
                        const equipPrice = parseFloat(be.equipment?.price || 0);
                        const equipQty = parseInt(be.quantity || 1);

                        // Check if already added from addons
                        const alreadyExists = equipmentAddons.some(e => 
                            e.name.toLowerCase() === equipName.toLowerCase()
                        ) || disposalAddons.some(d => 
                            d.name.toLowerCase() === equipName.toLowerCase()
                        );

                        if (!alreadyExists) {
                            if (equipName.toLowerCase().includes('disposal')) {
                                disposalAddons.push({
                                    name: equipName,
                                    quantity: equipQty,
                                    unitPrice: equipPrice,
                                    total: equipPrice * equipQty
                                });
                            } else {
                                equipmentAddons.push({
                                    name: equipName,
                                    quantity: equipQty,
                                    unitPrice: equipPrice,
                                    total: equipPrice * equipQty
                                });
                            }
                        }
                    });
                }

                // Calculate total add-ons cost
                const equipmentTotal = equipmentAddons.reduce((sum, item) => sum + item.total, 0);
                const disposalTotal = disposalAddons.reduce((sum, item) => sum + item.total, 0);
                const insuranceTotal = insuranceAddon ? insuranceAddon.total : 0;
                const addonsTotal = equipmentTotal + disposalTotal + insuranceTotal;

                // Calculate 3-point mileage route
                setCalculatingMileage(true);
                let totalMiles = 0;
                let mileageCharge = 0;
                let mileageExplanation = '';

                try {
                    // Get customer delivery address
                    const deliveryAddr = booking.delivery_address;
                    const customerAddress = deliveryAddr?.formatted_address || 
                        `${deliveryAddr?.street || booking.street}, ${deliveryAddr?.city || booking.city}, ${deliveryAddr?.state || booking.state} ${deliveryAddr?.zip || booking.zip}`;

                    // Calculate complete round-trip: Business → Customer → Landfill → Business
                    totalMiles = await calculateRoundTripDistance(customerAddress);
                    mileageCharge = totalMiles * mileageRate;
                    mileageExplanation = `Complete route includes delivery to customer, drop-off at landfill, return to business`;

                    console.log(`[Receipt] 3-Point Route Calculation: ${totalMiles} miles × $${mileageRate}/mile = $${mileageCharge.toFixed(2)}`);
                } catch (err) {
                    console.error('[Receipt] Mileage calculation failed:', err);
                    // Fallback to stored distance if available
                    if (booking.customers?.distance_miles) {
                        totalMiles = parseFloat(booking.customers.distance_miles);
                        mileageCharge = totalMiles * mileageRate;
                        mileageExplanation = 'Based on stored distance (route calculation unavailable)';
                    }
                }
                setCalculatingMileage(false);

                // Calculate totals
                const subtotal = basePrice + deliveryFee + mileageCharge + addonsTotal;
                const tax = subtotal * 0.07;
                const total = subtotal + tax;

                setReceiptDetails({
                    bookingId: booking.id,
                    customerName: `${booking.first_name || ''} ${booking.last_name || ''}`.trim() || booking.name,
                    customerEmail: booking.email,
                    serviceName,
                    basePrice,
                    deliveryFee,
                    mileage: {
                        totalMiles,
                        rate: mileageRate,
                        charge: mileageCharge,
                        explanation: mileageExplanation
                    },
                    addons: {
                        equipment: equipmentAddons,
                        disposal: disposalAddons,
                        insurance: insuranceAddon
                    },
                    equipmentTotal,
                    disposalTotal,
                    insuranceTotal,
                    addonsTotal,
                    subtotal,
                    tax,
                    total,
                    dropOffDate: booking.drop_off_date,
                    pickupDate: booking.pickup_date
                });

                // Trigger PDF download
                await downloadPDF(bookingId);

            } catch (err) {
                console.error('[Receipt] Error:', err);
                setStatus('error');
                setError(err.message || 'An error occurred while loading your receipt.');
            }
        };

        const downloadPDF = async (bookingId) => {
            try {
                const { data, error: functionError } = await supabase.functions.invoke('get-receipt-pdf', {
                    body: { bookingId },
                });

                if (functionError) {
                    const errorContext = await functionError.context.json();
                    throw new Error(errorContext.error || 'Could not fetch the receipt PDF.');
                }

                if (data.error) {
                    throw new Error(data.error);
                }

                if (data.pdf) {
                    const byteCharacters = atob(data.pdf);
                    const byteNumbers = new Array(byteCharacters.length);
                    for (let i = 0; i < byteCharacters.length; i++) {
                        byteNumbers[i] = byteCharacters.charCodeAt(i);
                    }
                    const byteArray = new Uint8Array(byteNumbers);
                    const blob = new Blob([byteArray], { type: 'application/pdf' });
                    const url = window.URL.createObjectURL(blob);
                    
                    const link = document.createElement('a');
                    link.href = url;
                    link.setAttribute('download', `U-Fill-Receipt-${bookingId}.pdf`);
                    document.body.appendChild(link);
                    link.click();
                    link.parentNode.removeChild(link);
                    window.URL.revokeObjectURL(url);
                    
                    setStatus('success');
                } else {
                    throw new Error('Receipt data not found in the response.');
                }
            } catch (err) {
                console.warn('[Receipt] PDF download failed:', err);
                // Don't set error status - still show receipt preview
                setStatus('success');
            }
        };

        fetchDetailsAndCalculate();
    }, [searchParams]);

    const formatCurrency = (amount) => {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD',
            minimumFractionDigits: 2
        }).format(amount);
    };

    return (
        <>
            <Helmet>
                <title>Booking Receipt - U-Fill Dumpsters</title>
                <meta name="description" content="Your U-Fill Dumpsters booking receipt with complete details." />
            </Helmet>
            <div className="min-h-[calc(100vh-200px)] p-4 max-w-4xl mx-auto">
                
                {dumpFeeInfo && status !== 'error' && (
                    <div className="bg-amber-900/30 border border-amber-500/50 p-6 rounded-xl mb-8 text-left shadow-xl relative w-full">
                        <div className="flex items-start">
                          <AlertTriangle className="h-8 w-8 text-amber-400 mr-4 flex-shrink-0" />
                          <div>
                            <h3 className="text-xl font-bold text-amber-400 mb-2 uppercase tracking-wider">Dump Fee Notice</h3>
                            <p className="text-amber-100 leading-relaxed font-medium">
                              Dump Fees: Customers will be charged separately after the delivery is taken to the dump and completed. 
                              These charges will be applied to the card on file based on the actual tonnage disposed.
                            </p>
                            <div className="mt-4 inline-block bg-black/40 border border-amber-500/30 px-4 py-2 rounded-lg">
                              <span className="text-amber-200">Current Rate: </span>
                              <span className="text-amber-400 font-bold text-lg">${parseFloat(dumpFeeInfo.fee_per_ton).toFixed(2)} per ton</span>
                            </div>
                          </div>
                        </div>
                    </div>
                )}

                {status === 'loading' && (
                    <div className="flex flex-col items-center py-20">
                        <Loader2 className="h-16 w-16 animate-spin text-yellow-400" />
                        <h1 className="text-3xl font-bold text-white mt-4">Loading Receipt Details...</h1>
                        <p className="text-gray-400 mt-2">Please wait while we prepare your receipt.</p>
                    </div>
                )}

                {status === 'success' && receiptDetails && (
                    <div className="space-y-6 animate-in fade-in duration-500">
                        <div className="text-center mb-8">
                            <div className="inline-flex items-center justify-center w-16 h-16 bg-green-500/10 border-2 border-green-500 rounded-full mb-4">
                                <Receipt className="h-8 w-8 text-green-500" />
                            </div>
                            <h1 className="text-4xl font-extrabold text-white mb-2">Booking Receipt</h1>
                            <p className="text-gray-400">Booking ID: #{receiptDetails.bookingId}</p>
                        </div>

                        <Card className="bg-gray-900 border-gray-800">
                            <CardHeader className="border-b border-gray-800">
                                <CardTitle className="text-white flex items-center">
                                    <Receipt className="mr-2 h-5 w-5 text-yellow-400" />
                                    Receipt Details
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="p-6 space-y-6">
                                
                                {/* Customer Info */}
                                <div className="border-b border-gray-800 pb-4">
                                    <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-3">Customer Information</h3>
                                    <p className="text-white font-semibold text-lg">{receiptDetails.customerName}</p>
                                    <p className="text-gray-400">{receiptDetails.customerEmail}</p>
                                    {receiptDetails.dropOffDate && (
                                        <p className="text-gray-400 mt-2">
                                            Service Period: {new Date(receiptDetails.dropOffDate).toLocaleDateString()} - {new Date(receiptDetails.pickupDate).toLocaleDateString()}
                                        </p>
                                    )}
                                </div>

                                {/* Service Charges */}
                                <div className="space-y-3">
                                    <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider">Service Charges</h3>
                                    
                                    <div className="flex justify-between text-gray-300">
                                        <span>{receiptDetails.serviceName} - Base Rental</span>
                                        <span className="font-semibold">{formatCurrency(receiptDetails.basePrice)}</span>
                                    </div>
                                    
                                    {receiptDetails.deliveryFee > 0 && (
                                        <div className="flex justify-between text-gray-300">
                                            <span>Delivery Fee</span>
                                            <span className="font-semibold">{formatCurrency(receiptDetails.deliveryFee)}</span>
                                        </div>
                                    )}

                                    {/* Mileage - 3-Point Route */}
                                    <div className="bg-gray-950 p-4 rounded-lg border border-gray-800">
                                        <div className="flex justify-between items-start">
                                            <div className="flex-1">
                                                <div className="flex items-center gap-2 mb-2">
                                                    <Truck className="h-4 w-4 text-blue-400" />
                                                    <span className="font-semibold text-white">Mileage Charge</span>
                                                </div>
                                                <p className="text-xs text-gray-400 mb-1">
                                                    {receiptDetails.mileage.totalMiles.toFixed(1)} miles × $1 (complete route) @ ${receiptDetails.mileage.rate.toFixed(2)}/mile
                                                </p>
                                                <p className="text-xs text-blue-300 italic">
                                                    {receiptDetails.mileage.explanation}
                                                </p>
                                            </div>
                                            <span className="font-bold text-white text-lg">
                                                {calculatingMileage ? (
                                                    <Loader2 className="h-5 w-5 animate-spin" />
                                                ) : (
                                                    formatCurrency(receiptDetails.mileage.charge)
                                                )}
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                {/* Add-ons Section */}
                                {receiptDetails.addonsTotal > 0 && (
                                    <div className="space-y-4 pt-4 border-t border-gray-800">
                                        <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider flex items-center">
                                            <Package className="mr-2 h-4 w-4" />
                                            Add-ons & Additional Services
                                        </h3>

                                        {/* Equipment Add-ons */}
                                        {receiptDetails.addons.equipment.length > 0 && (
                                            <div className="bg-gray-950 p-4 rounded-lg border border-gray-800">
                                                <h4 className="text-xs font-bold text-blue-400 uppercase tracking-wider mb-3 flex items-center">
                                                    <Wrench className="mr-1.5 h-3.5 w-3.5" />
                                                    Equipment Rentals
                                                </h4>
                                                <div className="space-y-2">
                                                    {receiptDetails.addons.equipment.map((item, idx) => (
                                                        <div key={`equip-${idx}`} className="flex justify-between text-sm">
                                                            <div className="text-gray-300">
                                                                <span className="font-medium">{item.name}</span>
                                                                <span className="text-gray-500 ml-2">
                                                                    (Qty: {item.quantity}) @ {formatCurrency(item.unitPrice)} each
                                                                </span>
                                                            </div>
                                                            <span className="font-semibold text-white">{formatCurrency(item.total)}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                                <div className="flex justify-between text-sm mt-3 pt-3 border-t border-gray-800">
                                                    <span className="text-gray-400">Equipment Subtotal</span>
                                                    <span className="font-bold text-blue-300">{formatCurrency(receiptDetails.equipmentTotal)}</span>
                                                </div>
                                            </div>
                                        )}

                                        {/* Disposal Services */}
                                        {receiptDetails.addons.disposal.length > 0 && (
                                            <div className="bg-gray-950 p-4 rounded-lg border border-gray-800">
                                                <h4 className="text-xs font-bold text-purple-400 uppercase tracking-wider mb-3 flex items-center">
                                                    <Package className="mr-1.5 h-3.5 w-3.5" />
                                                    Disposal Services
                                                </h4>
                                                <div className="space-y-2">
                                                    {receiptDetails.addons.disposal.map((item, idx) => (
                                                        <div key={`disposal-${idx}`} className="flex justify-between text-sm">
                                                            <div className="text-gray-300">
                                                                <span className="font-medium">{item.name}</span>
                                                                <span className="text-gray-500 ml-2">
                                                                    (Qty: {item.quantity}) @ {formatCurrency(item.unitPrice)} each
                                                                </span>
                                                            </div>
                                                            <span className="font-semibold text-white">{formatCurrency(item.total)}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                                <div className="flex justify-between text-sm mt-3 pt-3 border-t border-gray-800">
                                                    <span className="text-gray-400">Disposal Subtotal</span>
                                                    <span className="font-bold text-purple-300">{formatCurrency(receiptDetails.disposalTotal)}</span>
                                                </div>
                                            </div>
                                        )}

                                        {/* Insurance */}
                                        {receiptDetails.addons.insurance && (
                                            <div className="bg-gray-950 p-4 rounded-lg border border-gray-800">
                                                <h4 className="text-xs font-bold text-green-400 uppercase tracking-wider mb-3">Protection Plan</h4>
                                                <div className="flex justify-between text-sm">
                                                    <div className="text-gray-300">
                                                        <span className="font-medium">{receiptDetails.addons.insurance.name}</span>
                                                        <span className="text-gray-500 ml-2">
                                                            (Qty: {receiptDetails.addons.insurance.quantity}) @ {formatCurrency(receiptDetails.addons.insurance.unitPrice)} each
                                                        </span>
                                                    </div>
                                                    <span className="font-semibold text-white">{formatCurrency(receiptDetails.addons.insurance.total)}</span>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Totals Section */}
                                <div className="space-y-3 pt-6 border-t-2 border-gray-700">
                                    <div className="flex justify-between text-gray-300">
                                        <span>Subtotal (Pre-Tax)</span>
                                        <span className="font-semibold text-lg">{formatCurrency(receiptDetails.subtotal)}</span>
                                    </div>
                                    
                                    <div className="flex justify-between text-gray-400">
                                        <span>Tax (7%)</span>
                                        <span className="font-semibold">{formatCurrency(receiptDetails.tax)}</span>
                                    </div>
                                    
                                    <div className="flex justify-between items-center bg-yellow-500/10 p-4 rounded-lg border-2 border-yellow-500/30 mt-4">
                                        <span className="text-xl font-bold text-white">Total with Tax</span>
                                        <span className="text-3xl font-black text-yellow-400">{formatCurrency(receiptDetails.total)}</span>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        <div className="flex flex-col sm:flex-row gap-4 justify-center items-center pt-6">
                            <Button 
                                onClick={() => window.print()} 
                                className="bg-blue-600 hover:bg-blue-700 text-white"
                            >
                                <Download className="mr-2 h-4 w-4" />
                                Print Receipt
                            </Button>
                            <Link to="/">
                                <Button variant="outline" className="bg-gray-800 border-gray-700 text-white hover:bg-gray-700">
                                    <Home className="mr-2 h-4 w-4" />
                                    Back to Homepage
                                </Button>
                            </Link>
                        </div>
                    </div>
                )}

                {status === 'error' && (
                    <div className="flex flex-col items-center py-20">
                        <XCircle className="h-16 w-16 text-red-500" />
                        <h1 className="text-3xl font-bold text-white mt-4">Error Loading Receipt</h1>
                        <p className="text-red-300 mt-2 max-w-md text-center">{error}</p>
                        <p className="text-gray-400 mt-4 text-center">Please log in to your customer portal to access your receipts, or contact support for assistance.</p>
                        <div className="flex gap-4 mt-8">
                            <Link to="/login">
                                <Button className="bg-blue-600 hover:bg-blue-700 text-white">
                                    Go to Customer Portal
                                </Button>
                            </Link>
                            <Link to="/">
                                <Button variant="outline" className="bg-gray-800 border-gray-700 text-white hover:bg-gray-700">
                                    <Home className="mr-2 h-4 w-4" />
                                    Back to Homepage
                                </Button>
                            </Link>
                        </div>
                    </div>
                )}
            </div>
        </>
    );
};

export default ReceiptPage;