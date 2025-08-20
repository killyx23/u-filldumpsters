
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, ArrowRight, User, Mail, Phone, Home, MapPin, Calendar as CalendarIcon, AlertTriangle, Loader2, Info, Clock, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from "@/components/ui/checkbox";
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { format, startOfDay, isBefore, addHours, isSameDay, parseISO, startOfMonth, endOfMonth, formatISO } from 'date-fns';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';

export const BookingForm = ({ plan, bookingData, setBookingData, onSubmit, onBack, onShowAgreement, agreementAccepted }) => {
  const [totalPrice, setTotalPrice] = useState(plan.price);
  const [availability, setAvailability] = useState({});
  const [loadingAvailability, setLoadingAvailability] = useState(true);
  const [isVerifyingAddress, setIsVerifyingAddress] = useState(false);
  const [addressWarning, setAddressWarning] = useState(null);
  const [phoneWarning, setPhoneWarning] = useState(null);
  const [showEmailConfirmDialog, setShowEmailConfirmDialog] = useState(false);
  const [currentMonth, setCurrentMonth] = useState(new Date());

  const fetchAvailability = useCallback(async (month) => {
    setLoadingAvailability(true);
    const startDate = formatISO(startOfMonth(month), { representation: 'date' });
    const endDate = formatISO(endOfMonth(month), { representation: 'date' });

    try {
      const { data, error } = await supabase.functions.invoke('get-availability', {
        body: { serviceId: plan.id, startDate, endDate, fetchBookings: false }
      });

      if (error) {
        console.error("Edge function error:", error);
        throw new Error(`Failed to send request to the edge function.`);
      }
      
      if(data.error) {
        throw new Error(data.error);
      }
      
      setAvailability(prev => ({ ...prev, ...data.availability }));
    } catch (error) {
      toast({
        title: "Error fetching availability",
        description: error.message,
        variant: "destructive",
      });
      setAvailability({});
    } finally {
      setLoadingAvailability(false);
    }
  }, [plan.id]);

  useEffect(() => {
    fetchAvailability(currentMonth);
  }, [fetchAvailability, currentMonth]);

  const handleMonthChange = (month) => {
    setCurrentMonth(month);
    if (!Object.keys(availability).some(d => d.startsWith(format(month, 'yyyy-MM')))) {
      fetchAvailability(month);
    }
  };

  const disabledDates = useMemo(() => {
    const dates = Object.entries(availability)
      .filter(([, data]) => !data.available)
      .map(([dateStr]) => parseISO(dateStr));
    
    return [{ before: startOfDay(new Date()) }, ...dates];
  }, [availability]);

  const timeSlots = useMemo(() => {
    const dropOffDateStr = bookingData.dropOffDate ? format(bookingData.dropOffDate, 'yyyy-MM-dd') : null;
    const pickupDateStr = bookingData.pickupDate ? format(bookingData.pickupDate, 'yyyy-MM-dd') : null;

    return {
      dropOff: dropOffDateStr && availability[dropOffDateStr] ? availability[dropOffDateStr].dropOffSlots : [],
      pickup: pickupDateStr && availability[pickupDateStr] ? availability[pickupDateStr].pickupSlots : [],
    };
  }, [bookingData.dropOffDate, bookingData.pickupDate, availability]);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setBookingData(prev => ({...prev, [name]: value}));
  };
  
  const handleTimeChange = (field, value) => {
    setBookingData(prev => ({...prev, [field]: value}));
  };

  const handleDateSelect = (field, date) => {
    const newDate = date ? startOfDay(date) : null;
    setBookingData(prev => ({ ...prev, [field]: newDate, [`${field.replace('Date', '')}TimeSlot`]: '' }));

    if (field === 'dropOffDate' && newDate) {
      const pickupDate = bookingData.pickupDate ? startOfDay(bookingData.pickupDate) : null;
      if (!pickupDate || isBefore(pickupDate, newDate)) {
        setBookingData(prev => ({ ...prev, pickupDate: newDate, pickupTimeSlot: '' }));
      }
    }
  };
  
  const calculatePrice = useCallback(() => {
    if (!bookingData.dropOffDate || !bookingData.pickupDate) {
      return plan.price;
    }

    const dropOff = startOfDay(new Date(bookingData.dropOffDate));
    const pickup = startOfDay(new Date(bookingData.pickupDate));
    
    if (isBefore(pickup, dropOff)) {
      return plan.price;
    }

    const timeDiff = pickup.getTime() - dropOff.getTime();
    const dayDiff = Math.max(0, Math.ceil(timeDiff / (1000 * 3600 * 24))) + 1;
    
    if (plan.id === 1) { // Dumpster Rental
        const basePrice = 300;
        const dailyRate = 50;
        const weeklySpecialPrice = 500;
        
        if (dayDiff === 7) return weeklySpecialPrice;
        
        const additionalDays = Math.max(0, dayDiff - 1);
        return basePrice + (additionalDays * dailyRate);
    } else if (plan.id === 2) { // Dump Loader Trailer Rental Service
        return plan.price * dayDiff;
    }
    return plan.price;
  }, [bookingData.dropOffDate, bookingData.pickupDate, plan]);

  useEffect(() => {
    setTotalPrice(calculatePrice());
  }, [calculatePrice]);

  const pickupDisabledDates = useMemo(() => {
    const dropOffDate = bookingData.dropOffDate ? startOfDay(bookingData.dropOffDate) : new Date();
    return [
      ...disabledDates,
      { before: dropOffDate },
    ];
  }, [bookingData.dropOffDate, disabledDates]);

  const isFormValid = useMemo(() => {
    return agreementAccepted && bookingData.name && bookingData.email && bookingData.phone && bookingData.street && bookingData.city && bookingData.state && bookingData.zip && bookingData.dropOffDate && bookingData.pickupDate && bookingData.dropOffTimeSlot && bookingData.pickupTimeSlot;
  }, [bookingData, agreementAccepted]);

  const validatePhoneNumber = () => {
    const phoneRegex = /^\D*(\d{3})\D*(\d{3})\D*(\d{4})\D*$/;
    if (!phoneRegex.test(bookingData.phone) || bookingData.phone.replace(/\D/g, '').length < 10) {
      setPhoneWarning("Please enter a valid 10-digit phone number.");
      return false;
    }
    setPhoneWarning(null);
    return true;
  };

  const proceedToNextStep = (addressSkipped) => {
    if (plan.id === 2) {
      setShowEmailConfirmDialog(true);
    } else {
      onSubmit(totalPrice, addressSkipped);
    }
  };

  const handleFormSubmit = async (e) => {
    e.preventDefault();
    if (!validatePhoneNumber()) {
      return;
    }

    setIsVerifyingAddress(true);
    const fullAddress = `${bookingData.street}, ${bookingData.city}, ${bookingData.state} ${bookingData.zip}`;
    const { data, error } = await supabase.functions.invoke('verify-address', {
        body: { address: fullAddress }
    });

    setIsVerifyingAddress(false);

    if (error || !data.isValid) {
        setAddressWarning(data?.message || "The address could not be verified.");
    } else {
        proceedToNextStep(false); // False for addressVerificationSkipped
    }
  };

  const handleProceedWithRisk = () => {
    setAddressWarning(null);
    proceedToNextStep(true); // True for addressVerificationSkipped
  };
  
  const handleEmailConfirmed = () => {
      setShowEmailConfirmDialog(false);
      onSubmit(totalPrice, !!addressWarning);
  };

  return (
    <>
    <motion.div
      initial={{ opacity: 0, x: 100 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -100 }}
      transition={{ duration: 0.5 }}
      className="container mx-auto py-16 px-4"
    >
      <div className="max-w-4xl mx-auto bg-white/10 backdrop-blur-lg rounded-2xl p-8 shadow-2xl border border-white/20">
        <div className="flex items-center mb-8">
          <Button onClick={onBack} variant="ghost" size="icon" className="mr-4 text-white hover:bg-white/20">
            <ArrowLeft />
          </Button>
          <h2 className="text-3xl font-bold text-white">Step 1: Booking Details</h2>
        </div>

        <div className="grid md:grid-cols-2 gap-8">
          <div className="bg-white/5 p-6 rounded-lg">
            <div className="flex items-center mb-4">
                <h3 className="text-2xl font-bold text-yellow-400">{plan.name}</h3>
                {plan.id === 2 && ( 
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button variant="ghost" size="icon" className="ml-2 text-red-500 hover:text-red-600">
                                <Info />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="bg-gray-900 border-red-400 text-white max-w-xs">
                            <p className="font-bold text-red-400 mb-2">Important Rental Information</p>
                            <p className="text-sm">
                                Rentals are ready to be picked up at the address given at 8:00 a.m. If picked up after that time, it is still considered to be a full-day charge, no matter what time it was picked up, and still needs to be returned by 10 p.m. the same day, or may be subject to a late fee or even an additional full-day charge.
                            </p>
                            <p className="text-xs text-blue-200 mt-4">&copy; {new Date().getFullYear()} U-Fill Dumpsters. All rights reserved.</p>
                        </TooltipContent>
                    </Tooltip>
                )}
            </div>
            <p className="text-blue-200 mb-6">
                {plan.description}
                {plan.id === 2 && " (Pick up location is in South Saratoga Springs.)"}
            </p>
            <div className="border-t border-white/20 pt-4">
              <p className="text-white text-lg font-semibold">Estimated Base Price:</p>
              <p className="text-4xl font-bold text-green-400">${totalPrice.toFixed(2)}</p>
               <p className="text-sm text-blue-200 mt-1">Calculated based on selected dates.</p>
            </div>
          </div>

          <form onSubmit={handleFormSubmit} className="space-y-4">
            <InputField icon={<User />} type="text" name="name" placeholder="Full Name" value={bookingData.name} onChange={handleInputChange} required />
            <InputField icon={<Mail />} type="email" name="email" placeholder="Email Address" value={bookingData.email} onChange={handleInputChange} required />
            <InputField icon={<Phone />} type="tel" name="phone" placeholder="Phone Number" value={bookingData.phone} onChange={handleInputChange} onBlur={validatePhoneNumber} required />
            <InputField icon={<Home />} type="text" name="street" placeholder="Street Address" value={bookingData.street} onChange={handleInputChange} required />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <InputField icon={<MapPin />} type="text" name="city" placeholder="City" value={bookingData.city} onChange={handleInputChange} required />
                <InputField icon={<MapPin />} type="text" name="state" placeholder="State" value={bookingData.state} onChange={handleInputChange} required />
                <InputField icon={<MapPin />} type="text" name="zip" placeholder="ZIP Code" value={bookingData.zip} onChange={handleInputChange} required />
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <DatePickerField label={plan.id === 2 ? "Pickup Date & Time" : "Drop-off Date & Time"} date={bookingData.dropOffDate} setDate={(d) => handleDateSelect('dropOffDate', d)} disabledDates={disabledDates} onMonthChange={handleMonthChange} />
                <TimeSlotPicker label="Time" value={bookingData.dropOffTimeSlot} onValueChange={(v) => handleTimeChange('dropOffTimeSlot', v)} slots={timeSlots.dropOff} disabled={!bookingData.dropOffDate || loadingAvailability} loading={loadingAvailability && !timeSlots.dropOff.length} />
                <DatePickerField label={plan.id === 2 ? "Return Date & Time" : "Pickup Date & Time"} date={bookingData.pickupDate} setDate={(d) => handleDateSelect('pickupDate', d)} disabledDates={pickupDisabledDates} onMonthChange={handleMonthChange} />
                <TimeSlotPicker label="Time" value={bookingData.pickupTimeSlot} onValueChange={(v) => handleTimeChange('pickupTimeSlot', v)} slots={timeSlots.pickup} disabled={!bookingData.pickupDate || loadingAvailability} loading={loadingAvailability && !timeSlots.pickup.length} />
            </div>

            <div className="flex items-center space-x-3 pt-2">
              <Checkbox id="agreement" checked={agreementAccepted} onCheckedChange={onShowAgreement} className="border-white/50 data-[state=checked]:bg-yellow-400" />
              <label htmlFor="agreement" className="text-sm text-white">
                I have read and accept the <span onClick={onShowAgreement} className="text-yellow-400 font-bold underline cursor-pointer">user agreement</span>.
              </label>
            </div>
            
            {!agreementAccepted && (
              <div className="flex items-center text-yellow-300 text-sm">
                <AlertTriangle className="h-4 w-4 mr-2" />
                Please accept the agreement to proceed.
              </div>
            )}

            <Button type="submit" disabled={!isFormValid || isVerifyingAddress} className="w-full py-3 text-lg font-semibold bg-gradient-to-r from-yellow-500 to-orange-600 hover:from-yellow-600 hover:to-orange-700 text-black disabled:opacity-50 disabled:cursor-not-allowed">
              {isVerifyingAddress ? <Loader2 className="h-6 w-6 animate-spin" /> : isFormValid ? <>Proceed to Add-ons <ArrowRight className="ml-2" /></> : 'Complete All Fields to Continue'}
            </Button>
          </form>
        </div>
      </div>
    </motion.div>
    <Dialog open={!!addressWarning} onOpenChange={() => setAddressWarning(null)}>
        <DialogContent className="bg-gray-900 border-red-500 text-white">
            <DialogHeader>
                <DialogTitle className="flex items-center text-red-400 text-2xl">
                    <AlertTriangle className="mr-3 h-8 w-8" />
                    Address Verification Failed
                </DialogTitle>
            </DialogHeader>
            <DialogDescription className="text-blue-200 my-4 text-base">
                {addressWarning} Please review your address details to ensure they are correct.
            </DialogDescription>
            <div className="bg-red-900/30 border border-red-500/50 p-4 rounded-md text-sm">
                <p className="font-bold text-red-300">Disclaimer and Assumption of Risk</p>
                <p className="text-red-200 mt-2">
                    By proceeding with an unverified or potentially incorrect address, you acknowledge and agree that this may result in significant delays or the cancellation of your delivery. You hereby assume all risks and associated costs, including but not to limited to non-refundable fees, that may arise from providing an inaccurate or unserviceable address.
                </p>
            </div>
            <DialogFooter className="gap-2 sm:justify-between mt-4">
                <Button onClick={() => setAddressWarning(null)} variant="outline" className="border-yellow-400 text-yellow-400 hover:bg-yellow-400 hover:text-black">Review Address</Button>
                <Button onClick={handleProceedWithRisk} variant="destructive">I Understand & Continue</Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>
    <Dialog open={!!phoneWarning} onOpenChange={() => setPhoneWarning(null)}>
        <DialogContent className="bg-gray-900 border-red-500 text-white">
            <DialogHeader>
                <DialogTitle className="flex items-center text-red-400 text-2xl">
                    <AlertTriangle className="mr-3 h-8 w-8" />
                    Invalid Phone Number
                </DialogTitle>
            </DialogHeader>
            <DialogDescription className="text-blue-200 my-4 text-base">
                {phoneWarning}
            </DialogDescription>
            <DialogFooter>
                <Button onClick={() => setPhoneWarning(null)} variant="outline" className="border-yellow-400 text-yellow-400 hover:bg-yellow-400 hover:text-black">OK</Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>
    <Dialog open={showEmailConfirmDialog} onOpenChange={setShowEmailConfirmDialog}>
        <DialogContent className="bg-gray-900 border-yellow-500 text-white">
            <DialogHeader>
                <DialogTitle className="flex items-center text-yellow-400 text-2xl">
                    <ShieldCheck className="mr-3 h-8 w-8" />
                    Please Confirm Your Email
                </DialogTitle>
            </DialogHeader>
            <div className="my-4 text-base">
                <p className="text-blue-200">Please take a moment to verify that your email address is correct before proceeding:</p>
                <p className="font-bold text-white text-lg my-3 text-center bg-white/10 p-3 rounded-md">{bookingData.email}</p>
                <div className="bg-blue-900/30 border border-blue-500/50 p-4 rounded-md text-sm mt-4">
                    <p className="font-bold text-blue-300 mb-2">Important Information Disclaimer</p>
                    <p className="text-blue-200">
                        Your booking confirmation, which contains critical rental details, will be sent to this email address. This includes the precise pickup location for the trailer, access codes for the security lock, and essential instructions regarding proper equipment usage and safety protocols. An incorrect email address will result in you not receiving this vital information. By confirming, you acknowledge the accuracy of this email for receiving all official correspondence related to your rental.
                    </p>
                </div>
            </div>
            <DialogFooter className="gap-2 sm:justify-end">
                <Button onClick={() => setShowEmailConfirmDialog(false)} variant="outline" className="border-white/50 text-white hover:bg-white/20 hover:text-white">Edit Email</Button>
                <Button onClick={handleEmailConfirmed} className="bg-yellow-500 text-black hover:bg-yellow-600">Email is Correct, Continue</Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>
    </>
  );
};

