import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from '@fullcalendar/interaction';
import { Loader2, Save, Ban, AlertTriangle, Truck, Sun, Cloud, CloudRain, Snowflake, ChevronDown, ChevronUp } from 'lucide-react';
import { format, startOfDay, formatISO, parseISO, isSameDay, isBefore, endOfToday, endOfMonth, isWithinInterval, startOfMonth, isValid } from 'date-fns';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { motion, AnimatePresence } from 'framer-motion';

const services = [
    { id: 1, name: "16yd Dumpster Rental" },
    { id: 2, name: "Dump Loader Trailer Rental Service" },
];

const WeatherIcon = ({ condition }) => {
    if (!condition) return null;
    const text = condition.toLowerCase();
    if (text.includes('snow') || text.includes('ice') || text.includes('blizzard')) return <Snowflake className="h-4 w-4 text-cyan-300" />;
    if (text.includes('rain') || text.includes('drizzle') || text.includes('shower')) return <CloudRain className="h-4 w-4 text-blue-300" />;
    if (text.includes('cloud') || text.includes('overcast')) return <Cloud className="h-4 w-4 text-gray-400" />;
    if (text.includes('sun') || text.includes('clear')) return <Sun className="h-4 w-4 text-yellow-300" />;
    return null;
};

const ServiceAvailabilityCard = ({ service, availability, onAvailabilityChange, onSaveChanges }) => {
    const daysOfWeek = useMemo(() => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], []);
    const [expandedDay, setExpandedDay] = useState(null);

    const toggleDay = (index) => {
        setExpandedDay(expandedDay === index ? null : index);
    };

    return (
        <div className="bg-white/5 p-6 rounded-2xl shadow-lg border border-white/10 h-full flex flex-col">
            <div className="flex items-center mb-4">
                <Truck className="h-6 w-6 text-yellow-400" />
                <h3 className="text-xl font-bold text-yellow-400 ml-3">{service.name}</h3>
            </div>
            <div className="flex-grow space-y-2 overflow-y-auto pr-2">
                {daysOfWeek.map((dayName, index) => {
                    const dayData = availability.find(d => d.service_id === service.id && d.day_of_week === index) || {
                        day_of_week: index, is_available: false, delivery_start_time: '08:00', delivery_end_time: '10:00',
                        pickup_start_time: '08:00', pickup_end_time: '10:00',
                    };
                    const isExpanded = expandedDay === index;

                    return (
                        <div key={index} className="bg-white/10 p-3 rounded-md transition-all duration-300">
                            <div className="flex items-center justify-between cursor-pointer" onClick={() => toggleDay(index)}>
                                <Label className="text-lg font-semibold">{dayName}</Label>
                                <div className="flex items-center gap-4">
                                    <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                                        <Switch id={`available-${service.id}-${index}`} checked={dayData.is_available} onCheckedChange={(c) => onAvailabilityChange(service.id, index, 'is_available', c)} />
                                        <Label htmlFor={`available-${service.id}-${index}`}>{dayData.is_available ? "Open" : "Closed"}</Label>
                                    </div>
                                    {isExpanded ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
                                </div>
                            </div>
                            <AnimatePresence>
                            {isExpanded && dayData.is_available && (
                                <motion.div
                                    initial={{ opacity: 0, height: 0 }}
                                    animate={{ opacity: 1, height: 'auto' }}
                                    exit={{ opacity: 0, height: 0 }}
                                    transition={{ duration: 0.3 }}
                                    className="overflow-hidden"
                                >
                                    <div className="mt-4 pt-4 border-t border-white/20 space-y-3 text-sm">
                                        <p className="font-semibold text-blue-200">Delivery/Pickup Window</p>
                                        <div className="grid grid-cols-2 gap-2">
                                            <Input type="time" value={dayData.delivery_start_time || ''} onChange={e => onAvailabilityChange(service.id, index, 'delivery_start_time', e.target.value)} className="bg-white/20"/>
                                            <Input type="time" value={dayData.delivery_end_time || ''} onChange={e => onAvailabilityChange(service.id, index, 'delivery_end_time', e.target.value)} className="bg-white/20"/>
                                        </div>
                                        <div className="text-right mt-2">
                                            <Button onClick={() => onSaveChanges(dayData)} size="sm"><Save className="mr-2 h-4 w-4" /> Save Changes</Button>
                                        </div>
                                    </div>
                                </motion.div>
                            )}
                            </AnimatePresence>
                        </div>
                    )
                })}
            </div>
        </div>
    );
};

