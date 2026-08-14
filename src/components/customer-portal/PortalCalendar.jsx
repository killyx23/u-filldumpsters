import React from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import { parseISO } from 'date-fns';
import { parseBookingTimeSlot, parseClockTime } from '@/utils/parseBookingTimeSlot';
import { formatCustomerFacingPlanName } from '@/utils/displayPlanName';

/**
 * Build the event instant for one end of a booking.
 *
 * This used to concatenate the raw slot text onto the date, which only produced a valid
 * timestamp for slots stored as 'HH:mm:ss'. The 12-hour form ('6:00 AM') and both pipe window
 * forms ('06:00:00|08:00:00') yielded Invalid Date, so most bookings failed to place on the
 * calendar at all. The typed window columns are used when present.
 */
const eventInstant = (dateIso, typedTime, textSlot, fallbackHour) => {
  if (!dateIso) return null;

  const time =
    parseClockTime(typedTime) ??
    parseBookingTimeSlot(textSlot, 0)?.start ??
    { hour: fallbackHour, minute: 0, second: 0 };

  const pad = (n) => String(n).padStart(2, '0');
  return parseISO(`${dateIso}T${pad(time.hour)}:${pad(time.minute)}:${pad(time.second)}`);
};

export const PortalCalendar = ({ bookings }) => {
  const events = bookings.map(booking => {
    const isDelivery = booking.addons?.isDelivery;
    const serviceName = (formatCustomerFacingPlanName(booking.plan?.name) || 'Service') + (isDelivery ? ' with Delivery' : '');
    const serviceType = booking.plan?.id;

    let bgColor = '#3b82f6'; // Scheduled (blue)
    if (booking.pending_address_verification || ['pending_verification', 'pending_review'].includes(booking.status)) bgColor = '#f59e0b'; // Pending (orange)
    if (['Delivered', 'waiting_to_be_returned', 'in_transit'].includes(booking.status)) bgColor = '#10b981'; // Active/Delivered (green)
    if (booking.status === 'Cancelled') bgColor = '#ef4444'; // Cancelled (red)
    if (['Completed', 'flagged'].includes(booking.status)) bgColor = '#6b7280'; // Completed (gray)

    const baseEvent = {
      id: booking.id,
      backgroundColor: bgColor,
      borderColor: bgColor,
      textColor: 'white',
      extendedProps: { booking }
    };

    const outEvent = {
        ...baseEvent,
        title: `Out: ${serviceName}`,
        start: eventInstant(
            booking.drop_off_date,
            booking.drop_off_window_start,
            booking.drop_off_time_slot,
            8,
        ),
        allDay: !booking.drop_off_time_slot && !booking.drop_off_window_start,
    };

    if (serviceType === 3) return [outEvent]; // Only drop-off

    const inEvent = {
        ...baseEvent,
        title: `In: ${serviceName}`,
        start: eventInstant(
            booking.pickup_date,
            booking.pickup_window_start,
            booking.pickup_time_slot,
            17,
        ),
        allDay: !booking.pickup_time_slot && !booking.pickup_window_start,
        backgroundColor: bgColor === '#3b82f6' ? '#0ea5e9' : bgColor, // Slightly different blue for return
    };

    return [outEvent, inEvent];
  }).flat().filter(event => event.start !== null);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white mb-1">Interactive Calendar</h2>
        <p className="text-sm text-blue-200">View your schedule at a glance.</p>
      </div>

      <div className="flex flex-wrap gap-4 mb-4 text-xs font-semibold">
        <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-blue-500"></span> Scheduled</div>
        <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-green-500"></span> Active/Delivered</div>
        <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-orange-500"></span> Action Required</div>
        <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-gray-500"></span> Completed</div>
      </div>

      <div className="bg-black/20 p-4 sm:p-6 rounded-xl border border-white/10 calendar-container text-white shadow-2xl">
        <FullCalendar
          plugins={[dayGridPlugin]}
          initialView="dayGridMonth"
          events={events}
          headerToolbar={{
              left: 'prev,next today',
              center: 'title',
              right: 'dayGridMonth'
          }}
          height="auto"
          eventClick={(info) => {
              // Can open details dialog here
              console.log("Event clicked:", info.event.extendedProps.booking);
          }}
          eventDidMount={(info) => {
             info.el.title = info.event.title; // Simple native tooltip
          }}
        />
      </div>
    </div>
  );
};