import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';
import { Loader2, CheckCircle, AlertTriangle, MapPin, ExternalLink, ShieldAlert } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { format, parseISO } from 'date-fns';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { VerificationImageDisplay } from '@/components/VerificationImageDisplay';
import { reinstatePinTrackingPatch, expireActiveRentalAccessCodesForOrder } from '@/utils/bookingPinReinstate';

export const PendingVerificationsManager = () => {
    const { user } = useAuth();
    const [bookings, setBookings] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedBooking, setSelectedBooking] = useState(null);
    const [isApproveDialogOpen, setIsApproveDialogOpen] = useState(false);
    const [isCancelDialogOpen, setIsCancelDialogOpen] = useState(false);
    const [actionLoading, setActionLoading] = useState(false);

    const fetchPendingVerifications = async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('bookings')
                .select('*, customers(*)')
                .eq('pending_address_verification', true)
                .order('pending_verification_date', { ascending: false });

            if (error) throw error;
            setBookings(data || []);
        } catch (error) {
            toast({ title: "Failed to load pending verifications", description: error.message, variant: "destructive" });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchPendingVerifications();
    }, []);

    const handleApprove = async () => {
        if (!selectedBooking) return;
        setActionLoading(true);
        try {
            const adminEmail = user?.email || 'admin';
            const prevStatus = selectedBooking.status;

            const { error: updateError } = await supabase
                .from('bookings')
                .update({ 
                    pending_address_verification: false,
                    address_verified_by_admin: adminEmail,
                    address_verified_date: new Date().toISOString(),
                    status: 'Confirmed',
                    ...reinstatePinTrackingPatch(prevStatus, 'Confirmed'),
                })
                .eq('id', selectedBooking.id);

            if (updateError) throw updateError;

            if (prevStatus === 'pending_review') {
                await expireActiveRentalAccessCodesForOrder(selectedBooking.id);
            }

            await supabase.from('customer_notes').insert({
                customer_id: selectedBooking.customer_id,
                booking_id: selectedBooking.id,
                source: 'Address Verification',
                content: `Address manually verified and approved by ${adminEmail}. Status updated to Confirmed.`,
                author_type: 'admin'
            });

            await supabase.functions.invoke('send-booking-confirmation', { body: { booking_id: selectedBooking.id } });

            toast({ title: "Address Verified", description: "Booking has been confirmed and customer notified." });
            fetchPendingVerifications();
            setIsApproveDialogOpen(false);
        } catch (error) {
            toast({ title: "Approval Failed", description: error.message, variant: "destructive" });
        } finally {
            setActionLoading(false);
            setSelectedBooking(null);
        }
    };

    const handleCancel = async (refundType) => {
        if (!selectedBooking) return;
        setActionLoading(true);
        try {
            const { data, error } = await supabase.functions.invoke('refund-payment', { 
                body: { bookingId: selectedBooking.id, refundType } 
            });

            if (error) throw error;
            if (data?.error) throw new Error(data.error);

            const adminEmail = user?.email || 'admin';
            await supabase.from('customer_notes').insert({
                customer_id: selectedBooking.customer_id,
                booking_id: selectedBooking.id,
                source: 'Address Verification Rejection',
                content: `Booking cancelled by ${adminEmail} due to invalid address. Refund type: ${refundType}.`,
                author_type: 'admin'
            });

            toast({ title: "Booking Cancelled", description: "The booking was cancelled and refund processed." });
            fetchPendingVerifications();
            setIsCancelDialogOpen(false);
        } catch (error) {
            toast({ title: "Cancellation Failed", description: error.message, variant: "destructive" });
        } finally {
            setActionLoading(false);
            setSelectedBooking(null);
        }
    };

    if (loading) return <div className="flex justify-center p-8"><Loader2 className="animate-spin h-8 w-8 text-yellow-400" /></div>;

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h2 className="text-2xl font-bold text-white flex items-center">
                    <MapPin className="mr-2 h-6 w-6 text-orange-400" />
                    Pending Address Verifications
                </h2>
                <Button variant="outline" onClick={fetchPendingVerifications} size="sm">Refresh</Button>
            </div>

            {bookings.length === 0 ? (
                <div className="bg-gray-800 rounded-lg p-8 text-center text-gray-400">
                    <CheckCircle className="mx-auto h-12 w-12 text-green-500 mb-4" />
                    <p>No bookings are currently waiting for address verification.</p>
                </div>
            ) : (
                <div className="bg-gray-800 rounded-lg overflow-hidden border border-gray-700">
                    <Table>
                        <TableHeader>
                            <TableRow className="border-gray-700 hover:bg-gray-800">
                                <TableHead className="text-gray-300">Booking ID</TableHead>
                                <TableHead className="text-gray-300">Customer</TableHead>
                                <TableHead className="text-gray-300">Unverified Address</TableHead>
                                <TableHead className="text-gray-300">Pending Since</TableHead>
                                <TableHead className="text-gray-300 text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {bookings.map(booking => (
                                <TableRow key={booking.id} className="border-gray-700 hover:bg-gray-750">
                                    <TableCell className="font-medium text-blue-400">#{booking.id}</TableCell>
                                    <TableCell>
                                        <div className="text-white">{booking.name}</div>
                                        <div className="text-xs text-gray-400">{booking.customers?.customer_id_text} | {booking.phone}</div>
                                    </TableCell>
                                    <TableCell>
                                        <div className="text-orange-300 flex items-start">
                                            <AlertTriangle className="h-4 w-4 mr-1 mt-0.5 flex-shrink-0" />
                                            <span className="break-words max-w-xs">{booking.unverified_address}</span>
                                        </div>
                                        <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(booking.unverified_address)}`} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-400 hover:underline mt-1 flex items-center">
                                            View on Map <ExternalLink className="h-3 w-3 ml-1" />
                                        </a>
                                    </TableCell>
                                    <TableCell className="text-gray-300">
                                        {booking.pending_verification_date ? format(parseISO(booking.pending_verification_date), 'MMM d, yyyy h:mm a') : 'Unknown'}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <div className="flex justify-end gap-2">
                                            <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white" onClick={() => { setSelectedBooking(booking); setIsApproveDialogOpen(true); }}>
                                                Verify & Approve
                                            </Button>
                                            <Button size="sm" variant="destructive" onClick={() => { setSelectedBooking(booking); setIsCancelDialogOpen(true); }}>
                                                Cancel
                                            </Button>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            )}

            <Dialog open={isApproveDialogOpen} onOpenChange={setIsApproveDialogOpen}>
                <DialogContent className="bg-gray-900 border-green-500 text-white max-w-3xl">
                    <DialogHeader>
                        <DialogTitle>Approve Delivery Address</DialogTitle>
                        <DialogDescription>Review the customer's information before approving.</DialogDescription>
                    </DialogHeader>
                    <div className="py-4 space-y-6">
                        <div>
                            <p className="text-sm text-gray-300 mb-2">You are approving delivery to:</p>
                            <p className="font-bold text-lg text-white bg-black/30 p-3 rounded">{selectedBooking?.unverified_address}</p>
                        </div>
                        
                        <div className="border-t border-gray-700 pt-4">
                            <h4 className="flex items-center text-md font-bold mb-4 text-yellow-400">
                                <ShieldAlert className="h-5 w-5 mr-2" /> License Verification Documents
                            </h4>
                            {selectedBooking?.customer_id ? (
                                <VerificationImageDisplay customerId={selectedBooking.customer_id} />
                            ) : (
                                <div className="text-yellow-400 text-sm">No customer ID linked.</div>
                            )}
                        </div>

                        <p className="text-xs text-gray-400 mt-4">Approving this will change the booking status to Confirmed and send a confirmation email to the customer.</p>
                    </div>
                    <DialogFooter>
                        <Button variant="ghost" onClick={() => setIsApproveDialogOpen(false)}>Cancel</Button>
                        <Button onClick={handleApprove} disabled={actionLoading} className="bg-green-600 hover:bg-green-700 text-white">
                            {actionLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle className="h-4 w-4 mr-2" />} Approve Request
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={isCancelDialogOpen} onOpenChange={setIsCancelDialogOpen}>
                <DialogContent className="bg-gray-900 border-red-500 text-white">
                    <DialogHeader>
                        <DialogTitle>Cancel Booking due to Invalid Address</DialogTitle>
                        <DialogDescription>The customer's address is unserviceable or invalid.</DialogDescription>
                    </DialogHeader>
                    <div className="py-4">
                        <p className="text-sm text-gray-300 mb-4">How would you like to handle the refund for Booking #{selectedBooking?.id}?</p>
                        <div className="space-y-3">
                            <Button variant="outline" className="w-full justify-start text-left h-auto py-3 border-gray-600 hover:bg-gray-800" onClick={() => handleCancel('full')} disabled={actionLoading}>
                                <div>
                                    <div className="font-bold text-white">Issue Full Refund</div>
                                    <div className="text-xs text-gray-400 font-normal">Refund the entire amount back to the customer's card.</div>
                                </div>
                            </Button>
                            <Button variant="outline" className="w-full justify-start text-left h-auto py-3 border-red-500/50 hover:bg-red-900/20" onClick={() => handleCancel('partial')} disabled={actionLoading}>
                                <div>
                                    <div className="font-bold text-red-400">Apply Cancellation Fee (Partial Refund)</div>
                                    <div className="text-xs text-gray-400 font-normal">Deduct standard cancellation fees according to policy.</div>
                                </div>
                            </Button>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="ghost" onClick={() => setIsCancelDialogOpen(false)}>Go Back</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
};