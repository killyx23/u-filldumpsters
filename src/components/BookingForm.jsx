
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import { 
  ArrowLeft, 
  ArrowRight, 
  MapPin, 
  Calendar as CalendarIcon, 
  Loader2, 
  Clock, 
  AlertCircle,
  Truck
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format, startOfDay, isBefore, parse, formatISO, startOfMonth, endOfMonth, isValid, addDays, differenceInDays } from 'date-fns';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';
import { Checkbox } from '@/components/ui/checkbox';
import { GooglePlacesAutocomplete } from '@/components/GooglePlacesAutocomplete.jsx';
import { DeliveryServiceInfo } from '@/components/DeliveryServiceInfo.jsx';
import { AvailabilityService } from '@/services/AvailabilityService';
import { UnavailableServiceModal } from '@/components/UnavailableServiceModal';

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
  const [totalPrice, setTotalPrice] = useState(0);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [currentMileageRate, setCurrentMileageRate] = useState(0.85);

  const isDelivery = plan?.id === 2 && deliveryService;
  
  const currentPlan = useMemo(() => {
      if (loadingPlans) return null;
      if (isDelivery) return allPlans.find(p => p.id === 4) || null;
      return allPlans.find(p => p.id === plan?.id) || null;
  }, [isDelivery, allPlans, plan, loadingPlans]);

  useEffect(() => {
      const fetchPlans = async () => {
          setLoadingPlans(true);
          const { data, error } = await supabase.from('services').select('*');
          if (!error && data) setAllPlans(data);
          setLoadingPlans(false);
      };
      fetchPlans();
  }, []);

  useEffect(() => {
      const fetchMileageRate = async () => {
          if (currentPlan) {
              const { data, error } = await supabase.from('services').select('mileage_rate').eq('id', currentPlan.id).single();
              if (!error && data && data.mileage_rate !== null) {
                  setCurrentMileageRate(Number(data.mileage_rate));
              } else if (currentPlan.mileage_rate !== undefined && currentPlan.mileage_rate !== null) {
                  setCurrentMileageRate(Number(currentPlan.mileage_rate));
              }
          }
      };
      fetchMileageRate();
  }, [currentPlan]);

  useEffect(() => {
    if (isDelivery) {
      setBookingData(prev => ({ ...prev, dropOffTimeSlot: '', pickupTimeSlot: '' }));
    }
  }, [isDelivery, setBookingData]);

  const fetchAvailability = useCallback(async month => {
    if (!plan) return;
    setLoadingAvailability(true);
    const startDate = formatISO(startOfMonth(month), { representation: 'date' });
    const endDate = formatISO(endOfMonth(month), { representation: 'date' });
    const targetServiceId = currentPlan?.id || plan.id;

    try {
      const { data, error } = await supabase.functions.invoke('get-availability', {
        body: { serviceId: plan.id, startDate, endDate, isDelivery }
      });
      
      let mergedAvailability = {};
      if (!error && !data?.error) {
          mergedAvailability = { ...data.availability };
      }

      const dailyOverrides = await AvailabilityService.getAvailabilityForDateRange(targetServiceId, startDate, endDate);
      
      if (dailyOverrides && dailyOverrides.length > 0) {
          dailyOverrides.forEach(override => {
              if (!mergedAvailability[override.date]) {
                  mergedAvailability[override.date] = { available: override.is_available };
              } else {
                  mergedAvailability[override.date].available = override.is_available;
                  
                  if (!override.is_available) {
                      mergedAvailability[override.date].deliverySlots = [];
                      mergedAvailability[override.date].pickupSlots = [];
                      mergedAvailability[override.date].returnSlots = [];
                      mergedAvailability[override.date].hourlySlots = [];
                  }
              }
          });
      }

      setAvailability(prev => ({ ...prev, ...mergedAvailability }));
    } catch (error) {
      console.error("Error fetching combined availability:", error);
      toast({ title: 'Availability Error', description: 'Failed to load date availability.', variant: 'destructive'});
    } finally {
      setLoadingAvailability(false);
    }
  }, [plan, isDelivery, currentPlan]);

  useEffect(() => {
    if (!plan) return;
    const targetServiceId = currentPlan?.id || plan.id;
    const channel = supabase.channel('date_specific_availability_changes')
      .on(
        'postgres_changes', 
        { event: '*', schema: 'public', table: 'date_specific_availability', filter: `service_id=eq.${targetServiceId}` }, 
        () => {
          fetchAvailability(currentMonth);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentPlan, plan, currentMonth, fetchAvailability]);

  useEffect(() => {
    fetchAvailability(currentMonth);
  }, [fetchAvailability, currentMonth]);

  const disabledDates = useMemo(() => {
    const dates = [{ before: startOfDay(addDays(new Date(), 1)) }];
    for (const dateStr in availability) {
      if (!availability[dateStr].available) {
        dates.push(parse(dateStr, 'yyyy-MM-dd', new Date()));
      }
    }
    return dates;
  }, [availability]);

  const timeSlots = useMemo(() => {
    if (!currentPlan || !plan) return { dropOff: [], pickup: [] };
    const dropOffDateStr = bookingData.dropOffDate ? format(bookingData.dropOffDate, 'yyyy-MM-dd') : null;
    const pickupDateStr = bookingData.pickupDate ? format(bookingData.pickupDate, 'yyyy-MM-dd') : null;

    const dropOffAvail = dropOffDateStr ? availability[dropOffDateStr] : null;
    const pickupAvail = pickupDateStr ? availability[pickupDateStr] : null;

    let dropOffSlots = [];
    let pickupSlots = [];

    if (dropOffAvail && dropOffAvail.available) {
      if (plan.id === 1) dropOffSlots = dropOffAvail.deliverySlots || [];
      else if (plan.id === 2 && !isDelivery) dropOffSlots = dropOffAvail.pickupSlots || [];
      else if (plan.id === 2 && isDelivery) dropOffSlots = dropOffAvail.deliverySlots || [];
      else if (plan.id === 3) dropOffSlots = dropOffAvail.deliverySlots || [];
    }

    if (pickupAvail && pickupAvail.available) {
      if (plan.id === 1) pickupSlots = pickupAvail.pickupSlots || [];
      else if (plan.id === 2 && !isDelivery) pickupSlots = pickupAvail.returnSlots || [];
      else if (plan.id === 2 && isDelivery) pickupSlots = pickupAvail.pickupSlots || [];
    }

    return { dropOff: dropOffSlots, pickup: pickupSlots };
  }, [bookingData.dropOffDate, bookingData.pickupDate, availability, currentPlan, plan, isDelivery]);

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
      const state = { ...prev, [field]: newDate, [`${field.replace('Date', '')}TimeSlot`]: '' };
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
        setBookingData(prev => ({ ...prev, dropOffDate: null, dropOffTimeSlot: '' }));
        toast({ title: "Date Unavailable", description: "Your selected start date is no longer available.", variant: "destructive" });
      }
    }
    if (bookingData.pickupDate) {
      const pickupStr = format(bookingData.pickupDate, 'yyyy-MM-dd');
      if (availability[pickupStr] && !availability[pickupStr].available) {
        setBookingData(prev => ({ ...prev, pickupDate: null, pickupTimeSlot: '' }));
        toast({ title: "Date Unavailable", description: "Your selected end date is no longer available.", variant: "destructive" });
      }
    }
  }, [availability, bookingData.dropOffDate, bookingData.pickupDate, setBookingData]);

  useEffect(() => {
    if (!currentPlan) return;
    let price = parseFloat(currentPlan.base_price);
    if (bookingData.dropOffDate && (bookingData.pickupDate || currentPlan.id === 3)) {
      const dropOff = startOfDay(new Date(bookingData.dropOffDate));
      const pickup = currentPlan.id === 3 ? dropOff : startOfDay(new Date(bookingData.pickupDate));
      if (isValid(dropOff) && isValid(pickup) && !isBefore(pickup, dropOff)) {
        const dayDiff = differenceInDays(pickup, dropOff) + 1;
        if (currentPlan.id === 1) {
          price = dayDiff === 7 ? 500 : parseFloat(currentPlan.base_price) + (Math.max(0, dayDiff - 1) * 50);
        } else if (currentPlan.id === 2 || currentPlan.id === 4) {
          price = parseFloat(currentPlan.base_price) * dayDiff;
        }
      }
    }
    setTotalPrice(price);
  }, [bookingData.dropOffDate, bookingData.pickupDate, currentPlan]);

  const isFormValid = useMemo(() => {
    if (!currentPlan) return false;
    let baseValid = bookingData.dropOffDate && bookingData.dropOffTimeSlot;
    let pickupValid = currentPlan.id === 3 ? true : (bookingData.pickupDate && bookingData.pickupTimeSlot);
    
    const cAddress = bookingData.contactAddress;
    const addressValid = cAddress?.street && cAddress?.city && cAddress?.state && cAddress?.zip && cAddress?.isVerified;

    return baseValid && pickupValid && addressValid;
  }, [bookingData, currentPlan]);

  const handleFormSubmit = async e => {
    e.preventDefault();
    if (!isFormValid) {
        toast({ title: "Incomplete Form", description: "Please ensure all required fields are filled and address is verified.", variant: "destructive" });
        return;
    }
    
    onSubmit(bookingData, totalPrice, null, null, { 
      plan: { ...currentPlan, mileage_rate: currentMileageRate },
      deliveryService: isDelivery 
    });
  };

  const getFieldLabels = () => {
    if (!currentPlan || !plan) return { date1: 'Date', date2: 'Date' };
    switch (isDelivery ? 4 : plan.id) {
        case 1: return { date1: 'Delivery Date', date2: 'Pickup Date' };
        case 2: return { date1: 'Pickup Date', date2: 'Return Date' };
        case 3: return { date1: 'Delivery Date', date2: '' };
        case 4: return { date1: 'Drop-off Date', date2: 'Pickup Date' };
        default: return { date1: 'Start Date', date2: 'End Date' };
    }
  };

  if (loadingPlans || !plan) return <div className="flex justify-center items-center h-96"><Loader2 className="h-16 w-16 animate-spin text-yellow-400" /></div>;

  // Safely extract properties for rendering to avoid React errors
  const planName = currentPlan?.name || plan?.name || 'Selected Service';
  const planDesc = currentPlan?.description || plan?.description || '';

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
          <div className="bg-white/5 p-6 rounded-lg h-fit">
            <div className="flex items-center mb-4">
              <h3 className="text-2xl font-bold text-yellow-400">{planName}</h3>
              {plan?.id === 2 && !isDelivery && <AlertCircle className="h-5 w-5 ml-2 text-yellow-500 cursor-help" />}
            </div>
            <p className="text-blue-200 mb-6">{planDesc}</p>
            <div className="border-t border-white/20 pt-4">
              <p className="text-white text-lg font-semibold">Estimated Base Price:</p>
              <div className="flex items-baseline mb-2">
                <p className="text-4xl font-bold text-green-400">${totalPrice.toFixed(2)}</p>
                <span className="text-sm text-blue-200 ml-2">(plus tax)</span>
              </div>
              {(isDelivery || plan?.id === 1) && (
                <p className="text-xs text-yellow-300 italic flex items-center">
                   <Truck className="h-3 w-3 mr-1" /> Delivery fees are calculated in the next step based on distance.
                </p>
              )}
            </div>
          </div>

          <form onSubmit={handleFormSubmit} className="space-y-6">
            <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-4">
              {plan?.id === 2 && (
                  <div className="flex items-center space-x-3 mb-6 bg-white/10 p-4 rounded-lg border border-yellow-500/30">
                    <Checkbox id="deliveryService" checked={deliveryService} onCheckedChange={setDeliveryService} className="border-yellow-400 data-[state=checked]:bg-yellow-400"/>
                    <label htmlFor="deliveryService" className="text-sm font-semibold text-white cursor-pointer flex-1">
                      Need delivery? We've got you covered! Check here for delivery.
                    </label>
                    <DeliveryServiceInfo deliveryFee={30} />
                  </div>
              )}

              <div className="space-y-4 mt-6 bg-black/20 p-5 rounded-lg border border-white/10">
                  <h3 className="text-lg font-semibold text-white flex items-center">
                      <MapPin className="mr-2 h-5 w-5 text-red-400" />
                      Contact Address
                  </h3>
                  <div className="space-y-2">
                      <GooglePlacesAutocomplete 
                          value={bookingData.contactAddress?.street || ''}
                          onChange={(val) => setBookingData(prev => ({...prev, contactAddress: {...prev.contactAddress, street: val, isVerified: false}}))}
                          onAddressSelect={(details) => setBookingData(prev => ({...prev, contactAddress: {...details, isVerified: true}}))}
                          placeholder="Start typing your address..."
                          required
                      />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <InputField disabled icon={<MapPin />} value={bookingData.contactAddress?.city || ''} placeholder="City" />
                      <InputField disabled icon={<MapPin />} value={bookingData.contactAddress?.state || ''} placeholder="State" />
                      <InputField disabled icon={<MapPin />} value={bookingData.contactAddress?.zip || ''} placeholder="ZIP" />
                  </div>
                  {!bookingData.contactAddress?.isVerified && bookingData.contactAddress?.street && (
                      <p className="text-sm text-orange-400 mt-2 flex items-center">
                          <AlertCircle className="h-4 w-4 mr-1 flex-shrink-0" /> Please select an address from the dropdown to verify it.
                      </p>
                  )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6 border-t border-white/10 pt-4">
                  <DatePickerField label={getFieldLabels().date1} date={bookingData.dropOffDate} setDate={d => handleDateSelect('dropOffDate', d)} disabledDates={disabledDates} onMonthChange={setCurrentMonth} />
                  <TimeSlotPicker label="Time" value={bookingData.dropOffTimeSlot} onValueChange={v => setBookingData(p => ({...p, dropOffTimeSlot: v}))} slots={timeSlots.dropOff} disabled={!bookingData.dropOffDate} loading={loadingAvailability} />
                  
                  {currentPlan?.id !== 3 && (
                      <>
                          <DatePickerField label={getFieldLabels().date2} date={bookingData.pickupDate} setDate={d => handleDateSelect('pickupDate', d)} disabledDates={disabledDates} onMonthChange={setCurrentMonth} />
                          <TimeSlotPicker label="Time" value={bookingData.pickupTimeSlot} onValueChange={v => setBookingData(p => ({...p, pickupTimeSlot: v}))} slots={timeSlots.pickup} disabled={!bookingData.pickupDate} loading={loadingAvailability} />
                      </>
                  )}
              </div>
              
              <Button type="submit" disabled={!isFormValid} className="w-full py-4 text-lg font-semibold bg-gradient-to-r from-green-500 to-emerald-600 text-white disabled:opacity-50 mt-6 shadow-lg shadow-green-900/50">
                Choose Add-ons <ArrowRight className="ml-2" />
              </Button>
            </motion.div>
          </form>
        </div>
      </div>
    </motion.div>
    
    <UnavailableServiceModal 
      isOpen={isModalOpen} 
      onClose={() => setIsModalOpen(false)} 
      serviceName={planName}
    />
  </>;
};

