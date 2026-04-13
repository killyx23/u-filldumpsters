
import React, { useState, useRef, useMemo, useEffect } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, ArrowRight, ShieldCheck, UploadCloud, X, Info, AlertTriangle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/use-toast';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { uploadVerificationImage, saveVerificationDocumentToDb, updateVerificationStatus, getVerificationDocumentsByCustomerId } from '@/utils/verificationImageHelper';

const FilePreview = ({ file, url, onRemove }) => {
    if (!file && !url) return null;
    const displayUrl = file ? URL.createObjectURL(file) : url;
    return (
        <div className="relative group w-full h-32 rounded-lg overflow-hidden border border-white/20 bg-black/40">
            <img src={displayUrl} alt="Preview" className="w-full h-full object-contain" />
            <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <Button variant="destructive" size="icon" className="h-8 w-8" onClick={onRemove}>
                    <X className="h-5 w-5" />
                </Button>
            </div>
        </div>
    );
};

const PlateInfoTooltip = () => (
  <Tooltip>
    <TooltipTrigger asChild>
      <button type="button" className="ml-2 text-blue-300 hover:text-yellow-400 transition-colors">
        <Info className="h-5 w-5"/>
      </button>
    </TooltipTrigger>
    <TooltipContent side="top" className="bg-gray-900 border-blue-400 text-white max-w-sm p-4">
      <h4 className="font-bold text-yellow-300 mb-2">Why do we need this information?</h4>
      <p className="text-sm text-blue-200">
        To ensure the security and proper use of our rental equipment, we require the license plate number of the vehicle that will be towing the trailer. This information is crucial for liability & accountability, legal compliance, and asset protection.
      </p>
    </TooltipContent>
  </Tooltip>
);

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

