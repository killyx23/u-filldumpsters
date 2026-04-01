import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';
import { Loader2, User, Mail, Phone, Home, MapPin, Hash, Save, StickyNote, Key, Edit, X, History, AlertTriangle, CheckCircle, ArrowRight, Car, Route, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EditInput } from '@/components/admin/EditInput';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { GooglePlacesAutocomplete } from '@/components/GooglePlacesAutocomplete.jsx';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { calculateAndSaveDistanceFrontend, formatFullAddress } from '@/utils/distanceCalculationHelper';
import { useGoogleMapsLoader } from '@/hooks/useGoogleMapsLoader';

const InfoRow = ({ icon, label, value, href }) => {
    const content = href && value !== 'N/A' && value !== 'Not Available' ? (
        <a href={href} className="text-white hover:text-yellow-400 transition-colors underline break-all">{value}</a>
    ) : (
        <span className="text-white break-all">{value}</span>
    );

    return (
        <div className="flex items-start py-2 border-b border-white/10">
            <div className="flex items-center w-1/3 text-blue-200">
                {React.cloneElement(icon, { className: "mr-3 h-5 w-5" })}
                <span>{label}</span>
            </div>
            <div className="w-2/3">
                {content}
            </div>
        </div>
    );
};

export const CustomerProfile = ({ customer, setCustomer, onUpdate, onHistoryClick }) => {
    const [isEditing, setIsEditing] = useState(false);
    const [editedCustomer, setEditedCustomer] = useState(customer);
    const [isSaving, setIsSaving] = useState(false);
    const [verificationResult, setVerificationResult] = useState(null);
    const [travelInfo, setTravelInfo] = useState({ eta: null, distance: null, loading: false, error: null });
    const [addressAutocompleteUsed, setAddressAutocompleteUsed] = useState(true);
    
    // Load Google Maps script
    const { isLoaded: mapsLoaded, isLoading: mapsLoading, error: mapsError } = useGoogleMapsLoader();

    // Manual Distance Entry State
    const [showManualEntry, setShowManualEntry] = useState(false);
    const [manualDistance, setManualDistance] = useState('');
    const [manualTime, setManualTime] = useState('');

    const triggerDistanceCalculation = async (customerData) => {
        if (!mapsLoaded) {
            toast({ title: "Maps Not Ready", description: "Google Maps is not fully loaded yet. Please try again.", variant: "destructive" });
            return;
        }

        setTravelInfo({ eta: null, distance: null, loading: true, error: null });
        const result = await calculateAndSaveDistanceFrontend(customerData); // defaults to correct Saratoga Springs address
        
        if (!result.error) {
            setTravelInfo({ 
                eta: `${result.travelTime} mins`, 
                distance: `${result.distance} miles`, 
                loading: false,
                error: null
            });
            setManualDistance(result.distance.toString());
            setManualTime(result.travelTime.toString());
            onUpdate();
        } else {
            setTravelInfo({ eta: 'N/A', distance: 'N/A', loading: false, error: result.error });
            toast({ title: 'Distance Calculation Failed', description: result.error, variant: 'destructive' });
            setShowManualEntry(true); // Show manual entry if automatic fails
        }
    };

    useEffect(() => {
        setEditedCustomer(customer);
        
        const checkAndCalculateDistance = async () => {
            const hasValidAddress = customer && !customer.unverified_address && customer.street && customer.city && customer.state && customer.zip;
            
            if (hasValidAddress) {
                // If we already have the data in DB, use it directly
                if (customer.distance_miles !== null && customer.travel_time_minutes !== null) {
                    setTravelInfo({ 
                        eta: `${customer.travel_time_minutes} mins`, 
                        distance: `${customer.distance_miles} miles`, 
                        loading: false,
                        error: null
                    });
                    setManualDistance(customer.distance_miles.toString());
                    setManualTime(customer.travel_time_minutes.toString());
                } else if (mapsLoaded) {
                    // Calculate and save if verified but missing data and maps are loaded
                    await triggerDistanceCalculation(customer);
                }
            } else {
                setTravelInfo({ eta: 'N/A', distance: 'N/A', loading: false, error: null });
            }
        };

        if (!mapsLoading) {
            checkAndCalculateDistance();
        }
    }, [customer, onUpdate, mapsLoaded, mapsLoading]);


    const handleInputChange = (field, value) => {
        setEditedCustomer(prev => ({ ...prev, [field]: value }));
        if (['street', 'city', 'state', 'zip'].includes(field)) {
             setAddressAutocompleteUsed(false);
        }
    };
    
    const handleAddressSelect = (addressDetails) => {
        setEditedCustomer(prev => ({
            ...prev,
            street: addressDetails.street || prev.street,
            city: addressDetails.city || prev.city,
            state: addressDetails.state || prev.state,
            zip: addressDetails.zip || prev.zip
        }));
        setAddressAutocompleteUsed(true);
        toast({ title: "Address Populated", description: "Address details updated from Google Maps." });
    };

    const handleSave = async (forceSave = false) => {
        if (!editedCustomer.first_name || !editedCustomer.last_name) {
            toast({ title: 'Missing Name', description: 'Please provide both first and last name.', variant: 'destructive' });
            return;
        }

        if (!editedCustomer.street || !editedCustomer.city || !editedCustomer.state || !editedCustomer.zip) {
            toast({ title: 'Missing Address', description: 'Please fill out all address fields.', variant: 'destructive' });
            return;
        }
        
        setIsSaving(true);
        
        const fullAddress = formatFullAddress(editedCustomer);
        let isValidAddress = forceSave || addressAutocompleteUsed;
        
        if (!forceSave && !addressAutocompleteUsed) {
            try {
                const { data: verificationData, error: verificationError } = await supabase.functions.invoke('verify-address', { body: { address: fullAddress } });
                if (verificationError) throw verificationError;
                if (!verificationData.isValid) {
                    setVerificationResult({ status: 'failed', message: verificationData.message });
                    setIsSaving(false);
                    return;
                }
                isValidAddress = true;
                setVerificationResult({ status: 'success', message: verificationData.message });
            } catch (error) {
                setVerificationResult({ status: 'failed', message: `Google Maps check failed: ${error.message}` });
                setIsSaving(false);
                return;
            }
        }

        if (isValidAddress) {
            const computedFullName = `${editedCustomer.first_name} ${editedCustomer.last_name}`.trim();
            const customerUpdateData = { 
                ...editedCustomer, 
                name: computedFullName,
                unverified_address: !isValidAddress || forceSave 
            };
            
            // Clear existing distance data if address changed
            if (customer.street !== editedCustomer.street || customer.zip !== editedCustomer.zip) {
                customerUpdateData.distance_miles = null;
                customerUpdateData.travel_time_minutes = null;
            }

            const { data, error } = await supabase
                .from('customers')
                .update(customerUpdateData)
                .eq('id', customer.id)
                .select()
                .single();

            if (error) {
                toast({ title: 'Error saving profile', description: error.message, variant: 'destructive' });
                setIsSaving(false);
            } else {
                if (!forceSave && isValidAddress) {
                    const { error: bookingError } = await supabase
                        .from('bookings')
                        .update({ status: 'Confirmed' })
                        .eq('customer_id', customer.id)
                        .in('status', ['pending_verification', 'pending_review']);
                    
                    if (bookingError) console.warn("Could not update related bookings:", bookingError);
                }
                setCustomer(data);
                setIsEditing(false);
                setAddressAutocompleteUsed(true);
                
                // If we cleared the distance because address changed, trigger recalculation
                if ((customer.street !== editedCustomer.street || customer.zip !== editedCustomer.zip) && mapsLoaded) {
                    triggerDistanceCalculation(data);
                } else {
                    onUpdate();
                }
                setIsSaving(false);
            }
        }
    };
    
    const closeVerificationDialogAndSave = () => {
        setVerificationResult(null);
        handleSave(true);
    };

    const handleSaveAdminNotes = async () => {
        setIsSaving(true);
        const { error } = await supabase
            .from('customers')
            .update({ admin_notes: editedCustomer.admin_notes })
            .eq('id', customer.id);
        
        if (error) {
            toast({ title: "Failed to save admin notes", description: error.message, variant: "destructive" });
        } else {
            toast({ title: "Admin notes saved!" });
            setCustomer(prev => ({...prev, admin_notes: editedCustomer.admin_notes}));
        }
        setIsSaving(false);
    };
    
    const handleSaveManualDistance = async () => {
        const distNum = parseFloat(manualDistance);
        const timeNum = parseInt(manualTime, 10);
        
        if (isNaN(distNum) || isNaN(timeNum)) {
            toast({ title: "Invalid Input", description: "Please enter valid numbers for distance and time.", variant: "destructive" });
            return;
        }

        setIsSaving(true);
        const { error } = await supabase
            .from('customers')
            .update({ 
                distance_miles: distNum,
                travel_time_minutes: timeNum
            })
            .eq('id', customer.id);
            
        if (error) {
            toast({ title: "Failed to save manual distance", description: error.message, variant: "destructive" });
        } else {
            toast({ title: "Distance Updated", description: "Manual distance and travel time have been saved." });
            setTravelInfo({ eta: `${timeNum} mins`, distance: `${distNum} miles`, loading: false, error: null });
            setShowManualEntry(false);
            onUpdate(); // refresh global state
        }
        setIsSaving(false);
    };

    const displayFirstName = editedCustomer.first_name || (editedCustomer.name ? editedCustomer.name.split(' ')[0] : '');
    const displayLastName = editedCustomer.last_name || (editedCustomer.name ? editedCustomer.name.substring(editedCustomer.name.indexOf(' ') + 1) : '');

    return (
        <>
            <div className="grid md:grid-cols-2 gap-12">
                <div>
                    <div className="flex justify-between items-center mb-4">
                        <h3 className="flex items-center text-xl font-bold text-yellow-400">Contact & Billing Information</h3>
                         <div className="flex gap-2">
                            {isEditing ? (
                                <>
                                    <Button onClick={() => handleSave(false)} disabled={isSaving} size="sm">
                                        {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />} Verify & Save
                                    </Button>
                                    <Button variant="ghost" size="sm" onClick={() => { setIsEditing(false); setEditedCustomer(customer); setAddressAutocompleteUsed(true); }}>
                                        <X className="mr-2 h-4 w-4" /> Cancel
                                    </Button>
                                </>
                            ) : (
                                <>
                                    <Button onClick={onHistoryClick} size="sm" variant="secondary">
                                        <History className="mr-2 h-4 w-4"/> Full History
                                    </Button>
                                    <Button onClick={() => setIsEditing(true)} size="sm" variant="outline" className="border-yellow-400 text-yellow-400 hover:bg-yellow-400 hover:text-black">
                                        <Edit className="mr-2 h-4 w-4"/> Edit Profile
                                    </Button>
                                </>
                            )}
                        </div>
                    </div>

                    {isEditing ? (
                        <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-3">
                                <EditInput label="First Name" icon={<User />} value={displayFirstName} onChange={(e) => handleInputChange('first_name', e.target.value)} isEditing={isEditing} />
                                <EditInput label="Last Name" icon={<User />} value={displayLastName} onChange={(e) => handleInputChange('last_name', e.target.value)} isEditing={isEditing} />
                            </div>
                            <EditInput label="Email" icon={<Mail />} value={editedCustomer.email} onChange={(e) => handleInputChange('email', e.target.value)} isEditing={isEditing} type="email" />
                            <EditInput label="Phone" icon={<Phone />} value={editedCustomer.phone} onChange={(e) => handleInputChange('phone', e.target.value)} isEditing={isEditing} type="tel" />
                            
                            <div className="bg-black/20 p-4 rounded-lg border border-white/10 space-y-3 mt-4">
                                <Label className="text-yellow-400 font-semibold flex items-center">
                                    <MapPin className="w-4 h-4 mr-2"/> Address Verification
                                </Label>
                                <GooglePlacesAutocomplete 
                                    value={editedCustomer.street} 
                                    onChange={(val) => handleInputChange('street', val)} 
                                    onAddressSelect={handleAddressSelect} 
                                    placeholder="Search for address..." 
                                    required 
                                />
                                <div className="grid grid-cols-2 gap-3">
                                    <EditInput label="City" icon={<MapPin />} value={editedCustomer.city} onChange={(e) => handleInputChange('city', e.target.value)} isEditing={isEditing} />
                                    <EditInput label="State" icon={<MapPin />} value={editedCustomer.state} onChange={(e) => handleInputChange('state', e.target.value)} isEditing={isEditing} />
                                </div>
                                <EditInput label="ZIP" icon={<MapPin />} value={editedCustomer.zip} onChange={(e) => handleInputChange('zip', e.target.value)} isEditing={isEditing} />
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-1">
                            <InfoRow icon={<Key />} label="Customer ID" value={editedCustomer.customer_id_text || 'N/A'} />
                            <InfoRow icon={<User />} label="First Name" value={displayFirstName} />
                            <InfoRow icon={<User />} label="Last Name" value={displayLastName} />
                            <InfoRow icon={<Mail />} label="Email" value={editedCustomer.email} href={`mailto:${editedCustomer.email}`} />
                            <InfoRow icon={<Phone />} label="Phone" value={editedCustomer.phone} href={`tel:${editedCustomer.phone}`} />
                            <div className="flex items-start py-2 border-b border-white/10">
                                <div className="flex items-center w-1/3 text-blue-200">
                                    <Home className="mr-3 h-5 w-5" />
                                    <span>Address</span>
                                </div>
                                <div className="w-2/3 flex flex-col">
                                    <span className="text-white break-all">{`${editedCustomer.street}, ${editedCustomer.city}, ${editedCustomer.state} ${editedCustomer.zip}`}</span>
                                    {editedCustomer.unverified_address ? (
                                        <span className="flex items-center text-xs text-orange-400 mt-1"><AlertTriangle className="w-3 h-3 mr-1"/> Unverified Address</span>
                                    ) : (
                                        <span className="flex items-center text-xs text-green-400 mt-1"><CheckCircle className="w-3 h-3 mr-1"/> Verified</span>
                                    )}
                                </div>
                            </div>
                            
                            {/* Location & Travel Information Section */}
                             {mapsLoading || travelInfo.loading ? (
                                <div className="flex items-center py-2 border-b border-white/10">
                                    <Loader2 className="mr-3 h-5 w-5 animate-spin text-blue-200" />
                                    <span className="text-blue-200">
                                        {mapsLoading ? "Loading maps service..." : "Calculating travel time and distance..."}
                                    </span>
                                </div>
                            ) : mapsError ? (
                                <div className="py-2 border-b border-white/10 text-red-400 text-sm flex items-center">
                                    <AlertTriangle className="mr-3 h-5 w-5" />
                                    Maps service unavailable. Distance calculation disabled.
                                </div>
                            ) : showManualEntry ? (
                                <div className="py-3 border-b border-white/10 space-y-3 bg-black/20 p-4 rounded-lg mt-2">
                                    <div className="flex items-center justify-between">
                                        <Label className="text-yellow-400 font-semibold flex items-center">
                                            <Edit className="w-4 h-4 mr-2"/> Manual Distance Override
                                        </Label>
                                        <Button 
                                            variant="outline" 
                                            size="sm" 
                                            onClick={() => triggerDistanceCalculation(customer)} 
                                            className="text-xs py-1 h-7 border-blue-400 text-blue-400"
                                            disabled={!mapsLoaded}
                                        >
                                            Auto Calculate
                                        </Button>
                                    </div>
                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="space-y-1">
                                            <Label className="text-xs text-blue-200">Distance (miles)</Label>
                                            <Input 
                                                type="number" 
                                                step="0.1" 
                                                value={manualDistance} 
                                                onChange={e => setManualDistance(e.target.value)} 
                                                className="bg-white/10 text-white" 
                                                placeholder="e.g. 15.2"
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <Label className="text-xs text-blue-200">Travel Time (mins)</Label>
                                            <Input 
                                                type="number" 
                                                value={manualTime} 
                                                onChange={e => setManualTime(e.target.value)} 
                                                className="bg-white/10 text-white" 
                                                placeholder="e.g. 35"
                                            />
                                        </div>
                                    </div>
                                    <div className="flex gap-2 pt-2">
                                        <Button size="sm" onClick={handleSaveManualDistance} disabled={isSaving}>
                                            {isSaving ? <Loader2 className="w-4 h-4 animate-spin mr-2"/> : <Save className="w-4 h-4 mr-2"/>} Save Override
                                        </Button>
                                        <Button size="sm" variant="ghost" onClick={() => setShowManualEntry(false)}>Cancel</Button>
                                    </div>
                                </div>
                            ) : (
                                <>
                                    <div className="flex items-start py-2 border-b border-white/10 group">
                                        <div className="flex items-center w-1/3 text-blue-200">
                                            <Car className="mr-3 h-5 w-5" />
                                            <span>Est. Travel Time</span>
                                        </div>
                                        <div className="w-2/3 flex items-center justify-between">
                                            <span className="text-white">
                                                {travelInfo.eta ? `${travelInfo.eta} (one-way)` : 'N/A (one-way)'}
                                            </span>
                                            <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => setShowManualEntry(true)}>
                                                <Pencil className="h-3 w-3 text-yellow-400" />
                                            </Button>
                                        </div>
                                    </div>
                                    <div className="flex items-start py-2 border-b border-white/10 group">
                                        <div className="flex items-center w-1/3 text-blue-200">
                                            <Route className="mr-3 h-5 w-5" />
                                            <span>Distance</span>
                                        </div>
                                        <div className="w-2/3 flex flex-col">
                                            <div className="flex items-center justify-between w-full">
                                                <span className="text-white">
                                                    {travelInfo.distance ? `${travelInfo.distance} (one-way)` : 'N/A (one-way)'}
                                                </span>
                                                <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => setShowManualEntry(true)}>
                                                    <Pencil className="h-3 w-3 text-yellow-400" />
                                                </Button>
                                            </div>
                                            {travelInfo.error && (
                                                <div className="mt-1">
                                                    <span className="text-xs text-red-400 block mb-1">API Error: {travelInfo.error}</span>
                                                    <Button variant="link" size="sm" className="h-auto p-0 text-yellow-400 text-xs" onClick={() => setShowManualEntry(true)}>
                                                        Enter Manually
                                                    </Button>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </>
                            )}
                            
                            <InfoRow icon={<Hash />} label="Stripe Customer ID" value={editedCustomer.stripe_customer_id || "Not Available"} />
                            <InfoRow icon={<Hash />} label="Last Payment Intent ID" value={editedCustomer.stripe_payment_intent_id || "Not Available"} />
                            <InfoRow icon={<Hash />} label="Last Charge ID" value={editedCustomer.stripe_charge_id || "Not Available"} />
                        </div>
                    )}
                </div>
                
                <div>
                     <h3 className="flex items-center text-xl font-bold text-yellow-400 mb-4"><StickyNote className="mr-2"/>Admin-Only Notes</h3>
                     <p className="text-sm text-blue-200 mb-2">These notes are private and only visible to administrators.</p>
                     <Textarea 
                        value={editedCustomer.admin_notes || ''}
                        onChange={(e) => handleInputChange('admin_notes', e.target.value)}
                        className="bg-white/10 min-h-[200px]"
                        placeholder="Add private notes here..."
                     />
                     <Button onClick={handleSaveAdminNotes} className="mt-4" disabled={isSaving}>
                        {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />} 
                        Save Notes
                    </Button>
                </div>
            </div>

            <Dialog open={verificationResult !== null} onOpenChange={() => setVerificationResult(null)}>
                 <DialogContent>
                    {verificationResult?.status === 'success' ? (
                        <>
                            <DialogHeader>
                                <DialogTitle className="flex items-center text-green-400 text-2xl"><CheckCircle className="mr-3 h-8 w-8" />Address Verified</DialogTitle>
                            </DialogHeader>
                            <DialogDescription className="my-4 text-base">The address has been successfully verified by Google Maps and all related flags have been cleared.</DialogDescription>
                            <DialogFooter>
                                <Button onClick={() => setVerificationResult(null)} className="bg-green-600 hover:bg-green-700">
                                    <ArrowRight className="mr-2 h-4 w-4" /> Continue
                                </Button>
                            </DialogFooter>
                        </>
                    ) : (
                         <>
                            <DialogHeader>
                                <DialogTitle className="flex items-center text-red-400 text-2xl"><AlertTriangle className="mr-3 h-8 w-8" />Address Verification Failed</DialogTitle>
                            </DialogHeader>
                            <DialogDescription className="my-4 text-base">{verificationResult?.message} Do you want to save this address anyway? This will keep the customer flagged.</DialogDescription>
                            <DialogFooter>
                                <Button onClick={() => setVerificationResult(null)} variant="outline">Back to Editing</Button>
                                <Button onClick={closeVerificationDialogAndSave} variant="destructive">Save Anyway</Button>
                            </DialogFooter>
                        </>
                    )}
                </DialogContent>
            </Dialog>
        </>
    );
};