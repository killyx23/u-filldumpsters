
import React, { useState, useRef } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Loader2, ShieldCheck, UploadCloud } from 'lucide-react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { uploadVerificationImage, saveVerificationDocumentToDb, getMergedVerificationDocumentsByCustomerId } from '@/utils/verificationImageHelper';
import { VerificationInfoTooltip } from '@/components/VerificationInfoTooltip';
import { VerificationImageDisplay } from '@/components/VerificationImageDisplay';

export const VerificationManager = ({ customer, onUpdate }) => {
    const [licensePlate, setLicensePlate] = useState(customer?.license_plate || '');
    const [plateError, setPlateError] = useState('');
    const [isUploading, setIsUploading] = useState(false);
    
    // Local form state for new uploads
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
    
    const fileInputFrontRef = useRef(null);
    const fileInputBackRef = useRef(null);
    const fileInputInsuranceRef = useRef(null);

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
                }
            } catch (error) {
                console.error('[VerificationManager] Failed to load existing documents:', error);
            }
        };
        loadExistingDocs();
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

    const handleSubmit = async () => {
        if (!customer?.id) {
            toast({ title: 'Authentication Error', description: 'Customer profile not found.', variant: 'destructive' });
            return;
        }
        if (plateError) {
            toast({ title: 'Invalid License Plate', description: 'Please correct the format.', variant: 'destructive' });
            return;
        }

        setIsUploading(true);
        try {
            // Update customers table (plate info)
            const { error: customerError } = await supabase
                .from('customers')
                .update({
                    license_plate: licensePlate,
                    has_incomplete_verification: false
                })
                .eq('id', customer.id);

            if (customerError) throw customerError;

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

            const hasDocUpdate = Boolean(frontImage || backImage || insuranceImage);

            if (hasDocUpdate && nextFront?.url && nextBack?.url && nextInsurance?.url) {
                await saveVerificationDocumentToDb(
                    customer.id,
                    nextFront.url,
                    nextFront.path,
                    nextBack.url,
                    nextBack.path,
                    'approved',
                    nextInsurance.url,
                    nextInsurance.path,
                );
            } else if (hasDocUpdate && insuranceImage?.url && (!nextFront?.url || !nextBack?.url)) {
                toast({
                    title: 'License Images Required',
                    description: 'Please upload both front and back license images before saving insurance.',
                    variant: 'destructive',
                });
                return;
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
            setDisplayRefreshKey((prev) => prev + 1);
            
            toast({ title: "Verification Info Updated!", description: "Your information has been submitted for review." });
            if (onUpdate) onUpdate();
        } catch (error) {
            toast({ title: "Update Failed", description: error.message, variant: "destructive" });
        } finally {
            setIsUploading(false);
        }
    };

    return (
        <TooltipProvider>
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
                    <CardTitle className="text-lg font-bold text-yellow-400">Update Verification</CardTitle>
                    <CardDescription className="text-blue-200">
                        Upload new documents if requested by our team.
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
                            <Label>Replace Driver's License (Front)</Label>
                            {frontImage ? (
                                <div className="p-3 bg-green-900/30 border border-green-500 rounded text-green-300 text-sm text-center">New Front Image Selected</div>
                            ) : (
                                <Button type="button" variant="outline" className="w-full h-20 bg-black/20 hover:bg-white/10" onClick={() => fileInputFrontRef.current?.click()} disabled={isUploading}>
                                    <UploadCloud className="mr-2 h-4 w-4" /> Choose New Front
                                </Button>
                            )}
                            <Input ref={fileInputFrontRef} type="file" className="hidden" onChange={(e) => handleFileChange(e, 'license_front')} disabled={isUploading} accept="image/*" />
                        </div>
                        <div className="space-y-2">
                            <Label>Replace Driver's License (Back)</Label>
                            {backImage ? (
                                <div className="p-3 bg-green-900/30 border border-green-500 rounded text-green-300 text-sm text-center">New Back Image Selected</div>
                            ) : (
                                <Button type="button" variant="outline" className="w-full h-20 bg-black/20 hover:bg-white/10" onClick={() => fileInputBackRef.current?.click()} disabled={isUploading}>
                                    <UploadCloud className="mr-2 h-4 w-4" /> Choose New Back
                                </Button>
                            )}
                            <Input ref={fileInputBackRef} type="file" className="hidden" onChange={(e) => handleFileChange(e, 'license_back')} disabled={isUploading} accept="image/*" />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label>Replace Auto Insurance (Declaration Page or Insurance Card)</Label>
                        {insuranceImage ? (
                            <div className="p-3 bg-green-900/30 border border-green-500 rounded text-green-300 text-sm text-center">New Insurance Document Selected</div>
                        ) : (
                            <Button type="button" variant="outline" className="w-full h-20 bg-black/20 hover:bg-white/10" onClick={() => fileInputInsuranceRef.current?.click()} disabled={isUploading}>
                                <UploadCloud className="mr-2 h-4 w-4" /> Choose New Insurance Document
                            </Button>
                        )}
                        <Input ref={fileInputInsuranceRef} type="file" className="hidden" onChange={(e) => handleFileChange(e, 'insurance_document')} disabled={isUploading} accept="image/*,application/pdf" />
                    </div>

                    <div className="flex justify-end pt-4">
                        <Button onClick={handleSubmit} disabled={isUploading} className="bg-yellow-500 hover:bg-yellow-600 text-black font-semibold">
                            {isUploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
                            Submit Updates
                        </Button>
                    </div>
                </CardContent>
            </Card>
        </TooltipProvider>
    );
};
