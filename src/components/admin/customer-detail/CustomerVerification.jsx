
import React, { useState } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';
import { Car, ShieldAlert, FileText, Check, X, Image as ImageIcon, DollarSign, Loader2, Download, UploadCloud } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useReactToPrint } from 'react-to-print';
import { PrintableReceipt } from '@/components/PrintableReceipt';

const RefundDialog = ({ booking, customer, open, onOpenChange, onUpdate }) => {
    const [refundAmount, setRefundAmount] = useState(booking?.total_price || 0);
    const [cancellationFee, setCancellationFee] = useState(0);
    const [reason, setReason] = useState("Admin cancelled due to missing, not provided, or improper verification information.");
    const [isRefunding, setIsRefunding] = useState(false);
    const receiptRef = React.useRef();
    const paymentInfo = Array.isArray(booking?.stripe_payment_info) ? booking.stripe_payment_info[0] : booking?.stripe_payment_info;

    const handlePrint = useReactToPrint({
        content: () => receiptRef.current,
        documentTitle: `U-Fill-Refund-Receipt-${booking?.id || 'booking'}`,
    });
    
    React.useEffect(() => {
        if (booking) {
            const total = booking.total_price || 0;
            const fee = parseFloat(cancellationFee) || 0;
            setRefundAmount(Math.max(0, total - fee).toFixed(2));
        }
    }, [cancellationFee, booking]);

    const handleRefund = async () => {
        if (!paymentInfo?.stripe_charge_id) {
            toast({ title: "Refund Failed", description: "This booking is missing a Stripe Charge ID and cannot be refunded automatically.", variant: "destructive" });
            return;
        }
        setIsRefunding(true);
        try {
            const { error: refundError } = await supabase.functions.invoke('refund-payment', {
                body: {
                    bookingId: booking.id,
                    amount: parseFloat(refundAmount),
                    reason,
                    chargeId: paymentInfo.stripe_charge_id,
                }
            });

            if (refundError) throw refundError;
            
            const updatedBookingForEmail = {
                ...booking, 
                customers: customer, 
                status: 'Cancelled', 
                refund_details: { amount: parseFloat(refundAmount), reason }
            };
            
            await supabase.functions.invoke('send-booking-confirmation', {
                body: { booking: updatedBookingForEmail, customMessage: `This booking has been cancelled and a refund of $${refundAmount} has been processed. Reason: ${reason}` }
            });
            
            toast({ title: "Refund Processed & Customer Notified", description: `Successfully refunded $${refundAmount}.` });

            onUpdate();
            onOpenChange(false);
        } catch (error) {
            toast({ title: "Refund Failed", description: error.message, variant: "destructive" });
        } finally {
            setIsRefunding(false);
        }
    };

    if (!booking) return null;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <div className="hidden">
                 <PrintableReceipt ref={receiptRef} booking={{...booking, customers: customer, refund_details: {amount: parseFloat(refundAmount), reason, created_at: new Date().toISOString()}}} />
            </div>
            <DialogContent className="bg-gray-900 border-red-500 text-white">
                <DialogHeader>
                    <DialogTitle>Cancel Booking & Issue Refund</DialogTitle>
                    <DialogDescription>
                        Booking #{booking.id} will be cancelled. Original total: ${booking.total_price.toFixed(2)}.
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                    <div>
                        <Label htmlFor="cancellation-fee">Cancellation / Admin Fee</Label>
                        <Input id="cancellation-fee" type="number" value={cancellationFee} onChange={(e) => setCancellationFee(e.target.value)} placeholder="0.00" className="bg-white/20"/>
                    </div>
                    <div>
                        <Label>Amount to Refund</Label>
                        <p className="text-2xl font-bold text-green-400">${refundAmount}</p>
                    </div>
                    <div>
                        <Label htmlFor="reason">Reason for Cancellation (will be sent to customer)</Label>
                        <Input id="reason" value={reason} onChange={(e) => setReason(e.target.value)} className="bg-white/20"/>
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={handlePrint}>Print Refund Receipt</Button>
                    <Button variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
                    <Button variant="destructive" onClick={handleRefund} disabled={isRefunding}>
                        {isRefunding ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <DollarSign className="mr-2 h-4 w-4"/>}
                        Confirm & Refund
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

const ImageUploader = ({ customer, onUpdate }) => {
    const [isUploading, setIsUploading] = useState(false);
    const fileInputRef = React.useRef(null);

    const handlePhotoUpload = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        setIsUploading(true);

        const filePath = `${customer.id}/licenses/${Date.now()}-${file.name}`;
        const { error: uploadError } = await supabase.storage.from('customer-uploads').upload(filePath, file);

        if (uploadError) {
            toast({ title: "Upload Failed", description: uploadError.message, variant: "destructive" });
        } else {
            const { data: { publicUrl } } = supabase.storage.from('customer-uploads').getPublicUrl(filePath);
            
            const existingUrls = customer.license_image_urls || [];
            const newImage = { url: publicUrl, path: filePath, name: file.name };
            const updatedUrls = [...existingUrls, newImage];

            const { error: dbUpdateError } = await supabase.from('customers').update({ license_image_urls: updatedUrls }).eq('id', customer.id);

            if (dbUpdateError) {
                 toast({ title: "DB Update Failed", description: dbUpdateError.message, variant: "destructive" });
            } else {
                toast({ title: "Photo uploaded and linked successfully!" });
                onUpdate();
            }
        }
        setIsUploading(false);
        if (fileInputRef.current) {
            fileInputRef.current.value = "";
        }
    };

    return (
        <div>
            <Button onClick={() => fileInputRef.current?.click()} disabled={isUploading}>
                <UploadCloud className="mr-2 h-4 w-4" />
                {isUploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "Upload License Image"}
            </Button>
            <Input
                ref={fileInputRef}
                id="license-image-upload"
                type="file"
                className="hidden"
                onChange={handlePhotoUpload}
                disabled={isUploading}
                accept="image/*"
            />
        </div>
    );
};


