
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';
import { Loader2, Truck, ArrowUpCircle, User, Sun, Cloud, CloudRain, Snowflake } from 'lucide-react';
import { isToday, parseISO, startOfToday, isWithinInterval, endOfToday, format, formatISO, endOfMonth, startOfMonth } from 'date-fns';
import { StatusBadge } from '@/components/admin/StatusBadge';
import { ActionItemsManager } from '@/components/admin/ActionItemsManager';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from '@fullcalendar/interaction';
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const DailyTaskCard = ({ title, icon, bookings, onBookingClick }) => (
    <div className="bg-white/5 p-6 rounded-lg shadow-lg">
        <div className="flex items-center mb-4">
            {icon}
            <h3 className="text-xl font-bold text-yellow-400 ml-3">{title}</h3>
        </div>
        <div className="space-y-3 max-h-60 overflow-y-auto">
            {bookings.length > 0 ? bookings.map(booking => (
                <div key={booking.id} onClick={() => onBookingClick(booking)} className="bg-white/10 p-3 rounded-md cursor-pointer hover:bg-white/20 transition-colors">
                    <div className="flex justify-between items-center">
                        <div className="flex items-center">
                            <User className="h-4 w-4 mr-2 text-blue-300" />
                            <p className="font-bold text-white truncate">{booking.customers.name}</p>
                        </div>
                        <StatusBadge status={booking.status} />
                    </div>
                    <p className="text-xs text-gray-400 mt-1">{booking.plan.name}</p>
                </div>
            )) : (
                <p className="text-center text-blue-200 py-4">No {title.toLowerCase()} for today.</p>
            )}
        </div>
    </div>
);

const WeatherIcon = ({ condition }) => {
    if (!condition) return null;
    const text = condition.toLowerCase();
    if (text.includes('snow') || text.includes('ice') || text.includes('blizzard')) return <Snowflake className="h-4 w-4 text-cyan-300" />;
    if (text.includes('rain') || text.includes('drizzle') || text.includes('shower')) return <CloudRain className="h-4 w-4 text-blue-300" />;
    if (text.includes('cloud') || text.includes('overcast')) return <Cloud className="h-4 w-4 text-gray-400" />;
    if (text.includes('sun') || text.includes('clear')) return <Sun className="h-4 w-4 text-yellow-300" />;
    return null;
};

