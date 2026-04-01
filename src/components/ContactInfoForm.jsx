
import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, ArrowRight, User, Mail, Phone, Contact, MapPin, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { toast } from '@/components/ui/use-toast';
import { GooglePlacesAutocomplete } from '@/components/GooglePlacesAutocomplete.jsx';

export const ContactInfoForm = ({ bookingData, setBookingData, onSubmit, onBack }) => {
    const [phoneWarning, setPhoneWarning] = useState(null);

    const handleInputChange = e => {
        const { name, value } = e.target;
        setBookingData(prev => ({ ...prev, [name]: value }));
    };

    const handleBlur = e => {
        const { name, value } = e.target;
        if (name === 'firstName' || name === 'lastName') {
            setBookingData(prev => ({ ...prev, [name]: value.trim() }));
        }
    };

    const validatePhoneNumber = () => {
        if (!/^\D*(\d{3})\D*(\d{3})\D*(\d{4})\D*$/.test(bookingData.phone) || bookingData.phone.replace(/\D/g, '').length < 10) {
            setPhoneWarning("Please enter a valid 10-digit phone number.");
            return false;
        }
        setPhoneWarning(null);
        return true;
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        
        const trimmedFirstName = (bookingData.firstName || '').trim();
        const trimmedLastName = (bookingData.lastName || '').trim();

        setBookingData(prev => ({
            ...prev,
            firstName: trimmedFirstName,
            lastName: trimmedLastName
        }));
        
        if (!trimmedFirstName || !trimmedLastName || !bookingData.email || !bookingData.phone) {
            toast({ title: "Required Fields", description: "Please fill out your contact details.", variant: "destructive" });
            return;
        }

        const cAddress = bookingData.contactAddress;
        if (!cAddress?.street || !cAddress?.city || !cAddress?.state || !cAddress?.zip) {
            toast({ title: "Address Required", description: "Please ensure your full contact address is provided.", variant: "destructive" });
            return;
        }

        if (!validatePhoneNumber()) return;
        
        onSubmit();
    };

    const handleManualAddressChange = (field, value) => {
        setBookingData(prev => ({
            ...prev,
            contactAddress: {
                ...prev.contactAddress,
                [field]: value,
                isVerified: false,
                unverifiedAccepted: true
            }
        }));
    };

    return (
        <>
            <motion.div
                initial={{ opacity: 0, y: 50 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -50 }}
                className="container mx-auto py-16 px-4"
            >
                <div className="max-w-3xl mx-auto bg-white/10 backdrop-blur-lg rounded-2xl p-8 shadow-2xl border border-white/20">
                    <div className="flex items-center mb-8 border-b border-white/10 pb-4">
                        <Button onClick={onBack} variant="ghost" size="icon" className="mr-4 text-white hover:bg-white/20">
                            <ArrowLeft />
                        </Button>
                        <h2 className="text-3xl font-bold text-white flex items-center">
                            <Contact className="mr-3 h-8 w-8 text-blue-400" />
                            Personal Details
                        </h2>
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-6">
                        <div className="bg-black/20 p-6 rounded-xl border border-white/10 space-y-4">
                            <p className="text-blue-200 mb-4">Please provide your details so we can send you updates and coordinate your rental.</p>
                            
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <InputField icon={<User />} type="text" name="firstName" placeholder="First Name" value={bookingData.firstName} onChange={handleInputChange} onBlur={handleBlur} required />
                                <InputField icon={<User />} type="text" name="lastName" placeholder="Last Name" value={bookingData.lastName} onChange={handleInputChange} onBlur={handleBlur} required />
                            </div>
                            <InputField icon={<Phone />} type="tel" name="phone" placeholder="Phone Number" value={bookingData.phone} onChange={handleInputChange} onBlur={validatePhoneNumber} required />
                            <InputField icon={<Mail />} type="email" name="email" placeholder="Email Address" value={bookingData.email} onChange={handleInputChange} required />
                        </div>

                        <div className="bg-black/20 p-6 rounded-xl border border-white/10 space-y-4">
                            <div className="flex items-center justify-between mb-2">
                                <h3 className="text-xl font-semibold text-white flex items-center">
                                    <MapPin className="mr-2 h-5 w-5 text-green-400" />
                                    Billing/Contact Address
                                </h3>
                                {bookingData.contactAddress?.isVerified && (
                                    <span className="flex items-center text-sm text-green-400 font-semibold bg-green-400/10 px-3 py-1 rounded-full border border-green-400/20">
                                        <CheckCircle2 className="w-4 h-4 mr-1" /> Verified
                                    </span>
                                )}
                            </div>
                            
                            <p className="text-sm text-gray-400 mb-4">You provided this address in the first step. You can update it here if needed.</p>
                            
                            <div className="space-y-2">
                                <GooglePlacesAutocomplete 
                                    value={bookingData.contactAddress?.street || ''} 
                                    onChange={(val) => setBookingData(prev => ({
                                        ...prev, 
                                        contactAddress: {...prev.contactAddress, street: val, isVerified: false, unverifiedAccepted: true}
                                    }))} 
                                    onAddressSelect={(details) => setBookingData(prev => ({
                                        ...prev, 
                                        contactAddress: {...details, isVerified: true, unverifiedAccepted: false}
                                    }))} 
                                    placeholder="Start typing your address..." 
                                    required 
                                />
                            </div>
                            
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
                                <InputField icon={<MapPin />} type="text" value={bookingData.contactAddress?.city || ''} onChange={(e) => handleManualAddressChange('city', e.target.value)} placeholder="City" />
                                <InputField icon={<MapPin />} type="text" value={bookingData.contactAddress?.state || ''} onChange={(e) => handleManualAddressChange('state', e.target.value)} placeholder="State" />
                                <InputField icon={<MapPin />} type="text" value={bookingData.contactAddress?.zip || ''} onChange={(e) => handleManualAddressChange('zip', e.target.value)} placeholder="ZIP Code" />
                            </div>
                        </div>

                        <div className="pt-4">
                            <Button type="submit" className="w-full py-6 text-lg font-bold bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white shadow-lg shadow-blue-900/50">
                                Continue to Terms & Conditions <ArrowRight className="ml-2 h-5 w-5" />
                            </Button>
                        </div>
                    </form>
                </div>
            </motion.div>

            <Dialog open={!!phoneWarning} onOpenChange={() => setPhoneWarning(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Invalid Phone</DialogTitle>
                    </DialogHeader>
                    <DialogDescription>{phoneWarning}</DialogDescription>
                    <DialogFooter>
                        <Button onClick={() => setPhoneWarning(null)}>OK</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
};

const InputField = ({ icon, disabled, ...props }) => (
    <div className="relative flex items-center">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-blue-300">{icon}</span>
        <input {...props} disabled={disabled} className={`w-full bg-white/10 text-white rounded-lg border border-white/30 focus:ring-2 focus:ring-yellow-400 focus:border-yellow-400 pl-10 pr-4 py-3 placeholder-blue-200 transition-colors ${disabled ? 'opacity-60 bg-gray-800' : ''}`} />
    </div>
);
