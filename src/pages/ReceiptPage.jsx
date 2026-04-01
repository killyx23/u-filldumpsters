
import React, { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { supabase } from '@/lib/customSupabaseClient';
import { Loader2, XCircle, Home, Receipt, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Helmet } from 'react-helmet';
import { getDumpFeeForService } from '@/utils/getDumpFeeForService';

const ReceiptPage = () => {
    const [searchParams] = useSearchParams();
    const [status, setStatus] = useState('loading');
    const [error, setError] = useState('');
    const [bookingData, setBookingData] = useState(null);
    const [dumpFeeInfo, setDumpFeeInfo] = useState(null);

    useEffect(() => {
        const bookingId = searchParams.get('bookingId');

        if (!bookingId) {
            setStatus('error');
            setError('No booking ID provided. Please check the link and try again.');
            return;
        }

        const fetchDetailsAndDownload = async () => {
            try {
                // Fetch booking data first to get the service ID
                const { data: booking, error: bError } = await supabase
                    .from('bookings')
                    .select('*')
                    .eq('id', bookingId)
                    .single();

                if (!bError && booking) {
                    setBookingData(booking);
                    let resolvedServiceId = null;
                    if (booking.plan && booking.plan.service_id) {
                        resolvedServiceId = booking.plan.service_id;
                    } else if (booking.plan && booking.plan.id) {
                        resolvedServiceId = booking.plan.id;
                    }
                    if (booking.addons?.deliveryService && resolvedServiceId === 2) {
                        resolvedServiceId = 4;
                    }

                    if (resolvedServiceId) {
                        const df = await getDumpFeeForService(resolvedServiceId);
                        if (df) setDumpFeeInfo(df);
                    }
                }

                // Fetch PDF Receipt
                const { data, error: functionError } = await supabase.functions.invoke('get-receipt-pdf', {
                    body: { bookingId },
                });

                if (functionError) {
                    const errorContext = await functionError.context.json();
                    throw new Error(errorContext.error || 'Could not fetch the receipt.');
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
                setStatus('error');
                setError(err.message || 'An unknown error occurred while trying to download your receipt.');
            }
        };

        fetchDetailsAndDownload();
    }, [searchParams]);

    return (
        <>
            <Helmet>
                <title>Downloading Your Receipt - U-Fill Dumpsters</title>
                <meta name="description" content="Your U-Fill Dumpsters receipt is being downloaded." />
            </Helmet>
            <div className="min-h-[calc(100vh-200px)] flex flex-col items-center justify-center p-4 text-center max-w-2xl mx-auto">
                
                {dumpFeeInfo && status !== 'error' && (
                    <div className="bg-amber-900/30 border border-amber-500/50 p-6 rounded-xl mb-12 text-left shadow-xl relative w-full">
                        <div className="flex items-start">
                          <Receipt className="h-8 w-8 text-amber-400 mr-4 flex-shrink-0" />
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
                    <div className="flex flex-col items-center">
                        <Loader2 className="h-16 w-16 animate-spin text-yellow-400" />
                        <h1 className="text-3xl font-bold text-white mt-4">Preparing Your Receipt...</h1>
                        <p className="text-blue-200 mt-2">Your download will begin shortly.</p>
                    </div>
                )}
                {status === 'success' && (
                    <div className="flex flex-col items-center">
                        <h1 className="text-3xl font-bold text-white">Download Started!</h1>
                        <p className="text-blue-200 mt-2 max-w-md">Your receipt has been downloaded. If the download didn't start, please check your browser settings or try again.</p>
                        <Link to="/">
                            <Button className="mt-8 bg-blue-600 hover:bg-blue-700 text-white">
                                <Home className="mr-2" /> Back to Homepage
                            </Button>
                        </Link>
                    </div>
                )}
                {status === 'error' && (
                    <div className="flex flex-col items-center">
                        <XCircle className="h-16 w-16 text-red-500" />
                        <h1 className="text-3xl font-bold text-white mt-4">Download Failed</h1>
                        <p className="text-red-300 mt-2 max-w-md">{error}</p>
                        <p className="text-blue-200 mt-4">Please log in to your customer portal to access your receipts, or contact support for assistance.</p>
                        <Link to="/login">
                            <Button className="mt-8 bg-blue-600 hover:bg-blue-700 text-white">
                                Go to Customer Portal
                            </Button>
                        </Link>
                    </div>
                )}
            </div>
        </>
    );
};

export default ReceiptPage;
