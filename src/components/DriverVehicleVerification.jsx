import React, { useState, useRef, useMemo, useEffect } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, ArrowRight, ShieldCheck, UploadCloud, X, AlertTriangle, Loader2, CheckCircle2, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from '@/components/ui/use-toast';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { uploadVerificationImage, saveCheckoutVerificationDocuments, getCheckoutVerificationDocuments, isVerificationPdf } from '@/utils/verificationImageHelper';
import { isCheckoutEmailVerifiedSync } from '@/utils/checkoutEmailVerification';
import { VerificationInfoTooltip } from '@/components/VerificationInfoTooltip';
import { UiControlGuide } from '@/components/UiControlGuide';
import { getBookingGuideEntries } from '@/config/uiControlGuideEntries';
import { useReturningCustomerDetection } from '@/hooks/useReturningCustomerDetection';

const FilePreview = ({ file, url, storagePath, onRemove, onPreviewFailed }) => {
    const [previewFailed, setPreviewFailed] = useState(false);
    const [objectUrl, setObjectUrl] = useState(null);
    const isPdf = file?.type === 'application/pdf' || isVerificationPdf(storagePath || url);
    const hasFilePreview = Boolean(file && !isPdf);
    const hasUrlPreview = Boolean(url && !isPdf && !previewFailed);
    const showPreview = hasFilePreview || hasUrlPreview;

    useEffect(() => {
        setPreviewFailed(false);
        onPreviewFailed?.(false);
    }, [url, file, onPreviewFailed]);

    useEffect(() => {
        if (!hasFilePreview) {
            setObjectUrl(null);
            return undefined;
        }

        const nextUrl = URL.createObjectURL(file);
        setObjectUrl(nextUrl);
        return () => URL.revokeObjectURL(nextUrl);
    }, [file, hasFilePreview]);

    if (!file && !url && !storagePath) return null;

    const previewUrl = objectUrl || url;

    return (
        <div className="relative group w-full h-32 rounded-lg overflow-hidden border border-white/20 bg-black/40">
            {isPdf ? (
                <div className="w-full h-full flex flex-col items-center justify-center text-blue-200 px-4 text-center">
                    <FileText className="h-8 w-8 mb-2 text-yellow-400" />
                    <p className="text-sm">{file?.name || 'Insurance document uploaded'}</p>
                </div>
            ) : showPreview ? (
                <img
                    src={previewUrl}
                    alt="Preview"
                    className="w-full h-full object-contain"
                    onError={() => {
                        setPreviewFailed(true);
                        onPreviewFailed?.(true);
                    }}
                />
            ) : (
                <div className="w-full h-full flex flex-col items-center justify-center text-blue-200 px-4 text-center">
                    <FileText className="h-8 w-8 mb-2 text-yellow-400" />
                    <p className="text-sm">Preview unavailable — upload a new photo to continue</p>
                </div>
            )}
            <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <Button variant="destructive" size="icon" className="h-8 w-8" onClick={onRemove}>
                    <X className="h-5 w-5" />
                </Button>
            </div>
        </div>
    );
};

const IncompleteInfoPopover = () => (
    <Popover>
        <PopoverTrigger asChild>
            <button type="button" className="text-yellow-400 hover:text-yellow-300 transition-colors relative">
                <AlertTriangle className="h-5 w-5 mr-2" />
                <div className="absolute top-0 left-0 h-full w-full bg-yellow-400 rounded-full animate-ping opacity-75"></div>
            </button>
        </PopoverTrigger>
        <PopoverContent side="top" className="bg-gray-900 border-yellow-500 text-white max-w-md p-4">
            <h4 className="font-bold text-yellow-300 mb-2">Vital Information Required</h4>
            <p className="text-sm text-blue-200">
                This information is vital for securing your ability to rent our equipment. Skipping this may result in order cancellation or pickup delays. You can add it later via your Customer Portal.
            </p>
        </PopoverContent>
    </Popover>
);

function slotHasWorkingPreview({ file, url, path, previewFailed }) {
    if (file) return true;
    if (isVerificationPdf(path || url) && (path || url)) return true;
    return Boolean(url && !previewFailed);
}

