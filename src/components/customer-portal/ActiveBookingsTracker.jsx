
import React from 'react';
import { Clock, Truck, CheckCircle, MapPin } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { format, parseISO } from 'date-fns';

export const ActiveBookingsTracker = ({ bookings }) => {
  const activeBookings = bookings.filter(b => 
    ['pending_payment', 'Confirmed', 'Delivered', 'waiting_to_be_returned', 'in_transit', 'Rescheduled'].includes(b.status) || 
    b.pending_address_verification
  ).sort((a, b) => new Date(a.drop_off_date) - new Date(b.drop_off_date));

  if (activeBookings.length === 0) {
    return (
      <div className="bg-white/5 border border-white/10 rounded-xl p-8 text-center text-gray-400">
        <Truck className="mx-auto h-12 w-12 mb-4 opacity-50" />
        <h3 className="text-lg font-semibold text-white mb-2">No Active Bookings</h3>
        <p>You don't have any deliveries or active rentals to track right now.</p>
      </div>
    );
  }

  const getStageInfo = (booking) => {
    if (booking.pending_address_verification) return { stage: 0, text: 'Verification Pending', color: 'badge-pending' };
    
    switch (booking.status) {
      case 'pending_payment':
      case 'Confirmed':
      case 'Rescheduled':
        return { stage: 1, text: 'Scheduled', color: 'badge-scheduled' };
      case 'in_transit':
        return { stage: 2, text: 'In Transit', color: 'badge-in-transit' };
      case 'Delivered':
      case 'waiting_to_be_returned':
        return { stage: 3, text: 'Active/Delivered', color: 'badge-delivered' };
      default:
        return { stage: 1, text: 'Scheduled', color: 'badge-scheduled' };
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white mb-1">Real-Time Tracking</h2>
        <p className="text-sm text-blue-200">Track the status of your current orders.</p>
      </div>

      <div className="space-y-6">
        {activeBookings.map(booking => {
          const isDelivery = booking.addons?.isDelivery;
          const serviceName = (booking.plan?.name || 'Service') + (isDelivery ? ' with Delivery' : '');
          const { stage, text, color } = getStageInfo(booking);

          return (
            <Card key={booking.id} className="bg-white/5 border-white/10 text-white overflow-hidden">
              <CardHeader className="bg-black/20 border-b border-white/5 pb-4">
                <div className="flex justify-between items-start">
                  <div>
                    <CardTitle className="text-lg font-bold text-yellow-400">{serviceName}</CardTitle>
                    <p className="text-sm text-gray-400">Order #{booking.id}</p>
                  </div>
                  <span className={`px-3 py-1 rounded-full text-xs font-bold ${color}`}>
                    {text}
                  </span>
                </div>
              </CardHeader>
              <CardContent className="p-6">
                {/* Progress Tracker */}
                <div className="relative flex justify-between items-center mb-8">
                  <div className="absolute left-0 top-1/2 w-full h-1 bg-gray-700 -translate-y-1/2 rounded-full" />
                  <div 
                    className="absolute left-0 top-1/2 h-1 bg-blue-500 -translate-y-1/2 rounded-full transition-all duration-500"
                    style={{ width: `${(stage / 3) * 100}%` }}
                  />

                  <div className="relative z-10 flex flex-col items-center">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center border-4 border-gray-900 transition-colors ${stage >= 1 ? 'bg-blue-500 text-white' : 'bg-gray-700 text-gray-400'}`}>
                      <Clock className="w-5 h-5" />
                    </div>
                    <span className="text-xs font-semibold mt-2 absolute top-full pt-1">Scheduled</span>
                  </div>

                  <div className="relative z-10 flex flex-col items-center">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center border-4 border-gray-900 transition-colors ${stage >= 2 ? 'bg-orange-500 text-white' : 'bg-gray-700 text-gray-400'}`}>
                      <Truck className="w-5 h-5" />
                    </div>
                    <span className="text-xs font-semibold mt-2 absolute top-full pt-1">In Transit</span>
                  </div>

                  <div className="relative z-10 flex flex-col items-center">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center border-4 border-gray-900 transition-colors ${stage >= 3 ? 'bg-green-500 text-white' : 'bg-gray-700 text-gray-400'}`}>
                      <CheckCircle className="w-5 h-5" />
                    </div>
                    <span className="text-xs font-semibold mt-2 absolute top-full pt-1">Delivered</span>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-12 bg-black/20 p-4 rounded-lg border border-white/5">
                  <div className="flex items-start gap-3">
                    <MapPin className="text-blue-400 w-5 h-5 mt-0.5" />
                    <div>
                      <p className="text-xs text-gray-400 uppercase font-semibold">Delivery Address</p>
                      <p className="text-sm font-medium">{booking.delivery_address?.street || booking.street || 'Not provided'}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <Clock className="text-yellow-400 w-5 h-5 mt-0.5" />
                    <div>
                      <p className="text-xs text-gray-400 uppercase font-semibold">Estimated Time</p>
                      <p className="text-sm font-medium">
                        {format(parseISO(booking.drop_off_date), 'MMM d, yyyy')} • {booking.drop_off_time_slot || 'TBD'}
                      </p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
};
