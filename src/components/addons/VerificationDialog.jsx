
import React, { useState, useRef, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';
import { Loader2, Camera, AlertTriangle, ShieldCheck, UploadCloud, X } from 'lucide-react';
import { motion } from 'framer-motion';

const FilePreview = ({ file, onRemove }) => {
    if (!file) return null;
    const url = URL.createObjectURL(file);
    return (
        <div className="relative group w-full h-32 rounded-lg overflow-hidden">
            <img src={url} alt="Preview" className="w-full h-full object-cover" />
            <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <Button variant="destructive" size="icon" className="h-8 w-8" onClick={onRemove}>
                    <X className="h-5 w-5" />
                </Button>
            </div>
        </div>
    );
};

export const VerificationDialog = ({ open, onOpenChange, onVerifiedSubmit }) => {
    const [licensePlate, setLicensePlate] = useState('');
    const [licenseFront, setLicenseFront] = useState(null);
    const [licenseBack, setLicenseBack] = useState(null);
    const [isUploading, setIsUploading] = useState(false);
    const [verificationNotes, setVerificationNotes] = useState('');

    const fileInputFrontRef = useRef(null);
    const fileInputBackRef = useRef(null);

    const isFormComplete = licensePlate && licenseFront && licenseBack;
    
    const handleFileChange = (setter) => (e) => {
        const file = e.target.files[0];
        if (file) {
            setter(file);
        }
    };
    
    const uploadFile = useCallback(async (file, folder) => {
        if (!file) return null;
        
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            toast({ title: "Authentication Error", description: "You must be logged in to upload files.", variant: "destructive" });
            return null;
        }

        const filePath = `${user.id}/${folder}/${Date.now()}-${file.name}`;
        
        const { error } = await supabase.storage.from('customer-uploads').upload(filePath, file);

        if (error) {
            toast({ title: `Upload Failed for ${file.name}`, description: error.message, variant: "destructive" });
            return null;
        }
        
        const { data } = supabase.storage.from('customer-uploads').getPublicUrl(filePath);
        return { url: data.publicUrl, path: filePath, name: file.name };
    }, []);

    const handleSubmit = async (e, isSkipping) => {
        e.preventDefault();
        
        if (isSkipping && !verificationNotes) {
            toast({ title: 'Reason Required', description: 'Please provide a reason for skipping verification.', variant: 'destructive'});
            return;
        }

        setIsUploading(true);

        const frontImage = await uploadFile(licenseFront, 'licenses');
        const backImage = await uploadFile(licenseBack, 'licenses');
        
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
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="bg-gray-900 border-yellow-500 text-white max-w-2xl">
                <DialogHeader>
                    <DialogTitle className="flex items-center text-yellow-400 text-2xl">
                        <ShieldCheck className="mr-3 h-8 w-8" />
                        Driver & Vehicle Verification
                    </DialogTitle>
                    <DialogDescription className="text-blue-200 pt-2">
                        For security and to comply with our rental agreement, please provide the following information for the person picking up the trailer.
                    </DialogDescription>
                </DialogHeader>

                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="py-4">
                     <div className="mb-4">
                        <Label htmlFor="licensePlate">Towing Vehicle License Plate</Label>
                        <Input 
                            id="licensePlate" 
                            value={licensePlate} 
                            onChange={(e) => setLicensePlate(e.target.value.toUpperCase())}
                            placeholder="e.g., 555-ABC"
                            className="bg-white/20 uppercase"
                        />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label>Driver's License (Front)</Label>
                            <FilePreview file={licenseFront} onRemove={() => setLicenseFront(null)} />
                             <Button type="button" variant="outline" className="w-full" onClick={() => fileInputFrontRef.current?.click()} disabled={isUploading}>
                                <UploadCloud className="mr-2 h-4 w-4"/> Upload Front
                            </Button>
                            <Input ref={fileInputFrontRef} id="licenseFront" type="file" className="hidden" onChange={handleFileChange(setLicenseFront)} disabled={isUploading} accept="image/*" />
                        </div>
                         <div className="space-y-2">
                            <Label>Driver's License (Back)</Label>
                            <FilePreview file={licenseBack} onRemove={() => setLicenseBack(null)} />
                             <Button type="button" variant="outline" className="w-full" onClick={() => fileInputBackRef.current?.click()} disabled={isUploading}>
                                <UploadCloud className="mr-2 h-4 w-4"/> Upload Back
                            </Button>
                            <Input ref={fileInputBackRef} id="licenseBack" type="file" className="hidden" onChange={handleFileChange(setLicenseBack)} disabled={isUploading} accept="image/*" />
                        </div>
                    </div>
                </motion.div>

                {!isFormComplete && (
                     <div className="bg-orange-900/30 border border-orange-500/50 p-4 rounded-md">
                        <h4 className="font-bold text-orange-300 flex items-center mb-2"><AlertTriangle className="h-5 w-5 mr-2"/> Incomplete Information</h4>
                        <p className="text-sm text-orange-200">If you continue without providing all three items, your booking will be placed on hold pending manual review by our team.</p>
                        <Label htmlFor="verificationNotes" className="mt-3 block">Reason for skipping (required if incomplete):</Label>
                         <Textarea 
                            id="verificationNotes"
                            value={verificationNotes}
                            onChange={(e) => setVerificationNotes(e.target.value)}
                            className="bg-white/20 mt-1"
                            placeholder="e.g., Will provide at pickup, technical issue."
                        />
                    </div>
                )}

                <DialogFooter className="gap-2 sm:justify-between mt-4">
                     <Button 
                        variant="destructive"
                        onClick={(e) => handleSubmit(e, true)}
                        disabled={isUploading || !verificationNotes}
                     >
                        {isUploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <AlertTriangle className="mr-2 h-4 w-4"/>}
                        Continue without Info
                    </Button>
                     <Button 
                        onClick={(e) => handleSubmit(e, false)}
                        disabled={isUploading || !isFormComplete}
                        className="bg-green-600 hover:bg-green-700"
                     >
                        {isUploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <ShieldCheck className="mr-2 h-4 w-4"/>}
                        Submit & Verify
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
