
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, ArrowRight, MapPin, Calendar as CalendarIcon, Loader2, AlertCircle, Truck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { format, startOfDay, isBefore, parse, formatISO, startOfMonth, endOfMonth, isValid, addDays, differenceInDays } from 'date-fns';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';
import { Checkbox } from '@/components/ui/checkbox';
import { GooglePlacesAutocomplete } from '@/components/GooglePlacesAutocomplete.jsx';
import { DeliveryServiceInfo } from '@/components/DeliveryServiceInfo.jsx';
import { AvailabilityService } from '@/services/AvailabilityService';
import { UnavailableServiceModal } from '@/components/UnavailableServiceModal';
import { useDumpFees } from '@/hooks/useDumpFees';
import { useAvailableTimeSlots } from '@/hooks/useAvailableTimeSlots';
import { TimePickerDropdown } from '@/components/TimePickerDropdown';

export const BookingForm = ({
  plan,
  bookingData,
  setBookingData,
  onSubmit,
  onBack,
  deliveryService,
  setDeliveryService
}) => {
  const [allPlans, setAllPlans] = useState([]);
  const [loadingPlans, setLoadingPlans] = useState(true);
  const [availability, setAvailability] = useState({});
  const [loadingAvailability, setLoadingAvailability] = useState(true);
  const [currentMonth, setCurrentMonth] = useState(startOfMonth(new Date()));
  const [baseRentalPrice, setBaseRentalPrice] = useState(0);
  const [totalPrice, setTotalPrice] = useState(0);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [currentMileageRate, setCurrentMileageRate] = useState(0.85);
  const [currentDeliveryFee, setCurrentDeliveryFee] = useState(0);
  const [isServiceTermsExpanded, setIsServiceTermsExpanded] = useState(false);
  const isDelivery = plan?.id === 2 && deliveryService;
  const { getFeeForService } = useDumpFees();

  const currentPlan = useMemo(() => {
    if (loadingPlans) return null;
    if (isDelivery) return allPlans.find(p => p.id === 4) || null;
    return allPlans.find(p => p.id === plan?.id) || null;
  }, [isDelivery, allPlans, plan, loadingPlans]);

  const dropOffTimeType = currentPlan?.id === 1 ? 'delivery' : (currentPlan?.id === 2 && !isDelivery ? 'pickup' : (currentPlan?.id === 2 && isDelivery ? 'delivery' : (currentPlan?.id === 3 ? 'delivery' : 'delivery')));
  const pickupTimeType = currentPlan?.id === 1 ? 'pickup' : (currentPlan?.id === 2 && !isDelivery ? 'return' : (currentPlan?.id === 2 && isDelivery ? 'pickup' : 'pickup'));

  const { timeSlots: dropOffSlots, isLoading: dropOffLoading } = useAvailableTimeSlots(currentPlan?.id || plan?.id, bookingData.dropOffDate, dropOffTimeType);
  const { timeSlots: pickupSlots, isLoading: pickupLoading } = useAvailableTimeSlots(currentPlan?.id || plan?.id, bookingData.pickupDate, pickupTimeType);
  
  useEffect(() => {
    const fetchPlans = async () => {
      setLoadingPlans(true);
      const {
        data,
        error
      } = await supabase.from('services').select('*');
      if (!error && data) setAllPlans(data);
      setLoadingPlans(false);
    };
    fetchPlans();
  }, []);
  
  useEffect(() => {
    if (currentPlan) {
        if (currentPlan.mileage_rate !== undefined && currentPlan.mileage_rate !== null) {
          setCurrentMileageRate(Number(currentPlan.mileage_rate));
        }
        if (currentPlan.delivery_fee !== undefined && currentPlan.delivery_fee !== null) {
          setCurrentDeliveryFee(Number(currentPlan.delivery_fee));
        } else {
          setCurrentDeliveryFee(0);
        }
    }
  }, [currentPlan]);
  
  useEffect(() => {
    if (isDelivery) {
      setBookingData(prev => ({
        ...prev,
        dropOffTimeSlot: '',
        pickupTimeSlot: ''
      }));
    }
  }, [isDelivery, setBookingData]);
  
  const fetchAvailability = useCallback(async month => {
    if (!plan) return;
    setLoadingAvailability(true);
    const startDate = formatISO(startOfMonth(month), {
      representation: 'date'
    });
    const endDate = formatISO(endOfMonth(month), {
      representation: 'date'
    });
    const targetServiceId = currentPlan?.id || plan.id;
    try {
      const {
        data,
        error
      } = await supabase.functions.invoke('get-availability', {
        body: {
          serviceId: plan.id,
          startDate,
          endDate,
          isDelivery
        }
      });
      let mergedAvailability = {};
      if (!error && !data?.error) {
        mergedAvailability = {
          ...data.availability
        };
      }
      const dailyOverrides = await AvailabilityService.getAvailabilityForDateRange(targetServiceId, startDate, endDate);
      if (dailyOverrides && dailyOverrides.length > 0) {
        dailyOverrides.forEach(override => {
          if (!mergedAvailability[override.date]) {
            mergedAvailability[override.date] = {
              available: override.is_available
            };
          } else {
            mergedAvailability[override.date].available = override.is_available;
          }
        });
      }
      setAvailability(prev => ({
        ...prev,
        ...mergedAvailability
      }));
    } catch (error) {
      console.error("Error fetching combined availability:", error);
      toast({
        title: 'Availability Error',
        description: 'Failed to load date availability.',
        variant: 'destructive'
      });
    } finally {
      setLoadingAvailability(false);
    }
  }, [plan, isDelivery, currentPlan]);
  
  useEffect(() => {
    if (!plan) return;
    const targetServiceId = currentPlan?.id || plan.id;
    const channel = supabase.channel('date_specific_availability_changes').on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'date_specific_availability',
      filter: `service_id=eq.${targetServiceId}`
    }, () => {
      fetchAvailability(currentMonth);
    }).subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentPlan, plan, currentMonth, fetchAvailability]);
  
  useEffect(() => {
    fetchAvailability(currentMonth);
  }, [fetchAvailability, currentMonth]);
  
  const disabledDates = useMemo(() => {
    const dates = [{
      before: startOfDay(addDays(new Date(), 1))
    }];
    for (const dateStr in availability) {
      if (!availability[dateStr].available) {
        dates.push(parse(dateStr, 'yyyy-MM-dd', new Date()));
      }
    }
    return dates;
  }, [availability]);
  
  const handleDateSelect = async (field, date) => {
    const newDate = date ? startOfDay(date) : null;
    if (newDate) {
      const dateStr = format(newDate, 'yyyy-MM-dd');
      const isAvail = availability[dateStr]?.available;
      if (isAvail === false) {
        setIsModalOpen(true);
        return;
      }
    }
    setBookingData(prev => {
      const state = {
        ...prev,
        [field]: newDate,
        [`${field.replace('Date', '')}TimeSlot`]: ''
      };
      if (field === 'dropOffDate' && newDate && currentPlan?.id !== 3) {
        if (!prev.pickupDate || isBefore(startOfDay(prev.pickupDate), newDate)) {
          state.pickupDate = newDate;
          state.pickupTimeSlot = '';
        }
      }
      return state;
    });
  };
  
  useEffect(() => {
    if (bookingData.dropOffDate) {
      const dropOffStr = format(bookingData.dropOffDate, 'yyyy-MM-dd');
      if (availability[dropOffStr] && !availability[dropOffStr].available) {
        setBookingData(prev => ({
          ...prev,
          dropOffDate: null,
          dropOffTimeSlot: ''
        }));
        toast({
          title: "Date Unavailable",
          description: "Your selected start date is no longer available.",
          variant: "destructive"
        });
      }
    }
    if (bookingData.pickupDate) {
      const pickupStr = format(bookingData.pickupDate, 'yyyy-MM-dd');
      if (availability[pickupStr] && !availability[pickupStr].available) {
        setBookingData(prev => ({
          ...prev,
          pickupDate: null,
          pickupTimeSlot: ''
        }));
        toast({
          title: "Date Unavailable",
          description: "Your selected end date is no longer available.",
          variant: "destructive"
        });
      }
    }
  }, [availability, bookingData.dropOffDate, bookingData.pickupDate, setBookingData]);
  
  useEffect(() => {
    if (!currentPlan) return;
    let basePriceCalculation = parseFloat(currentPlan.base_price) || 0;
    
    if (bookingData.dropOffDate && (bookingData.pickupDate || currentPlan.id === 3)) {
      const dropOff = startOfDay(new Date(bookingData.dropOffDate));
      const pickup = currentPlan.id === 3 ? dropOff : startOfDay(new Date(bookingData.pickupDate));
      if (isValid(dropOff) && isValid(pickup) && !isBefore(pickup, dropOff)) {
        const dayDiff = differenceInDays(pickup, dropOff) + 1;
        if (currentPlan.id === 1) {
          basePriceCalculation = dayDiff === 7 ? 500 : parseFloat(currentPlan.base_price) + Math.max(0, dayDiff - 1) * 50;
        } else if (currentPlan.id === 2 || currentPlan.id === 4) {
          basePriceCalculation = parseFloat(currentPlan.base_price) * dayDiff;
        }
      }
    }
    
    setBaseRentalPrice(basePriceCalculation);
    setTotalPrice(basePriceCalculation + currentDeliveryFee);
  }, [bookingData.dropOffDate, bookingData.pickupDate, currentPlan, currentDeliveryFee]);
  
  const isFormValid = useMemo(() => {
    if (!currentPlan) return false;
    let baseValid = bookingData.dropOffDate && bookingData.dropOffTimeSlot;
    let pickupValid = currentPlan.id === 3 ? true : bookingData.pickupDate && bookingData.pickupTimeSlot;
    const cAddress = bookingData.contactAddress;
    const addressValid = cAddress?.street && cAddress?.city && cAddress?.state && cAddress?.zip;
    return baseValid && pickupValid && addressValid;
  }, [bookingData, currentPlan]);
  
  const handleFormSubmit = async e => {
    e.preventDefault();
    if (!isFormValid) {
      toast({
        title: "Incomplete Form",
        description: "Please ensure all required fields are filled to proceed.",
        variant: "destructive"
      });
      return;
    }
    
    const addonsPayload = {
      plan: {
        ...currentPlan,
        mileage_rate: currentMileageRate,
        delivery_fee: currentDeliveryFee,
        price: baseRentalPrice
      },
      deliveryService: isDelivery,
      deliveryFee: currentDeliveryFee
    };
    
    if (!bookingData.contactAddress?.isVerified) {
        addonsPayload.pending_address_verification = true;
        addonsPayload.unverified_address = `${bookingData.contactAddress.street}, ${bookingData.contactAddress.city}, ${bookingData.contactAddress.state} ${bookingData.contactAddress.zip}`;
        addonsPayload.pending_verification_reason = "Address entered manually";
        bookingData.contactAddress.unverifiedAccepted = true;
    }

    onSubmit(bookingData, baseRentalPrice, null, null, addonsPayload);
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
  
  const getFieldLabels = () => {
    if (!currentPlan || !plan) return {
      date1: 'Date',
      date2: 'Date'
    };
    switch (isDelivery ? 4 : plan.id) {
      case 1:
        return {
          date1: 'Delivery Date',
          date2: 'Pickup Date'
        };
      case 2:
        return {
          date1: 'Pickup Date',
          date2: 'Return Date'
        };
      case 3:
        return {
          date1: 'Delivery Date',
          date2: ''
        };
      case 4:
        return {
          date1: 'Drop-off Date',
          date2: 'Pickup Date'
        };
      default:
        return {
          date1: 'Start Date',
          date2: 'End Date'
        };
    }
  };

  const toggleServiceTerms = () => {
    setIsServiceTermsExpanded(!isServiceTermsExpanded);
  };
  
  if (loadingPlans || !plan) return <div className="flex justify-center items-center h-96"><Loader2 className="h-16 w-16 animate-spin text-yellow-400" /></div>;

  const planName = currentPlan?.name || plan?.name || 'Selected Service';
  
  const renderDescription = () => {
    const dumpFeeData = getFeeForService(currentPlan?.id);
    const dynamicFee = dumpFeeData?.fee_per_ton ? parseFloat(dumpFeeData.fee_per_ton).toFixed(2) : '45.00';
    const dynamicMaxTons = dumpFeeData?.max_tons ? parseFloat(dumpFeeData.max_tons) : null;

    if (currentPlan?.id === 4) {
      return (
        <div className="text-blue-200 mb-6 space-y-4 text-sm leading-relaxed">
          <p>
            Experience the ultimate convenience with our Dump Trailer Delivery & Removal Service.
          </p>
          <div className="bg-black/20 p-3 rounded border border-blue-500/20">
            <p className="font-bold text-white mb-1">Fee Structure:</p>
            <ul className="list-disc list-inside space-y-1">
              <li>Rental: Base rate per day</li>
              {currentDeliveryFee > 0 && <li>Base Delivery Fee: <span className="text-green-400">${currentDeliveryFee.toFixed(2)}</span></li>}
              <li>Mileage Charge: Distance-based calculation</li>
              <li>Dump Fees: <span className="text-green-400">${dynamicFee} per ton</span></li>
            </ul>
          </div>
        </div>
      );
    }

    if (currentPlan?.id === 1) {
      return (
         <div className="text-blue-200 mb-6 space-y-3 text-sm leading-relaxed">
          <p>
            Our <strong>16 Yard Dumpster Rental</strong> is perfect for mid-to-large cleanouts.
          </p>
          <div className="bg-black/20 p-3 rounded border border-blue-500/20 mt-4">
            <p className="font-bold text-white mb-1">Pricing Details:</p>
            <ul className="list-disc list-inside space-y-1">
              <li>Rental: Base rate covers up to 7 days</li>
              {currentDeliveryFee > 0 && <li>Base Delivery Fee: <span className="text-green-400">${currentDeliveryFee.toFixed(2)}</span></li>}
              <li>Dump Fees: <span className="text-green-400">${dynamicFee} per ton</span></li>
            </ul>
          </div>
        </div>
      );
    }

    if (currentPlan?.id === 2) {
      return (
        <div className="text-blue-200 mb-6 space-y-3 text-sm leading-relaxed">
          <p>
            Our <strong>Dump Loader Trailer Rental</strong> is the heavy-duty solution.
          </p>
        </div>
      );
    }
    
    return <p className="text-blue-200 mb-6">{currentPlan?.description || plan?.description || ''}</p>;
  };
  
  return <>
    <motion.div initial={{ opacity: 0, y: 50 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -50 }} className="container mx-auto pt-8 pb-16 px-4">
      <div className="max-w-4xl mx-auto bg-white/10 backdrop-blur-lg rounded-2xl p-8 shadow-2xl border border-white/20">
        
        <div className="flex items-center mb-8 border-b border-white/10 pb-4">
            <Button onClick={onBack} variant="ghost" size="icon" className="mr-4 text-white hover:bg-white/20">
              <ArrowLeft />
            </Button>
            <h2 className="text-3xl font-bold text-white">
              Booking Details
            </h2>
        </div>
        
        <div className="grid md:grid-cols-2 gap-8">
          <div className="bg-white/5 p-6 rounded-lg h-fit border border-white/5">
            <div className="flex items-center mb-4">
              <h3 className="text-2xl font-bold text-yellow-400">{planName}</h3>
            </div>
            {renderDescription()}
            <div className="border-t border-white/20 pt-4">
              <p className="text-white text-lg font-semibold">Estimated Price (Rental + Base Delivery Fee):</p>
              <div className="flex items-baseline mb-2">
                <p className="text-4xl font-bold text-green-400">${totalPrice.toFixed(2)}</p>
              </div>
            </div>
          </div>

          <form onSubmit={handleFormSubmit} className="space-y-6">
            <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-4">
              {plan?.id === 2 && <div className="flex items-center space-x-3 mb-6 bg-white/10 p-4 rounded-lg border border-yellow-500/30">
                    <Checkbox id="deliveryService" checked={deliveryService} onCheckedChange={setDeliveryService} className="border-yellow-400 data-[state=checked]:bg-yellow-400" />
                    <label htmlFor="deliveryService" className="text-sm font-semibold text-white cursor-pointer flex-1">
                      Don't have a truck. Need delivery? We've got you covered! Check here for delivery.
                    </label>
                    <DeliveryServiceInfo deliveryFee={currentDeliveryFee > 0 ? currentDeliveryFee : 30} />
                  </div>}

              <div className="space-y-4 mt-6 bg-black/20 p-5 rounded-lg border border-white/10">
                  <h3 className="text-lg font-semibold text-white flex items-center">
                      <MapPin className="mr-2 h-5 w-5 text-red-400" />
                      Contact Address
                  </h3>
                  <div className="space-y-2">
                      <GooglePlacesAutocomplete 
                        value={bookingData.contactAddress?.street || ''} 
                        onChange={val => setBookingData(prev => ({
                            ...prev,
                            contactAddress: { ...prev.contactAddress, street: val, isVerified: false, unverifiedAccepted: true }
                        }))} 
                        onAddressSelect={details => setBookingData(prev => ({
                            ...prev,
                            contactAddress: { ...prev.contactAddress, isVerified: true, unverifiedAccepted: false, ...details }
                        }))} 
                        placeholder="Start typing your address..." 
                        required 
                      />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <InputField icon={<MapPin />} value={bookingData.contactAddress?.city || ''} onChange={(e) => handleManualAddressChange('city', e.target.value)} placeholder="City" />
                      <InputField icon={<MapPin />} value={bookingData.contactAddress?.state || ''} onChange={(e) => handleManualAddressChange('state', e.target.value)} placeholder="State" />
                      <InputField icon={<MapPin />} value={bookingData.contactAddress?.zip || ''} onChange={(e) => handleManualAddressChange('zip', e.target.value)} placeholder="ZIP" />
                  </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6 border-t border-white/10 pt-4">
                  <DatePickerField label={getFieldLabels().date1} date={bookingData.dropOffDate} setDate={d => handleDateSelect('dropOffDate', d)} disabledDates={disabledDates} onMonthChange={setCurrentMonth} />
                  <div className="md:col-span-1">
                    <label className="text-sm font-medium text-white mb-2 block">Time</label>
                    <TimePickerDropdown 
                      selectedTime={bookingData.dropOffTimeSlot} 
                      onTimeChange={v => setBookingData(p => ({ ...p, dropOffTimeSlot: v }))} 
                      timeSlots={dropOffSlots} 
                      disabled={!bookingData.dropOffDate} 
                      isLoading={dropOffLoading || loadingAvailability} 
                    />
                  </div>
                  
                  {currentPlan?.id !== 3 && <>
                          <DatePickerField label={getFieldLabels().date2} date={bookingData.pickupDate} setDate={d => handleDateSelect('pickupDate', d)} disabledDates={disabledDates} onMonthChange={setCurrentMonth} />
                          <div className="md:col-span-1">
                            <label className="text-sm font-medium text-white mb-2 block">Time</label>
                            <TimePickerDropdown 
                              selectedTime={bookingData.pickupTimeSlot} 
                              onTimeChange={v => setBookingData(p => ({ ...p, pickupTimeSlot: v }))} 
                              timeSlots={pickupSlots} 
                              disabled={!bookingData.pickupDate} 
                              isLoading={pickupLoading || loadingAvailability} 
                            />
                          </div>
                      </>}
              </div>
              
              <Button type="submit" disabled={!isFormValid} className="w-full py-4 text-lg font-semibold bg-gradient-to-r from-green-500 to-emerald-600 text-white disabled:opacity-50 mt-6 shadow-lg shadow-green-900/50 hover:from-green-400 hover:to-emerald-500 transition-all">
                Choose Add-ons <ArrowRight className="ml-2" />
              </Button>
            </motion.div>
          </form>
        </div>
      </div>
    </motion.div>
    
    <UnavailableServiceModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} serviceName={planName} />
  </>;
};

