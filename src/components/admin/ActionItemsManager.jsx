import React from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, DollarSign, ShieldAlert } from 'lucide-react';
import { StatusBadge } from '@/components/admin/StatusBadge';

const ActionItemCard = ({ title, icon, bookings, onBookingClick, emptyText }) => (
    <div className="bg-white/5 p-6 rounded-lg shadow-lg">
        <div className="flex items-center mb-4">
            {icon}
            <h3 className="text-xl font-bold text-yellow-400 ml-3">{title}</h3>
        </div>
        <div className="space-y-3 max-h-60 overflow-y-auto">
            {bookings.length > 0 ? bookings.map(booking => (
                <div key={booking.id} onClick={() => onBookingClick(booking)} className="bg-white/10 p-3 rounded-md cursor-pointer hover:bg-white/20 transition-colors">
                    <div className="flex justify-between items-center">
                        <p className="font-bold text-white truncate">{booking.customers.name}</p>
                        <StatusBadge status={booking.status} />
                    </div>
                    <p className="text-xs text-gray-400 mt-1">{booking.plan.name}</p>
                </div>
            )) : (
                <p className="text-center text-blue-200 py-4">{emptyText || "No items require action."}</p>
            )}
        </div>
    </div>
);

export const ActionItemsManager = ({ bookings }) => {
    const navigate = useNavigate();

    const pendingPayments = bookings.filter(b => b.status === 'pending_payment');
    const flaggedBookings = bookings.filter(b => b.status === 'flagged');
    const pendingVerification = bookings.filter(b => b.status === 'pending_verification' || b.status === 'pending_review');

    const handleBookingClick = (booking) => {
        navigate(`/admin/customer/${booking.customer_id}?tab=verification`);
    };
    
    const handleFlaggedClick = (booking) => {
         navigate(`/admin/customer/${booking.customer_id}?tab=rentals`);
    };

    return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-8">
            <ActionItemCard 
                title="Pending Verification" 
                icon={<ShieldAlert className="h-6 w-6 text-orange-400" />} 
                bookings={pendingVerification} 
                onBookingClick={handleBookingClick}
                emptyText="No bookings pending verification."
            />
             <ActionItemCard 
                title="Flagged for Follow-up" 
                icon={<AlertTriangle className="h-6 w-6 text-red-400" />} 
                bookings={flaggedBookings} 
                onBookingClick={handleFlaggedClick}
                emptyText="No bookings are flagged."
            />
            <ActionItemCard 
                title="Pending Payments" 
                icon={<DollarSign className="h-6 w-6 text-yellow-400" />} 
                bookings={pendingPayments} 
                onBookingClick={handleBookingClick}
                emptyText="No payments are pending." 
            />
        </div>
    );
};