const InputField = ({ icon, ...props }) => (
  <div className="relative flex items-center">
    <span className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-blue-300">{icon}</span>
    <input {...props} className="w-full bg-white/10 text-white rounded-lg border border-white/30 focus:ring-2 focus:ring-yellow-400 focus:border-yellow-400 pl-10 pr-4 py-3 placeholder-blue-200" />
  </div>
);

const DatePickerField = ({ label, date, setDate, disabledDates, onMonthChange }) => (
    <div className="md:col-span-1">
        <label className="text-sm font-medium text-white mb-2 block">{label}</label>
        <Popover>
            <PopoverTrigger asChild>
                <Button variant="outline" className="w-full justify-start text-left font-normal bg-white/10 border-white/30 hover:bg-white/20 text-white">
                    <CalendarIcon className="mr-2 h-4 w-4"/>
                    {date ? format(date, 'PPP') : <span>Pick a date</span>}
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0 bg-gray-800 border-gray-700 text-white">
                <Calendar mode="single" selected={date} onSelect={setDate} disabled={disabledDates} initialFocus onMonthChange={onMonthChange} />
            </PopoverContent>
        </Popover>
    </div>
);

const TimeSlotPicker = ({ label, value, onValueChange, slots, disabled, loading }) => (
    <div className="md:col-span-1">
        <label className="text-sm font-medium text-white mb-2 block invisible">{label}</label>
        <Select onValueChange={onValueChange} value={value} disabled={disabled}>
            <SelectTrigger className="w-full bg-white/10 border-white/30 text-white">
                <Clock className="mr-2 h-4 w-4" />
                <SelectValue placeholder="Select a time" />
            </SelectTrigger>
            <SelectContent className="bg-gray-800 border-gray-700 text-white">
                {loading ? <SelectItem value="loading" disabled>Loading...</SelectItem> :
                 slots && slots.length > 0 ? slots.map(slot => (
                    <SelectItem key={slot} value={slot}>{format(new Date(`1970-01-01T${slot}`), 'h:mm a')}</SelectItem>
                )) : <SelectItem value="no-slots" disabled>No available slots</SelectItem>}
            </SelectContent>
        </Select>
    </div>
);
