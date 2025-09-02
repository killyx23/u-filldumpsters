import React, { useState, useEffect, useCallback, useMemo } from 'react';
    import { motion } from 'framer-motion';
    import { ArrowLeft, ArrowRight, User, Mail, Phone, Home, MapPin, Calendar as CalendarIcon, AlertTriangle, Loader2, Info, Clock, ShieldCheck, Truck } from 'lucide-react';
    import { Button } from '@/components/ui/button';
    import { Checkbox } from "@/components/ui/checkbox";
    import { Calendar } from '@/components/ui/calendar';
    import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
    import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
    import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
    import { format, startOfDay, isBefore, parse, formatISO, startOfMonth, endOfMonth, isValid } from 'date-fns';
    import { supabase } from '@/lib/customSupabaseClient';
    import { toast } from '@/components/ui/use-toast';

    const ImportantInfoIcon = () => {
      const [isOpen, setIsOpen] = useState(false);
    
      return (
        <Popover open={isOpen} onOpenChange={setIsOpen}>
          <PopoverTrigger asChild>
            <div className="relative ml-2 cursor-pointer" onClick={() => setIsOpen(v => !v)}>
              <div className="relative z-10 text-red-500 hover:text-red-400 transition-colors">
                <Info className="h-7 w-7" />
              </div>
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
                <div className="animate-ping-slow-outer h-5 w-5 rounded-full bg-red-500/80"></div>
              </div>
            </div>
          </PopoverTrigger>
          <PopoverContent side="bottom" className="bg-gray-900 border-red-400 text-white max-w-xs" onOpenAutoFocus={(e) => e.preventDefault()}>
            <p className="font-bold text-red-400 mb-2">Important Rental Information</p>
            <p className="text-sm">Rentals are ready to be picked up at the address given at 8:00 a.m. If picked up after that time, it is still considered to be a full-day charge, no matter what time it was picked up, and still needs to be returned by 10 p.m. the same day, or may be subject to a late fee or even an additional full-day charge.</p>
            <p className="text-xs text-blue-200 mt-4">&copy; {new Date().getFullYear()} U-Fill Dumpsters. All rights reserved.</p>
          </PopoverContent>
        </Popover>
      );
    };

    export const BookingForm = ({ plan, bookingData, setBookingData, onSubmit, onBack, onShowAgreement, agreementAccepted }) => {
      const [totalPrice, setTotalPrice] = useState(plan.price);
      const [availability, setAvailability] = useState({});
      const [loadingAvailability, setLoadingAvailability] = useState(true);
      const [isVerifying, setIsVerifying] = useState(false);
      const [addressWarning, setAddressWarning] = useState(null);
      const [phoneWarning, setPhoneWarning] = useState(null);
      const [showEmailConfirmDialog, setShowEmailConfirmDialog] = useState(false);
      const [currentMonth, setCurrentMonth] = useState(startOfMonth(new Date()));
      const [distanceInfo, setDistanceInfo] = useState(null);
      const [showDistanceFeeDialog, setShowDistanceFeeDialog] = useState(false);

      const fetchAvailability = useCallback(async (month) => {
        setLoadingAvailability(true);
        const startDate = formatISO(startOfMonth(month), { representation: 'date' });
        const endDate = formatISO(endOfMonth(month), { representation: 'date' });

        try {
          const { data, error } = await supabase.functions.invoke('get-availability', {
            body: { serviceId: plan.id, startDate, endDate }
          });
          
          if (error) {
              let errorMsg = `Function invoke failed: ${error.message}`;
              try {
                  const contextError = await error.context.json();
                  if (contextError.error) {
                      errorMsg = contextError.error;
                  }
              } catch (e) {
                // Ignore if context is not valid JSON
              }
              throw new Error(errorMsg);
          }
          if(data.error) throw new Error(data.error);
          
          setAvailability(prev => ({ ...prev, ...data.availability }));
        } catch (error) {
          toast({ title: "Error fetching availability", description: error.message, variant: "destructive", duration: 30000 });
        } finally {
          setLoadingAvailability(false);
        }
      }, [plan.id]);

      useEffect(() => {
        fetchAvailability(currentMonth);
      }, [fetchAvailability, currentMonth]);

      const handleMonthChange = (month) => {
        const newMonth = startOfMonth(month);
        if (newMonth.getMonth() !== currentMonth.getMonth() || newMonth.getFullYear() !== currentMonth.getFullYear()) {
             setCurrentMonth(newMonth);
        }
      };

      const disabledDates = useMemo(() => ([{ before: startOfDay(new Date()) }, ...Object.entries(availability).filter(([, data]) => !data.available).map(([dateStr]) => parse(dateStr, 'yyyy-MM-dd', new Date()))]), [availability]);

      const timeSlots = useMemo(() => {
        const dropOffDateStr = bookingData.dropOffDate ? format(bookingData.dropOffDate, 'yyyy-MM-dd') : null;
        const pickupDateStr = bookingData.pickupDate ? format(bookingData.pickupDate, 'yyyy-MM-dd') : null;
        return {
          dropOff: dropOffDateStr && availability[dropOffDateStr] ? availability[dropOffDateStr].dropOffSlots : [],
          pickup: pickupDateStr && availability[pickupDateStr] ? availability[pickupDateStr].pickupSlots : [],
          dropOffUsesWindows: dropOffDateStr && availability[dropOffDateStr] ? availability[dropOffDateStr].usesWindows : false,
          pickupUsesWindows: pickupDateStr && availability[pickupDateStr] ? availability[pickupDateStr].usesWindows : false,
        };
      }, [bookingData.dropOffDate, bookingData.pickupDate, availability]);

      const handleInputChange = (e) => {
        const { name, value } = e.target;
        setBookingData(prev => ({...prev, [name]: value}));
      };
      
      const handleTimeChange = (field, value) => setBookingData(prev => ({...prev, [field]: value}));

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
        if (!bookingData.dropOffDate || !bookingData.pickupDate) return plan.price;
        const dropOff = startOfDay(new Date(bookingData.dropOffDate));
        const pickup = startOfDay(new Date(bookingData.pickupDate));
        if (!isValid(dropOff) || !isValid(pickup) || isBefore(pickup, dropOff)) return plan.price;
        const dayDiff = Math.max(0, Math.ceil((pickup.getTime() - dropOff.getTime()) / (1000 * 3600 * 24))) + 1;
        
        let price = plan.price;
        if (plan.id === 1) { // Dumpster Rental
            const basePrice = 300;
            const dailyRate = 50;
            const weeklySpecialPrice = 500;
            if (dayDiff === 7) price = weeklySpecialPrice;
            else price = basePrice + (Math.max(0, dayDiff - 1) * dailyRate);
        } else if (plan.id === 2) { // Dump Loader
            price = plan.price * dayDiff;
        }

        if (distanceInfo?.fee > 0) {
          price += distanceInfo.fee;
        }
        
        return price;
      }, [bookingData.dropOffDate, bookingData.pickupDate, plan, distanceInfo]);

      useEffect(() => {
        setTotalPrice(calculatePrice());
      }, [calculatePrice]);

      const pickupDisabledDates = useMemo(() => ([...disabledDates, { before: bookingData.dropOffDate ? startOfDay(bookingData.dropOffDate) : new Date() }]), [bookingData.dropOffDate, disabledDates]);

      const isFormValid = useMemo(() => (agreementAccepted && bookingData.name && bookingData.email && bookingData.phone && bookingData.street && bookingData.city && bookingData.state && bookingData.zip && bookingData.dropOffDate && bookingData.pickupDate && bookingData.dropOffTimeSlot && bookingData.pickupTimeSlot), [bookingData, agreementAccepted]);

      const validatePhoneNumber = () => {
        if (!/^\D*(\d{3})\D*(\d{3})\D*(\d{4})\D*$/.test(bookingData.phone) || bookingData.phone.replace(/\D/g, '').length < 10) {
          setPhoneWarning("Please enter a valid 10-digit phone number.");
          return false;
        }
        setPhoneWarning(null);
        return true;
      };

      const proceedToNextStep = (addressSkipped) => {
        const finalPrice = calculatePrice();
        if (plan.id === 2) {
          setShowEmailConfirmDialog(true);
        } else {
          onSubmit(finalPrice, addressSkipped, distanceInfo);
        }
      };

      const handleFormSubmit = async (e) => {
        e.preventDefault();
        if (!validatePhoneNumber()) return;

        setIsVerifying(true);
        const fullAddress = `${bookingData.street}, ${bookingData.city}, ${bookingData.state} ${bookingData.zip}`;
        
        try {
            const { data, error } = await supabase.functions.invoke('verify-address-and-distance', { body: { address: fullAddress, serviceType: plan.id } });
            if (error) {
                let errorMsg = `Function invoke failed: ${error.message}`;
                try {
                    const contextError = await error.context.json();
                    if (contextError.error) {
                        errorMsg = contextError.error;
                    }
                } catch (e) {
                  // Ignore
                }
                throw new Error(errorMsg);
            }
            
            if (data.error) throw new Error(data.error);

            if (!data.isValid) {
                setAddressWarning(data.message || "The address could not be verified.");
                setIsVerifying(false);
                return;
            }
            
            setAddressWarning(null);
            setDistanceInfo(data.distanceInfo);
            
            if (data.distanceInfo?.fee > 0) {
                setShowDistanceFeeDialog(true);
            } else {
                proceedToNextStep(false);
            }
        } catch(err) {
            toast({ title: 'Verification Error', description: err.message, variant: 'destructive', duration: 30000 });
            setIsVerifying(false);
        }
      };
      
      const handleAcceptDistanceFee = () => {
        setShowDistanceFeeDialog(false);
        proceedToNextStep(false);
        setIsVerifying(false);
      };

      const handleProceedWithRisk = () => {
        setAddressWarning(null);
        proceedToNextStep(true);
      };
      
      const handleEmailConfirmed = () => {
          setShowEmailConfirmDialog(false);
          const finalPrice = calculatePrice();
          onSubmit(finalPrice, !!addressWarning, distanceInfo);
      };
      
      const isDropOffLoading = loadingAvailability && (!bookingData.dropOffDate || !availability[format(bookingData.dropOffDate, 'yyyy-MM-dd')]);
      const isPickupLoading = loadingAvailability && (!bookingData.pickupDate || !availability[format(bookingData.pickupDate, 'yyyy-MM-dd')]);

      return (
        <>
        <motion.div initial={{ opacity: 0, y: 50 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -50 }} transition={{ duration: 0.5 }} className="container mx-auto py-16 px-4">
          <div className="max-w-4xl mx-auto bg-white/10 backdrop-blur-lg rounded-2xl p-8 shadow-2xl border border-white/20">
            <div className="flex items-center mb-8"><Button onClick={onBack} variant="ghost" size="icon" className="mr-4 text-white hover:bg-white/20"><ArrowLeft /></Button><h2 className="text-3xl font-bold text-white">Booking Details</h2></div>
            <div className="grid md:grid-cols-2 gap-8">
              <div className="bg-white/5 p-6 rounded-lg">
                <div className="flex items-center mb-4">
                  <h3 className="text-2xl font-bold text-yellow-400">{plan.name}</h3>
                  {plan.id === 2 && <ImportantInfoIcon />}
                </div>
                <p className="text-blue-200 mb-6">{plan.description}{plan.id === 2 && " (Pick up location is in South Saratoga Springs.)"}</p>
                <div className="border-t border-white/20 pt-4">
                  <p className="text-white text-lg font-semibold">Estimated Base Price:</p>
                  <div className="flex items-baseline">
                    <p className="text-4xl font-bold text-green-400">${totalPrice.toFixed(2)}</p>
                    <span className="text-sm text-blue-200 ml-2">(plus taxes)</span>
                  </div>
                  <p className="text-sm text-blue-200 mt-1">Calculated based on selected dates.{distanceInfo?.fee > 0 && <span className="block text-yellow-300"> Includes ${distanceInfo.fee.toFixed(2)} extended delivery fee.</span>}</p>
                </div>
              </div>
              <form onSubmit={handleFormSubmit} className="space-y-4">
                <InputField icon={<User />} type="text" name="name" placeholder="Full Name" value={bookingData.name} onChange={handleInputChange} required />
                <InputField icon={<Mail />} type="email" name="email" placeholder="Email Address" value={bookingData.email} onChange={handleInputChange} required />
                <InputField icon={<Phone />} type="tel" name="phone" placeholder="Phone Number" value={bookingData.phone} onChange={handleInputChange} onBlur={validatePhoneNumber} required />
                <InputField icon={<Home />} type="text" name="street" placeholder="Street Address" value={bookingData.street} onChange={handleInputChange} required />
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4"><InputField icon={<MapPin />} type="text" name="city" placeholder="City" value={bookingData.city} onChange={handleInputChange} required /><InputField icon={<MapPin />} type="text" name="state" placeholder="State" value={bookingData.state} onChange={handleInputChange} required /><InputField icon={<MapPin />} type="text" name="zip" placeholder="ZIP Code" value={bookingData.zip} onChange={handleInputChange} required /></div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <DatePickerField label={plan.id === 2 ? "Pickup Date & Time" : "Drop-off Date & Time"} date={bookingData.dropOffDate} setDate={(d) => handleDateSelect('dropOffDate', d)} disabledDates={disabledDates} onMonthChange={handleMonthChange} />
                    <TimeSlotPicker label="Time" value={bookingData.dropOffTimeSlot} onValueChange={(v) => handleTimeChange('dropOffTimeSlot', v)} slots={timeSlots.dropOff} useWindows={timeSlots.dropOffUsesWindows} disabled={!bookingData.dropOffDate} loading={isDropOffLoading} />
                    <DatePickerField label={plan.id === 2 ? "Return Date & Time" : "Pickup Date & Time"} date={bookingData.pickupDate} setDate={(d) => handleDateSelect('pickupDate', d)} disabledDates={pickupDisabledDates} onMonthChange={handleMonthChange} />
                    <TimeSlotPicker label="Time" value={bookingData.pickupTimeSlot} onValueChange={(v) => handleTimeChange('pickupTimeSlot', v)} slots={timeSlots.pickup} useWindows={timeSlots.pickupUsesWindows} disabled={!bookingData.pickupDate} loading={isPickupLoading} />
                </div>
                <div className="flex items-center space-x-3 pt-2"><Checkbox id="agreement" checked={agreementAccepted} onCheckedChange={onShowAgreement} className="border-white/50 data-[state=checked]:bg-yellow-400" /><label htmlFor="agreement" className="text-sm text-white">I have read and accept the <span onClick={onShowAgreement} className="text-yellow-400 font-bold underline cursor-pointer">user agreement</span>.</label></div>
                {!agreementAccepted && (<div className="flex items-center text-yellow-300 text-sm"><AlertTriangle className="h-4 w-4 mr-2" />Please accept the agreement to proceed.</div>)}
                <Button type="submit" disabled={!isFormValid || isVerifying} className="w-full py-3 text-lg font-semibold bg-gradient-to-r from-yellow-500 to-orange-600 hover:from-yellow-600 hover:to-orange-700 text-black disabled:opacity-50 disabled:cursor-not-allowed">{isVerifying ? <Loader2 className="h-6 w-6 animate-spin" /> : isFormValid ? <>Proceed to Add-ons <ArrowRight className="ml-2" /></> : 'Complete All Fields to Continue'}</Button>
              </form>
            </div>
          </div>
        </motion.div>
        <Dialog open={!!addressWarning} onOpenChange={() => setAddressWarning(null)}><DialogContent><DialogHeader><DialogTitle className="flex items-center text-red-400 text-2xl"><AlertTriangle className="mr-3 h-8 w-8" />Address Verification Failed</DialogTitle></DialogHeader><DialogDescription className="my-4 text-base">{addressWarning} Please review your address details to ensure they are correct.</DialogDescription><div className="bg-red-900/30 border border-red-500/50 p-4 rounded-md text-sm"><p className="font-bold text-red-300">Disclaimer and Assumption of Risk</p><p className="text-red-200 mt-2">By proceeding with an unverified or potentially incorrect address, you acknowledge and agree that this may result in significant delays or the cancellation of your delivery. You hereby assume all risks and associated costs, including but not to limited to non-refundable fees, that may arise from providing an inaccurate or unserviceable address.</p></div><DialogFooter className="gap-2 sm:justify-between mt-4"><Button onClick={() => setAddressWarning(null)} variant="outline" className="border-yellow-400 text-yellow-400 hover:bg-yellow-400 hover:text-black">Review Address</Button><Button onClick={handleProceedWithRisk} variant="destructive">I Understand & Continue</Button></DialogFooter></DialogContent></Dialog>
        <Dialog open={!!phoneWarning} onOpenChange={() => setPhoneWarning(null)}><DialogContent><DialogHeader><DialogTitle className="flex items-center text-red-400 text-2xl"><AlertTriangle className="mr-3 h-8 w-8" />Invalid Phone Number</DialogTitle></DialogHeader><DialogDescription className="my-4 text-base">{phoneWarning}</DialogDescription><DialogFooter><Button onClick={() => setPhoneWarning(null)} variant="outline" className="border-yellow-400 text-yellow-400 hover:bg-yellow-400 hover:text-black">OK</Button></DialogFooter></DialogContent></Dialog>
        <Dialog open={showDistanceFeeDialog} onOpenChange={setShowDistanceFeeDialog}><DialogContent><DialogHeader><DialogTitle className="flex items-center text-yellow-400 text-2xl"><Truck className="mr-3 h-8 w-8" />Extended Delivery Service</DialogTitle></DialogHeader><div className="my-4 text-base"><p className="text-blue-200">We're happy to extend our service to your location! To help cover the additional travel, a one-time extended delivery fee will be applied to your order.</p><div className="my-4 p-4 bg-white/10 rounded-lg text-center"><p className="text-sm text-blue-200">Distance from our location:</p><p className="text-2xl font-bold text-white">{distanceInfo?.miles.toFixed(1)} miles</p><p className="text-sm text-blue-200 mt-2">Surcharge:</p><p className="text-2xl font-bold text-green-400">${distanceInfo?.fee.toFixed(2)}</p><p className="text-xs text-gray-400">($0.80 per mile over 30 miles)</p></div><p className="text-blue-200">This fee allows us to serve a wider community. Please click below to accept and continue with your booking.</p></div><DialogFooter><Button onClick={handleAcceptDistanceFee} className="bg-yellow-500 text-black hover:bg-yellow-600">Accept & Continue</Button></DialogFooter></DialogContent></Dialog>
        <Dialog open={showEmailConfirmDialog} onOpenChange={setShowEmailConfirmDialog}><DialogContent><DialogHeader><DialogTitle className="flex items-center text-yellow-400 text-2xl"><ShieldCheck className="mr-3 h-8 w-8" />Please Confirm Your Email</DialogTitle></DialogHeader><div className="my-4 text-base"><p className="text-blue-200">Please take a moment to verify that your email address is correct before proceeding:</p><p className="font-bold text-white text-lg my-3 text-center bg-white/10 p-3 rounded-md">{bookingData.email}</p><div className="bg-blue-900/30 border border-blue-500/50 p-4 rounded-md text-sm mt-4"><p className="font-bold text-blue-300 mb-2">Important Information Disclaimer</p><p className="text-blue-200">Your booking confirmation, which contains critical rental details, will be sent to this email address. This includes the precise pickup location for the trailer, access codes for the security lock, and essential instructions regarding proper equipment usage and safety protocols. An incorrect email address will result in you not receiving this vital information. By confirming, you acknowledge the accuracy of this email for receiving all official correspondence related to your rental.</p></div></div><DialogFooter className="gap-2 sm:justify-end"><Button onClick={() => setShowEmailConfirmDialog(false)} variant="outline" className="border-white/50 text-white hover:bg-white/20 hover:text-white">Edit Email</Button><Button onClick={handleEmailConfirmed} className="bg-yellow-500 text-black hover:bg-yellow-600">Email is Correct, Continue</Button></DialogFooter></DialogContent></Dialog>
        </>
      );
    };
    const InputField = ({ icon, ...props }) => (<div className="relative flex items-center"><span className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-blue-300">{icon}</span><input {...props} className="w-full bg-white/10 text-white rounded-lg border border-white/30 focus:ring-2 focus:ring-yellow-400 focus:border-yellow-400 pl-10 pr-4 py-3 placeholder-blue-200" /></div>);
    const DatePickerField = ({ label, date, setDate, disabledDates, onMonthChange }) => (<div className="md:col-span-1"><label className="text-sm font-medium text-white mb-2 block">{label}</label><Popover><PopoverTrigger asChild><Button variant="outline" className="w-full justify-start text-left font-normal bg-white/10 border-white/30 hover:bg-white/20 text-white"><CalendarIcon className="mr-2 h-4 w-4"/>{date ? format(date, 'PPP') : <span>Pick a date</span>}</Button></PopoverTrigger><PopoverContent className="w-auto p-0 bg-gray-800 border-gray-700 text-white"><Calendar mode="single" selected={date} onSelect={setDate} disabled={disabledDates} initialFocus onMonthChange={onMonthChange} /></PopoverContent></Popover></div>);
    const TimeSlotPicker = ({ label, value, onValueChange, slots, useWindows, disabled, loading }) => {
        const formatWindow = (windowStr) => {
            const [start, end] = windowStr.split('-');
            const formattedStart = format(parse(start, 'HH:mm', new Date()), 'h:mm a');
            const formattedEnd = format(parse(end, 'HH:mm', new Date()), 'h:mm a');
            return `${formattedStart} - ${formattedEnd}`;
        };

        return (
            <div className="md:col-span-1">
                <label className="text-sm font-medium text-white mb-2 block invisible">{label}</label>
                <Select onValueChange={onValueChange} value={value} disabled={disabled || loading}>
                    <SelectTrigger className="w-full bg-white/10 border-white/30 text-white">
                        <Clock className="mr-2 h-4 w-4" />
                        <SelectValue placeholder="Select a time" />
                    </SelectTrigger>
                    <SelectContent className="bg-gray-800 border-gray-700 text-white">
                        {loading ? (
                            <SelectItem value="loading" disabled>Loading...</SelectItem>
                        ) : slots && slots.length > 0 ? (
                            slots.map(slot => (
                                <SelectItem key={slot} value={slot}>
                                    {useWindows ? formatWindow(slot) : format(parse(slot, 'HH:mm', new Date()), 'h:mm a')}
                                </SelectItem>
                            ))
                        ) : (
                            <SelectItem value="no-slots" disabled>No available slots</SelectItem>
                        )}
                    </SelectContent>
                </Select>
            </div>
        );
    };