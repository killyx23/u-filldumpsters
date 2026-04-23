import React, { useState, useEffect, useCallback } from 'react';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { MapPin, Loader2, CheckCircle, AlertCircle, RefreshCw } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { GooglePlacesAutocomplete } from '@/components/GooglePlacesAutocomplete';
import { fetchDistanceAndCalculateFee } from '@/services/DistanceCalculationService';
import { toast } from '@/components/ui/use-toast';

export const RescheduleAddressVerification = ({ booking, newService, onAddressUpdated }) => {
    // Safety check: provide default empty function if callback not provided
    const handleAddressUpdated = onAddressUpdated || (() => {
        console.warn('RescheduleAddressVerification: onAddressUpdated callback not provided');
    });

    const originalAddressObj = booking?.delivery_address;
    const originalAddressStr = originalAddressObj?.formatted_address || 
        `${booking?.street || ''}, ${booking?.city || ''}, ${booking?.state || ''} ${booking?.zip || ''}`.trim();
    
    const [useSameAddress, setUseSameAddress] = useState(true);
    const [newAddress, setNewAddress] = useState({
        street: '',
        city: '',
        state: '',
        zip: '',
        isVerified: false
    });
    const [calculating, setCalculating] = useState(false);
    const [verificationResult, setVerificationResult] = useState(null);
    const [error, setError] = useState(null);
    const [showManualWarningDialog, setShowManualWarningDialog] = useState(false);
    const [manualAddressAccepted, setManualAddressAccepted] = useState(false);

    const mileageRate = newService?.mileage_rate || booking?.plan?.mileage_rate || 0.85;
    const dryRunFee = 100; // Default dry run fee

    // Initialize with original address distance
    useEffect(() => {
        if (useSameAddress) {
            const originalDistance = booking?.customers?.distance_miles || 0;
            setVerificationResult({ success: true, distance: originalDistance, totalFee: 0 });
            handleAddressUpdated(originalAddressStr, { 
                error: false, 
                distance: originalDistance,
                isVerified: true 
            });
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [useSameAddress, originalAddressStr, booking?.customers?.distance_miles]);

    const calculateDistance = useCallback(async (address) => {
        if (!address || !address.street || !address.isVerified) {
            handleAddressUpdated('', { error: true, distance: 0, isVerified: false });
            return;
        }

        setCalculating(true);
        setError(null);
        
        try {
            const fullAddress = `${address.street}, ${address.city}, ${address.state} ${address.zip}`;
            
            const result = await fetchDistanceAndCalculateFee(fullAddress, newService?.id || booking?.plan?.id, mileageRate);

            if (result.error) {
                setError(result.error);
                setVerificationResult(null);
                handleAddressUpdated(fullAddress, { error: true, distance: 0, isVerified: false });
            } else {
                setVerificationResult({ 
                    success: true, 
                    distance: result.distance, 
                    totalFee: result.totalFee,
                    distanceFeeDisplay: result.distanceFeeDisplay 
                });
                handleAddressUpdated(fullAddress, { 
                    error: false, 
                    distance: result.distance,
                    isVerified: true 
                });
                setError(null);
            }
        } catch (err) {
            console.error("Distance calculation error:", err);
            setError(err.message || "Failed to calculate delivery distance. Please try again.");
            toast({ title: "Distance calculation failed", description: err.message, variant: "destructive" });
            handleAddressUpdated('', { error: true, distance: 0, isVerified: false });
        } finally {
            setCalculating(false);
        }
    }, [handleAddressUpdated, newService?.id, booking?.plan?.id, mileageRate]);

    const handleAddressSelect = (details) => {
        const addressData = {
            street: details.street,
            city: details.city,
            state: details.state,
            zip: details.zip,
            isVerified: true
        };
        setNewAddress(addressData);
        setManualAddressAccepted(false); // Reset acceptance when GPS-verified address is selected
        calculateDistance(addressData);
    };

    const handleManualAddressChange = (field, value) => {
        setNewAddress(prev => {
            const updated = { ...prev, [field]: value, isVerified: false };
            if (field === 'street' && !value) {
                setVerificationResult(null);
                setManualAddressAccepted(false);
                handleAddressUpdated('', { error: true, distance: 0, isVerified: false });
            }
            return updated;
        });
    };

    const handleRetry = () => {
        if (newAddress.isVerified) {
            calculateDistance(newAddress);
        }
    };

    const handleUseDifferentAddress = () => {
        setUseSameAddress(false);
        setVerificationResult(null);
        setManualAddressAccepted(false);
        handleAddressUpdated('', { error: true, distance: 0, isVerified: false });
    };

    const handleContinueWithManualAddress = () => {
        if (!manualAddressAccepted) {
            toast({ 
                title: "Acceptance Required", 
                description: "You must accept the risks to continue with manual address entry.", 
                variant: "destructive" 
            });
            return;
        }

        // Proceed with manual address - update the parent state to mark address as "verified" but flag as manual
        const fullAddress = `${newAddress.street}, ${newAddress.city}, ${newAddress.state} ${newAddress.zip}`;
        handleAddressUpdated(fullAddress, { 
            error: false, 
            distance: 0, // No distance calculated for manual entry
            isVerified: true, // Allow proceeding
            isManualEntry: true // Flag for backend processing
        });
        
        setVerificationResult({ success: true, distance: 0, totalFee: 0, isManual: true });
        setShowManualWarningDialog(false);
        
        toast({ 
            title: "Manual Address Accepted", 
            description: "Your address has been accepted. Please verify it in the customer portal after booking.", 
            variant: "default" 
        });
    };

    // Check if manual address entry is complete but not GPS-verified
    const isManualAddressComplete = !useSameAddress && 
        newAddress.street && 
        newAddress.city && 
        newAddress.state && 
        newAddress.zip && 
        !newAddress.isVerified;

    return (
        <div className="space-y-8 animate-in fade-in duration-500 max-w-4xl mx-auto w-full">
            <div className="text-center space-y-3 pb-4">
                <h2 className="text-3xl font-extrabold text-white tracking-tight">
                    Delivery Address
                </h2>
                <p className="text-base text-gray-400 max-w-2xl mx-auto">
                    Confirm the delivery location for your rescheduled appointment.
                </p>
            </div>
            
            <Card className="bg-gray-900 border-gray-800 shadow-xl rounded-2xl overflow-hidden">
                <CardContent className="p-6 md:p-8 space-y-6">
                    <div className="space-y-4">
                        <Label className="text-gray-300 text-base font-bold">
                            Is this going to the same address as your original booking?
                        </Label>
                        
                        {useSameAddress ? (
                            <div className="space-y-4">
                                <div className="bg-white/5 p-4 rounded-lg border border-white/10 flex items-start">
                                    <MapPin className="h-5 w-5 text-green-400 mr-3 mt-0.5 flex-shrink-0" />
                                    <div className="flex-1">
                                        <p className="text-white font-medium">{originalAddressStr}</p>
                                        {verificationResult?.success && (
                                            <div className="mt-3 bg-green-900/30 border border-green-500/30 p-4 rounded-xl flex items-start gap-4">
                                                <CheckCircle className="w-6 h-6 text-green-400 flex-shrink-0" />
                                                <div>
                                                    <p className="font-bold text-white text-base mb-1">Address Verified successfully</p>
                                                    <p className="text-sm text-gray-400">Using original delivery location.</p>
                                                    <p className="text-sm text-green-300 mt-2 font-semibold bg-gray-950/50 inline-block px-3 py-1 rounded-lg border border-gray-800">
                                                        Estimated Distance: {verificationResult.distance.toFixed(1)} miles
                                                    </p>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                                <Button 
                                    variant="outline" 
                                    onClick={handleUseDifferentAddress}
                                    className="text-white border-white/30 hover:bg-white/10"
                                >
                                    Deliver to a different address
                                </Button>
                            </div>
                        ) : (
                            <div className="space-y-4">
                                <div className="space-y-2">
                                    <GooglePlacesAutocomplete 
                                        value={newAddress.street || ''}
                                        onChange={(val) => handleManualAddressChange('street', val)}
                                        onAddressSelect={handleAddressSelect}
                                        placeholder="Start typing your delivery address..."
                                    />
                                </div>
                                
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                    <div className="relative flex items-center">
                                        <MapPin className="absolute left-3 h-4 w-4 text-blue-300" />
                                        <input 
                                            className="w-full bg-white/10 text-white rounded-lg border border-white/30 focus:ring-2 focus:ring-gold focus:border-gold pl-9 pr-4 py-2 transition-colors" 
                                            value={newAddress.city || ''} 
                                            onChange={(e) => handleManualAddressChange('city', e.target.value)}
                                            placeholder="City" 
                                        />
                                    </div>
                                    <div className="relative flex items-center">
                                        <MapPin className="absolute left-3 h-4 w-4 text-blue-300" />
                                        <input 
                                            className="w-full bg-white/10 text-white rounded-lg border border-white/30 focus:ring-2 focus:ring-gold focus:border-gold pl-9 pr-4 py-2 transition-colors" 
                                            value={newAddress.state || ''} 
                                            onChange={(e) => handleManualAddressChange('state', e.target.value)}
                                            placeholder="State" 
                                        />
                                    </div>
                                    <div className="relative flex items-center">
                                        <MapPin className="absolute left-3 h-4 w-4 text-blue-300" />
                                        <input 
                                            className="w-full bg-white/10 text-white rounded-lg border border-white/30 focus:ring-2 focus:ring-gold focus:border-gold pl-9 pr-4 py-2 transition-colors" 
                                            value={newAddress.zip || ''} 
                                            onChange={(e) => handleManualAddressChange('zip', e.target.value)}
                                            placeholder="ZIP" 
                                        />
                                    </div>
                                </div>

                                {isManualAddressComplete && (
                                    <div className="bg-orange-900/30 border border-orange-500/50 p-4 rounded-lg space-y-3">
                                        <div className="flex items-start gap-2">
                                            <AlertCircle className="h-5 w-5 text-orange-400 flex-shrink-0 mt-0.5" />
                                            <p className="text-orange-200 text-sm">
                                                Manual address entry requires verification. Please select from the dropdown suggestions for automatic verification, or click "Continue with Manual Address" to proceed with risks.
                                            </p>
                                        </div>
                                        <Button 
                                            variant="outline" 
                                            onClick={() => setShowManualWarningDialog(true)}
                                            className="w-full border-orange-500/50 text-orange-200 hover:bg-orange-500/20"
                                        >
                                            Continue with Manual Address
                                        </Button>
                                    </div>
                                )}

                                {calculating && (
                                    <p className="text-sm text-yellow-400 flex items-center">
                                        <Loader2 className="h-4 w-4 animate-spin mr-2"/> Calculating route...
                                    </p>
                                )}

                                {error && (
                                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between text-red-400 text-sm bg-red-900/20 p-3 rounded-lg border border-red-500/30 gap-3">
                                        <div className="flex items-center">
                                            <AlertCircle className="h-4 w-4 mr-2 flex-shrink-0" /> 
                                            <span>{error}</span>
                                        </div>
                                        <Button variant="outline" size="sm" onClick={handleRetry} className="flex-shrink-0 border-red-500 text-red-400 hover:bg-red-500 hover:text-white">
                                            <RefreshCw className="h-3 w-3 mr-2" /> Retry Calculation
                                        </Button>
                                    </div>
                                )}

                                {verificationResult?.success && newAddress.isVerified && !verificationResult.isManual && (
                                    <div className="bg-green-900/30 border border-green-500/30 p-5 rounded-xl flex items-start gap-4">
                                        <CheckCircle className="w-6 h-6 text-green-400 flex-shrink-0" />
                                        <div>
                                            <p className="font-bold text-white text-base mb-1">Address Verified successfully</p>
                                            <p className="text-sm text-gray-400">Location is within our service area.</p>
                                            <p className="text-sm text-green-300 mt-2 font-semibold bg-gray-950/50 inline-block px-3 py-1 rounded-lg border border-gray-800">
                                                {verificationResult.distanceFeeDisplay || `Estimated Distance: ${verificationResult.distance.toFixed(1)} miles`}
                                            </p>
                                        </div>
                                    </div>
                                )}

                                {verificationResult?.success && verificationResult.isManual && (
                                    <div className="bg-orange-900/30 border border-orange-500/30 p-5 rounded-xl flex items-start gap-4">
                                        <AlertCircle className="w-6 h-6 text-orange-400 flex-shrink-0" />
                                        <div>
                                            <p className="font-bold text-white text-base mb-1">Manual Address Accepted</p>
                                            <p className="text-sm text-gray-400">You have accepted the risks of manual address entry. Please verify your address in the customer portal after submission.</p>
                                        </div>
                                    </div>
                                )}

                                <Button 
                                    variant="outline" 
                                    onClick={() => { 
                                        setUseSameAddress(true); 
                                        setNewAddress({ street: '', city: '', state: '', zip: '', isVerified: false }); 
                                        setManualAddressAccepted(false);
                                        setVerificationResult(null);
                                    }}
                                    className="text-white border-white/30 hover:bg-white/10 mt-4"
                                >
                                    Cancel and use original address
                                </Button>
                            </div>
                        )}
                    </div>
                </CardContent>
            </Card>

            {/* Manual Address Warning Dialog */}
            <Dialog open={showManualWarningDialog} onOpenChange={setShowManualWarningDialog}>
                <DialogContent className="sm:max-w-md bg-gray-900 border-orange-500/50">
                    <DialogHeader>
                        <DialogTitle className="text-xl font-bold text-orange-400 flex items-center gap-2">
                            <AlertCircle className="h-6 w-6" />
                            Manual Address Entry Warning
                        </DialogTitle>
                        <DialogDescription className="text-gray-300 text-sm leading-relaxed pt-4">
                            Manual address entry requires verification. By continuing without GPS verification, your order may be delayed or canceled if we cannot locate your address. You may also be charged for a dry run visit (${dryRunFee}) or the full appointment cost if we cannot access your property. Do you want to continue?
                        </DialogDescription>
                    </DialogHeader>
                    
                    <div className="flex items-start space-x-3 py-4">
                        <Checkbox 
                            id="accept-manual-address" 
                            checked={manualAddressAccepted}
                            onCheckedChange={setManualAddressAccepted}
                            className="mt-1"
                        />
                        <label 
                            htmlFor="accept-manual-address" 
                            className="text-sm text-gray-300 cursor-pointer leading-relaxed"
                        >
                            I understand and accept the risks
                        </label>
                    </div>

                    <DialogFooter className="flex flex-col-reverse sm:flex-row gap-2">
                        <Button 
                            variant="outline" 
                            onClick={() => {
                                setShowManualWarningDialog(false);
                                setManualAddressAccepted(false);
                            }}
                            className="w-full sm:w-auto border-gray-700 text-gray-300 hover:bg-gray-800"
                        >
                            Cancel
                        </Button>
                        <Button 
                            onClick={handleContinueWithManualAddress}
                            disabled={!manualAddressAccepted}
                            className="w-full sm:w-auto bg-orange-500 hover:bg-orange-600 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            Continue with Manual Address
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
};