import React, { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { format, parseISO, isValid } from 'date-fns';
import { 
  CheckCircle, 
  AlertTriangle, 
  Truck, 
  Clock, 
  XCircle, 
  Info, 
  MapPin, 
  List,
  Star
} from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export const BookingsList = ({ bookings, onReceiptClick, onCancelClick, onRescheduleClick }) => {
  const [filterStatus, setFilterStatus] = useState('all');

  const filteredBookings = useMemo(() => {
    let result = [...bookings].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    if (filterStatus !== 'all') {
      if (filterStatus === 'upcoming') {
         result = result.filter(b => ['pending_payment', 'Confirmed', 'Rescheduled'].includes(b.status) && !b.pending_address_verification);
      } else if (filterStatus === 'past') {
         result = result.filter(b => ['Completed', 'flagged', 'Returned', 'Cancelled'].includes(b.status));
      } else if (filterStatus === 'pending') {
         result = result.filter(b => b.pending_address_verification || ['pending_verification', 'pending_review'].includes(b.status));
      }
    }
    return result;
  }, [bookings, filterStatus]);

  const getStatusInfo = (booking) => {
    if (booking.pending_address_verification) {
        return { text: 'Address Pending', class: 'badge-pending', icon: <MapPin className="h-3 w-3" /> };
    }
    switch (booking.status) {
        case 'pending_verification':
        case 'pending_review':
            return { text: 'Manual Review', class: 'badge-pending', icon: <AlertTriangle className="h-3 w-3" /> };
        case 'pending_payment':
        case 'Confirmed':
        case 'Rescheduled':
            return { text: 'Scheduled', class: 'badge-scheduled', icon: <Clock className="h-3 w-3" /> };
        case 'in_transit':
        case 'Delivered':
        case 'waiting_to_be_returned':
            return { text: 'Active Rental', class: 'badge-in-transit', icon: <Truck className="h-3 w-3" /> };
        case 'Completed':
        case 'flagged':
        case 'Returned':
            return { text: 'Completed', class: 'badge-delivered', icon: <CheckCircle className="h-3 w-3" /> };
        case 'Cancelled':
            return { text: 'Cancelled', class: 'badge-cancelled', icon: <XCircle className="h-3 w-3" /> };
        default:
            return { text: booking.status, class: 'bg-gray-800 text-gray-300', icon: <Info className="h-3 w-3" /> };
    }
  };

  const formatTime = (timeString) => {
      if (!timeString) return 'TBD';
      try {
          const [hours, minutes] = timeString.split(':');
          const date = new Date();
          date.setHours(parseInt(hours, 10));
          date.setMinutes(parseInt(minutes || '0', 10));
          return isValid(date) ? format(date, 'h:mm a') : timeString;
      } catch (e) {
          return timeString;
      }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white mb-1">My Bookings</h2>
          <p className="text-sm text-blue-200">View and manage all your past and upcoming services.</p>
        </div>
        <div className="w-full sm:w-auto">
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-full sm:w-[180px] bg-black/20 border-white/20 text-white">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent className="bg-gray-900 border-white/20 text-white">
              <SelectItem value="all">All Bookings</SelectItem>
              <SelectItem value="upcoming">Upcoming</SelectItem>
              <SelectItem value="pending">Action Required</SelectItem>
              <SelectItem value="past">Past / Completed</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredBookings.length > 0 ? filteredBookings.map(booking => {
          const isDelivery = booking.addons?.isDelivery;
          const serviceName = (booking.plan?.name || 'Service') + (isDelivery ? ' with Delivery' : '');
          const statusInfo = getStatusInfo(booking);
          const canModify = !booking.pending_address_verification && ['pending_payment', 'Confirmed', 'Rescheduled'].includes(booking.status);
          const isCompleted = ['Completed', 'flagged', 'Returned'].includes(booking.status) || booking.returned_at;

          return (
            <Card key={booking.id} className={`bg-white/5 border-white/10 text-white flex flex-col ${booking.pending_address_verification ? 'border-orange-500/50 shadow-[0_0_15px_rgba(249,115,22,0.15)]' : ''}`}>
              <CardHeader className="pb-4 border-b border-white/5">
                <div className="flex justify-between items-start mb-2">
                  <span className={`px-2 py-1 rounded text-xs font-semibold flex items-center gap-1 ${statusInfo.class}`}>
                    {statusInfo.icon} {statusInfo.text}
                  </span>
                  <span className="text-xs text-gray-400">#{booking.id}</span>
                </div>
                <CardTitle className="text-lg font-bold text-yellow-400">{serviceName}</CardTitle>
              </CardHeader>
              <CardContent className="py-4 space-y-3 flex-grow text-sm">
                 {booking.pending_address_verification && (
                    <div className="bg-orange-900/30 border border-orange-500/40 p-3 rounded-md mb-2">
                        <p className="font-semibold text-orange-400 flex items-center mb-1"><AlertTriangle className="h-4 w-4 mr-1"/> Action Required</p>
                        <p className="text-orange-200 text-xs">Address pending manual verification. Delivery cannot proceed until verified.</p>
                    </div>
                )}
                <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-gray-300">
                  <span className="text-gray-500 font-medium">Out:</span>
                  <span>{format(parseISO(booking.drop_off_date), 'MMM d, yyyy')} • {formatTime(booking.drop_off_time_slot)}</span>
                  
                  {booking.plan?.id !== 3 && (
                    <>
                      <span className="text-gray-500 font-medium">In:</span>
                      <span>{format(parseISO(booking.pickup_date), 'MMM d, yyyy')} • {formatTime(booking.pickup_time_slot)}</span>
                    </>
                  )}
                  
                  <span className="text-gray-500 font-medium">Total:</span>
                  <span className="text-white font-bold">${(booking.total_price || 0).toFixed(2)}</span>
                </div>
              </CardContent>
              <CardFooter className="pt-4 border-t border-white/5 flex flex-wrap gap-2 justify-end">
                {isCompleted && (
                   <div className="w-full text-xs text-yellow-400/80 mb-2 flex items-center justify-end">
                      <Star className="w-3 h-3 mr-1"/> Visit Communication Hub to leave a review
                   </div>
                )}
                <Button variant="outline" size="sm" onClick={() => onReceiptClick(booking)} className="border-white/20 hover:bg-white/10">Details</Button>
                {canModify && (
                  <>
                    <Button variant="secondary" size="sm" onClick={() => onRescheduleClick(booking)}>Reschedule</Button>
                    <Button variant="destructive" size="sm" onClick={() => onCancelClick(booking)} className="bg-red-600/80 hover:bg-red-600">Cancel</Button>
                  </>
                )}
              </CardFooter>
            </Card>
          )
        }) : (
           <div className="col-span-full py-12 text-center bg-black/20 rounded-xl border border-white/5">
             <List className="h-12 w-12 text-gray-500 mx-auto mb-4" />
             <h3 className="text-xl font-semibold text-white mb-2">No bookings found</h3>
             <p className="text-gray-400">You don't have any bookings matching this filter.</p>
           </div>
        )}
      </div>
    </div>
  );
};