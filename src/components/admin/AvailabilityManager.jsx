import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Ban } from 'lucide-react';
import { formatISO, isSameDay, isBefore, startOfDay, startOfMonth, endOfMonth, parseISO } from 'date-fns';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { ServiceAvailabilityCard } from './availability/ServiceAvailabilityCard';
import { CalendarView } from './availability/CalendarView';

export const AvailabilityManager = () => {
    const [services, setServices] = useState([]);
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

            const [servicesRes, availRes, unavailRes, weatherRes, bookingRes] = await Promise.all([
                supabase.from('services').select('*').order('id'),
                supabase.from('service_availability').select('*').order('service_id, day_of_week'),
                supabase.from('unavailable_dates').select('*'),
                supabase.functions.invoke('get-weather', { body: { startDate: monthStartISO, endDate: monthEndISO } }),
                supabase.from('bookings').select('*, customers!inner(name)').gte('drop_off_date', monthStartISO).lte('drop_off_date', monthEndISO)
            ]);

            if (servicesRes.error) throw new Error(`Services: ${servicesRes.error.message}`);
            setServices(servicesRes.data || []);

            if (availRes.error) throw new Error(`Service Availability: ${availRes.error.message}`);
            setAvailability(availRes.data || []);

            if (unavailRes.error) throw new Error(`Unavailable Dates: ${unavailRes.error.message}`);
            setUnavailableDates(unavailRes.data || []);
            
            if (weatherRes.data) setWeather(prev => ({...prev, ...weatherRes.data.forecast}));
            
            if (bookingRes.error) throw new Error(`Bookings: ${bookingRes.error.message}`);
            setBookings(bookingRes.data || []);

        } catch (error) {
            toast({ title: 'Error fetching data', description: error.message, variant: 'destructive' });
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchInitialData(viewDate);
    }, [fetchInitialData, viewDate]);
    
    const handleMonthChange = (info) => {
        const newDate = info.view.currentStart;
        if (!isSameDay(startOfMonth(newDate), startOfMonth(viewDate))) {
            setViewDate(newDate);
        }
    };
    
    const handleSaveChanges = async (payload) => {
        const finalPayload = {
            ...payload,
            updated_at: new Date().toISOString()
        };

        const { error } = await supabase.from('service_availability').upsert(finalPayload, { onConflict: 'service_id, day_of_week' });

        if (error) {
            toast({ title: `Failed to update settings`, description: error.message, variant: 'destructive' });
        } else {
            toast({ title: `Settings updated successfully` });
            await fetchInitialData(viewDate);
        }
    };

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
            const { error } = await supabase.from('unavailable_dates').insert({ date: formattedDate, service_id: null, reason: 'Admin block out' });
            if (error) toast({ title: 'Failed to mark date as unavailable', description: error.message, variant: 'destructive' });
            else toast({ title: 'Date marked as unavailable for all services' });
        }
        setShowDateModal(false);
        setSelectedDateInfo(null);
        fetchInitialData(viewDate);
    };

    if (loading) return <div className="flex justify-center items-center h-64"><Loader2 className="h-16 w-16 animate-spin text-yellow-400" /></div>;

    return (
        <>
            <Dialog open={showDateModal} onOpenChange={setShowDateModal}>
                <DialogContent className="bg-gray-900 text-white border-yellow-400">
                    <DialogHeader><DialogTitle>Manage Global Availability</DialogTitle></DialogHeader>
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
                <CalendarView
                    bookings={bookings}
                    unavailableDates={unavailableDates}
                    weather={weather}
                    viewDate={viewDate}
                    onDateClick={handleDateClick}
                    onEventClick={handleEventClick}
                    onMonthChange={handleMonthChange}
                    services={services}
                />
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {services.map(service => (
                        <ServiceAvailabilityCard
                            key={service.id}
                            service={service}
                            availability={availability.filter(a => a.service_id === service.id)}
                            onSaveChanges={handleSaveChanges}
                        />
                    ))}
                </div>
            </div>
        </>
    );
};