export const BookingsManager = () => {
    const [bookings, setBookings] = useState([]);
    const [weather, setWeather] = useState({});
    const [loading, setLoading] = useState(true);
    const [currentCalendarDate, setCurrentCalendarDate] = useState(new Date());
    const navigate = useNavigate();

    const fetchBookingData = useCallback(async (date) => {
        setLoading(true);
        try {
            const monthStart = startOfMonth(date);
            const monthEnd = endOfMonth(date);

            const [bookingRes, weatherRes] = await Promise.all([
                 supabase.from('bookings').select('*, customers!inner(*)').order('drop_off_date', { ascending: true }),
                 supabase.functions.invoke('get-weather', { body: { startDate: formatISO(monthStart, { representation: 'date' }), endDate: formatISO(monthEnd, { representation: 'date' }) }})
            ]);

            if (bookingRes.error) throw bookingRes.error;
            setBookings(bookingRes.data || []);
            
            if (weatherRes.data) setWeather(prev => ({...prev, ...weatherRes.data.forecast}));
        } catch (error) {
            toast({ title: 'Error fetching bookings', description: error.message, variant: 'destructive' });
            setBookings([]);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchBookingData(currentCalendarDate);
    }, [fetchBookingData, currentCalendarDate]);

    const handleMonthChange = (info) => {
        setCurrentCalendarDate(info.start);
    };

    const { todaysDeliveries, todaysPickups, activeDumpLoaders, calendarEvents } = useMemo(() => {
        const today = startOfToday();
        
        const paidAndConfirmed = ['Confirmed', 'Delivered', 'flagged', 'waiting_to_be_returned'];
        
        const todaysDeliveries = bookings.filter(b => 
            b.plan.id !== 2 && isToday(parseISO(b.drop_off_date)) && paidAndConfirmed.includes(b.status)
        );
        const todaysPickups = bookings.filter(b => 
            b.plan.id !== 2 && isToday(parseISO(b.pickup_date)) && b.status === 'Delivered'
        );
        
        const activeDumpLoaders = bookings.filter(b => {
             if (b.plan.id !== 2) return false;
             const startDate = parseISO(b.drop_off_date);
             const endDate = parseISO(b.pickup_date);
             return isWithinInterval(today, { start: startDate, end: endDate }) && paidAndConfirmed.includes(b.status) && b.status !== 'Completed';
        });
        
        const getEventColor = (status) => {
            if (status === 'pending_payment') return '#ef4444'; // Red
            if (status === 'Confirmed') return '#facc15'; // Yellow
            if (status === 'Completed') return '#22c55e'; // Green
            if (status === 'flagged') return '#f97316'; // Orange
            if (status === 'waiting_to_be_returned') return '#a855f7'; // Purple
            return '#3b82f6'; // Blue for others like 'Delivered'
        };

        const calendarEvents = bookings.map(booking => ({
            id: booking.id,
            title: `${booking.customers.name}`,
            start: parseISO(booking.drop_off_date),
            end: endOfToday(parseISO(booking.pickup_date)),
            allDay: true,
            backgroundColor: getEventColor(booking.status),
            borderColor: getEventColor(booking.status),
            extendedProps: {
                customerId: booking.customer_id
            }
        }));

        return { todaysDeliveries, todaysPickups, activeDumpLoaders, calendarEvents };
    }, [bookings]);

    const handleBookingClick = (booking) => {
        navigate(`/admin/customer/${booking.customer_id}`);
    };
    
    const handleEventClick = (clickInfo) => {
        navigate(`/admin/customer/${clickInfo.event.extendedProps.customerId}`);
    };

    const renderDayCellContent = (dayRenderInfo) => {
        const dateStr = format(dayRenderInfo.date, 'yyyy-MM-dd');
        const dayEvents = calendarEvents.filter(event => {
            const eventStart = startOfToday(event.start);
            const eventEnd = event.end ? endOfToday(event.end) : eventStart;
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

    if (loading) {
        return <div className="flex justify-center items-center h-64"><Loader2 className="h-16 w-16 animate-spin text-yellow-400" /></div>;
    }

    return (
        <div className="space-y-8">
            <ActionItemsManager bookings={bookings} />
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <DailyTaskCard title="Today's Deliveries" icon={<Truck className="h-6 w-6 text-yellow-400" />} bookings={todaysDeliveries} onBookingClick={handleBookingClick} />
                <DailyTaskCard title="Today's Pickups" icon={<ArrowUpCircle className="h-6 w-6 text-yellow-400" />} bookings={todaysPickups} onBookingClick={handleBookingClick} />
                <DailyTaskCard title="Active Dump Loaders" icon={<Truck className="h-6 w-6 text-yellow-400" />} bookings={activeDumpLoaders} onBookingClick={handleBookingClick} />
            </div>
            <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 shadow-2xl border border-white/20 calendar-container">
                <h2 className="text-2xl font-bold mb-4">Monthly Booking Calendar</h2>
                <FullCalendar
                    plugins={[dayGridPlugin, interactionPlugin]}
                    initialView="dayGridMonth"
                    events={calendarEvents}
                    eventClick={handleEventClick}
                    headerToolbar={{
                        left: 'prev,next today',
                        center: 'title',
                        right: 'dayGridMonth'
                    }}
                    height="auto"
                    datesSet={handleMonthChange}
                    dayCellContent={renderDayCellContent}
                    eventContent={() => null}
                />
            </div>
        </div>
    );
};
  