const InputField = ({ icon, disabled, ...props }) => <div className="relative flex items-center">
    <span className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-blue-300">{icon}</span>
    <input {...props} disabled={disabled} className={`w-full bg-white/10 text-white rounded-lg border border-white/30 focus:ring-2 focus:ring-yellow-400 focus:border-yellow-400 pl-9 pr-4 py-2 text-sm placeholder-blue-200 transition-colors ${disabled ? 'opacity-60 bg-gray-800 cursor-not-allowed' : ''}`} />
  </div>;

const DatePickerField = ({ label, date, setDate, disabledDates, onMonthChange }) => <div className="md:col-span-1">
    <label className="text-sm font-medium text-white mb-2 block">{label}</label>
    <Popover>
      <PopoverTrigger asChild><Button variant="outline" className="w-full justify-start text-left font-normal bg-white/10 border-white/30 hover:bg-white/20 text-white"><CalendarIcon className="mr-2 h-4 w-4" />{date ? format(date, 'PPP') : <span>Pick a date</span>}</Button></PopoverTrigger>
      <PopoverContent className="w-auto p-0 bg-gray-800 border-gray-700 text-white"><Calendar mode="single" selected={date} onSelect={setDate} disabled={disabledDates} initialFocus onMonthChange={onMonthChange} /></PopoverContent>
    </Popover>
  </div>;
