
import React, { useState, useRef, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, ArrowRight, ShieldCheck, UploadCloud, X, Info, AlertTriangle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

const FilePreview = ({ file, onRemove }) => {
    if (!file) return null;
    const url = URL.createObjectURL(file);
    return (
        <div className="relative group w-full h-32 rounded-lg overflow-hidden border border-white/20">
            <img src={url} alt="Preview" className="w-full h-full object-cover" />
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

export const DriverVehicleVerification = ({ onVerifiedSubmit, onBack }) => {
    const [licensePlate, setLicensePlate] = useState('');
    const [plateError, setPlateError] = useState('');
    const [licenseFront, setLicenseFront] = useState(null);
    const [licenseBack, setLicenseBack] = useState(null);
    const [isUploading, setIsUploading] = useState(false);
    const [verificationNotes, setVerificationNotes] = useState('');

    const fileInputFrontRef = useRef(null);
    const fileInputBackRef = useRef(null);

    const isFormComplete = useMemo(() => {
        const plateRegex = /^[A-Z0-9]{6,7}$/;
        return plateRegex.test(licensePlate) && licenseFront && licenseBack;
    }, [licensePlate, licenseFront, licenseBack]);

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
    
    const handleFileChange = (setter) => (e) => {
        const file = e.target.files[0];
        if (file) {
            setter(file);
        }
    };
    
    const uploadFile = useCallback(async (file, folder, customerId) => {
        if (!file) return null;
        const filePath = `${customerId}/${folder}/${Date.now()}-${file.name}`;
        const { error } = await supabase.storage.from('customer-uploads').upload(filePath, file);

        if (error) {
            toast({ title: `Upload Failed for ${file.name}`, description: error.message, variant: "destructive", duration: 15000 });
            return null;
        }
        const { data } = supabase.storage.from('customer-uploads').getPublicUrl(filePath);
        return { url: data.publicUrl, path: filePath, name: file.name };
    }, []);

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
        const tempUserId = `unassigned-${Date.now()}`;
        const frontImage = await uploadFile(licenseFront, 'licenses', tempUserId);
        const backImage = await uploadFile(licenseBack, 'licenses', tempUserId);
        
        if ((licenseFront && !frontImage) || (licenseBack && !backImage)) {
            setIsUploading(false);
            return;
        }

        const licenseImageUrls = [frontImage, backImage].filter(Boolean);
        
        onVerifiedSubmit({
            licensePlate,
            licenseImageUrls,
            wasVerificationSkipped: isSkipping,
            verificationNotes: isSkipping ? verificationNotes : null
        });
        setIsUploading(false);
    };

    return (
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
                            <FilePreview file={licenseFront} onRemove={() => setLicenseFront(null)} />
                             <Button type="button" variant="outline" className="w-full h-14 bg-white/5 border-white/30 hover:bg-white/10 text-white" onClick={() => fileInputFrontRef.current?.click()} disabled={isUploading}>
                                <UploadCloud className="mr-2 h-5 w-5"/> Upload Front
                            </Button>
                            <Input ref={fileInputFrontRef} id="licenseFront" type="file" className="hidden" onChange={handleFileChange(setLicenseFront)} disabled={isUploading} accept="image/*" />
                        </div>
                         <div className="space-y-3">
                            <Label className="text-lg font-semibold text-white">Driver's License (Back)</Label>
                            <FilePreview file={licenseBack} onRemove={() => setLicenseBack(null)} />
                             <Button type="button" variant="outline" className="w-full h-14 bg-white/5 border-white/30 hover:bg-white/10 text-white" onClick={() => fileInputBackRef.current?.click()} disabled={isUploading}>
                                <UploadCloud className="mr-2 h-5 w-5"/> Upload Back
                            </Button>
                            <Input ref={fileInputBackRef} id="licenseBack" type="file" className="hidden" onChange={handleFileChange(setLicenseBack)} disabled={isUploading} accept="image/*" />
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
    );
};
