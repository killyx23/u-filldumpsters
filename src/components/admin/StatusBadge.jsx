
import React from 'react';

export const StatusBadge = ({ status }) => {
    const baseClasses = "text-xs font-bold px-2 py-1 rounded-full inline-block capitalize";
    
    const statusStyles = {
        'pending_payment': 'bg-red-500/20 text-red-300',
        'pending_verification': 'bg-orange-500/20 text-orange-300',
        'pending_review': 'bg-orange-500/20 text-orange-300',
        'Confirmed': 'bg-yellow-500/20 text-yellow-300',
        'Delivered': 'bg-cyan-500/20 text-cyan-300',
        'Completed': 'bg-green-500/20 text-green-300',
        'flagged': 'bg-orange-500/20 text-orange-300',
        'waiting_to_be_returned': 'bg-purple-500/20 text-purple-300',
        'Cancelled': 'bg-gray-500/20 text-gray-300',
    };

    const statusText = {
        'pending_payment': 'Payment Pending',
        'pending_verification': 'Pending Verification',
        'pending_review': 'Pending Review',
        'Confirmed': 'Delivery Ready',
        'Delivered': 'Delivered / Rented',
        'waiting_to_be_returned': 'Waiting for Return',
        'Completed': 'Completed',
        'flagged': 'Flagged',
        'Cancelled': 'Cancelled',
    };

    const displayStatus = statusText[status] || status.replace(/_/g, ' ');

    return <span className={`${baseClasses} ${statusStyles[status] || 'bg-gray-500/20 text-gray-300'}`}>{displayStatus}</span>;
};
