import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, ArrowRight, MapPin, Calendar as CalendarIcon, Loader2, Clock, AlertCircle, Truck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { format, startOfDay, isBefore, parse, formatISO, startOfMonth, endOfMonth, isValid, addDays, differenceInDays } from 'date-fns';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';
import { Checkbox } from '@/components/ui/checkbox';
import { GooglePlacesAutocomplete } from '@/components/GooglePlacesAutocomplete.jsx';
import { DeliveryServiceInfo } from '@/components/DeliveryServiceInfo.jsx';
import { AvailabilityService } from '@/services/AvailabilityService';
import { UnavailableServiceModal } from '@/components/UnavailableServiceModal';
import { useDumpFees } from '@/hooks/useDumpFees';
import { isValidEquipmentId, logEquipmentIdQuery } from '@/utils/equipmentIdValidator';
import { formatCurrency } from '@/api/EcommerceApi';

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
  const [fetchingExactTimes, setFetchingExactTimes] = useState(false);
  const [fetchedPickupWindows, setFetchedPickupWindows] = useState([]);
  const [currentMonth, setCurrentMonth] = useState(startOfMonth(new Date()));
  const [baseRentalPrice, setBaseRentalPrice] = useState(0);
  const [totalPrice, setTotalPrice] = useState(0);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [currentMileageRate, setCurrentMileageRate] = useState(0.85);
  const [currentDeliveryFee, setCurrentDeliveryFee] = useState(0);
  const [isServiceTermsExpanded, setIsServiceTermsExpanded] = useState(false);
  const [trailerRentalHours, setTrailerRentalHours] = useState({ pickupStart: '', returnBy: '' });
  
  // Disposal fees state
  const [mattressFee, setMattressFee] = useState(null);
  const [tvFee, setTvFee] = useState(null);
  const [applianceFee, setApplianceFee] = useState(null);
  const [feesLoading, setFeesLoading] = useState(true);
  const [feesError, setFeesError] = useState(null);
  
  const isDelivery = plan?.id === 2 && deliveryService;
  const { getFeeForService } = useDumpFees();

  console.group('[BookingForm] Component Initialization');
  console.log('Plan ID:', plan?.id);
  console.log('Delivery Service:', deliveryService);
  console.log('Is Delivery:', isDelivery);
  console.groupEnd();

  const currentPlan = useMemo(() => {
    if (loadingPlans) return null;
    if (isDelivery) return allPlans.find(p => p.id === 4) || null;
    return allPlans.find(p => p.id === plan?.id) || null;
  }, [isDelivery, allPlans, plan, loadingPlans]);

  // Fetch disposal fees from equipment_pricing table
  useEffect(() => {
    const fetchDisposalFees = async () => {
      console.log('[BookingForm] Fetching disposal fees from equipment_pricing table');
      setFeesLoading(true);
      setFeesError(null);
      
      try {
        const { data, error } = await supabase
          .from('equipment_pricing')
          .select('equipment_id, base_price')
          .in('equipment_id', [4, 5, 6]);

        if (error) {
          console.error('[BookingForm] Error fetching disposal fees:', error);
          setFeesError('Failed to load disposal fees');
          // Set fallback values
          setMattressFee(25);
          setTvFee(15);
          setApplianceFee(35);
        } else if (data && data.length > 0) {
          console.log('[BookingForm] Disposal fees fetched successfully:', data);
          
          data.forEach(item => {
            const price = Number(item.base_price);
            if (item.equipment_id === 4) {
              setMattressFee(price);
            } else if (item.equipment_id === 5) {
              setTvFee(price);
            } else if (item.equipment_id === 6) {
              setApplianceFee(price);
            }
          });
          
          console.log('[BookingForm] ✓ Disposal fees loaded:', {
            mattress: data.find(d => d.equipment_id === 4)?.base_price,
            tv: data.find(d => d.equipment_id === 5)?.base_price,
            appliance: data.find(d => d.equipment_id === 6)?.base_price
          });
        } else {
          console.warn('[BookingForm] No disposal fees found in database');
          setFeesError('No disposal fees found');
          // Set fallback values
          setMattressFee(25);
          setTvFee(15);
          setApplianceFee(35);
        }
      } catch (err) {
        console.error('[BookingForm] Exception fetching disposal fees:', err);
        setFeesError('Error loading disposal fees');
        // Set fallback values
        setMattressFee(25);
        setTvFee(15);
        setApplianceFee(35);
      } finally {
        setFeesLoading(false);
      }
    };

    fetchDisposalFees();
  }, []);

  // Helper function to format time to "h:mm a" format
  const formatTimeToAmPm = (timeStr) => {
    if (!timeStr) return '';
    try {
      const parsed = parse(timeStr, 'HH:mm:ss', new Date());
      return format(parsed, 'h:mm a');
    } catch (error) {
      console.warn('[BookingForm] Time formatting error:', error);
      return timeStr;
    }
  };
  
  useEffect(() => {
    const fetchPlans = async () => {
      console.log('[BookingForm] Fetching service plans...');
      setLoadingPlans(true);
      const { data, error } = await supabase.from('services').select('*');
      if (!error && data) {
        console.log('[BookingForm] ✓ Loaded', data.length, 'service plans');
        setAllPlans(data);
      } else {
        console.error('[BookingForm] ❌ Failed to fetch plans:', error);
      }
      setLoadingPlans(false);
    };
    fetchPlans();
  }, []);
  
  useEffect(() => {
    if (currentPlan) {
        console.log('[BookingForm] Setting pricing for plan:', currentPlan.id, currentPlan.name);
        if (currentPlan.mileage_rate !== undefined && currentPlan.mileage_rate !== null) {
          setCurrentMileageRate(Number(currentPlan.mileage_rate));
          console.log('[BookingForm] Mileage rate:', currentPlan.mileage_rate);
        }
        if (currentPlan.delivery_fee !== undefined && currentPlan.delivery_fee !== null) {
          setCurrentDeliveryFee(Number(currentPlan.delivery_fee));
          console.log('[BookingForm] Delivery fee:', currentPlan.delivery_fee);
        } else {
          setCurrentDeliveryFee(0);
        }
    }
  }, [currentPlan]);
  
  useEffect(() => {
    if (isDelivery) {
      console.log('[BookingForm] Delivery service enabled - clearing time slots');
      setBookingData(prev => ({
        ...prev,
        dropOffTimeSlot: '',
        pickupTimeSlot: ''
      }));
    }
  }, [isDelivery, setBookingData]);

  // Fetch dynamic rental hours for Dump Loader Trailer Rental (Service ID: 2)
  useEffect(() => {
    if (currentPlan?.id !== 2 || isDelivery) return;

    const fetchTrailerRentalHours = async () => {
      console.log('[BookingForm] Fetching trailer rental hours for service 2');
      let pickupStart = '';
      let returnBy = '';
      const defaultHours = { pickupStart: '8:00 AM', returnBy: '6:00 PM' };

      try {
        if (bookingData.dropOffDate) {
          const dateStr = format(bookingData.dropOffDate, 'yyyy-MM-dd');
          const { data: dsa, error: dsaError } = await supabase
            .from('date_specific_availability')
            .select('pickup_start_time, return_by_time')
            .eq('service_id', 2)
            .eq('date', dateStr)
            .maybeSingle();

          if (dsaError) {
            console.warn('[BookingForm] Error fetching date-specific availability:', dsaError);
          }

          if (dsa?.pickup_start_time) pickupStart = dsa.pickup_start_time;
          if (dsa?.return_by_time) returnBy = dsa.return_by_time;
        }

        if (!pickupStart || !returnBy) {
          const dow = bookingData.dropOffDate ? bookingData.dropOffDate.getDay() : new Date().getDay();
          const { data: sa, error: saError } = await supabase
            .from('service_availability')
            .select('pickup_start_time, return_by_time')
            .eq('service_id', 2)
            .eq('day_of_week', dow)
            .maybeSingle();

          if (saError) {
            console.warn('[BookingForm] Error fetching service availability:', saError);
          }

          if (sa) {
            if (!pickupStart && sa.pickup_start_time) pickupStart = sa.pickup_start_time;
            if (!returnBy && sa.return_by_time) returnBy = sa.return_by_time;
          }
        }

        setTrailerRentalHours({
          pickupStart: pickupStart ? formatTimeToAmPm(pickupStart) : defaultHours.pickupStart,
          returnBy: returnBy ? formatTimeToAmPm(returnBy) : defaultHours.returnBy
        });

        console.log('[BookingForm] ✓ Trailer rental hours:', { pickupStart, returnBy });

      } catch (error) {
        console.warn('[BookingForm] Unexpected error fetching trailer rental hours:', error);
        setTrailerRentalHours(defaultHours);
      }
    };

    fetchTrailerRentalHours();
  }, [bookingData.dropOffDate, currentPlan, isDelivery]);
  
  const fetchAvailability = useCallback(async month => {
    if (!plan) return;
    console.log('[BookingForm] Fetching availability for month:', format(month, 'yyyy-MM'));
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
      
      setAvailability(prev => ({ ...prev, ...mergedAvailability }));
      console.log('[BookingForm] ✓ Availability loaded for', Object.keys(mergedAvailability).length, 'dates');
      
    } catch (error) {
      console.error('[BookingForm] ❌ Error fetching availability:', error);
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
      console.log('[BookingForm] Availability change detected - refreshing');
      fetchAvailability(currentMonth);
    }).subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentPlan, plan, currentMonth, fetchAvailability]);
  
  useEffect(() => {
    fetchAvailability(currentMonth);
  }, [fetchAvailability, currentMonth]);

  // Fetch Exact Times for Dump Loader Trailer Rental (ID: 2)
  useEffect(() => {
    if (!currentPlan || currentPlan.id !== 2 || isDelivery) return;

    const fetchExactTimes = async () => {
      console.log('[BookingForm] Fetching exact times for trailer rental');
      setFetchingExactTimes(true);
      let pStartTime = '';
      let rByTime = '';
      const defaultStart = '8:00 AM';
      const defaultReturn = '6:00 PM';

      try {
        if (bookingData.dropOffDate) {
          const dateStr = format(bookingData.dropOffDate, 'yyyy-MM-dd');
          const dow = bookingData.dropOffDate.getDay();
          
          const { data: dsa, error: dsaError } = await supabase
            .from('date_specific_availability')
            .select('pickup_start_time')
            .eq('service_id', 2)
            .eq('date', dateStr)
            .maybeSingle();
          
          if (dsaError) {
            console.warn('[BookingForm] Error fetching date-specific pickup time:', dsaError);
          }
          
          if (dsa?.pickup_start_time) {
            pStartTime = dsa.pickup_start_time;
          } else {
            const { data: sa, error: saError } = await supabase
              .from('service_availability')
              .select('pickup_start_time')
              .eq('service_id', 2)
              .eq('day_of_week', dow)
              .maybeSingle();
            
            if (saError) {
              console.warn('[BookingForm] Error fetching service availability pickup time:', saError);
            }
            
            if (sa?.pickup_start_time) {
              pStartTime = sa.pickup_start_time;
            }
          }
        }

        if (bookingData.pickupDate) {
          const dateStr = format(bookingData.pickupDate, 'yyyy-MM-dd');
          const dow = bookingData.pickupDate.getDay();
          
          const { data: dsa, error: dsaError } = await supabase
            .from('date_specific_availability')
            .select('return_by_time')
            .eq('service_id', 2)
            .eq('date', dateStr)
            .maybeSingle();
          
          if (dsaError) {
            console.warn('[BookingForm] Error fetching date-specific return time:', dsaError);
          }
          
          if (dsa?.return_by_time) {
            rByTime = dsa.return_by_time;
          } else {
            const { data: sa, error: saError } = await supabase
              .from('service_availability')
              .select('return_by_time')
              .eq('service_id', 2)
              .eq('day_of_week', dow)
              .maybeSingle();
            
            if (saError) {
              console.warn('[BookingForm] Error fetching service availability return time:', saError);
            }
            
            if (sa?.return_by_time) {
              rByTime = sa.return_by_time;
            }
          }
        }

        setBookingData(prev => ({
          ...prev,
          dropOffTimeSlot: pStartTime ? formatTimeToAmPm(pStartTime) : defaultStart,
          pickupTimeSlot: rByTime ? formatTimeToAmPm(rByTime) : defaultReturn
        }));

        console.log('[BookingForm] ✓ Exact times set:', {
          dropOff: pStartTime || defaultStart,
          pickup: rByTime || defaultReturn
        });

      } catch (error) {
        console.warn('[BookingForm] Unexpected error fetching exact times:', error);
        setBookingData(prev => ({
          ...prev,
          dropOffTimeSlot: defaultStart,
          pickupTimeSlot: defaultReturn
        }));
      } finally {
        setFetchingExactTimes(false);
      }
    };

    fetchExactTimes();
  }, [bookingData.dropOffDate, bookingData.pickupDate, currentPlan, isDelivery, setBookingData]);
  
  // Fetch Exact Times for Delivery Pickup Window (Service 1 & 4)
  useEffect(() => {
    if (!currentPlan || (currentPlan.id !== 1 && currentPlan.id !== 4)) return;
    
    const targetDate = bookingData.dropOffDate; 
    
    if (!targetDate) {
        setFetchedPickupWindows([]);
        return;
    }

    const fetchPickupWindow = async () => {
        console.log('[BookingForm] Fetching delivery pickup window for service', currentPlan.id);
        const dateStr = format(targetDate, 'yyyy-MM-dd');
        const dow = targetDate.getDay();

        try {
          const { data: dsa, error: dsaError } = await supabase
            .from('date_specific_availability')
            .select('delivery_pickup_start_time, delivery_pickup_end_time')
            .eq('service_id', currentPlan.id)
            .eq('date', dateStr)
            .maybeSingle();

          if (dsaError) {
            console.warn('[BookingForm] Error fetching date-specific delivery pickup window:', dsaError);
          }

          let startTime = dsa?.delivery_pickup_start_time;
          let endTime = dsa?.delivery_pickup_end_time;

          if (!startTime || !endTime) {
            const { data: sa, error: saError } = await supabase
              .from('service_availability')
              .select('delivery_pickup_window_start_time, delivery_pickup_window_end_time')
              .eq('service_id', currentPlan.id)
              .eq('day_of_week', dow)
              .maybeSingle();

            if (saError) {
              console.warn('[BookingForm] Error fetching service availability delivery pickup window:', saError);
            }

            startTime = startTime || sa?.delivery_pickup_window_start_time;
            endTime = endTime || sa?.delivery_pickup_window_end_time;
          }

          if (startTime && endTime) {
            const formattedLabel = `${formatTimeToAmPm(startTime)} - ${formatTimeToAmPm(endTime)}`;
            const rawValue = `${startTime}|${endTime}`;
            setFetchedPickupWindows([{ label: formattedLabel, value: rawValue }]);
            console.log('[BookingForm] ✓ Delivery pickup window:', formattedLabel);
          } else {
            console.warn('[BookingForm] No delivery pickup window found for service_id=' + currentPlan.id);
            setFetchedPickupWindows([]);
          }
        } catch (error) {
          console.warn('[BookingForm] Unexpected error fetching delivery pickup window:', error);
          setFetchedPickupWindows([]);
        }
    };

    fetchPickupWindow();
  }, [bookingData.dropOffDate, currentPlan]);
  
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
    
    if (currentPlan && (currentPlan.id === 1 || currentPlan.id === 4)) {
        pickupSlots = fetchedPickupWindows.length > 0 ? fetchedPickupWindows : [];
    }
    
    console.log('[BookingForm] Time slots:', {
      dropOff: dropOffSlots.length,
      pickup: pickupSlots.length
    });
    
    return { dropOff: dropOffSlots, pickup: pickupSlots };
  }, [bookingData.dropOffDate, bookingData.pickupDate, availability, currentPlan, plan, isDelivery, fetchedPickupWindows]);
  
  // TASK 1: 24-hour rental logic for delivery services (plan.id === 3 or 4)
  const handleDateSelect = async (field, date) => {
    const newDate = date ? startOfDay(date) : null;
    if (newDate) {
      const dateStr = format(newDate, 'yyyy-MM-dd');
      const isAvail = availability[dateStr]?.available;
      if (isAvail === false) {
        console.warn('[BookingForm] Selected unavailable date:', dateStr);
        setIsModalOpen(true);
        return;
      }
      console.log('[BookingForm] Date selected:', field, dateStr);
    }
    
    setBookingData(prev => {
      const state = {
        ...prev,
        [field]: newDate,
        ...(currentPlan?.id !== 2 || isDelivery ? { [`${field.replace('Date', '')}TimeSlot`]: '' } : {})
      };

      // TASK 1: For delivery services (plan.id === 3 or 4), enforce 24-hour minimum rental
      if (field === 'dropOffDate' && newDate && (currentPlan?.id === 3 || currentPlan?.id === 4)) {
        // Automatically set pickup date to next day (24-hour minimum)
        const nextDay = addDays(newDate, 1);
        state.pickupDate = nextDay;
        state.pickupTimeSlot = ''; // Clear time slot to force reselection
        
        console.log('[BookingForm] 24-hour rental: pickup date set to next day', {
          deliveryDate: format(newDate, 'yyyy-MM-dd'),
          pickupDate: format(nextDay, 'yyyy-MM-dd')
        });
      } else if (field === 'pickupDate' && newDate && (currentPlan?.id === 3 || currentPlan?.id === 4)) {
        // Validate pickup is at least 24 hours after delivery
        if (prev.dropOffDate) {
          const minPickupDate = addDays(startOfDay(prev.dropOffDate), 1);
          if (isBefore(newDate, minPickupDate)) {
            console.warn('[BookingForm] Pickup date less than 24 hours after delivery - resetting to minimum');
            state.pickupDate = minPickupDate;
            toast({
              title: "24-Hour Minimum Rental",
              description: "Pickup must be at least 24 hours after delivery. Date adjusted to next day.",
              variant: "destructive"
            });
          }
        }
      } else if (field === 'dropOffDate' && newDate && currentPlan?.id !== 3 && currentPlan?.id !== 4) {
        // Existing logic for other services
        if (!prev.pickupDate || isBefore(startOfDay(prev.pickupDate), newDate)) {
          state.pickupDate = newDate;
          if (currentPlan?.id !== 2 || isDelivery) {
             state.pickupTimeSlot = '';
          }
        }
      }
      
      return state;
    });
  };
  
  useEffect(() => {
    if (bookingData.dropOffDate) {
      const dropOffStr = format(bookingData.dropOffDate, 'yyyy-MM-dd');
      if (availability[dropOffStr] && !availability[dropOffStr].available) {
        console.warn('[BookingForm] Drop-off date became unavailable:', dropOffStr);
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
        console.warn('[BookingForm] Pickup date became unavailable:', pickupStr);
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
    
    // Calculate base rental price
    let basePriceCalculation = parseFloat(currentPlan.base_price) || 0;
    
    if (bookingData.dropOffDate && (bookingData.pickupDate || currentPlan.id === 3)) {
      const dropOff = startOfDay(new Date(bookingData.dropOffDate));
      const pickup = currentPlan.id === 3 ? dropOff : startOfDay(new Date(bookingData.pickupDate));
      if (isValid(dropOff) && isValid(pickup) && !isBefore(pickup, dropOff)) {
        // TASK 1 FIX: Correct rental day calculation for delivery services
        let dayDiff;
        
        // For delivery services (plan.id === 3 or 4), calculate rental days without adding +1
        // because the difference already represents the correct number of rental days
        if (currentPlan.id === 3 || currentPlan.id === 4) {
          dayDiff = differenceInDays(pickup, dropOff);
          // If same day delivery/pickup, count as 1 day minimum
          if (dayDiff === 0) dayDiff = 1;
        } else {
          // For all other services, keep existing logic
          dayDiff = differenceInDays(pickup, dropOff) + 1;
        }
        
        if (currentPlan.id === 1) {
          basePriceCalculation = dayDiff === 7 ? 500 : parseFloat(currentPlan.base_price) + Math.max(0, dayDiff - 1) * 50;
        } else if (currentPlan.id === 2 || currentPlan.id === 4) {
          basePriceCalculation = parseFloat(currentPlan.base_price) * dayDiff;
        } else if (currentPlan.id === 3) {
          basePriceCalculation = parseFloat(currentPlan.base_price) * dayDiff;
        }
        
        console.log('[BookingForm] Base rental calculation:', {
          planId: currentPlan.id,
          days: dayDiff,
          basePrice: basePriceCalculation
        });
      }
    }
    
    setBaseRentalPrice(basePriceCalculation);
    
    // Calculate total: base rental + delivery fee (equipment not included here, only in OrderSummary)
    const total = basePriceCalculation + currentDeliveryFee;
    setTotalPrice(total);
    
    console.log('[BookingForm] Price totals:', {
      baseRental: basePriceCalculation,
      deliveryFee: currentDeliveryFee,
      total
    });
  }, [bookingData.dropOffDate, bookingData.pickupDate, currentPlan, currentDeliveryFee]);
  
  const isFormValid = useMemo(() => {
    if (!currentPlan) return false;
    let baseValid = bookingData.dropOffDate && bookingData.dropOffTimeSlot && bookingData.dropOffTimeSlot !== 'Not available';
    let pickupValid = currentPlan.id === 3 ? true : (bookingData.pickupDate && bookingData.pickupTimeSlot && bookingData.pickupTimeSlot !== 'Not available');
    
    // TASK 1: Additional validation for 24-hour minimum rental
    if ((currentPlan.id === 3 || currentPlan.id === 4) && bookingData.dropOffDate && bookingData.pickupDate) {
      const minPickupDate = addDays(startOfDay(bookingData.dropOffDate), 1);
      if (isBefore(startOfDay(bookingData.pickupDate), minPickupDate)) {
        console.warn('[BookingForm] Form invalid: pickup less than 24 hours after delivery');
        pickupValid = false;
      }
    }
    
    const cAddress = bookingData.contactAddress;
    const addressValid = cAddress?.street && cAddress?.city && cAddress?.state && cAddress?.zip;
    return baseValid && pickupValid && addressValid;
  }, [bookingData, currentPlan]);
  
  const handleFormSubmit = async e => {
    e.preventDefault();
    console.log('[BookingForm] Form submission initiated');
    
    if (!isFormValid) {
      console.warn('[BookingForm] Form validation failed');
      toast({
        title: "Incomplete Form",
        description: "Please ensure all required fields are filled and valid times are selected to proceed.",
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
        console.log('[BookingForm] Address not verified - marking for verification');
        addonsPayload.pending_address_verification = true;
        addonsPayload.unverified_address = `${bookingData.contactAddress.street}, ${bookingData.contactAddress.city}, ${bookingData.contactAddress.state} ${bookingData.contactAddress.zip}`;
        addonsPayload.pending_verification_reason = "Address entered manually";
        bookingData.contactAddress.unverifiedAccepted = true;
    }

    console.log('[BookingForm] ✓ Submitting booking data:', {
      plan: currentPlan.name,
      dates: {
        dropOff: bookingData.dropOffDate,
        pickup: bookingData.pickupDate
      },
      pricing: {
        baseRental: baseRentalPrice,
        deliveryFee: currentDeliveryFee,
        total: totalPrice
      }
    });

    onSubmit(bookingData, baseRentalPrice, null, null, addonsPayload);
  };

  const handleManualAddressChange = (field, value) => {
      console.log('[BookingForm] Manual address change:', field, value);
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
      date2: 'Date',
      time1: 'Time',
      time2: 'Time'
    };
    switch (isDelivery ? 4 : plan.id) {
      case 1:
      case 4:
        return {
          date1: 'Delivery Date',
          date2: 'Delivery Pickup Date',
          time1: 'Delivery (Time Window)',
          time2: 'Delivery (Pickup Window)'
        };
      case 2:
        return {
          date1: 'Pickup Date',
          date2: 'Return Date',
          time1: 'Pickup Start Time',
          time2: 'Return by Time'
        };
      case 3:
        return {
          date1: 'Delivery Date',
          date2: 'Pickup Date',
          time1: 'Delivery (Time Window)',
          time2: 'Pickup (Time Window)'
        };
      default:
        return {
          date1: 'Start Date',
          date2: 'End Date',
          time1: 'Start Time',
          time2: 'End Time'
        };
    }
  };

  const toggleServiceTerms = () => {
    setIsServiceTermsExpanded(!isServiceTermsExpanded);
  };
  
  if (loadingPlans || !plan) {
    console.log('[BookingForm] Loading plans...');
    return <div className="flex justify-center items-center h-96"><Loader2 className="h-16 w-16 animate-spin text-yellow-400" /></div>;
  }

  const planName = currentPlan?.name || plan?.name || 'Selected Service';
  const labels = getFieldLabels();
  
  const renderDescription = () => {
    const dumpFeeData = getFeeForService(currentPlan?.id);
    const dynamicFee = dumpFeeData?.fee_per_ton ? parseFloat(dumpFeeData.fee_per_ton).toFixed(2) : '45.00';
    const dynamicMaxTons = dumpFeeData?.max_tons ? parseFloat(dumpFeeData.max_tons) : null;

    if (currentPlan?.id === 4) {
      return (
        <div className="text-blue-200 space-y-4 text-sm leading-relaxed">
          <p>
            Experience the ultimate convenience with our Dump Trailer Delivery & Removal Service. Perfect for residential or commercial projects, this service eliminates the need for you to own a towing vehicle.
          </p>
          <div className="bg-yellow-900/20 border border-yellow-500/30 rounded-lg p-3">
            <p className="font-bold text-yellow-400 mb-1">📅 24-Hour Minimum Rental</p>
            <p className="text-yellow-100">Pickup is scheduled for the next day after delivery, giving you a full 24 hours to complete your project.</p>
          </div>
          <div>
            <h4 className="font-bold text-white mb-1">Our Service Process</h4>
            <p>
              Our standard rental is optimized for short-term projects, providing a seamless, "no-contact" experience. We offer early morning drop-offs between 6:00 AM and 8:00 AM, placing the trailer at your property's street curb. You will have the entire day to load the bin at your own pace. We return the following morning during the same window to haul it away.
            </p>
            <p className="mt-2">
              For your convenience, we handle both drop-off and pick-up remotely—there is no need for you to be present. To further streamline your workflow, we also offer additional equipment rentals to help you work more efficiently.
            </p>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <h4 className="font-bold text-white text-base">Service Terms</h4>
              <span 
                onClick={toggleServiceTerms}
                className="text-blue-400 hover:text-blue-300 cursor-pointer text-sm font-medium transition-colors"
              >
                {isServiceTermsExpanded ? 'see less' : 'see more'}
              </span>
            </div>
            <AnimatePresence>
              {isServiceTermsExpanded && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.3 }}
                  className="overflow-hidden"
                >
                  <div className="mt-2">
                    <h5 className="font-bold text-blue-100">Site Accessibility & Parking</h5>
                    <p>
                      Customers are responsible for ensuring a clear, accessible parking space is available at the street curb directly in front of the property. This space must be cleared prior to our arrival and remain available for our return the following morning. Our trucks require ample room to maneuver for both drop-off and retrieval; if we are unable to access the site, a dry-run fee may be imposed. Please ensure there is sufficient clearance for the driver to operate safely.
                    </p>
                  </div>
                  <div className="mt-2">
                    <h5 className="font-bold text-blue-100">Permits & Compliance</h5>
                    <p>
                      Customers are responsible for obtaining any necessary street-side parking permits and adhering to all local city ordinances. Any fines resulting from improper placement, lack of permits, or overloading are the sole responsibility of the client.
                    </p>
                  </div>
                  <div className="mt-2">
                    <h5 className="font-bold text-blue-100">Disposal Fees</h5>
                    <p>
                      Disposal fees are charged per ton. These charges will be applied to the card on file once the rental is complete and the load has been processed at the landfill.
                    </p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <div className="bg-black/20 p-3 rounded border border-blue-500/20">
            <p className="font-bold text-white mb-1">Fee Structure:</p>
            <ul className="list-disc list-inside space-y-1">
              <li>Rental: Base rate per day (calculated below)</li>
              {currentDeliveryFee > 0 && <li>Base Delivery Fee: <span className="text-green-400">${currentDeliveryFee.toFixed(2)}</span></li>}
              <li>Mileage Charge: Distance-based calculation from our lot</li>
              <li>Dump Fees: <span className="text-green-400">${dynamicFee} per ton</span></li>
              <li>Weight Limit: <span className="text-orange-400">{dynamicMaxTons || 2.5}-ton maximum capacity</span></li>
            </ul>
          </div>
        </div>
      );
    }

    if (currentPlan?.id === 1) {
      return (
         <div className="text-blue-200 space-y-3 text-sm leading-relaxed">
          <p>
            Our <strong>16 Yard Dumpster Rental</strong> is perfect for mid-to-large cleanouts, remodeling projects, and construction debris.
          </p>
          <div className="bg-black/20 p-3 rounded border border-blue-500/20 mt-4">
            <p className="font-bold text-white mb-1">Pricing Details:</p>
            <ul className="list-disc list-inside space-y-1">
              <li>Rental: Base rate covers up to 7 days</li>
              {currentDeliveryFee > 0 && <li>Base Delivery Fee: <span className="text-green-400">${currentDeliveryFee.toFixed(2)}</span></li>}
              <li>Dump Fees: <span className="text-green-400">${dynamicFee} per ton {dynamicMaxTons ? `(${dynamicMaxTons} tons max)` : ''}</span></li>
            </ul>
          </div>
        </div>
      );
    }

    if (currentPlan?.id === 2) {
      const rentalHoursText = trailerRentalHours.pickupStart && trailerRentalHours.returnBy 
        ? `gives you the trailer from ${trailerRentalHours.pickupStart} to ${trailerRentalHours.returnBy}.`
        : 'gives you the trailer for a full rental day.';

      return (
        <div className="text-blue-200 space-y-4 text-sm leading-relaxed">
          <p>
            Our <strong>Dump Loader Trailer Rental</strong> is the heavy-duty solution for DIYers and professionals alike. This versatile 16'x7'x4' trailer empowers you to move materials on your own schedule—saving you time, money, and the hassle of multiple trips.
          </p>
          
          <div>
            <h4 className="font-bold text-white text-base mb-2">Key Capabilities:</h4>
            <ul className="space-y-1.5 ml-1">
              <li className="flex items-start">
                <span className="text-yellow-400 mr-2 mt-0.5">•</span>
                <span><strong className="text-white">Bulk Material Hauling:</strong> Perfect for picking up bark, gravel, or aggregate directly from the supplier. Transport high-volume loads in a single trip and dump them exactly where you need them.</span>
              </li>
              <li className="flex items-start">
                <span className="text-yellow-400 mr-2 mt-0.5">•</span>
                <span><strong className="text-white">Versatile Disposal:</strong> Built for landscape debris, junk removal, construction waste, and remodel demolition.</span>
              </li>
            </ul>
          </div>

          <div>
            <h4 className="font-bold text-white text-base mb-2">Self-Service Flexibility & Maximum Value:</h4>
            <ul className="space-y-1.5 ml-1">
              <li className="flex items-start">
                <span className="text-yellow-400 mr-2 mt-0.5">•</span>
                <span><strong className="text-white">Contactless Pickup & Return:</strong> Your receipt includes the address and access instructions. No need to coordinate a meeting time—simply arrive, hook up, and go.</span>
              </li>
              <li className="flex items-start">
                <span className="text-yellow-400 mr-2 mt-0.5">•</span>
                <span><strong className="text-white">The Longest Rental Window:</strong> We offer some of the most generous rental hours in the industry, giving you a true full day's work without unnecessary restrictions. While other companies shorten your time or charge extra for full-day access, our flat daily rate {rentalHoursText}</span>
              </li>
              <li className="flex items-start">
                <span className="text-yellow-400 mr-2 mt-0.5">•</span>
                <span><strong className="text-white">Your Schedule:</strong> Pick up as early or return as late as you need within our operating window for one consistent, transparent price.</span>
              </li>
            </ul>
          </div>

          <div>
            <h4 className="font-bold text-white text-base mb-2">Rental & Safety Requirements:</h4>
            <ul className="space-y-1.5 ml-1">
              <li className="flex items-start">
                <span className="text-yellow-400 mr-2 mt-0.5">•</span>
                <span><strong className="text-white">Rental Terms:</strong> Multi-day rentals are available for larger projects requiring extended haul time. See below for current daily rates.</span>
              </li>
              <li className="flex items-start">
                <span className="text-yellow-400 mr-2 mt-0.5">•</span>
                <span><strong className="text-white">Hitch Requirements:</strong> Your vehicle MUST be equipped with a <span className="text-yellow-400 font-semibold">2-5/16" ball hitch</span> and a standard 7-way electrical connector. You are responsible for a safety self-inspection upon hookup to ensure a secure connection.</span>
              </li>
            </ul>
          </div>

          <div>
            <h4 className="font-bold text-white text-base mb-2">Location:</h4>
            <p className="ml-1">Pick up is located on the South Side of Saratoga Springs.</p>
          </div>

          <div className="bg-black/20 p-3 rounded border border-blue-500/20">
            <p className="font-bold text-white mb-2">Rental Includes:</p>
            <ul className="space-y-1">
              <li className="flex items-start">
                <span className="text-green-400 mr-2 mt-0.5">•</span>
                <span>Wireless Remote Control for easy dumping operation</span>
              </li>
              <li className="flex items-start">
                <span className="text-green-400 mr-2 mt-0.5">•</span>
                <span>Integrated Power Tarp Cover to secure your load</span>
              </li>
              <li className="flex items-start">
                <span className="text-green-400 mr-2 mt-0.5">•</span>
                <span>Hydraulic Jack for effortless coupling and uncoupling</span>
              </li>
              <li className="flex items-start">
                <span className="text-green-400 mr-2 mt-0.5">•</span>
                <span>Weight Limit: 5-ton capacity</span>
              </li>
            </ul>
          </div>
        </div>
      );
    }

    if (currentPlan?.id === 3) {
      return (
        <div className="text-blue-200 space-y-4 text-sm leading-relaxed">
          <p>
            Our <strong>Material Delivery Service</strong> provides quick, efficient delivery of bulk materials directly to your job site.
          </p>
          <div className="bg-yellow-900/20 border border-yellow-500/30 rounded-lg p-3">
            <p className="font-bold text-yellow-400 mb-1">📅 24-Hour Service Window</p>
            <p className="text-yellow-100">Delivery is made on your selected date, with automatic pickup scheduled 24 hours later.</p>
          </div>
          <div className="bg-black/20 p-3 rounded border border-blue-500/20">
            <p className="font-bold text-white mb-1">Service Details:</p>
            <ul className="list-disc list-inside space-y-1">
              <li>Same-day delivery and next-day pickup</li>
              <li>Professional material handling</li>
              <li>Delivery fee based on distance</li>
            </ul>
          </div>
        </div>
      );
    }
    
    return <p className="text-blue-200">{currentPlan?.description || plan?.description || ''}</p>;
  };
  
  // Helper function to format fees as currency
  const formatFeeAsCurrency = (fee) => {
    if (fee === null || fee === undefined) return 'N/A';
    return `$${Number(fee).toFixed(2)}`;
  };
  
  console.log('[BookingForm] Render complete');
  
  return <>
    <motion.div initial={{
      opacity: 0,
      y: 50
    }} animate={{
      opacity: 1,
      y: 0
    }} exit={{
      opacity: 0,
      y: -50
    }} className="container mx-auto pt-8 pb-16 px-4">
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
              {plan?.id === 2 && !isDelivery && (
                <Dialog>
                  <DialogTrigger asChild>
                    <AlertCircle className="h-6 w-6 ml-2 text-yellow-500 cursor-pointer animate-pulse transition-transform hover:scale-110" />
                  </DialogTrigger>
                  <DialogContent 
                    className="!top-[25vh] !translate-y-0 !left-[50%] !translate-x-[-50%] w-[90vw] max-w-[450px] max-h-[60vh] overflow-y-auto bg-gray-900 border-2 border-orange-500 p-5 shadow-2xl shadow-orange-900/40 z-[9999] text-white"
                  >
                    <div className="flex items-center space-x-2 mb-4 border-b border-orange-500/30 pb-3">
                      <AlertCircle className="h-6 w-6 text-orange-500 flex-shrink-0" />
                      <span className="font-bold text-orange-400 text-base uppercase tracking-wide">Liability & Responsibility</span>
                    </div>
                    <ul className="space-y-4 text-sm text-gray-300">
                      <li>
                        <strong className="text-white block mb-1">Vehicle & Towing Requirements:</strong>
                        Renter must ensure their vehicle meets the necessary towing capacity. Valid driver's license and proof of insurance are required.
                      </li>
                      <li>
                        <strong className="text-white block mb-1">Damage & Improper Use:</strong>
                        Renter is fully responsible for any trailer damage, overloading, or improper loading occurring during the rental period.
                      </li>
                      <li>
                        <strong className="text-white block mb-1">Cleaning & Maintenance:</strong>
                        The trailer must be returned completely empty and reasonably clean. Failure to do so will result in additional dump and cleaning fees.
                      </li>
                      <li>
                        <strong className="text-white block mb-1">Insurance & Legal Compliance:</strong>
                        Renter is fully liable for all traffic violations, accidents, and must comply with all local towing laws and regulations.
                      </li>
                      <li>
                        <strong className="text-white block mb-1">Assumption of Risk:</strong>
                        By renting, the customer assumes all risks associated with towing and operating the dump trailer.
                      </li>
                    </ul>
                  </DialogContent>
                </Dialog>
              )}
              {currentPlan?.id === 4 && (
                <Dialog>
                  <DialogTrigger asChild>
                    <AlertCircle className="h-6 w-6 ml-2 text-yellow-500 cursor-pointer animate-pulse transition-transform hover:scale-110" />
                  </DialogTrigger>
                  <DialogContent 
                    className="!top-[25vh] !translate-y-0 !left-[50%] !translate-x-[-50%] w-[90vw] max-w-[450px] max-h-[60vh] overflow-y-auto bg-gray-900 border-2 border-orange-500 p-5 shadow-2xl shadow-orange-900/40 z-[9999] text-white"
                  >
                    <div className="flex items-center space-x-2 mb-4 border-b border-orange-500/30 pb-3">
                      <AlertCircle className="h-6 w-6 text-orange-500 flex-shrink-0" />
                      <span className="font-bold text-orange-400 text-base uppercase tracking-wide">Prohibited Materials</span>
                    </div>
                    {feesLoading ? (
                      <div className="flex items-center justify-center py-4">
                        <Loader2 className="h-6 w-6 animate-spin text-orange-400 mr-2" />
                        <span className="text-sm text-gray-300">Loading disposal fees...</span>
                      </div>
                    ) : feesError ? (
                      <div className="text-sm text-red-400 bg-red-900/20 p-3 rounded border border-red-500/30">
                        <strong>Error:</strong> {feesError}. Using default values.
                      </div>
                    ) : null}
                    <p className="text-sm text-gray-300 leading-relaxed">
                      <strong className="text-white">CAUTION:</strong> These Materials are not allowed in the dumpster. Prohibited items include hazardous materials (paint, chemicals, asbestos), tires, and batteries. Mattresses and TVs can be taken to the dump, but they require an extra {formatFeeAsCurrency(mattressFee)} for each mattress and {formatFeeAsCurrency(tvFee)} for each TV. Appliances require {formatFeeAsCurrency(applianceFee)} for each appliance. Please refer to our user agreement for a complete list of restricted items. Disposing of these items in the dumpster may result in additional fees.
                    </p>
                  </DialogContent>
                </Dialog>
              )}
            </div>
            
            {/* Scrollable Description Area */}
            <div className="max-h-[350px] overflow-y-auto mb-4 pr-2 scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent">
              {renderDescription()}
            </div>
            
            <div className="border-t border-white/20 pt-4">
              <p className="text-white text-lg font-semibold">
                {currentPlan?.id === 2 && !isDelivery ? 'Projected Total (For Days Booked):' : 'Estimated Price (Rental + Base Delivery Fee):'}
              </p>
              <div className="flex items-baseline mb-2">
                <p className="text-4xl font-bold text-green-400">${totalPrice.toFixed(2)}</p>
                <span className="text-sm text-blue-200 ml-2">(plus tax)</span>
              </div>
              <div className="text-sm text-gray-300 mb-2">
                 <span>Base Rental: ${baseRentalPrice.toFixed(2)}</span>
                 {currentDeliveryFee > 0 && <span className="ml-4">Delivery Fee: ${currentDeliveryFee.toFixed(2)}</span>}
              </div>
              {(isDelivery || plan?.id === 1) && <p className="text-xs text-yellow-300 italic flex items-center mt-2">
                   <Truck className="h-4 w-4 mr-1" /> Mileage charge will be calculated in the next step based on distance.
                </p>}
            </div>
          </div>

          <form onSubmit={handleFormSubmit} className="space-y-6">
            <motion.div initial={{
              opacity: 0,
              x: 20
            }} animate={{
              opacity: 1,
              x: 0
            }} className="space-y-4">
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
                            contactAddress: {
                              ...prev.contactAddress,
                              street: val,
                              isVerified: false,
                              unverifiedAccepted: true
                            }
                        }))} 
                        onAddressSelect={details => setBookingData(prev => ({
                            ...prev,
                            contactAddress: {
                              ...prev.contactAddress,
                              isVerified: true,
                              unverifiedAccepted: false,
                              ...details,
                            }
                        }))} 
                        placeholder="Start typing your address..." 
                        required 
                      />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <InputField 
                        icon={<MapPin />} 
                        value={bookingData.contactAddress?.city || ''} 
                        onChange={(e) => handleManualAddressChange('city', e.target.value)}
                        placeholder="City" 
                      />
                      <InputField 
                        icon={<MapPin />} 
                        value={bookingData.contactAddress?.state || ''} 
                        onChange={(e) => handleManualAddressChange('state', e.target.value)}
                        placeholder="State" 
                      />
                      <InputField 
                        icon={<MapPin />} 
                        value={bookingData.contactAddress?.zip || ''} 
                        onChange={(e) => handleManualAddressChange('zip', e.target.value)}
                        placeholder="ZIP" 
                      />
                  </div>
                  {!bookingData.contactAddress?.isVerified && bookingData.contactAddress?.street && (
                      <p className="text-xs text-orange-300 bg-orange-900/20 p-2 rounded border border-orange-500/30 mt-2">
                          Important: Please log in to the customer portal as soon as your order is placed. This allows you to verify your details and ensure your order processes as quickly as possible.
                      </p>
                  )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6 border-t border-white/10 pt-4">
                  <DatePickerField label={labels.date1} date={bookingData.dropOffDate} setDate={d => handleDateSelect('dropOffDate', d)} disabledDates={disabledDates} onMonthChange={setCurrentMonth} />
                  {currentPlan?.id === 2 && !isDelivery ? (
                      <ReadOnlyTimeField label={labels.time1} value={bookingData.dropOffTimeSlot} loading={fetchingExactTimes} />
                  ) : (
                      <TimeSlotPicker label={labels.time1} value={bookingData.dropOffTimeSlot} onValueChange={v => setBookingData(p => ({
                        ...p,
                        dropOffTimeSlot: v
                      }))} slots={timeSlots.dropOff} disabled={!bookingData.dropOffDate} loading={loadingAvailability} />
                  )}
                  
                  {currentPlan?.id !== 3 && <>
                          <DatePickerField label={labels.date2} date={bookingData.pickupDate} setDate={d => handleDateSelect('pickupDate', d)} disabledDates={disabledDates} onMonthChange={setCurrentMonth} />
                          {currentPlan?.id === 2 && !isDelivery ? (
                              <ReadOnlyTimeField label={labels.time2} value={bookingData.pickupTimeSlot} loading={fetchingExactTimes} />
                          ) : (
                              <TimeSlotPicker label={labels.time2} value={bookingData.pickupTimeSlot} onValueChange={v => setBookingData(p => ({
                                ...p,
                                pickupTimeSlot: v
                              }))} slots={timeSlots.pickup} disabled={!bookingData.pickupDate} loading={loadingAvailability} />
                          )}
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

const InputField = ({
  icon,
  disabled,
  ...props
}) => <div className="relative flex items-center">
    <span className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-blue-300">{icon}</span>
    <input {...props} disabled={disabled} className={`w-full bg-white/10 text-white rounded-lg border border-white/30 focus:ring-2 focus:ring-yellow-400 focus:border-yellow-400 pl-9 pr-4 py-2 text-sm placeholder-blue-200 transition-colors ${disabled ? 'opacity-60 bg-gray-800 cursor-not-allowed' : ''}`} />
  </div>;

const DatePickerField = ({
  label,
  date,
  setDate,
  disabledDates,
  onMonthChange
}) => <div className="md:col-span-1">
    <label className="text-sm font-medium text-white mb-2 block">{label}</label>
    <Popover>
      <PopoverTrigger asChild><Button variant="outline" className="w-full justify-start text-left font-normal bg-white/10 border-white/30 hover:bg-white/20 text-white"><CalendarIcon className="mr-2 h-4 w-4" />{date ? format(date, 'PPP') : <span>Pick a date</span>}</Button></PopoverTrigger>
      <PopoverContent className="w-auto p-0 bg-gray-800 border-gray-700 text-white"><Calendar mode="single" selected={date} onSelect={setDate} disabled={disabledDates} initialFocus onMonthChange={onMonthChange} /></PopoverContent>
    </Popover>
  </div>;

const TimeSlotPicker = ({
  label,
  value,
  onValueChange,
  slots,
  disabled,
  loading
}) => <div className="md:col-span-1">
    <label className="text-sm font-medium text-white mb-2 block">{label}</label>
    <Select onValueChange={onValueChange} value={value} disabled={disabled || loading}>
      <SelectTrigger className="w-full bg-white/10 border-white/30 text-white"><Clock className="mr-2 h-4 w-4" /><SelectValue placeholder="Select a time" /></SelectTrigger>
      <SelectContent className="bg-gray-800 border-gray-700 text-white">
        {loading ? <SelectItem value="loading" disabled>Loading...</SelectItem> : slots?.length > 0 ? slots.map(slot => <SelectItem key={slot.value} value={slot.value}>{slot.label || slot.value}</SelectItem>) : <SelectItem value="no-slots" disabled>None</SelectItem>}
      </SelectContent>
    </Select>
  </div>;

const ReadOnlyTimeField = ({ label, value, loading }) => {
  const formatTimeToAmPm = (timeStr) => {
    if (!timeStr || timeStr === 'Not available') return timeStr;
    try {
      const parsed = parse(timeStr, 'HH:mm:ss', new Date());
      return format(parsed, 'h:mm a');
    } catch {
      return timeStr;
    }
  };

  const displayValue = loading ? 'Loading...' : (value ? formatTimeToAmPm(value) : 'Pending...');
      
  return (
      <div className="md:col-span-1">
          <label className="text-sm font-medium text-white mb-2 block">{label}</label>
          <div className={`w-full bg-black/40 border border-white/20 rounded-md px-3 py-2 flex items-center cursor-not-allowed text-sm h-10 ${value === 'Not available' ? 'text-red-400 font-semibold' : 'text-gray-300'}`}>
              {loading ? (
                 <><Loader2 className="mr-2 h-4 w-4 animate-spin text-gray-500" /> Loading...</>
              ) : (
                 <><Clock className={`mr-2 h-4 w-4 ${value === 'Not available' ? 'text-red-400' : 'text-gray-500'}`} /> {displayValue}</>
              )}
          </div>
      </div>
  );
};