export const DriverVehicleVerification = ({ onVerifiedSubmit, onBack, customerId }) => {
    const [licensePlate, setLicensePlate] = useState('');
    const [plateError, setPlateError] = useState('');
    
    const [licenseFrontFile, setLicenseFrontFile] = useState(null);
    const [licenseBackFile, setLicenseBackFile] = useState(null);
    
    // Track existing URLs if customer already has documents
    const [existingFrontUrl, setExistingFrontUrl] = useState(null);
    const [existingBackUrl, setExistingBackUrl] = useState(null);
    const [existingFrontPath, setExistingFrontPath] = useState(null);
    const [existingBackPath, setExistingBackPath] = useState(null);

    const [isUploading, setIsUploading] = useState(false);
    const [isLoadingInitial, setIsLoadingInitial] = useState(true);
    const [verificationNotes, setVerificationNotes] = useState('');

    const fileInputFrontRef = useRef(null);
    const fileInputBackRef = useRef(null);

    useEffect(() => {
        const fetchExistingDocs = async () => {
            if (!customerId) {
                setIsLoadingInitial(false);
                return;
            }
            try {
                // Returns null gracefully if no record exists due to maybeSingle()
                const doc = await getVerificationDocumentsByCustomerId(customerId);
                if (doc) {
                    setExistingFrontUrl(doc.license_front_url || null);
                    setExistingBackUrl(doc.license_back_url || null);
                    setExistingFrontPath(doc.license_front_storage_path || null);
                    setExistingBackPath(doc.license_back_storage_path || null);
                } else {
                    // Explicitly reset to empty state if no record is found
                    setExistingFrontUrl(null);
                    setExistingBackUrl(null);
                    setExistingFrontPath(null);
                    setExistingBackPath(null);
                }
            } catch (err) {
                console.error("Error fetching existing documents:", err);
            } finally {
                setIsLoadingInitial(false);
            }
        };
        fetchExistingDocs();
    }, [customerId]);

    const isFormComplete = useMemo(() => {
        const plateRegex = /^[A-Z0-9]{6,7}$/;
        const hasFront = licenseFrontFile || existingFrontUrl;
        const hasBack = licenseBackFile || existingBackUrl;
        return plateRegex.test(licensePlate) && hasFront && hasBack;
    }, [licensePlate, licenseFrontFile, licenseBackFile, existingFrontUrl, existingBackUrl]);

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
    
    const handleFileChange = (setter, clearExistingUrl) => (e) => {
        const file = e.target.files[0];
        if (file) {
            setter(file);
            if (clearExistingUrl) clearExistingUrl(null);
        }
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
        // Fallback to unassigned if customer hasn't been created yet in the flow
        const effectiveCustomerId = customerId || `unassigned-${Date.now()}`;
        
        try {
            let frontImage = { url: existingFrontUrl, path: existingFrontPath };
            let backImage = { url: existingBackUrl, path: existingBackPath };

            if (licenseFrontFile) {
                frontImage = await uploadVerificationImage(effectiveCustomerId, licenseFrontFile, 'license_front');
            }
            if (licenseBackFile) {
                backImage = await uploadVerificationImage(effectiveCustomerId, licenseBackFile, 'license_back');
            }

            if ((licenseFrontFile && !frontImage) || (licenseBackFile && !backImage)) {
                throw new Error("Failed to upload one or more images.");
            }

            // Save to the database document table (will gracefully handle INSERT or UPDATE depending on if a record exists)
            if (customerId && frontImage?.url && backImage?.url) {
                await saveVerificationDocumentToDb(
                    customerId, 
                    frontImage.url, 
                    frontImage.path, 
                    backImage.url, 
                    backImage.path
                );
                // If updating existing images, set status to pending again for review
                if (licenseFrontFile || licenseBackFile) {
                    await updateVerificationStatus(customerId, 'pending', null);
                }
            }

            const licenseImageUrls = [frontImage, backImage].filter(img => img && img.url);
            
            onVerifiedSubmit({
                licensePlate,
                licenseImageUrls,
                wasVerificationSkipped: isSkipping,
                verificationNotes: isSkipping ? verificationNotes : null
            });
        } catch (error) {
            console.error("Verification upload error:", error);
            toast({ title: 'Upload Failed', description: error.message || 'Failed to upload verification documents.', variant: 'destructive', duration: 15000 });
        } finally {
            setIsUploading(false);
        }
    };

    if (isLoadingInitial) {
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

                    <div className="space-y-8 bg-black/20 p-6 rounded-xl border border-white/10">
                        <div>
                            <div className="flex items-center mb-2">
                                <Label htmlFor="licensePlate" className="text-lg font-semibold text-white">Towing Vehicle License Plate</Label>
                                <PlateInfoTooltip />
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
                                <FilePreview file={licenseFrontFile} url={existingFrontUrl} onRemove={() => { setLicenseFrontFile(null); setExistingFrontUrl(null); }} />
                                {!licenseFrontFile && !existingFrontUrl && (
                                    <Button type="button" variant="outline" className="w-full h-14 bg-white/5 border-white/30 hover:bg-white/10 text-white" onClick={() => fileInputFrontRef.current?.click()} disabled={isUploading}>
                                        <UploadCloud className="mr-2 h-5 w-5"/> Upload Front
                                    </Button>
                                )}
                                <Input ref={fileInputFrontRef} id="licenseFront" type="file" className="hidden" onChange={handleFileChange(setLicenseFrontFile, setExistingFrontUrl)} disabled={isUploading} accept="image/*" />
                            </div>
                            <div className="space-y-3">
                                <Label className="text-lg font-semibold text-white">Driver's License (Back)</Label>
                                <FilePreview file={licenseBackFile} url={existingBackUrl} onRemove={() => { setLicenseBackFile(null); setExistingBackUrl(null); }} />
                                {!licenseBackFile && !existingBackUrl && (
                                    <Button type="button" variant="outline" className="w-full h-14 bg-white/5 border-white/30 hover:bg-white/10 text-white" onClick={() => fileInputBackRef.current?.click()} disabled={isUploading}>
                                        <UploadCloud className="mr-2 h-5 w-5"/> Upload Back
                                    </Button>
                                )}
                                <Input ref={fileInputBackRef} id="licenseBack" type="file" className="hidden" onChange={handleFileChange(setLicenseBackFile, setExistingBackUrl)} disabled={isUploading} accept="image/*" />
                            </div>
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
                                placeholder="e.g., Don't have license on hand right now."
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
                            onClick={(e) => handleSubmit(e, false)}
                            disabled={isUploading || !isFormComplete}
                            className="py-6 px-8 text-lg font-bold bg-green-600 hover:bg-green-700 text-white"
                        >
                            {isUploading ? <Loader2 className="mr-2 h-5 w-5 animate-spin"/> : <>Submit & Continue <ArrowRight className="ml-2 h-5 w-5"/></>}
                        </Button>
                    </div>
                </div>
            </motion.div>
        </TooltipProvider>
    );
};
