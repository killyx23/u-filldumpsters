import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { Loader2, Car, ImageDown as ImageUp, Info, CheckCircle, UploadCloud } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export const VerificationDialog = ({ open, onOpenChange, onVerifiedSubmit }) => {
    const [licensePlate, setLicensePlate] = useState('');
    const [licenseImages, setLicenseImages] = useState([]);
    const [isUploading, setIsUploading] = useState(false);
    const [showIncompleteWarning, setShowIncompleteWarning] = useState(false);
    const [incompleteReason, setIncompleteReason] = useState('');
    const { user } = useAuth();

    const handleImageUpload = async (e) => {
        const files = Array.from(e.target.files);
        if (files.length === 0) return;

        setIsUploading(true);
        const uploadedFilePaths = [];

        for (const file of files) {
            const filePath = `${user.id}/${Date.now()}-${file.name}`;
            const { error: uploadError } = await supabase.storage.from('license-images').upload(filePath, file);

            if (uploadError) {
                toast({ title: "Upload Failed", description: uploadError.message, variant: "destructive" });
                setIsUploading(false);
                return;
            }
            const { data: { publicUrl } } = supabase.storage.from('license-images').getPublicUrl(filePath);
            uploadedFilePaths.push({ url: publicUrl, path: filePath, name: file.name });
        }

        setLicenseImages(prev => [...prev, ...uploadedFilePaths].slice(0, 2)); // Ensure only 2 images max
        setIsUploading(false);
        toast({ title: `${files.length} image(s) uploaded successfully!` });
    };

    const handleSubmit = () => {
        if (!licensePlate || licenseImages.length < 2) {
            setShowIncompleteWarning(true);
            return;
        }
        onVerifiedSubmit({ licensePlate, licenseImages, verificationSkipped: false });
    };

    const handleAcknowledgeIncomplete = () => {
        onVerifiedSubmit({ licensePlate, licenseImages, verificationSkipped: true, verificationNotes: incompleteReason });
        setShowIncompleteWarning(false);
    };

    return (
        <>
            <Dialog open={open && !showIncompleteWarning} onOpenChange={onOpenChange}>
                <DialogContent className="bg-gradient-to-br from-gray-900 to-blue-900/50 border-yellow-500 text-white max-w-3xl p-0">
                    <div className="flex">
                        <div className="w-1/3 bg-black/20 p-8 flex flex-col justify-center items-center text-center border-r border-yellow-500/30">
                            <Car className="h-16 w-16 text-yellow-400 mb-4" />
                            <DialogHeader>
                                <DialogTitle className="text-2xl text-yellow-400">Final Verification Step</DialogTitle>
                                <DialogDescription className="text-blue-200">
                                    For security and insurance purposes, please provide the following for the towing vehicle.
                                </DialogDescription>
                            </DialogHeader>
                        </div>
                        <div className="w-2/3 p-8 space-y-6">
                            <div>
                                <div className="flex items-center justify-between">
                                    <Label htmlFor="license-plate" className="text-lg font-semibold flex items-center"><Car className="mr-2 h-5 w-5" />Towing Vehicle License Plate</Label>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <Info className="h-5 w-5 text-blue-300 cursor-pointer" />
                                        </TooltipTrigger>
                                        <TooltipContent>
                                            <p>Required for fraud protection, legalities, and insurance information.</p>
                                        </TooltipContent>
                                    </Tooltip>
                                </div>
                                <Input id="license-plate" value={licensePlate} onChange={e => setLicensePlate(e.target.value)} placeholder="e.g., 5X5 5X5" className="bg-white/10 mt-2" />
                            </div>

                            <div>
                                <Label htmlFor="license-images" className="text-lg font-semibold flex items-center"><ImageUp className="mr-2 h-5 w-5" />Driver's License (Front & Back)</Label>
                                <div className="mt-2 grid grid-cols-2 gap-4">
                                    {[0, 1].map(index => (
                                        <div key={index} className="aspect-video bg-white/5 rounded-lg flex flex-col items-center justify-center p-4 border-2 border-dashed border-white/20">
                                            {licenseImages[index] ? (
                                                <div className="text-center text-green-400">
                                                    <CheckCircle className="h-8 w-8 mx-auto mb-2" />
                                                    <p className="text-xs font-semibold truncate">{licenseImages[index].name}</p>
                                                </div>
                                            ) : (
                                                <div className="text-center text-blue-300">
                                                    <UploadCloud className="h-8 w-8 mx-auto mb-2" />
                                                    <p className="text-xs font-semibold">{index === 0 ? 'Upload Front' : 'Upload Back'}</p>
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                                <div className="mt-2">
                                     <Input id="license-images" type="file" multiple accept="image/*" onChange={handleImageUpload} className="bg-white/20 file:text-yellow-300" disabled={isUploading || licenseImages.length >= 2} />
                                     {isUploading && <Loader2 className="h-4 w-4 animate-spin mt-2" />}
                                </div>
                                <p className="text-sm text-blue-200 mt-2">{licenseImages.length} of 2 images uploaded.</p>
                            </div>
                            <DialogFooter>
                                <Button onClick={handleSubmit} size="lg" className="w-full bg-gradient-to-r from-yellow-500 to-orange-600 text-black font-bold text-lg hover:from-yellow-600 hover:to-orange-700">Submit Verification</Button>
                            </DialogFooter>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            <Dialog open={showIncompleteWarning} onOpenChange={setShowIncompleteWarning}>
                <DialogContent className="bg-gray-900 border-red-500 text-white">
                    <DialogHeader>
                        <DialogTitle className="text-red-400">Incomplete Verification</DialogTitle>
                        <DialogDescription>
                            You have not provided all the required information. You may continue, but your booking will be flagged for manual review and may be cancelled if verification cannot be completed.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="py-4">
                        <Label htmlFor="incomplete-reason">Please provide a reason (optional)</Label>
                        <Input id="incomplete-reason" value={incompleteReason} onChange={e => setIncompleteReason(e.target.value)} placeholder="e.g., Will provide at pickup" className="bg-white/20 mt-1" />
                    </div>
                    <DialogFooter>
                        <Button onClick={() => setShowIncompleteWarning(false)} variant="outline">Go Back</Button>
                        <Button onClick={handleAcknowledgeIncomplete} variant="destructive">Acknowledge & Continue</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    )
};