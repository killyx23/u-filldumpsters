import React, { useState, useEffect, useCallback, useMemo } from 'react';
    import { useNavigate } from 'react-router-dom';
    import { supabase } from '@/lib/customSupabaseClient';
    import { toast } from '@/components/ui/use-toast';
    import { Loader2, Truck, ArrowUpCircle, User, Sun, Cloud, CloudRain, Snowflake, Bell } from 'lucide-react';
    import { isToday, parseISO, startOfToday, isWithinInterval, endOfToday, format, formatISO, endOfMonth, startOfMonth, isSameDay } from 'date-fns';
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
                        <p className="text-xs text-gray-400 mt-1">{booking.plan.name}{booking.addons.isDelivery ? ' (Delivery)' : ''}</p>
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
        const [viewDate, setViewDate] = useState(new Date());
        const navigate = useNavigate();
    
        const fetchBookingData = useCallback(async (date, isInitialLoad = true) => {
            if (isInitialLoad) setLoading(true);
            try {
                const monthStart = startOfMonth(date);
                const monthEnd = endOfMonth(date);
                const monthStartISO = formatISO(monthStart, { representation: 'date' });
                const monthEndISO = formatISO(monthEnd, { representation: 'date' });
    
                const [bookingRes, weatherRes] = await Promise.all([
                    supabase
                        .from('bookings')
                        .select('*, customers!inner(*)')
                        .gte('drop_off_date', monthStartISO)
                        .lte('drop_off_date', monthEndISO)
                        .order('drop_off_date', { ascending: true }),
                    supabase.functions.invoke('get-weather', { body: { startDate: monthStartISO, endDate: monthEndISO } })
                ]);
    
                if (bookingRes.error) throw bookingRes.error;
                setBookings(bookingRes.data || []);
                
                if (weatherRes.data) setWeather(prev => ({...prev, ...weatherRes.data.forecast}));
            } catch (error) {
                toast({ title: 'Error fetching bookings', description: error.message, variant: 'destructive' });
                setBookings([]);
            } finally {
                if (isInitialLoad) setLoading(false);
            }
        }, []);
    
        useEffect(() => {
            fetchBookingData(viewDate);
        }, [fetchBookingData, viewDate]);

        useEffect(() => {
            const channel = supabase.channel('public:bookings')
                .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, 
                (payload) => {
                    if (payload.eventType === 'INSERT') {
                        const newBooking = payload.new;
                        supabase.from('customers').select('*').eq('id', newBooking.customer_id).single().then(({data: customer}) => {
                            if(customer) {
                                setBookings(current => [...current, {...newBooking, customers: customer}]);
                                toast({ title: "New Booking Created!", description: `A new booking for ${customer.name} has been added.` });
                            }
                        });
                    } else if (payload.eventType === 'UPDATE') {
                        const updatedBooking = payload.new;
                        let customerName = 'a customer';
                        const existingBooking = bookings.find(b => b.id === updatedBooking.id);
                        if (existingBooking && existingBooking.customers) {
                            customerName = existingBooking.customers.name;
                        }

                        setBookings(current => current.map(b => b.id === updatedBooking.id ? {...b, ...updatedBooking, customers: b.customers} : b));
                        
                        if (payload.old.status !== 'pending_review' && updatedBooking.status === 'pending_review') {
                             toast({
                                title: "Action Required",
                                description: `A change request has been submitted by ${customerName} for booking #${updatedBooking.id}.`,
                                action: <Bell className="h-5 w-5 text-yellow-400" />,
                            });
                        }
                    } else if (payload.eventType === 'DELETE') {
                        setBookings(current => current.filter(b => b.id !== payload.old.id));
                    }
                })
                .subscribe();
    
            return () => {
                supabase.removeChannel(channel);
            };
        }, [bookings]);
    
        const handleMonthChange = (info) => {
            const newDate = info.view.currentStart;
            if (!isSameDay(startOfMonth(newDate), startOfMonth(viewDate))) {
                setViewDate(newDate);
            }
        };
    
        const { todaysDeliveries, todaysPickups, activeDumpLoaders, calendarEvents } = useMemo(() => {
            const today = startOfToday();
            
            const paidAndConfirmed = ['Confirmed', 'Delivered', 'flagged', 'waiting_to_be_returned'];
            
            const todaysDeliveries = bookings.filter(b => {
                const isTrailerDelivery = b.plan.id === 2 && b.addons?.isDelivery;
                return (b.plan.id === 1 || isTrailerDelivery) && isToday(parseISO(b.drop_off_date)) && paidAndConfirmed.includes(b.status);
            });
    
            const todaysPickups = bookings.filter(b => {
                const isTrailerDelivery = b.plan.id === 2 && b.addons?.isDelivery;
                return (b.plan.id === 1 || isTrailerDelivery) && isToday(parseISO(b.pickup_date)) && b.status === 'Delivered';
            });
            
            const activeDumpLoaders = bookings.filter(b => {
                 if (b.plan.id !== 2 || b.addons?.isDelivery) return false;
                 const startDate = parseISO(b.drop_off_date);
                 const endDate = parseISO(b.pickup_date);
                 return isWithinInterval(today, { start: startDate, end: endDate }) && paidAndConfirmed.includes(b.status) && b.status !== 'Completed';
            });
            
            const getEventColor = (booking) => {
                const { status, plan, addons } = booking;
                if (status === 'pending_payment') return '#ef4444'; // Red
                if (status === 'pending_review') return '#ef4444'; // Red
                if (status === 'pending_verification') return '#f97316'; // Orange
                if (status === 'Confirmed') {
                    if (plan.id === 2 && addons?.isDelivery) return '#6d28d9'; // Dark Purple for trailer delivery
                    return '#facc15'; // Yellow
                }
                if (status === 'Completed') return '#22c55e'; // Green
                if (status === 'flagged') return '#f97316'; // Orange
                if (status === 'waiting_to_be_returned') return '#a855f7'; // Purple
                if (status === 'Delivered') return '#3b82f6'; // Blue
    
                return '#3b82f6'; // Default Blue
            };
    
            const calendarEvents = bookings.map(booking => ({
                id: booking.id,
                title: `${booking.customers.name}`,
                start: parseISO(booking.drop_off_date),
                end: endOfToday(parseISO(booking.pickup_date)),
                allDay: true,
                backgroundColor: getEventColor(booking),
                borderColor: getEventColor(booking),
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
                    <DailyTaskCard title="Active Self-Service Loaders" icon={<Truck className="h-6 w-6 text-yellow-400" />} bookings={activeDumpLoaders} onBookingClick={handleBookingClick} />
                </div>
                <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 shadow-2xl border border-white/20 calendar-container">
                    <h2 className="text-2xl font-bold mb-4">Monthly Booking Calendar</h2>
                    <FullCalendar
                        plugins={[dayGridPlugin, interactionPlugin]}
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