export const CustomerVerification = ({ customer, verificationBookings, onUpdate }) => {
    const [selectedBookingForRefund, setSelectedBookingForRefund] = useState(null);
    
    const handleApprove = async (bookingId) => {
        const { error } = await supabase
            .from('bookings')
            .update({ status: 'Confirmed', verification_notes: 'Admin approved verification.', is_manually_verified: true })
            .eq('id', bookingId);
            
        if (error) {
            toast({ title: "Approval Failed", description: error.message, variant: 'destructive' });
        } else {
            toast({ title: "Booking Approved", description: `The booking is now confirmed and ready for delivery.` });
            onUpdate();
        }
    };

    const handleCancelClick = (booking) => {
        setSelectedBookingForRefund(booking);
    };

    const handleDownload = async (url, filename) => {
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const blob = await response.blob();
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        } catch (error) {
            console.error("Download Error:", error);
            toast({ title: "Download Failed", description: "Could not download the image. Check console for details.", variant: "destructive" });
        }
    };
    
    return (
        <>
        <RefundDialog booking={selectedBookingForRefund} customer={customer} open={!!selectedBookingForRefund} onOpenChange={() => setSelectedBookingForRefund(null)} onUpdate={onUpdate} />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="bg-white/5 p-6 rounded-lg shadow-lg">
                <h3 className="flex items-center text-xl font-bold text-yellow-400 mb-4"><Car className="mr-3 h-6 w-6"/>Vehicle & License Details</h3>
                <div className="space-y-4">
                    <div>
                        <p className="font-semibold text-blue-200">License Plate:</p>
                        <p className="text-white font-mono text-lg bg-white/10 p-2 rounded-md">{customer.license_plate || 'Not Provided'}</p>
                    </div>
                     <div>
                        <p className="font-semibold text-blue-200">Driver's License Images:</p>
                        <div className="mt-2 grid grid-cols-1 gap-4">
                           {customer.license_image_urls && customer.license_image_urls.length > 0 ? customer.license_image_urls.map((img, index) => (
                               <div key={index} className="relative group">
                                  <a href={img.url} target="_blank" rel="noopener noreferrer" className="block relative">
                                    <img src={img.url} alt={`License ${index+1}`} className="w-full h-auto rounded-lg object-cover aspect-video" />
                                    <div className="absolute inset-0 bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                        <ImageIcon className="h-8 w-8 text-white"/>
                                    </div>
                                  </a>
                                  <Button size="sm" variant="secondary" className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => {e.preventDefault(); handleDownload(img.url, `license_${customer.id}_${index+1}.jpg`);}}>
                                    <Download className="h-4 w-4 mr-2" /> Download
                                  </Button>
                               </div>
                           )) : <p className="text-blue-200 col-span-2 text-center py-4">No images uploaded.</p>}
                        </div>
                        <div className="mt-4">
                            <ImageUploader customer={customer} onUpdate={onUpdate} />
                        </div>
                    </div>
                </div>
            </div>

            <div className="bg-white/5 p-6 rounded-lg shadow-lg">
                <h3 className="flex items-center text-xl font-bold text-yellow-400 mb-4"><ShieldAlert className="mr-3 h-6 w-6"/>Pending Verifications</h3>
                 <div className="space-y-4">
                    {verificationBookings.length > 0 ? verificationBookings.map(booking => (
                        <div key={booking.id} className="bg-orange-900/30 border border-orange-500 p-4 rounded-lg">
                            <p className="font-bold text-orange-300">Booking #{booking.id} requires review.</p>
                            {booking.verification_notes && (
                                <div className="mt-2">
                                     <p className="font-semibold text-blue-200 flex items-center"><FileText className="mr-2 h-4 w-4"/>Customer Note:</p>
                                     <p className="text-orange-200 italic bg-black/20 p-2 rounded-md">"{booking.verification_notes}"</p>
                                </div>
                            )}
                            <div className="flex justify-end space-x-2 mt-4">
                                <Button size="sm" variant="destructive" onClick={() => handleCancelClick(booking)}><X className="mr-2 h-4 w-4"/>Cancel & Refund</Button>
                                <Button size="sm" className="bg-green-600 hover:bg-green-700" onClick={() => handleApprove(booking.id)}><Check className="mr-2 h-4 w-4"/>Approve</Button>
                            </div>
                        </div>
                    )) : (
                        <p className="text-center text-blue-200 py-8">No bookings are pending verification.</p>
                    )}
                </div>
            </div>
        </div>
        </>
    );
};