export const AvailabilityManager = () => {
    const [availability, setAvailability] = useState([]);
    const [bookings, setBookings] = useState([]);
    const [weather, setWeather] = useState({});
    const [loading, setLoading] = useState(true);
    const [unavailableDates, setUnavailableDates] = useState([]);
    const [showDateModal, setShowDateModal] = useState(false);
    const [selectedDateInfo, setSelectedDateInfo] = useState(null);
    const [viewDate, setViewDate] = useState(new Date());
    const navigate = useNavigate();

    const fetchInitialData = useCallback(async (date) => {
        setLoading(true);
        try {
            const monthStart = startOfMonth(date);
            const monthEnd = endOfMonth(date);
            const monthStartISO = formatISO(monthStart, { representation: 'date' });
            const monthEndISO = formatISO(monthEnd, { representation: 'date' });

            const [availRes, unavailRes, weatherRes, bookingRes] = await Promise.all([
                supabase.from('service_availability').select('*').order('service_id, day_of_week'),
                supabase.from('unavailable_dates').select('*'),
                supabase.functions.invoke('get-weather', { body: { startDate: monthStartISO, endDate: monthEndISO } }),
                supabase
                    .from('bookings')
                    .select('*, customers!inner(name)')
                    .gte('drop_off_date', monthStartISO)
                    .lte('drop_off_date', monthEndISO)
            ]);

            if (availRes.error) throw new Error(`Service Availability: ${availRes.error.message}`);
            setAvailability(availRes.data || []);

            if (unavailRes.error) throw new Error(`Unavailable Dates: ${unavailRes.error.message}`);
            setUnavailableDates(unavailRes.data || []);
            
            if (weatherRes.data) setWeather(prev => ({...prev, ...weatherRes.data.forecast}));
            
            if (bookingRes.error) throw new Error(`Bookings: ${bookingRes.error.message}`);
            setBookings(bookingRes.data || []);

        } catch (error) {
            toast({ title: 'Error fetching data', description: error.message, variant: 'destructive' });
            setAvailability([]);
            setBookings([]);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchInitialData(viewDate);
    }, [fetchInitialData, viewDate]);
    
    const handleMonthChange = (info) => {
        const newDate = info.view.currentStart;
        if (!isSameDay(newDate, viewDate)) {
            setViewDate(newDate);
        }
    };

    const handleAvailabilityChange = (serviceId, dayOfWeek, field, value) => {
        setAvailability(prev => {
            const exists = prev.some(d => d.service_id === serviceId && d.day_of_week === dayOfWeek);
            if (exists) {
                return prev.map(day => (day.service_id === serviceId && day.day_of_week === dayOfWeek) ? { ...day, [field]: value } : day);
            }
            const newDay = { service_id: serviceId, day_of_week: dayOfWeek, is_available: false, delivery_start_time: '08:00', delivery_end_time: '10:00', pickup_start_time: '08:00', pickup_end_time: '10:00', [field]: value };
            return [...prev, newDay];
        });
    };

    const handleSaveChanges = async (day) => {
        const { error } = await supabase.from('service_availability').upsert({
            service_id: day.service_id, day_of_week: day.day_of_week, is_available: day.is_available,
            delivery_start_time: day.delivery_start_time, delivery_end_time: day.delivery_end_time,
            pickup_start_time: day.pickup_start_time, pickup_end_time: day.pickup_end_time,
            updated_at: new Date().toISOString()
        }, { onConflict: 'service_id, day_of_week' });

        if (error) toast({ title: `Failed to update settings`, description: error.message, variant: 'destructive' });
        else {
            toast({ title: `Settings updated successfully` });
            fetchInitialData(viewDate);
        }
    };
    
    const calendarEvents = useMemo(() => {
        const unavailEvents = unavailableDates.map(d => ({
            id: `unavail-${d.id}`, title: d.service_id ? `Blocked: ${services.find(s => s.id === d.service_id)?.name}` : 'Blocked: All Services',
            start: d.date, allDay: true, backgroundColor: '#ef4444', borderColor: '#ef4444', classNames: ['cursor-pointer']
        }));

        const getEventColor = (status) => {
            if (status === 'pending_payment') return '#ef4444'; // Red
            if (status === 'Confirmed') return '#facc15'; // Yellow
            if (status === 'Completed') return '#22c55e'; // Green
            if (status === 'flagged') return '#f97316'; // Orange
            return '#3b82f6'; // Blue for others like 'Delivered'
        };

        const bookingEvents = bookings.map(booking => ({
            id: booking.id, title: `${booking.customers.name}`, start: parseISO(booking.drop_off_date), end: endOfToday(parseISO(booking.pickup_date)),
            allDay: true, backgroundColor: getEventColor(booking.status), borderColor: getEventColor(booking.status),
            extendedProps: { customerId: booking.customer_id, type: 'booking' }
        }));

        return [...unavailEvents, ...bookingEvents];
    }, [unavailableDates, bookings]);

    const handleDateClick = (arg) => {
        const clickedDate = startOfDay(arg.date);
        if (isBefore(clickedDate, startOfDay(new Date()))) {
            toast({ title: "Past Date", description: "Cannot change availability for past dates.", variant: 'destructive' });
            return;
        }
        const existingGlobalUnavailable = unavailableDates.find(d => isSameDay(parseISO(d.date), clickedDate) && !d.service_id);
        setSelectedDateInfo({ date: clickedDate, isUnavailable: !!existingGlobalUnavailable, id: existingGlobalUnavailable?.id });
        setShowDateModal(true);
    };

    const handleEventClick = (clickInfo) => {
        if (clickInfo.event.extendedProps.type === 'booking') {
            navigate(`/admin/customer/${clickInfo.event.extendedProps.customerId}`);
        } else {
            handleDateClick(clickInfo.event);
        }
    };

    const handleToggleDateAvailability = async () => {
        if (!selectedDateInfo) return;
        if (selectedDateInfo.isUnavailable) {
            const { error } = await supabase.from('unavailable_dates').delete().match({ id: selectedDateInfo.id });
            if (error) toast({ title: 'Failed to make date available', description: error.message, variant: 'destructive' });
            else toast({ title: 'Date is now available for all services' });
        } else {
            const formattedDate = formatISO(selectedDateInfo.date, { representation: 'date' });
            const { error } = await supabase.from('unavailable_dates').insert({ date: formattedDate, service_id: null });
            if (error) toast({ title: 'Failed to mark date as unavailable', description: error.message, variant: 'destructive' });
            else toast({ title: 'Date marked as unavailable for all services' });
        }
        setShowDateModal(false);
        setSelectedDateInfo(null);
        fetchInitialData(viewDate);
    };

    const renderDayCellContent = (dayRenderInfo) => {
        const dateStr = format(dayRenderInfo.date, 'yyyy-MM-dd');
        const dayEvents = calendarEvents.filter(event => {
            const eventStartRaw = parseISO(event.start);
            if (!isValid(eventStartRaw)) return false;
            const eventStart = startOfDay(eventStartRaw);
            const eventEnd = event.end ? endOfToday(parseISO(event.end)) : eventStart;
            if (!isValid(eventEnd)) return false;
            return isWithinInterval(dayRenderInfo.date, { start: eventStart, end: eventEnd });
        }).sort((a, b) => a.title.localeCompare(b.title));

        return (
            <Popover>
                <PopoverTrigger asChild>
                    <div className="fc-daygrid-day-frame-custom">
                        <div className="fc-daygrid-day-top-custom">
                            <WeatherIcon condition={weather[dateStr]} />
                            <div className="fc-daygrid-day-number-custom">{dayRenderInfo.dayNumberText}</div>
                        </div>
                        <div className="fc-daygrid-day-events-custom">
                            {dayEvents.slice(0, 2).map(event => (
                                <div key={event.id} className="fc-event-custom" style={{ backgroundColor: event.backgroundColor }}>
                                    {event.title}
                                </div>
                            ))}
                            {dayEvents.length > 2 && (
                                <div className="fc-event-more-custom">+ {dayEvents.length - 2} more</div>
                            )}
                        </div>
                    </div>
                </PopoverTrigger>
                {dayEvents.length > 0 && (
                    <PopoverContent className="w-80 bg-gray-800 border-yellow-400 text-white">
                        <div className="font-bold text-lg mb-2">{format(dayRenderInfo.date, 'PPP')}</div>
                        <div className="space-y-2 max-h-60 overflow-y-auto">
                            {dayEvents.map(event => (
                                <div key={event.id} className="p-2 rounded-md" style={{ backgroundColor: event.backgroundColor }}>
                                    {event.title}
                                </div>
                            ))}
                        </div>
                    </PopoverContent>
                )}
            </Popover>
        );
    };

    if (loading) return <div className="flex justify-center items-center h-64"><Loader2 className="h-16 w-16 animate-spin text-yellow-400" /></div>;
    
    if (!loading && !availability.length) {
        return (
            <div className="flex flex-col items-center justify-center h-64 bg-red-900/20 text-red-300 rounded-lg p-4">
                <AlertTriangle className="h-16 w-16 mb-4" />
                <h2 className="text-2xl font-bold">Failed to Load Availability Data</h2>
                <p>Could not connect to the database. Please check your connection and refresh.</p>
            </div>
        );
    }

    return (
        <>
        <Dialog open={showDateModal} onOpenChange={setShowDateModal}>
            <DialogContent className="bg-gray-900 text-white border-yellow-400">
                <DialogHeader><DialogTitle>Manage Global Availability for {selectedDateInfo?.date ? format(selectedDateInfo.date, 'PPP') : ''}</DialogTitle></DialogHeader>
                <div className="py-4">
                    <p className="mb-4">This will mark the selected date as available or unavailable for <strong className="text-yellow-400">ALL</strong> services.</p>
                     <Button onClick={handleToggleDateAvailability} className={`w-full ${selectedDateInfo?.isUnavailable ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'}`}>
                        <Ban className="mr-2 h-4 w-4" />
                        {selectedDateInfo?.isUnavailable ? "Make Globally Available" : "Make Globally Unavailable"}
                    </Button>
                </div>
                <DialogFooter><DialogClose asChild><Button variant="ghost">Cancel</Button></DialogClose></DialogFooter>
            </DialogContent>
        </Dialog>

        <div className="space-y-8">
            <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 shadow-2xl border border-white/20 calendar-container">
                <div className="flex flex-wrap gap-4 justify-between items-center mb-4">
                    <h2 className="text-2xl font-bold">Booking & Availability Calendar</h2>
                    <div className="flex items-center gap-2 text-sm text-yellow-300 bg-yellow-500/10 p-2 rounded-md">
                       <p>Click a date to block it out, or click a booking to view details.</p>
                    </div>
                </div>
                 <FullCalendar
                    key={viewDate.toISOString()}
                    plugins={[dayGridPlugin, interactionPlugin]}
                    initialView="dayGridMonth"
                    initialDate={viewDate}
                    dateClick={handleDateClick}
                    eventClick={handleEventClick}
                    events={calendarEvents}
                    headerToolbar={{ left: 'prev,next today', center: 'title', right: 'dayGridMonth' }}
                    height="auto"
                    validRange={{ start: formatISO(new Date(), { representation: 'date' }) }}
                    eventDisplay="block"
                    datesSet={handleMonthChange}
                    dayCellContent={renderDayCellContent}
                    eventContent={() => null}
                />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {services.map(service => (
                    <ServiceAvailabilityCard key={service.id} service={service} availability={availability} onAvailabilityChange={handleAvailabilityChange} onSaveChanges={handleSaveChanges} />
                ))}
            </div>
        </div>
        </>
    );
};