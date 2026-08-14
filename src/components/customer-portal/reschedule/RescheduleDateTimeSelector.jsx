import { useState, useEffect, useCallback } from 'react';
import { Calendar as ShadCalendar } from '@/components/ui/calendar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import {
    format,
    parseISO,
    startOfDay,
    addDays,
    startOfMonth,
    endOfMonth,
    addMonths,
    formatISO,
    eachDayOfInterval,
    isBefore,
} from 'date-fns';
import { CalendarX, CalendarCheck, Clock, Loader2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { convertTo12Hour } from '@/utils/timeFormatConverter';
import { safeExtractString } from '@/utils/stringExtractors';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';
import { formatCustomerFacingPlanName } from '@/utils/displayPlanName';

const isDateUnavailable = (date, availability) => {
    const dateStr = format(date, 'yyyy-MM-dd');
    return availability[dateStr]?.available === false;
};

const rangeHasUnavailableDay = (from, to, availability) => {
    if (!from || !to) return false;
    const start = startOfDay(from);
    const end = startOfDay(to);
    if (isBefore(end, start)) return false;
    return eachDayOfInterval({ start, end }).some((day) => isDateUnavailable(day, availability));
};

export const RescheduleDateTimeSelector = ({
    booking,
    bookingId = null,
    newDropOffDate,
    setNewDropOffDate,
    newPickupDate,
    setNewPickupDate,
    newDropOffTime,
    setNewDropOffTime,
    newPickupTime,
    setNewPickupTime,
    selectedService,
}) => {
    const [dropOffTimeSlots, setDropOffTimeSlots] = useState([]);
    const [pickupTimeSlots, setPickupTimeSlots] = useState([]);
    const [fetchingTimes, setFetchingTimes] = useState(false);
    const [availability, setAvailability] = useState({});
    const [loadingAvailability, setLoadingAvailability] = useState(true);
    const [visibleMonth, setVisibleMonth] = useState(() => startOfMonth(new Date()));

    const dropOffDateStr = safeExtractString(booking?.drop_off_date);
    const pickupDateStr = safeExtractString(booking?.pickup_date);

    const originalDropOff = dropOffDateStr ? parseISO(dropOffDateStr) : new Date();
    const originalPickup = pickupDateStr ? parseISO(pickupDateStr) : new Date();
    const originalPlanName = formatCustomerFacingPlanName(safeExtractString(booking?.plan?.name, 'Standard Service'));

    const serviceId = selectedService?.id || booking?.plan?.id;
    const resolvedBookingId = bookingId ?? booking?.id ?? null;

    const dropOffTimeSlotStr = safeExtractString(booking?.drop_off_time_slot, '08:00');
    const pickupTimeSlotStr = safeExtractString(booking?.pickup_time_slot, '17:00');

    const fetchAvailability = useCallback(async (month) => {
        if (!serviceId) return;
        setLoadingAvailability(true);
        const startDate = formatISO(startOfMonth(month), { representation: 'date' });
        const endDate = formatISO(endOfMonth(addMonths(month, 1)), { representation: 'date' });

        try {
            const body = {
                serviceId,
                startDate,
                endDate,
            };
            if (resolvedBookingId != null) {
                body.excludeBookingId = Number(resolvedBookingId);
            }

            const { data, error } = await supabase.functions.invoke('get-availability', { body });

            let mergedAvailability = {};
            if (!error && !data?.error) {
                mergedAvailability = { ...data.availability };
            } else if (error || data?.error) {
                console.error('[RescheduleDateTimeSelector] Availability error:', error || data?.error);
                toast({
                    title: 'Availability Error',
                    description: 'Failed to load date availability. Please try again.',
                    variant: 'destructive',
                });
            }

            setAvailability((prev) => ({ ...prev, ...mergedAvailability }));
        } catch (err) {
            console.error('[RescheduleDateTimeSelector] Error fetching availability:', err);
            toast({
                title: 'Availability Error',
                description: 'Failed to load date availability.',
                variant: 'destructive',
            });
        } finally {
            setLoadingAvailability(false);
        }
    }, [serviceId, resolvedBookingId]);

    useEffect(() => {
        setAvailability({});
        fetchAvailability(visibleMonth);
    }, [fetchAvailability, visibleMonth]);

    useEffect(() => {
        if (loadingAvailability) return;

        if (newDropOffDate) {
            const dropStr = format(newDropOffDate, 'yyyy-MM-dd');
            if (availability[dropStr] && !availability[dropStr].available) {
                setNewDropOffDate(null);
                setNewDropOffTime(null);
                setNewPickupDate(null);
                setNewPickupTime(null);
                toast({
                    title: 'Date Unavailable',
                    description: 'Your selected start date is no longer available. Please choose another.',
                    variant: 'destructive',
                });
                return;
            }
        }

        if (newPickupDate) {
            const pickStr = format(newPickupDate, 'yyyy-MM-dd');
            if (availability[pickStr] && !availability[pickStr].available) {
                setNewPickupDate(null);
                setNewPickupTime(null);
                toast({
                    title: 'Date Unavailable',
                    description: 'Your selected end date is no longer available. Please choose another.',
                    variant: 'destructive',
                });
            }
        }
    }, [
        availability,
        loadingAvailability,
        newDropOffDate,
        newPickupDate,
        setNewDropOffDate,
        setNewPickupDate,
        setNewDropOffTime,
        setNewPickupTime,
    ]);

    const ensureSelectableSlot = (currentValue, slots, setValue) => {
        if (slots.length === 0) return;
        const stillValid = currentValue && slots.some((s) => s.value === currentValue);
        if (stillValid) return;
        const fallback = slots.find((s) => s.available !== false) ?? slots[0];
        setValue(fallback.value);
    };

    useEffect(() => {
        if (!newDropOffDate || !serviceId) return;

        const fetchTimeSlots = async () => {
            setFetchingTimes(true);
            try {
                const dropOffDateFormatted = format(newDropOffDate, 'yyyy-MM-dd');
                const pickupDateFormatted = newPickupDate ? format(newPickupDate, 'yyyy-MM-dd') : dropOffDateFormatted;
                const startDate = dropOffDateFormatted <= pickupDateFormatted ? dropOffDateFormatted : pickupDateFormatted;
                const endDate = dropOffDateFormatted <= pickupDateFormatted ? pickupDateFormatted : dropOffDateFormatted;

                const body = { serviceId, startDate, endDate };
                if (resolvedBookingId != null) {
                    body.excludeBookingId = Number(resolvedBookingId);
                }

                const { data, error } = await supabase.functions.invoke('get-availability', {
                    body,
                });

                if (error) throw error;
                if (data?.error) throw new Error(data.error);

                const availabilityByDate = data?.availability || {};
                const dropOffAvail = availabilityByDate[dropOffDateFormatted];
                const pickupAvail = availabilityByDate[pickupDateFormatted];

                const toWindowSlots = (rawSlots) =>
                    (rawSlots || []).map((slot) => ({
                        value: slot.end ? `${slot.value}|${slot.end}` : slot.value,
                        label: slot.label || slot.value,
                        available: slot.available !== false,
                    }));

                if (serviceId === 1 || serviceId === 4) {
                    const dropSlots = toWindowSlots(dropOffAvail?.deliverySlots);
                    setDropOffTimeSlots(dropSlots);
                    ensureSelectableSlot(newDropOffTime, dropSlots, setNewDropOffTime);

                    const pickSlots = toWindowSlots(pickupAvail?.pickupSlots);
                    setPickupTimeSlots(pickSlots);
                    ensureSelectableSlot(newPickupTime, pickSlots, setNewPickupTime);
                } else if (serviceId === 3) {
                    const dropSlots = toWindowSlots(dropOffAvail?.deliverySlots);
                    setDropOffTimeSlots(dropSlots);
                    ensureSelectableSlot(newDropOffTime, dropSlots, setNewDropOffTime);
                    setPickupTimeSlots([]);
                } else if (serviceId === 2 || serviceId === 5 || serviceId === 8) {
                    const dropSlot = (dropOffAvail?.pickupSlots || [])[0];
                    setDropOffTimeSlots(dropSlot ? [dropSlot] : []);
                    if (dropSlot) setNewDropOffTime(dropSlot.value);

                    if (newPickupDate) {
                        const pickSlot = (pickupAvail?.returnSlots || [])[0];
                        setPickupTimeSlots(pickSlot ? [pickSlot] : []);
                        if (pickSlot) setNewPickupTime(pickSlot.value);
                    } else {
                        setPickupTimeSlots([]);
                    }
                } else {
                    setDropOffTimeSlots([]);
                    setPickupTimeSlots([]);
                }
            } catch (error) {
                console.error("Error fetching time slots from get-availability:", error);
                setDropOffTimeSlots([]);
                setPickupTimeSlots([]);
            } finally {
                setFetchingTimes(false);
            }
        };

        fetchTimeSlots();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [newDropOffDate, newPickupDate, serviceId, resolvedBookingId, setNewDropOffTime, setNewPickupTime]);

    const isDateDisabled = useCallback((date) => {
        const day = startOfDay(date);
        const minBookable = startOfDay(addDays(new Date(), 1));
        if (isBefore(day, minBookable)) return true;
        const dateStr = format(day, 'yyyy-MM-dd');
        if (availability[dateStr]?.available === false) return true;
        // While loading or before a month is fetched, only past/today are blocked
        return false;
    }, [availability]);

    const handleRangeSelect = (rangeOrDate) => {
        if (serviceId === 3) {
            const date = rangeOrDate || null;
            if (date && isDateUnavailable(date, availability)) {
                toast({
                    title: 'Date Unavailable',
                    description: 'That date is not available. Please choose another.',
                    variant: 'destructive',
                });
                return;
            }
            setNewDropOffDate(date);
            setNewPickupDate(null);
            return;
        }

        const from = rangeOrDate?.from || null;
        const to = rangeOrDate?.to || null;

        if (from && isDateUnavailable(from, availability)) {
            toast({
                title: 'Date Unavailable',
                description: 'That start date is not available. Please choose another.',
                variant: 'destructive',
            });
            return;
        }
        if (to && isDateUnavailable(to, availability)) {
            toast({
                title: 'Date Unavailable',
                description: 'That end date is not available. Please choose another.',
                variant: 'destructive',
            });
            return;
        }
        if (from && to && rangeHasUnavailableDay(from, to, availability)) {
            toast({
                title: 'Date Range Unavailable',
                description: 'Your selected range includes a day that is fully booked or closed. Please choose different dates.',
                variant: 'destructive',
            });
            return;
        }

        setNewDropOffDate(from);
        setNewPickupDate(to);
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
    const numberOfMonths = typeof window !== 'undefined' && window.innerWidth >= 768 ? 2 : 1;

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

                        <div className="bg-gray-950 rounded-2xl border border-[hsl(var(--gold)_/_0.2)] p-4 shadow-inner inline-block w-full overflow-x-auto custom-calendar-wrapper relative min-h-[320px]">
                            {loadingAvailability && Object.keys(availability).length === 0 && (
                                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-gray-950/80 rounded-2xl">
                                    <Loader2 className="w-8 h-8 animate-spin text-gold mb-2" />
                                    <p className="text-gray-400 text-sm">Loading available dates...</p>
                                </div>
                            )}
                            <ShadCalendar
                                mode={serviceId === 3 ? "single" : "range"}
                                selected={serviceId === 3 ? newDropOffDate : { from: newDropOffDate, to: newPickupDate }}
                                onSelect={handleRangeSelect}
                                disabled={isDateDisabled}
                                numberOfMonths={numberOfMonths}
                                onMonthChange={(month) => setVisibleMonth(startOfMonth(month))}
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
                                                        <SelectItem key={`start-${idx}-${slot.value}`} value={slot.value} disabled={slot.available === false} className="focus:bg-gold/20 focus:text-gold py-3 cursor-pointer">
                                                            {slot.label}{slot.available === false ? ' (Full)' : ''}
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
                                                            <SelectItem key={`end-${idx}-${slot.value}`} value={slot.value} disabled={slot.available === false} className="focus:bg-gold/20 focus:text-gold py-3 cursor-pointer">
                                                                {slot.label}{slot.available === false ? ' (Full)' : ''}
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

/** Re-verify chosen dates against get-availability before advancing the wizard. */
export async function verifyRescheduleDatesAvailable({
    serviceId,
    bookingId,
    dropOffDate,
    pickupDate,
}) {
    if (!serviceId || !dropOffDate) {
        return { ok: false, message: 'Please select a start date.' };
    }

    const start = startOfDay(dropOffDate);
    const end = pickupDate ? startOfDay(pickupDate) : start;
    const startDate = formatISO(start, { representation: 'date' });
    const endDate = formatISO(end, { representation: 'date' });

    const body = { serviceId, startDate, endDate };
    if (bookingId != null) {
        body.excludeBookingId = Number(bookingId);
    }

    const { data, error } = await supabase.functions.invoke('get-availability', { body });
    if (error || data?.error) {
        return {
            ok: false,
            message: 'Could not verify date availability. Please try again.',
        };
    }

    const avail = data?.availability || {};
    const days = eachDayOfInterval({ start, end });
    for (const day of days) {
        const key = format(day, 'yyyy-MM-dd');
        if (avail[key]?.available === false) {
            return {
                ok: false,
                message: `${format(day, 'MMM d, yyyy')} is no longer available. Please choose different dates.`,
            };
        }
    }

    return { ok: true };
}