export const DriverVehicleVerification = ({
    onVerifiedSubmit,
    onBack,
    customerId: customerIdProp,
    customerEmail,
    bookingData,
}) => {
    const [resolvedCustomerId, setResolvedCustomerId] = useState(customerIdProp || bookingData?.contactAddress?.customerId || null);
    const { isReturning: isTrueReturning, customerData, loading: detectingReturning } = useReturningCustomerDetection(customerEmail);

    const [licensePlate, setLicensePlate] = useState('');
    const [plateError, setPlateError] = useState('');
    
    const [licenseFrontFile, setLicenseFrontFile] = useState(null);
    const [licenseBackFile, setLicenseBackFile] = useState(null);
    const [insuranceFile, setInsuranceFile] = useState(null);
    
    // Track existing URLs if customer already has documents
    const [existingFrontUrl, setExistingFrontUrl] = useState(null);
    const [existingBackUrl, setExistingBackUrl] = useState(null);
    const [existingInsuranceUrl, setExistingInsuranceUrl] = useState(null);
    const [existingFrontPath, setExistingFrontPath] = useState(null);
    const [existingBackPath, setExistingBackPath] = useState(null);
    const [existingInsurancePath, setExistingInsurancePath] = useState(null);
    const [frontPreviewFailed, setFrontPreviewFailed] = useState(false);
    const [backPreviewFailed, setBackPreviewFailed] = useState(false);
    const [insurancePreviewFailed, setInsurancePreviewFailed] = useState(false);

    const [isUploading, setIsUploading] = useState(false);
    const [isLoadingInitial, setIsLoadingInitial] = useState(true);
    const [verificationNotes, setVerificationNotes] = useState('');
    
    const [isEmailRegistered, setIsEmailRegistered] = useState(false);
    const [initialPlateLoaded, setInitialPlateLoaded] = useState(false);
    const [showAttestationDialog, setShowAttestationDialog] = useState(false);
    const [attestationAccepted, setAttestationAccepted] = useState(false);

    const effectiveCustomerId = resolvedCustomerId || customerIdProp || bookingData?.contactAddress?.customerId;

    const isReturningCustomer =
        isTrueReturning || Boolean(bookingData?.returningCustomerVerified);

    const fileInputFrontRef = useRef(null);
    const fileInputBackRef = useRef(null);
    const fileInputInsuranceRef = useRef(null);

    useEffect(() => {
        setResolvedCustomerId(customerIdProp || bookingData?.contactAddress?.customerId || customerData?.id || null);
    }, [customerIdProp, bookingData?.contactAddress?.customerId, customerData?.id]);

    useEffect(() => {
        const fetchExistingDocs = async () => {
            setIsLoadingInitial(true);
            if (!effectiveCustomerId) {
                setIsLoadingInitial(false);
                return;
            }
            try {
                const doc = customerEmail
                    ? await getCheckoutVerificationDocuments(effectiveCustomerId, customerEmail, {
                        pendingToken: bookingData?.pendingToken || null,
                    })
                    : null;

                if (doc?.license_plate && !initialPlateLoaded) {
                    setLicensePlate(String(doc.license_plate).toUpperCase());
                    setInitialPlateLoaded(true);
                }

                if (doc) {
                    setExistingFrontUrl(doc.license_front_url || null);
                    setExistingBackUrl(doc.license_back_url || null);
                    setExistingInsuranceUrl(doc.insurance_url || null);
                    setExistingFrontPath(doc.license_front_storage_path || null);
                    setExistingBackPath(doc.license_back_storage_path || null);
                    setExistingInsurancePath(doc.insurance_storage_path || null);
                    setFrontPreviewFailed(false);
                    setBackPreviewFailed(false);
                    setInsurancePreviewFailed(false);
                    setIsEmailRegistered(isTrueReturning);
                } else {
                    setExistingFrontUrl(null);
                    setExistingBackUrl(null);
                    setExistingInsuranceUrl(null);
                    setExistingFrontPath(null);
                    setExistingBackPath(null);
                    setExistingInsurancePath(null);
                    setFrontPreviewFailed(false);
                    setBackPreviewFailed(false);
                    setInsurancePreviewFailed(false);
                    setIsEmailRegistered(Boolean(isTrueReturning && customerData));
                }
            } catch (err) {
                console.error('Error fetching existing documents:', err);
                if (effectiveCustomerId) setIsEmailRegistered(isTrueReturning);
            } finally {
                setIsLoadingInitial(false);
            }
        };
        fetchExistingDocs();
    }, [effectiveCustomerId, customerEmail, isTrueReturning, customerData, initialPlateLoaded, bookingData?.pendingToken]);

    const handleAttestationConfirm = (e) => {
        if (!attestationAccepted) return;
        setShowAttestationDialog(false);
        setAttestationAccepted(false);
        handleSubmit(e, false);
    };

    const handleContinueWithAttestation = (e) => {
        e.preventDefault();
        if (!isFormComplete || plateError) return;
        if (isReturningCustomer) {
            setAttestationAccepted(false);
            setShowAttestationDialog(true);
            return;
        }
        handleSubmit(e, false);
    };

    const hasWorkingFront = slotHasWorkingPreview({
        file: licenseFrontFile,
        url: existingFrontUrl,
        path: existingFrontPath,
        previewFailed: frontPreviewFailed,
    });
    const hasWorkingBack = slotHasWorkingPreview({
        file: licenseBackFile,
        url: existingBackUrl,
        path: existingBackPath,
        previewFailed: backPreviewFailed,
    });
    const hasWorkingInsurance = slotHasWorkingPreview({
        file: insuranceFile,
        url: existingInsuranceUrl,
        path: existingInsurancePath,
        previewFailed: insurancePreviewFailed,
    });

    const isFormComplete = useMemo(() => {
        const plateRegex = /^[A-Z0-9]{6,7}$/;
        return plateRegex.test(licensePlate) && hasWorkingFront && hasWorkingBack && hasWorkingInsurance;
    }, [licensePlate, hasWorkingFront, hasWorkingBack, hasWorkingInsurance]);

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
    
    const handleFileChange = (setter, clearExistingUrl, clearExistingPath, clearPreviewFailed) => (e) => {
        const file = e.target.files[0];
        if (file) {
            setter(file);
            clearExistingUrl?.(null);
            clearExistingPath?.(null);
            clearPreviewFailed?.(false);
        }
        e.target.value = '';
    };

    const handleSubmit = async (e, isSkipping) => {
        e.preventDefault();
        
        if (isSkipping && !verificationNotes) {
            toast({ title: 'Reason Required', description: 'Please provide a reason for skipping verification.', variant: 'destructive', duration: 15000});
            return;
        }
        if (!isSkipping && plateError) {
             toast({ title: 'Invalid License Plate', description: 'Please correct the license plate format before submitting.', variant: 'destructive', duration: 15000});
            return;
        }

        setIsUploading(true);
        // Client fallback must use unassigned-* paths (storage RLS). Prefer edge save when verified.
        const effectiveCustomerIdForUpload = `unassigned-${Date.now()}`;
        const emailVerified = isCheckoutEmailVerifiedSync(customerEmail, bookingData || {});
        const canPersistToCustomer = Boolean(
            effectiveCustomerId &&
            customerEmail &&
            (emailVerified || bookingData?.returningCustomerVerified)
        );

        try {
            let frontImage = { url: existingFrontUrl, path: existingFrontPath };
            let backImage = { url: existingBackUrl, path: existingBackPath };
            let insuranceImage = { url: existingInsuranceUrl, path: existingInsurancePath };

            if (!isSkipping && canPersistToCustomer) {
                const result = await saveCheckoutVerificationDocuments({
                    customerId: effectiveCustomerId,
                    email: customerEmail,
                    pendingToken: bookingData?.pendingToken || null,
                    licensePlate: licensePlate || null,
                    licenseFrontFile,
                    licenseBackFile,
                    insuranceFile,
                    existingFrontUrl,
                    existingFrontPath,
                    existingBackUrl,
                    existingBackPath,
                    existingInsuranceUrl,
                    existingInsurancePath,
                });

                const docs = result?.documents || {};
                frontImage = {
                    url: docs.license_front_url || frontImage.url,
                    path: docs.license_front_storage_path || frontImage.path,
                };
                backImage = {
                    url: docs.license_back_url || backImage.url,
                    path: docs.license_back_storage_path || backImage.path,
                };
                insuranceImage = {
                    url: docs.insurance_url || insuranceImage.url,
                    path: docs.insurance_storage_path || insuranceImage.path,
                };
            } else {
                if (licenseFrontFile) {
                    frontImage = await uploadVerificationImage(effectiveCustomerIdForUpload, licenseFrontFile, 'license_front');
                }
                if (licenseBackFile) {
                    backImage = await uploadVerificationImage(effectiveCustomerIdForUpload, licenseBackFile, 'license_back');
                }
                if (insuranceFile) {
                    insuranceImage = await uploadVerificationImage(effectiveCustomerIdForUpload, insuranceFile, 'insurance_document');
                }
            }

            if ((licenseFrontFile && !frontImage?.path && !frontImage?.url) || (licenseBackFile && !backImage?.path && !backImage?.url) || (insuranceFile && !insuranceImage?.path && !insuranceImage?.url)) {
                throw new Error("Failed to upload one or more images.");
            }

            const licenseImageUrls = [frontImage, backImage].filter(img => img && (img.url || img.path));
            
            onVerifiedSubmit({
                licensePlate,
                licenseImageUrls,
                insuranceImageUrl: (insuranceImage?.url || insuranceImage?.path) ? insuranceImage : null,
                wasVerificationSkipped: isSkipping,
                verificationNotes: isSkipping ? verificationNotes : null
            });
        } catch (error) {
            console.error("Verification upload error:", error);
            
            // Handle duplicate email error gracefully with friendly informational toast
            if (error.message && error.message.includes('already registered')) {
                setIsEmailRegistered(true);
                toast({ 
                    title: 'Email Already in System', 
                    description: 'This email is already in our system. You can log in with your existing account or use a different email to continue.',
                    variant: 'info',
                    duration: 6000
                });
            } else {
                toast({ 
                    title: 'Upload Failed', 
                    description: error.message || 'Failed to upload verification documents.', 
                    variant: 'destructive', 
                    duration: 15000 
                });
            }
        } finally {
            setIsUploading(false);
        }
    };

    if (isLoadingInitial || detectingReturning) {
        return (
            <div className="container mx-auto py-16 px-4 flex justify-center items-center min-h-[50vh]">
                <Loader2 className="h-12 w-12 animate-spin text-yellow-400" />
            </div>
        );
    }

    return (
        <TooltipProvider>
            <motion.div
                initial={{ opacity: 0, y: 50 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -50 }}
                className="container mx-auto py-16 px-4"
            >
                <div className="max-w-3xl mx-auto bg-white/10 backdrop-blur-lg rounded-2xl p-8 shadow-2xl border border-white/20">
                    <div className="flex items-center mb-8 border-b border-white/10 pb-4">
                        <Button onClick={onBack} variant="ghost" size="icon" className="mr-4 text-white hover:bg-white/20" disabled={isUploading}>
                            <ArrowLeft />
                        </Button>
                        <div>
                            <h2 className="text-3xl font-bold text-white flex items-center">
                                <ShieldCheck className="mr-3 h-8 w-8 text-yellow-400" />
                                Driver & Vehicle Verification
                            </h2>
                            <p className="text-blue-200 mt-1">
                                For security and to comply with our rental agreement, please provide the following information for the person picking up the equipment.
                            </p>
                        </div>
                    </div>

                    {isEmailRegistered && (
                        <motion.div 
                            initial={{ opacity: 0, y: -10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="mb-6 bg-blue-900/30 border border-blue-500/50 p-4 rounded-xl flex items-start gap-3"
                        >
                            <CheckCircle2 className="h-6 w-6 text-blue-400 flex-shrink-0 mt-0.5" />
                            <div>
                                <h4 className="font-semibold text-blue-300 text-lg mb-1">Welcome Back!</h4>
                                <p className="text-blue-200 text-sm">
                                    Your saved documents are shown below. Please confirm they are still current for this rental, or update them if anything has changed.
                                </p>
                            </div>
                        </motion.div>
                    )}

                    {isReturningCustomer && (
                    <div className="mb-6 bg-amber-900/25 border border-amber-500/40 rounded-xl p-5">
                        <h4 className="text-lg font-semibold text-amber-200 mb-2">Verify Your Information</h4>
                        <p className="text-sm text-amber-100/90 leading-relaxed">
                            Please verify that the driver&apos;s license, auto insurance, and towing vehicle license plate shown below are
                            <strong> correct, current, and true</strong> for the person picking up this rental and the vehicle being used.
                            Update any information before continuing. If you continue without complete or current documentation, your booking may be flagged for manual review by our team.
                        </p>
                    </div>
                    )}

                    <div className="space-y-8 bg-black/20 p-6 rounded-xl border border-white/10">
                        <div>
                            <div className="flex items-center mb-2">
                                <Label htmlFor="licensePlate" className="text-lg font-semibold text-white">Towing Vehicle License Plate</Label>
                                <VerificationInfoTooltip />
                            </div>
                            <Input 
                                id="licensePlate" 
                                value={licensePlate} 
                                onChange={handlePlateChange}
                                placeholder="e.g., ABC1234"
                                className="bg-white/10 border-white/30 text-white uppercase text-lg h-14"
                                maxLength="7"
                                disabled={isUploading}
                            />
                            {plateError && <p className="text-red-400 text-sm mt-2">{plateError}</p>}
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-white/10">
                            <div className="space-y-3">
                                <Label className="text-lg font-semibold text-white">Driver's License (Front)</Label>
                                <FilePreview
                                    file={licenseFrontFile}
                                    url={existingFrontUrl}
                                    storagePath={existingFrontPath}
                                    onPreviewFailed={setFrontPreviewFailed}
                                    onRemove={() => {
                                        setLicenseFrontFile(null);
                                        setExistingFrontUrl(null);
                                        setExistingFrontPath(null);
                                        setFrontPreviewFailed(false);
                                    }}
                                />
                                {!hasWorkingFront && (
                                    <Button type="button" variant="outline" className="w-full h-14 bg-white/5 border-white/30 hover:bg-white/10 text-white" onClick={() => fileInputFrontRef.current?.click()} disabled={isUploading}>
                                        <UploadCloud className="mr-2 h-5 w-5"/> {(existingFrontPath || existingFrontUrl) ? 'Replace Front Photo' : 'Upload Front'}
                                    </Button>
                                )}
                                <Input
                                    ref={fileInputFrontRef}
                                    id="licenseFront"
                                    type="file"
                                    className="hidden"
                                    onChange={handleFileChange(setLicenseFrontFile, setExistingFrontUrl, setExistingFrontPath, setFrontPreviewFailed)}
                                    disabled={isUploading}
                                    accept="image/*"
                                />
                            </div>
                            <div className="space-y-3">
                                <Label className="text-lg font-semibold text-white">Driver's License (Back)</Label>
                                <FilePreview
                                    file={licenseBackFile}
                                    url={existingBackUrl}
                                    storagePath={existingBackPath}
                                    onPreviewFailed={setBackPreviewFailed}
                                    onRemove={() => {
                                        setLicenseBackFile(null);
                                        setExistingBackUrl(null);
                                        setExistingBackPath(null);
                                        setBackPreviewFailed(false);
                                    }}
                                />
                                {!hasWorkingBack && (
                                    <Button type="button" variant="outline" className="w-full h-14 bg-white/5 border-white/30 hover:bg-white/10 text-white" onClick={() => fileInputBackRef.current?.click()} disabled={isUploading}>
                                        <UploadCloud className="mr-2 h-5 w-5"/> {(existingBackPath || existingBackUrl) ? 'Replace Back Photo' : 'Upload Back'}
                                    </Button>
                                )}
                                <Input
                                    ref={fileInputBackRef}
                                    id="licenseBack"
                                    type="file"
                                    className="hidden"
                                    onChange={handleFileChange(setLicenseBackFile, setExistingBackUrl, setExistingBackPath, setBackPreviewFailed)}
                                    disabled={isUploading}
                                    accept="image/*"
                                />
                            </div>
                        </div>

                        <div className="space-y-3 pt-4 border-t border-white/10">
                            <Label className="text-lg font-semibold text-white">Auto Insurance (Declaration Page or Insurance Card)</Label>
                            <FilePreview
                                file={insuranceFile}
                                url={existingInsuranceUrl}
                                storagePath={existingInsurancePath}
                                onPreviewFailed={setInsurancePreviewFailed}
                                onRemove={() => {
                                    setInsuranceFile(null);
                                    setExistingInsuranceUrl(null);
                                    setExistingInsurancePath(null);
                                    setInsurancePreviewFailed(false);
                                }}
                            />
                            {!hasWorkingInsurance && (
                                <Button
                                    type="button"
                                    variant="outline"
                                    className="w-full h-14 bg-white/5 border-white/30 hover:bg-white/10 text-white"
                                    onClick={() => fileInputInsuranceRef.current?.click()}
                                    disabled={isUploading}
                                >
                                    <UploadCloud className="mr-2 h-5 w-5" />
                                    {(existingInsurancePath || existingInsuranceUrl) ? 'Replace Insurance Document' : 'Upload Insurance Document'}
                                </Button>
                            )}
                            <Input
                                ref={fileInputInsuranceRef}
                                id="insuranceDocument"
                                type="file"
                                className="hidden"
                                onChange={handleFileChange(setInsuranceFile, setExistingInsuranceUrl, setExistingInsurancePath, setInsurancePreviewFailed)}
                                disabled={isUploading}
                                accept="image/*,application/pdf"
                            />
                        </div>
                    </div>

                    {!isFormComplete && (
                        <div className="mt-6 bg-orange-900/30 border border-orange-500/50 p-6 rounded-xl">
                            <h4 className="font-bold text-orange-300 text-lg flex items-center mb-3">
                                <IncompleteInfoPopover />
                                Incomplete Information
                            </h4>
                            <p className="text-orange-200 mb-4">If you continue without providing all required items, your booking will be placed on hold pending manual review.</p>
                            <Label htmlFor="verificationNotes" className="text-white block mb-2">Reason for skipping (required if incomplete):</Label>
                            <Textarea 
                                id="verificationNotes"
                                value={verificationNotes}
                                onChange={(e) => setVerificationNotes(e.target.value)}
                                className="bg-white/10 border-white/30 text-white placeholder-orange-200/50"
                                placeholder="e.g., Don't have license or insurance documents on hand right now."
                                disabled={isUploading}
                            />
                        </div>
                    )}

                    <div className="flex flex-col sm:flex-row gap-4 sm:justify-between mt-8">
                        <Button 
                            variant="outline"
                            onClick={(e) => handleSubmit(e, true)}
                            disabled={isUploading || !verificationNotes}
                            className="py-6 border-orange-500/50 text-orange-400 hover:bg-orange-900/30 hover:text-orange-300"
                        >
                            {isUploading ? <Loader2 className="mr-2 h-5 w-5 animate-spin"/> : <AlertTriangle className="mr-2 h-5 w-5"/>}
                            Continue without Info
                        </Button>
                        <Button 
                            onClick={handleContinueWithAttestation}
                            disabled={isUploading || !isFormComplete}
                            className="py-6 px-8 text-lg font-bold bg-green-600 hover:bg-green-700 text-white"
                        >
                            {isUploading ? <Loader2 className="mr-2 h-5 w-5 animate-spin"/> : <>Submit & Continue <ArrowRight className="ml-2 h-5 w-5"/></>}
                        </Button>
                    </div>

                    <Dialog open={showAttestationDialog} onOpenChange={setShowAttestationDialog}>
                        <DialogContent className="max-w-lg bg-gray-900 border-white/20 text-white">
                            <DialogHeader>
                                <DialogTitle className="text-xl text-yellow-300">Confirm Driver &amp; Vehicle Information</DialogTitle>
                                <DialogDescription className="text-blue-200 text-sm leading-relaxed pt-2">
                                    Before continuing, you must confirm the accuracy of the information provided for this rental.
                                </DialogDescription>
                            </DialogHeader>
                            <div className="space-y-4 py-2">
                                <p className="text-sm text-blue-100 leading-relaxed">
                                    By checking the box below and continuing, you represent and affirm under penalty of applicable law that:
                                </p>
                                <ul className="text-sm text-blue-200/90 list-disc pl-5 space-y-2">
                                    <li>The driver&apos;s license images, auto insurance document, and towing vehicle license plate are true, correct, and current as of today.</li>
                                    <li>The person listed is authorized to pick up this rental and the towing vehicle identified is the vehicle that will be used.</li>
                                    <li>You understand that false or outdated information may result in cancellation, delays, fees, or denial of service.</li>
                                </ul>
                                <label className="flex items-start gap-3 cursor-pointer rounded-lg border border-white/20 bg-black/30 p-4">
                                    <Checkbox
                                        checked={attestationAccepted}
                                        onCheckedChange={(checked) => setAttestationAccepted(checked === true)}
                                        className="mt-0.5 border-white/40 data-[state=checked]:bg-yellow-500 data-[state=checked]:border-yellow-500"
                                    />
                                    <span className="text-sm text-white leading-relaxed">
                                        I certify that the driver and vehicle information provided is accurate, current, and complete to the best of my knowledge.
                                    </span>
                                </label>
                            </div>
                            <DialogFooter className="flex-col sm:flex-row gap-2">
                                <Button
                                    type="button"
                                    variant="outline"
                                    className="w-full sm:w-auto"
                                    onClick={() => {
                                        setShowAttestationDialog(false);
                                        setAttestationAccepted(false);
                                    }}
                                >
                                    Go Back &amp; Review
                                </Button>
                                <Button
                                    type="button"
                                    className="w-full sm:w-auto bg-green-600 hover:bg-green-700"
                                    disabled={!attestationAccepted || isUploading}
                                    onClick={handleAttestationConfirm}
                                >
                                    I Agree &amp; Continue
                                </Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>
                    <UiControlGuide
                        stepTitle="Driver & Vehicle Verification"
                        entries={getBookingGuideEntries('verification')}
                        className="mt-4 flex justify-end"
                    />
                </div>
            </motion.div>
        </TooltipProvider>
    );
};
