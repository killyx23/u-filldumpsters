
import React, { useState, useEffect } from 'react';
import { Calendar as ShadCalendar } from '@/components/ui/calendar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { format, parseISO, isSameDay } from 'date-fns';
import { CalendarX, CalendarCheck, Clock, Loader2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { convertTo12Hour, formatTimeRange12Hour } from '@/utils/timeFormatConverter';
import { safeExtractString } from '@/utils/stringExtractors';
import { supabase } from '@/lib/customSupabaseClient';

export const RescheduleDateTimeSelector = ({ 
    booking, 
    availableDates = [],
    newDropOffDate, 
    setNewDropOffDate, 
    newPickupDate, 
    setNewPickupDate,
    newDropOffTime,
    setNewDropOffTime,
    newPickupTime,
    setNewPickupTime,
    selectedService
}) => {
    const [dropOffTimeSlots, setDropOffTimeSlots] = useState([]);
    const [pickupTimeSlots, setPickupTimeSlots] = useState([]);
    const [fetchingTimes, setFetchingTimes] = useState(false);

    const dropOffDateStr = safeExtractString(booking?.drop_off_date);
    const pickupDateStr = safeExtractString(booking?.pickup_date);
    
    const originalDropOff = dropOffDateStr ? parseISO(dropOffDateStr) : new Date();
    const originalPickup = pickupDateStr ? parseISO(pickupDateStr) : new Date();
    const originalPlanName = safeExtractString(booking?.plan?.name, 'Standard Service');
    
    const serviceId = selectedService?.id || booking?.plan?.id;
    
    const dropOffTimeSlotStr = safeExtractString(booking?.drop_off_time_slot, '08:00');
    const pickupTimeSlotStr = safeExtractString(booking?.pickup_time_slot, '17:00');

    useEffect(() => {
        if (!newDropOffDate || !serviceId) return;

        const fetchTimeSlots = async () => {
            setFetchingTimes(true);
            try {
                const dateStr = format(newDropOffDate, 'yyyy-MM-dd');
                const dow = newDropOffDate.getDay();

                // Query date_specific_availability first
                const { data: dsa, error: dsaError } = await supabase
                    .from('date_specific_availability')
                    .select('*')
                    .eq('service_id', serviceId)
                    .eq('date', dateStr)
                    .maybeSingle();

                if (dsaError && dsaError.code !== 'PGRST116') {
                    console.error('Error fetching date_specific_availability:', dsaError);
                }

                // Fallback to service_availability
                const { data: sa, error: saError } = await supabase
                    .from('service_availability')
                    .select('*')
                    .eq('service_id', serviceId)
                    .eq('day_of_week', dow)
                    .maybeSingle();

                if (saError && saError.code !== 'PGRST116') {
                    console.error('Error fetching service_availability:', saError);
                }

                const availability = dsa || sa;

                if (!availability) {
                    console.warn(`No availability data found for service ${serviceId} on ${dateStr}`);
                    // Provide default full-day availability
                    const defaultSlot = { value: '08:00|17:00', label: '8:00 AM - 5:00 PM' };
                    setDropOffTimeSlots([defaultSlot]);
                    setPickupTimeSlots([defaultSlot]);
                    if (!newDropOffTime) setNewDropOffTime(defaultSlot.value);
                    if (!newPickupTime) setNewPickupTime(defaultSlot.value);
                    setFetchingTimes(false);
                    return;
                }

                // Service-specific time slot logic
                if (serviceId === 1 || serviceId === 4) {
                    const deliveryStart = availability.delivery_start_time || availability.delivery_window_start_time || '08:00';
                    const deliveryEnd = availability.delivery_end_time || availability.delivery_window_end_time || '17:00';
                    
                    const timeWindowValue = `${deliveryStart}|${deliveryEnd}`;
                    setDropOffTimeSlots([{
                        value: timeWindowValue,
                        label: formatTimeRange12Hour(deliveryStart, deliveryEnd)
                    }]);
                    
                    if (!newDropOffTime) {
                        setNewDropOffTime(timeWindowValue);
                    }

                    const pickupStart = availability.delivery_pickup_start_time || availability.delivery_pickup_window_start_time || '08:00';
                    const pickupEnd = availability.delivery_pickup_end_time || availability.delivery_pickup_window_end_time || '17:00';
                    
                    const pickupWindowValue = `${pickupStart}|${pickupEnd}`;
                    setPickupTimeSlots([{
                        value: pickupWindowValue,
                        label: formatTimeRange12Hour(pickupStart, pickupEnd)
                    }]);
                    
                    if (!newPickupTime) {
                        setNewPickupTime(pickupWindowValue);
                    }
                } else if (serviceId === 2) {
                    const pickupStart = availability.pickup_start_time || '08:00';
                    
                    setNewDropOffTime(pickupStart);
                    setDropOffTimeSlots([{
                        value: pickupStart,
                        label: convertTo12Hour(pickupStart)
                    }]);

                    if (newPickupDate) {
                        const pickupDateStr = format(newPickupDate, 'yyyy-MM-dd');
                        const pickupDow = newPickupDate.getDay();

                        const { data: dsaPickup, error: dsaPickupError } = await supabase
                            .from('date_specific_availability')
                            .select('return_by_time')
                            .eq('service_id', serviceId)
                            .eq('date', pickupDateStr)
                            .maybeSingle();

                        if (dsaPickupError && dsaPickupError.code !== 'PGRST116') {
                            console.error('Error fetching pickup date_specific_availability:', dsaPickupError);
                        }

                        const { data: saPickup, error: saPickupError } = await supabase
                            .from('service_availability')
                            .select('return_by_time')
                            .eq('service_id', serviceId)
                            .eq('day_of_week', pickupDow)
                            .maybeSingle();

                        if (saPickupError && saPickupError.code !== 'PGRST116') {
                            console.error('Error fetching pickup service_availability:', saPickupError);
                        }

                        const returnTime = dsaPickup?.return_by_time || saPickup?.return_by_time || availability.return_by_time || '17:00';
                        
                        setNewPickupTime(returnTime);
                        setPickupTimeSlots([{
                            value: returnTime,
                            label: convertTo12Hour(returnTime)
                        }]);
                    }
                } else if (serviceId === 3) {
                    const deliveryStart = availability.delivery_start_time || availability.delivery_window_start_time || '08:00';
                    const deliveryEnd = availability.delivery_end_time || availability.delivery_window_end_time || '17:00';
                    
                    const timeWindowValue = `${deliveryStart}|${deliveryEnd}`;
                    setDropOffTimeSlots([{
                        value: timeWindowValue,
                        label: formatTimeRange12Hour(deliveryStart, deliveryEnd)
                    }]);
                    
                    if (!newDropOffTime) {
                        setNewDropOffTime(timeWindowValue);
                    }
                    
                    setPickupTimeSlots([]);
                }
            } catch (error) {
                console.error("Error fetching time slots:", error);
                // Provide default fallback
                const defaultSlot = { value: '08:00|17:00', label: '8:00 AM - 5:00 PM' };
                setDropOffTimeSlots([defaultSlot]);
                setPickupTimeSlots([defaultSlot]);
                if (!newDropOffTime) setNewDropOffTime(defaultSlot.value);
                if (!newPickupTime && serviceId !== 3) setNewPickupTime(defaultSlot.value);
            } finally {
                setFetchingTimes(false);
            }
        };

        fetchTimeSlots();
    }, [newDropOffDate, newPickupDate, serviceId, setNewDropOffTime, setNewPickupTime, newDropOffTime, newPickupTime]);

    const isDateDisabled = (date) => {
        if (isSameDay(date, originalDropOff) || isSameDay(date, originalPickup)) return false;
        if (date < new Date(new Date().setHours(0,0,0,0))) return true;
        return false; 
    };

    const handleRangeSelect = (range) => {
        setNewDropOffDate(range?.from || null);
        setNewPickupDate(range?.to || null);
    };

    const getLabels = () => {
        if (serviceId === 1 || serviceId === 4) {
            return { 
                start: "Delivery (Time Window)", 
                end: "Delivery (Pickup Window)" 
            };
        } else if (serviceId === 2) {
            return { 
                start: "Pickup Start Time", 
                end: "Return by Time" 
            };
        } else if (serviceId === 3) {
            return { 
                start: "Delivery (Time Window)", 
                end: "" 
            };
        }
        return { 
            start: "New Start Time", 
            end: "New End Time" 
        };
    };

    const labels = getLabels();

    return (
        <div className="space-y-8 animate-in fade-in duration-500 max-w-5xl mx-auto w-full">
            <div className="text-center space-y-3 pb-2">
                <h2 className="text-3xl font-extrabold text-white tracking-tight">
                    Select New Dates & Times
                </h2>
                <p className="text-base text-gray-400 max-w-2xl mx-auto">
                    Choose the dates and times for your rescheduled appointment.
                </p>
            </div>

            <Card className="bg-gray-900 border-gray-800 shadow-lg">
                <CardContent className="p-6">
                    <div className="flex flex-col md:flex-row items-center justify-between gap-6">
                        <div className="flex items-center text-gray-400 w-full md:w-auto border-b md:border-b-0 md:border-r border-gray-800 pb-4 md:pb-0 md:pr-6">
                            <CalendarX className="w-8 h-8 mr-4 text-gray-500 shrink-0" />
                            <div>
                                <p className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-1">Original Booking</p>
                                <h4 className="text-base font-bold text-white">{originalPlanName}</h4>
                            </div>
                        </div>
                        <div className="flex flex-col sm:flex-row gap-4 w-full md:w-auto">
                            <div className="bg-gray-950 border border-gray-800 px-5 py-3 rounded-xl text-center flex-1 min-w-[200px]">
                                <span className="text-gray-500 text-xs font-bold uppercase tracking-widest block mb-1">Original Start</span>
                                <span className="text-gray-200 font-semibold block">
                                    {format(originalDropOff, 'MMM d, yyyy')}
                                </span>
                                <span className="text-gray-400 text-sm mt-0.5 block">
                                    @ {convertTo12Hour(dropOffTimeSlotStr)}
                                </span>
                            </div>
                            {booking?.plan?.id !== 3 && (
                                <div className="bg-gray-950 border border-gray-800 px-5 py-3 rounded-xl text-center flex-1 min-w-[200px]">
                                    <span className="text-gray-500 text-xs font-bold uppercase tracking-widest block mb-1">Original End</span>
                                    <span className="text-gray-200 font-semibold block">
                                        {format(originalPickup, 'MMM d, yyyy')}
                                    </span>
                                    <span className="text-gray-400 text-sm mt-0.5 block">
                                        @ {convertTo12Hour(pickupTimeSlotStr)}
                                    </span>
                                </div>
                            )}
                        </div>
                    </div>
                </CardContent>
            </Card>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                <Card className="lg:col-span-7 bg-[hsl(var(--gold)_/_0.02)] border-[hsl(var(--gold)_/_0.3)] shadow-[0_0_30px_hsla(var(--gold),0.05)] relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-gold to-gold-light"></div>
                    <CardContent className="p-8 flex flex-col items-center">
                        <div className="text-center mb-6">
                            <h3 className="text-xl font-bold text-gold flex items-center justify-center">
                                <CalendarCheck className="w-6 h-6 mr-2" /> Select Dates
                            </h3>
                        </div>
                        
                        <div className="bg-gray-950 rounded-2xl border border-[hsl(var(--gold)_/_0.2)] p-4 shadow-inner inline-block w-full overflow-x-auto custom-calendar-wrapper">
                            <ShadCalendar
                                mode={serviceId === 3 ? "single" : "range"}
                                selected={serviceId === 3 ? newDropOffDate : { from: newDropOffDate, to: newPickupDate }}
                                onSelect={handleRangeSelect}
                                disabled={isDateDisabled}
                                numberOfMonths={window.innerWidth >= 768 ? 2 : 1}
                                className="mx-auto"
                            />
                        </div>
                    </CardContent>
                </Card>

                <div className="lg:col-span-5 flex flex-col gap-6">
                    <Card className="bg-gray-900 border-gray-800 flex-1">
                        <CardContent className="p-6 h-full flex flex-col justify-center">
                            {fetchingTimes ? (
                                <div className="flex flex-col items-center justify-center space-y-4 py-8">
                                    <Loader2 className="w-8 h-8 animate-spin text-gold" />
                                    <p className="text-gray-400 text-sm">Loading available times...</p>
                                </div>
                            ) : (
                                <div className="space-y-6 w-full">
                                    <div className="space-y-3">
                                        <Label className="text-gray-300 text-sm font-bold uppercase tracking-widest flex items-center">
                                            <Clock className="w-4 h-4 mr-2 text-gold"/> {labels.start}
                                        </Label>
                                        {serviceId === 2 ? (
                                            <div className="w-full h-12 bg-gray-950 border border-gray-700 text-white rounded-xl flex items-center px-4">
                                                <Clock className="w-4 h-4 mr-2 text-gray-500" />
                                                <span>{dropOffTimeSlots[0]?.label || 'Loading...'}</span>
                                            </div>
                                        ) : (
                                            <Select value={newDropOffTime} onValueChange={setNewDropOffTime} disabled={dropOffTimeSlots.length === 0}>
                                                <SelectTrigger className="w-full h-12 bg-gray-950 border-gray-700 text-white rounded-xl focus:ring-gold/50">
                                                    <SelectValue placeholder={dropOffTimeSlots.length === 0 ? "No times available" : "Select Time Window"} />
                                                </SelectTrigger>
                                                <SelectContent className="bg-gray-900 border-gray-700 text-white max-h-[300px]">
                                                    {dropOffTimeSlots.map((slot, idx) => (
                                                        <SelectItem key={`start-${idx}-${slot.value}`} value={slot.value} className="focus:bg-gold/20 focus:text-gold py-3 cursor-pointer">
                                                            {slot.label}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        )}
                                    </div>
                                    
                                    {serviceId !== 3 && (
                                        <div className="space-y-3">
                                            <Label className="text-gray-300 text-sm font-bold uppercase tracking-widest flex items-center">
                                                <Clock className="w-4 h-4 mr-2 text-gold"/> {labels.end}
                                            </Label>
                                            {serviceId === 2 ? (
                                                <div className="w-full h-12 bg-gray-950 border border-gray-700 text-white rounded-xl flex items-center px-4">
                                                    <Clock className="w-4 h-4 mr-2 text-gray-500" />
                                                    <span>{pickupTimeSlots[0]?.label || 'Loading...'}</span>
                                                </div>
                                            ) : (
                                                <Select value={newPickupTime} onValueChange={setNewPickupTime} disabled={pickupTimeSlots.length === 0}>
                                                    <SelectTrigger className="w-full h-12 bg-gray-950 border-gray-700 text-white rounded-xl focus:ring-gold/50">
                                                        <SelectValue placeholder={pickupTimeSlots.length === 0 ? "No times available" : "Select Pickup Window"} />
                                                    </SelectTrigger>
                                                    <SelectContent className="bg-gray-900 border-gray-700 text-white max-h-[300px]">
                                                        {pickupTimeSlots.map((slot, idx) => (
                                                            <SelectItem key={`end-${idx}-${slot.value}`} value={slot.value} className="focus:bg-gold/20 focus:text-gold py-3 cursor-pointer">
                                                                {slot.label}
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
};
