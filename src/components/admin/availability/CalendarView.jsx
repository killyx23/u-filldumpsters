
import React, { useMemo } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from '@fullcalendar/interaction';
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format, parseISO, isWithinInterval, endOfToday, startOfToday, formatISO } from 'date-fns';
import { Sun, Cloud, CloudRain, Snowflake } from 'lucide-react';

const WeatherIcon = ({ condition }) => {
    if (!condition) return null;
    const text = condition.toLowerCase();
    if (text.includes('snow') || text.includes('ice') || text.includes('blizzard')) return <Snowflake className="h-4 w-4 text-cyan-300" />;
    if (text.includes('rain') || text.includes('drizzle') || text.includes('shower')) return <CloudRain className="h-4 w-4 text-blue-300" />;
    if (text.includes('cloud') || text.includes('overcast')) return <Cloud className="h-4 w-4 text-gray-400" />;
    if (text.includes('sun') || text.includes('clear')) return <Sun className="h-4 w-4 text-yellow-300" />;
    return null;
};

const getEventColor = (status) => {
    if (status === 'pending_payment') return '#ef4444'; // Red
    if (status === 'Confirmed') return '#facc15'; // Yellow
    if (status === 'Completed') return '#22c55e'; // Green
    if (status === 'flagged') return '#f97316'; // Orange
    return '#3b82f6'; // Blue for others like 'Delivered'
};

export const CalendarView = ({ services, bookings, unavailableDates, weather, viewDate, onDateClick, onEventClick, onMonthChange }) => {
    const calendarEvents = useMemo(() => {
        const unavailEvents = unavailableDates.map(d => ({
            id: `unavail-${d.id}`,
            title: d.service_id ? `Blocked: ${services.find(s => s.id === d.service_id)?.name || 'Unknown'}` : 'Blocked: All Services',
            start: d.date,
            allDay: true,
            backgroundColor: '#ef4444',
            borderColor: '#ef4444',
            classNames: ['cursor-pointer']
        }));

        const bookingEvents = bookings.map(booking => ({
            id: booking.id,
            title: `${booking.customers.name}`,
            start: parseISO(booking.drop_off_date),
            end: endOfToday(parseISO(booking.pickup_date)),
            allDay: true,
            backgroundColor: getEventColor(booking.status),
            borderColor: getEventColor(booking.status),
            extendedProps: { customerId: booking.customer_id, type: 'booking' }
        }));

        return [...unavailEvents, ...bookingEvents];
    }, [unavailableDates, bookings, services]);

    const renderDayCellContent = (dayRenderInfo) => {
        const dateStr = format(dayRenderInfo.date, 'yyyy-MM-dd');
        const dayEvents = calendarEvents.filter(event => {
            const eventStart = startOfToday(parseISO(event.start));
            const eventEnd = event.end ? endOfToday(parseISO(event.end)) : eventStart;
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
                            {dayEvents.length > 2 && <div className="fc-event-more-custom">+ {dayEvents.length - 2} more</div>}
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

    return (
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
                dateClick={onDateClick}
                eventClick={onEventClick}
                events={calendarEvents}
                headerToolbar={{ left: 'prev,next today', center: 'title', right: 'dayGridMonth' }}
                height="auto"
                validRange={{ start: formatISO(new Date(), { representation: 'date' }) }}
                eventDisplay="block"
                datesSet={onMonthChange}
                dayCellContent={renderDayCellContent}
                eventContent={() => null}
            />
        </div>
    );
};
