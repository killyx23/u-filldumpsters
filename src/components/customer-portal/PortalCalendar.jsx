import React from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import { parseISO } from 'date-fns';

export const PortalCalendar = ({ bookings }) => {
  const events = bookings.map(booking => {
    const isDelivery = booking.addons?.isDelivery;
    const serviceName = (booking.plan?.name || 'Service') + (isDelivery ? ' with Delivery' : '');
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
        start: parseISO(booking.drop_off_date + 'T' + (booking.drop_off_time_slot || '08:00')),
        allDay: !booking.drop_off_time_slot,
    };

    if (serviceType === 3) return [outEvent]; // Only drop-off

    const inEvent = {
        ...baseEvent,
        title: `In: ${serviceName}`,
        start: parseISO(booking.pickup_date + 'T' + (booking.pickup_time_slot || '17:00')),
        allDay: !booking.pickup_time_slot,
        backgroundColor: bgColor === '#3b82f6' ? '#0ea5e9' : bgColor, // Slightly different blue for return
    };

    return [outEvent, inEvent];
  }).flat();

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