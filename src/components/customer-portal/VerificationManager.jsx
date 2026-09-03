import React, { useState, useRef } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Loader2, ShieldCheck, UploadCloud } from 'lucide-react';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  uploadVerificationImage,
  saveVerificationDocumentToDb,
  getMergedVerificationDocumentsByCustomerId,
  areVerificationDocumentsComplete,
} from '@/utils/verificationImageHelper';
import { VerificationInfoTooltip } from '@/components/VerificationInfoTooltip';
import { VerificationImageDisplay } from '@/components/VerificationImageDisplay';
import {
  bookingNeedsSkippedVerification,
  formatVerificationDeadlineMessage,
} from '@/utils/verificationDeadline';

export const VerificationManager = ({ customer, bookings = [], onUpdate }) => {
    const [licensePlate, setLicensePlate] = useState(customer?.license_plate || '');
    const [plateError, setPlateError] = useState('');
    const [isUploading, setIsUploading] = useState(false);

    const [frontImage, setFrontImage] = useState(null);
    const [backImage, setBackImage] = useState(null);
    const [insuranceImage, setInsuranceImage] = useState(null);
    const [existingFrontUrl, setExistingFrontUrl] = useState(null);
    const [existingBackUrl, setExistingBackUrl] = useState(null);
    const [existingInsuranceUrl, setExistingInsuranceUrl] = useState(null);
    const [existingFrontPath, setExistingFrontPath] = useState(null);
    const [existingBackPath, setExistingBackPath] = useState(null);
    const [existingInsurancePath, setExistingInsurancePath] = useState(null);
    const [displayRefreshKey, setDisplayRefreshKey] = useState(0);
    const [hadCompleteDocsOnLoad, setHadCompleteDocsOnLoad] = useState(false);

    const [attestOpen, setAttestOpen] = useState(false);
    const [attestChecked, setAttestChecked] = useState(false);
    const [pendingSavePayload, setPendingSavePayload] = useState(null);

    const fileInputFrontRef = useRef(null);
    const fileInputBackRef = useRef(null);
    const fileInputInsuranceRef = useRef(null);

    const skippedBookings = (bookings || []).filter((b) =>
      bookingNeedsSkippedVerification(b, customer)
    );
    const deadlineBanner =
      skippedBookings.length > 0
        ? formatVerificationDeadlineMessage(skippedBookings[0])
        : null;

    React.useEffect(() => {
        const loadExistingDocs = async () => {
            if (!customer?.id) return;
            try {
                const doc = await getMergedVerificationDocumentsByCustomerId(customer.id);
                if (doc) {
                    setExistingFrontUrl(doc.license_front_url || null);
                    setExistingBackUrl(doc.license_back_url || null);
                    setExistingInsuranceUrl(doc.insurance_url || null);
                    setExistingFrontPath(doc.license_front_storage_path || null);
                    setExistingBackPath(doc.license_back_storage_path || null);
                    setExistingInsurancePath(doc.insurance_storage_path || null);

                    const docsComplete = areVerificationDocumentsComplete(doc);
                    setHadCompleteDocsOnLoad(docsComplete);
                    const status = doc.verification_status;
                    if (
                        docsComplete &&
                        status !== 'approved' &&
                        status !== 'rejected'
                    ) {
                        await saveVerificationDocumentToDb(
                            customer.id,
                            doc.license_front_url || null,
                            doc.license_front_storage_path || null,
                            doc.license_back_url || null,
                            doc.license_back_storage_path || null,
                            'approved',
                            doc.insurance_url || null,
                            doc.insurance_storage_path || null,
                        );

                        const platePresent = Boolean(
                            String(customer.license_plate || licensePlate || '').trim()
                        );
                        if (platePresent || customer.has_incomplete_verification) {
                            await supabase
                                .from('customers')
                                .update({ has_incomplete_verification: false })
                                .eq('id', customer.id);
                        }

                        setDisplayRefreshKey((prev) => prev + 1);
                        if (onUpdate) onUpdate();
                    }
                }
            } catch (error) {
                console.error('[VerificationManager] Failed to load existing documents:', error);
            }
        };
        loadExistingDocs();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- heal once per customer load
    }, [customer?.id]);

    const handlePlateChange = (e) => {
        const value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
        setLicensePlate(value);
        const plateRegex = /^[A-Z0-9]{6,7}$/;
        if (value && !plateRegex.test(value)) {
            setPlateError("Plate must be 6-7 letters and numbers.");
        } else {
            setPlateError('');
        }
    };

    const handleFileChange = async (e, type) => {
        const file = e.target.files[0];
        if (!file || !customer?.id) return;

        setIsUploading(true);
        try {
            const uploaded = await uploadVerificationImage(customer.id, file, type);
            if (type === 'license_front') setFrontImage(uploaded);
            else if (type === 'license_back') setBackImage(uploaded);
            else setInsuranceImage(uploaded);
            toast({ title: "Image Uploaded", description: "Ready to save." });
        } catch (error) {
            toast({ title: `Upload Failed`, description: error.message, variant: "destructive" });
        } finally {
            setIsUploading(false);
        }
    };

    const hasSlot = (slot) => Boolean(slot?.url || slot?.path);

    const completeSkippedBookings = async () => {
        const targets = (bookings || []).filter(
            (b) =>
                b.status === 'pending_verification' ||
                b.was_verification_skipped ||
                b.addons?.wasVerificationSkipped
        );
        if (targets.length === 0) return;

        const attestedAt = new Date().toISOString();
        const bookingIds = targets.map((b) => b.id);

        await Promise.all(
            targets.map(async (booking) => {
                const nextAddons = {
                    ...(booking.addons || {}),
                    verificationAttestedAt: attestedAt,
                    verificationAttestationAccepted: true,
                    wasVerificationSkipped: false,
                    verificationSkipped: false,
                };
                const { error } = await supabase
                    .from('bookings')
                    .update({
                        status: 'Confirmed',
                        was_verification_skipped: false,
                        verification_notes: null,
                        addons: nextAddons,
                    })
                    .eq('id', booking.id);
                if (error) {
                    console.error('[VerificationManager] Failed to confirm booking after attestation:', error);
                    throw error;
                }
            })
        );

        // Clear pending "Verification Skip Reason" review flags in admin chat notes
        const { error: notesReadError } = await supabase
            .from('customer_notes')
            .update({ is_read: true })
            .eq('customer_id', customer.id)
            .eq('source', 'Verification Skip Reason')
            .in('booking_id', bookingIds);
        if (notesReadError) {
            console.warn('[VerificationManager] Could not mark skip notes read:', notesReadError);
        }

        // Mark prior skip chat alerts as read so they no longer count as pending
        const { data: skipChats } = await supabase
            .from('chat_messages')
            .select('id, message_content')
            .eq('customer_id', customer.id)
            .in('booking_id', bookingIds);
        const skipChatIds = (skipChats || [])
            .filter((m) =>
                String(m.message_content || '')
                    .toLowerCase()
                    .includes('verification was skipped')
            )
            .map((m) => m.id);
        if (skipChatIds.length > 0) {
            await supabase
                .from('chat_messages')
                .update({ is_read: true })
                .in('id', skipChatIds);
        }

        const bookingList = bookingIds.map((id) => `#${id}`).join(', ');
        const completionText =
            targets.length === 1
                ? `Driver & Vehicle Verification for Booking ${bookingList} has been completed by the customer in the Customer Portal. License plate, driver’s license (front and back), and insurance were submitted and attested as true and legally correct. This verification skip is taken care of — no further pending action for this flag.`
                : `Driver & Vehicle Verification for Bookings ${bookingList} has been completed by the customer in the Customer Portal. License plate, driver’s license (front and back), and insurance were submitted and attested as true and legally correct. These verification skips are taken care of — no further pending action for this flag.`;

        // Live chat (admin Chat tab + customer portal messages)
        for (const booking of targets) {
            const { error: chatError } = await supabase.from('chat_messages').insert({
                conversation_id: `cust_${customer.id}`,
                customer_id: customer.id,
                booking_id: booking.id,
                sender_type: 'customer',
                message_content:
                    `Driver & Vehicle Verification for Booking #${booking.id} has been taken care of. ` +
                    `The customer submitted license plate, driver’s license (front and back), and insurance, ` +
                    `and confirmed the information is current, proper, and legally correct.`,
                is_read: true,
            });
            if (chatError) {
                console.warn('[VerificationManager] chat_messages insert failed:', chatError);
            }
        }

        // Structured note in admin chat feed (alongside Verification Skip Reason cards)
        const { error: noteError } = await supabase.from('customer_notes').insert({
            customer_id: customer.id,
            booking_id: targets[0].id,
            source: 'Verification Completed',
            content: completionText,
            author_type: 'admin',
            is_read: true,
        });
        if (noteError) {
            console.warn('[VerificationManager] customer_notes insert failed:', noteError);
        }

        const siteUrl = typeof window !== 'undefined' ? window.location.origin : undefined;
        await Promise.all(bookingIds.map(async (id) => {
            const { error: emailError } = await supabase.functions.invoke('send-booking-confirmation', {
                body: { bookingId: id, site_url: siteUrl },
            });
            if (emailError) {
                console.warn('[VerificationManager] confirmation email failed for booking', id, emailError);
            }
        }));
    };

    const performSave = async ({ nextFront, nextBack, nextInsurance, isFirstCompleteSubmit }) => {
        const { error: customerError } = await supabase
            .from('customers')
            .update({
                license_plate: licensePlate,
                has_incomplete_verification: false,
            })
            .eq('id', customer.id);

        if (customerError) throw customerError;

        if (hasSlot(nextFront) && hasSlot(nextBack) && hasSlot(nextInsurance)) {
            await saveVerificationDocumentToDb(
                customer.id,
                nextFront.url || null,
                nextFront.path || null,
                nextBack.url || null,
                nextBack.path || null,
                'approved',
                nextInsurance.url || null,
                nextInsurance.path || null,
            );
        }

        if (isFirstCompleteSubmit) {
            await completeSkippedBookings();
        }

        setFrontImage(null);
        setBackImage(null);
        setInsuranceImage(null);
        setExistingFrontUrl(nextFront?.url || null);
        setExistingBackUrl(nextBack?.url || null);
        setExistingInsuranceUrl(nextInsurance?.url || null);
        setExistingFrontPath(nextFront?.path || null);
        setExistingBackPath(nextBack?.path || null);
        setExistingInsurancePath(nextInsurance?.path || null);
        setHadCompleteDocsOnLoad(true);
        setDisplayRefreshKey((prev) => prev + 1);

        toast({
            title: isFirstCompleteSubmit ? 'Verification Complete' : 'Verification Info Updated!',
            description: isFirstCompleteSubmit
                ? 'Thank you. Your documents have been submitted and a booking confirmation email is on the way.'
                : 'Your information has been submitted for review.',
        });
        if (onUpdate) onUpdate();
    };

    const handleSubmit = async () => {
        if (!customer?.id) {
            toast({ title: 'Authentication Error', description: 'Customer profile not found.', variant: 'destructive' });
            return;
        }
        if (plateError) {
            toast({ title: 'Invalid License Plate', description: 'Please correct the format.', variant: 'destructive' });
            return;
        }
        if (!String(licensePlate || '').trim()) {
            toast({
                title: 'License Plate Required',
                description: 'Please enter your towing vehicle license plate.',
                variant: 'destructive',
            });
            return;
        }

        const merged = await getMergedVerificationDocumentsByCustomerId(customer.id);

        const nextFront = frontImage || {
            url: existingFrontUrl || merged?.license_front_url,
            path: existingFrontPath || merged?.license_front_storage_path,
        };
        const nextBack = backImage || {
            url: existingBackUrl || merged?.license_back_url,
            path: existingBackPath || merged?.license_back_storage_path,
        };
        const nextInsurance = insuranceImage || {
            url: existingInsuranceUrl || merged?.insurance_url,
            path: existingInsurancePath || merged?.insurance_storage_path,
        };

        const packageComplete =
            Boolean(String(licensePlate || '').trim()) &&
            hasSlot(nextFront) &&
            hasSlot(nextBack) &&
            hasSlot(nextInsurance);

        if (!packageComplete) {
            toast({
                title: 'Incomplete Verification',
                description:
                    'Please provide your license plate plus front and back of your driver’s license and your insurance document.',
                variant: 'destructive',
            });
            return;
        }

        const needsFirstAttestation =
            !hadCompleteDocsOnLoad &&
            (customer?.has_incomplete_verification ||
                skippedBookings.length > 0 ||
                (bookings || []).some(
                    (b) =>
                        b.status === 'pending_verification' ||
                        b.was_verification_skipped ||
                        b.addons?.wasVerificationSkipped
                ));

        if (needsFirstAttestation) {
            setPendingSavePayload({ nextFront, nextBack, nextInsurance, isFirstCompleteSubmit: true });
            setAttestChecked(false);
            setAttestOpen(true);
            return;
        }

        setIsUploading(true);
        try {
            await performSave({
                nextFront,
                nextBack,
                nextInsurance,
                isFirstCompleteSubmit: false,
            });
        } catch (error) {
            toast({ title: 'Update Failed', description: error.message, variant: 'destructive' });
        } finally {
            setIsUploading(false);
        }
    };

    const handleConfirmAttestation = async () => {
        if (!attestChecked || !pendingSavePayload) return;
        setIsUploading(true);
        try {
            await performSave(pendingSavePayload);
            setAttestOpen(false);
            setPendingSavePayload(null);
            setAttestChecked(false);
        } catch (error) {
            toast({ title: 'Update Failed', description: error.message, variant: 'destructive' });
        } finally {
            setIsUploading(false);
        }
    };

    return (
        <TooltipProvider>
            {deadlineBanner && (
                <div className="mb-6 rounded-xl border border-orange-500/50 bg-orange-900/30 p-4 text-orange-100 text-sm">
                    <p className="font-semibold text-orange-300 mb-1">Action required — license verification</p>
                    <p>{deadlineBanner}</p>
                </div>
            )}

            <Card className="bg-white/5 border-white/10 text-white mb-6">
                <CardHeader>
                    <CardTitle className="text-lg font-bold text-yellow-400">Current Verification Status</CardTitle>
                    <CardDescription className="text-blue-200">
                        View your currently saved verification documents.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <VerificationImageDisplay customerId={customer?.id} refreshKey={displayRefreshKey} />
                </CardContent>
            </Card>

            <Card className="bg-white/5 border-white/10 text-white">
                <CardHeader>
                    <CardTitle className="text-lg font-bold text-yellow-400">
                        {hadCompleteDocsOnLoad ? 'Update Verification' : 'Complete Verification'}
                    </CardTitle>
                    <CardDescription className="text-blue-200">
                        {hadCompleteDocsOnLoad
                            ? 'Upload new documents if requested by our team.'
                            : 'Add your license plate, driver’s license (front and back), and insurance to finish your booking.'}
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    <div>
                        <div className="flex items-center">
                            <Label htmlFor="licensePlate">Towing Vehicle License Plate</Label>
                            <VerificationInfoTooltip />
                        </div>
                        <Input
                            id="licensePlate"
                            value={licensePlate}
                            onChange={handlePlateChange}
                            placeholder="e.g., ABC1234"
                            className="bg-white/20 uppercase mt-1"
                            maxLength="7"
                            disabled={isUploading}
                        />
                        {plateError && <p className="text-red-400 text-xs mt-1">{plateError}</p>}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-2">
                            <Label>Driver&apos;s License (Front)</Label>
                            {frontImage ? (
                                <div className="p-3 bg-green-900/30 border border-green-500 rounded text-green-300 text-sm text-center">New Front Image Selected</div>
                            ) : (
                                <Button type="button" variant="outline" className="w-full h-20 bg-black/20 hover:bg-white/10" onClick={() => fileInputFrontRef.current?.click()} disabled={isUploading}>
                                    <UploadCloud className="mr-2 h-4 w-4" /> Choose Front Image
                                </Button>
                            )}
                            <Input ref={fileInputFrontRef} type="file" className="hidden" onChange={(e) => handleFileChange(e, 'license_front')} disabled={isUploading} accept="image/*" />
                        </div>
                        <div className="space-y-2">
                            <Label>Driver&apos;s License (Back)</Label>
                            {backImage ? (
                                <div className="p-3 bg-green-900/30 border border-green-500 rounded text-green-300 text-sm text-center">New Back Image Selected</div>
                            ) : (
                                <Button type="button" variant="outline" className="w-full h-20 bg-black/20 hover:bg-white/10" onClick={() => fileInputBackRef.current?.click()} disabled={isUploading}>
                                    <UploadCloud className="mr-2 h-4 w-4" /> Choose Back Image
                                </Button>
                            )}
                            <Input ref={fileInputBackRef} type="file" className="hidden" onChange={(e) => handleFileChange(e, 'license_back')} disabled={isUploading} accept="image/*" />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label>Auto Insurance (Declaration Page or Insurance Card)</Label>
                        {insuranceImage ? (
                            <div className="p-3 bg-green-900/30 border border-green-500 rounded text-green-300 text-sm text-center">New Insurance Document Selected</div>
                        ) : (
                            <Button type="button" variant="outline" className="w-full h-20 bg-black/20 hover:bg-white/10" onClick={() => fileInputInsuranceRef.current?.click()} disabled={isUploading}>
                                <UploadCloud className="mr-2 h-4 w-4" /> Choose Insurance Document
                            </Button>
                        )}
                        <Input ref={fileInputInsuranceRef} type="file" className="hidden" onChange={(e) => handleFileChange(e, 'insurance_document')} disabled={isUploading} accept="image/*,application/pdf" />
                    </div>

                    <div className="flex justify-end pt-4">
                        <Button onClick={handleSubmit} disabled={isUploading} className="bg-yellow-500 hover:bg-yellow-600 text-black font-semibold">
                            {isUploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
                            Submit Verification
                        </Button>
                    </div>
                </CardContent>
            </Card>

            <Dialog
                open={attestOpen}
                onOpenChange={(open) => {
                    if (!isUploading) {
                        setAttestOpen(open);
                        if (!open) {
                            setPendingSavePayload(null);
                            setAttestChecked(false);
                        }
                    }
                }}
            >
                <DialogContent className="bg-gray-900 border-yellow-500/40 text-white max-w-lg">
                    <DialogHeader>
                        <DialogTitle className="text-yellow-400">Confirm Your Information</DialogTitle>
                        <DialogDescription className="text-blue-200">
                            Before we mark your verification complete, please confirm that the documents and details you provided are accurate.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="flex items-start gap-3 py-2">
                        <Checkbox
                            id="verification-attestation"
                            checked={attestChecked}
                            onCheckedChange={(checked) => setAttestChecked(checked === true)}
                            className="mt-1 border-white/40 data-[state=checked]:bg-yellow-500 data-[state=checked]:text-black"
                        />
                        <Label htmlFor="verification-attestation" className="text-sm text-gray-100 leading-relaxed cursor-pointer">
                            I confirm that I have provided current and proper information, and I verify that this is my legally correct license plate, driver’s license, and insurance information.
                        </Label>
                    </div>
                    <DialogFooter className="gap-2 sm:gap-0">
                        <Button
                            type="button"
                            variant="outline"
                            className="border-white/20 text-white"
                            disabled={isUploading}
                            onClick={() => {
                                setAttestOpen(false);
                                setPendingSavePayload(null);
                                setAttestChecked(false);
                            }}
                        >
                            Cancel
                        </Button>
                        <Button
                            type="button"
                            className="bg-yellow-500 hover:bg-yellow-600 text-black font-semibold"
                            disabled={!attestChecked || isUploading}
                            onClick={handleConfirmAttestation}
                        >
                            {isUploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                            Verify &amp; Submit
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </TooltipProvider>
    );
};
