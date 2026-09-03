import React from 'react';
import { isCustomerPickupService } from '@/utils/customerPickupService';
import { isFollowUpHold } from '@/utils/followUpResolution';

export const StatusBadge = ({ status, booking = null }) => {
    const baseClasses = "text-xs font-bold px-2 py-1 rounded-full inline-block capitalize";
    const isPickup = booking
      ? isCustomerPickupService(booking.plan, booking.addons || {})
      : false;

    const statusStyles = {
        'pending_payment': 'bg-red-500/20 text-red-300',
        'pending_verification': 'bg-orange-500/20 text-orange-300',
        'pending_review': 'bg-orange-500/20 text-orange-300',
        'Confirmed': 'bg-yellow-500/20 text-yellow-300',
        'Rescheduled': 'bg-blue-500/20 text-blue-300',
        'Delivered': 'bg-cyan-500/20 text-cyan-300',
        'pending_checklist': 'bg-purple-500/20 text-purple-300',
        'Completed': 'bg-green-500/20 text-green-300',
        'flagged': 'bg-red-500/20 text-red-300',
        'waiting_to_be_returned': 'bg-purple-500/20 text-purple-300',
        'Cancelled': 'bg-gray-500/20 text-gray-300',
        'cancellation_pending': 'bg-amber-500/20 text-amber-300',
        'booking_not_finished': 'bg-slate-500/20 text-slate-300',
    };

    const statusText = {
        'pending_payment': 'Payment Pending',
        'pending_verification': 'Pending Verification',
        'pending_review': 'Pending Review',
        'Confirmed': isPickup ? 'Ready for Pickup' : 'Delivery Ready',
        'Rescheduled': 'Rescheduled',
        'Delivered': isPickup ? 'Rented' : 'Delivered',
        'pending_checklist': isPickup ? 'Returned — Awaiting Inspection' : 'Pending Checklist',
        'waiting_to_be_returned': isPickup ? 'Rented' : 'Waiting for Return',
        'Completed': 'Completed',
        'flagged': 'Flagged for Follow-up',
        'Cancelled': 'Cancelled',
        'cancellation_pending': 'Cancellation Pending',
        'booking_not_finished': 'Booking Not Finished',
    };

    // Timestamp-driven overrides for self-pickup when status is still Confirmed
    let displayStatus = statusText[status] || String(status || '').replace(/_/g, ' ');
    let displayClass = statusStyles[status] || 'bg-gray-500/20 text-gray-300';

    if (status === 'flagged' && isFollowUpHold(booking?.follow_up_resolution)) {
      displayStatus = 'Repair before next rental';
      displayClass = 'bg-orange-500/20 text-orange-300';
    }

    if (isPickup) {
      if (booking?.returned_at && status !== 'Completed' && status !== 'flagged' && status !== 'Cancelled') {
        displayStatus = status === 'pending_checklist'
          ? 'Returned — Awaiting Inspection'
          : 'Returned';
      } else if (booking?.rented_out_at && (status === 'Delivered' || status === 'waiting_to_be_returned')) {
        displayStatus = 'Rented';
      }
    }

    return <span className={`${baseClasses} ${displayClass}`}>{displayStatus}</span>;
};
