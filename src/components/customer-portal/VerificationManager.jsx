
import React, { useState, useRef, useCallback, useMemo } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card.jsx";
import { Loader2, ShieldCheck, UploadCloud, X, Info, AlertTriangle, CheckCircle } from 'lucide-react';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip';

const FilePreview = ({ url, onRemove, isUploading }) => {
    if (!url) return null;
    return (
        <div className="relative group w-full h-40 rounded-lg overflow-hidden border border-gray-600">
            <img src={url} alt="Preview" className="w-full h-full object-cover" />
            <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <Button variant="destructive" size="icon" className="h-8 w-8" onClick={onRemove} disabled={isUploading}>
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
        To ensure the security and proper use of our rental equipment, we require the license plate number of the vehicle that will be towing the trailer. This information is crucial for liability, legal compliance, and asset protection.
      </p>
    </TooltipContent>
  </Tooltip>
);

export const VerificationManager = ({ customer, onUpdate }) => {
    const [licensePlate, setLicensePlate] = useState(customer.license_plate || '');
    const [plateError, setPlateError] = useState('');
    const [licenseImages, setLicenseImages] = useState(customer.license_image_urls || []);
    const [isUploading, setIsUploading] = useState(false);

    const fileInputFrontRef = useRef(null);
    const fileInputBackRef = useRef(null);

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

    const uploadFile = useCallback(async (file) => {
        if (!file) return null;
        const filePath = `licenses/${customer.id}/${Date.now()}-${file.name}`;
        const { error } = await supabase.storage.from('customer-uploads').upload(filePath, file);
        if (error) {
            toast({ title: `Upload Failed for ${file.name}`, description: error.message, variant: "destructive" });
            return null;
        }
        const { data } = supabase.storage.from('customer-uploads').getPublicUrl(filePath);
        return data.publicUrl;
    }, [customer.id]);

    const handleFileChange = async (e, imageIndex) => {
        const file = e.target.files[0];
        if (!file) return;

        setIsUploading(true);
        const newUrl = await uploadFile(file);
        if (newUrl) {
            setLicenseImages(prev => {
                const updatedImages = [...prev];
                updatedImages[imageIndex] = newUrl;
                return updatedImages;
            });
        }
        setIsUploading(false);
    };

    const handleRemoveImage = (indexToRemove) => {
        setLicenseImages(prev => prev.filter((_, index) => index !== indexToRemove));
    };

    const handleSubmit = async () => {
        if (plateError) {
            toast({ title: 'Invalid License Plate', description: 'Please correct the format.', variant: 'destructive' });
            return;
        }
        setIsUploading(true);
        const { error } = await supabase
            .from('customers')
            .update({
                license_plate: licensePlate,
                license_image_urls: licenseImages,
                has_incomplete_verification: !(licensePlate && licenseImages.length >= 2)
            })
            .eq('id', customer.id);

        if (error) {
            toast({ title: "Update Failed", description: error.message, variant: "destructive" });
        } else {
            toast({ title: "Verification Info Updated!", description: "Your information has been saved." });
            onUpdate();
        }
        setIsUploading(false);
    };

    const isVerified = customer.has_incomplete_verification === false;

    return (
        <TooltipProvider>
            <Card className="bg-white/5 border-white/10 text-white">
                <CardHeader>
                    <div className="flex justify-between items-center">
                        <CardTitle className="text-lg font-bold text-yellow-400">My Verification</CardTitle>
                        {isVerified ? (
                            <div className="flex items-center gap-2 text-green-400 font-semibold">
                                <CheckCircle className="h-5 w-5" />
                                Verified
                            </div>
                        ) : (
                            <div className="flex items-center gap-2 text-orange-400 font-semibold">
                                <AlertTriangle className="h-5 w-5" />
                                Incomplete
                            </div>
                        )}
                    </div>
                    <CardDescription className="text-blue-200">
                        Keep your verification details up to date to ensure smooth rentals.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    <div>
                        <div className="flex items-center">
                            <Label htmlFor="licensePlate">Towing Vehicle License Plate</Label>
                            <PlateInfoTooltip />
                        </div>
                        <Input
                            id="licensePlate"
                            value={licensePlate}
                            onChange={handlePlateChange}
                            placeholder="e.g., ABC1234"
                            className="bg-white/20 uppercase"
                            maxLength="7"
                            disabled={isUploading}
                        />
                        {plateError && <p className="text-red-400 text-xs mt-1">{plateError}</p>}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-2">
                            <Label>Driver's License (Front)</Label>
                            {licenseImages[0] ? (
                                <FilePreview url={licenseImages[0]} onRemove={() => handleRemoveImage(0)} isUploading={isUploading} />
                            ) : (
                                <Button type="button" variant="outline" className="w-full h-40" onClick={() => fileInputFrontRef.current?.click()} disabled={isUploading}>
                                    <UploadCloud className="mr-2 h-4 w-4" /> Upload Front
                                </Button>
                            )}
                            <Input ref={fileInputFrontRef} type="file" className="hidden" onChange={(e) => handleFileChange(e, 0)} disabled={isUploading} accept="image/*" />
                        </div>
                        <div className="space-y-2">
                            <Label>Driver's License (Back)</Label>
                            {licenseImages[1] ? (
                                <FilePreview url={licenseImages[1]} onRemove={() => handleRemoveImage(1)} isUploading={isUploading} />
                            ) : (
                                <Button type="button" variant="outline" className="w-full h-40" onClick={() => fileInputBackRef.current?.click()} disabled={isUploading}>
                                    <UploadCloud className="mr-2 h-4 w-4" /> Upload Back
                                </Button>
                            )}
                            <Input ref={fileInputBackRef} type="file" className="hidden" onChange={(e) => handleFileChange(e, 1)} disabled={isUploading} accept="image/*" />
                        </div>
                    </div>

                    <div className="flex justify-end">
                        <Button onClick={handleSubmit} disabled={isUploading}>
                            {isUploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
                            Save Verification Info
                        </Button>
                    </div>
                </CardContent>
            </Card>
        </TooltipProvider>
    );
};