const InputField = ({ icon, disabled, ...props }) => (
  <div className="relative flex items-center">
    <span className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-blue-300">{icon}</span>
    <input {...props} disabled={disabled} className={`w-full bg-white/10 text-white rounded-lg border border-white/30 focus:ring-2 focus:ring-yellow-400 focus:border-yellow-400 pl-9 pr-4 py-2 text-sm placeholder-blue-200 transition-colors ${disabled ? 'opacity-60 bg-gray-800 cursor-not-allowed' : ''}`} />
  </div>
);

const DatePickerField = ({ label, date, setDate, disabledDates, onMonthChange }) => (
  <div className="md:col-span-1">
    <label className="text-sm font-medium text-white mb-2 block">{label}</label>
    <Popover>
      <PopoverTrigger asChild><Button variant="outline" className="w-full justify-start text-left font-normal bg-white/10 border-white/30 hover:bg-white/20 text-white"><CalendarIcon className="mr-2 h-4 w-4" />{date ? format(date, 'PPP') : <span>Pick a date</span>}</Button></PopoverTrigger>
      <PopoverContent className="w-auto p-0 bg-gray-800 border-gray-700 text-white"><Calendar mode="single" selected={date} onSelect={setDate} disabled={disabledDates} initialFocus onMonthChange={onMonthChange} /></PopoverContent>
    </Popover>
  </div>
);

const TimeSlotPicker = ({ label, value, onValueChange, slots, disabled, loading }) => (
  <div className="md:col-span-1">
    <label className="text-sm font-medium text-white mb-2 block">{label}</label>
    <Select onValueChange={onValueChange} value={value} disabled={disabled || loading}>
      <SelectTrigger className="w-full bg-white/10 border-white/30 text-white"><Clock className="mr-2 h-4 w-4" /><SelectValue placeholder="Select a time" /></SelectTrigger>
      <SelectContent className="bg-gray-800 border-gray-700 text-white">
        {loading ? <SelectItem value="loading" disabled>Loading...</SelectItem> : slots?.length > 0 ? slots.map(slot => <SelectItem key={slot.value} value={slot.value}>{slot.label || slot.value}</SelectItem>) : <SelectItem value="no-slots" disabled>None</SelectItem>}
      </SelectContent>
    </Select>
  </div>
);
