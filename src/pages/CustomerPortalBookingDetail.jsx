import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Calendar, MapPin, Loader2, DollarSign, Package, Info, AlertTriangle, Navigation, RefreshCw } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { supabase } from '@/lib/customSupabaseClient';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { calculateDistanceViaGoogleMaps, getBusinessAddress } from '@/utils/distanceCalculationHelper';
import { RescheduleDialog } from '@/components/customer-portal/reschedule/RescheduleDialog';

export default function CustomerPortalBookingDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [booking, setBooking] = useState(null);
  const [loading, setLoading] = useState(true);
  const [distanceInfo, setDistanceInfo] = useState({ distance: 0, travelTime: 0, loading: true, error: null });
  const [isRescheduleOpen, setIsRescheduleOpen] = useState(false);

  const fetchBookingAndDistance = async () => {
    let fetchedBooking = null;
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('bookings')
        .select('*, customers(*)')
        .eq('id', id)
        .single();

      if (error) throw error;
      fetchedBooking = data;
      setBooking(data);
    } catch (error) {
      console.error('Error fetching booking details:', error);
      setBooking(null);
    } finally {
      // Do not block the whole page on Google Distance Matrix (no timeout in SDK callback).
      setLoading(false);
    }

    if (!fetchedBooking) {
      setDistanceInfo({ distance: 0, travelTime: 0, loading: false, error: null });
      return;
    }

    setDistanceInfo({ distance: 0, travelTime: 0, loading: true, error: null });
    const address =
      fetchedBooking.delivery_address?.formatted_address ||
      `${fetchedBooking.street}, ${fetchedBooking.city}, ${fetchedBooking.state} ${fetchedBooking.zip}`;
    if (address) {
      try {
        const origin = await getBusinessAddress();
        const res = await calculateDistanceViaGoogleMaps(origin, address);
        const estimatedTravelTime = res.travelTime || Math.round(res.distance * 2);
        setDistanceInfo({
          distance: res.distance,
          travelTime: estimatedTravelTime,
          loading: false,
          error: null
        });
      } catch (distError) {
        setDistanceInfo({ distance: 0, travelTime: 0, loading: false, error: "Failed to calculate distance" });
      }
    } else {
      setDistanceInfo({ distance: 0, travelTime: 0, loading: false, error: "No address provided" });
    }
  };

  useEffect(() => {
    if (id) fetchBookingAndDistance();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-[50vh]">
        <Loader2 className="h-12 w-12 animate-spin text-yellow-400" />
      </div>
    );
  }

  if (!booking) {
    return (
      <div className="text-center py-16">
        <h2 className="text-2xl font-bold text-white mb-4">Booking Not Found</h2>
        <Button onClick={() => navigate('/portal?tab=bookings')} variant="outline" className="text-white border-white/20">
          Return to Portal
        </Button>
      </div>
    );
  }

  const planName = booking.plan?.name || 'Custom Rental';
  const isHighDistance = distanceInfo.distance > 30;
  const canReschedule = booking.status === 'pending_payment' || booking.status === 'confirmed' || booking.status === 'active';

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
            <Button onClick={() => navigate('/portal?tab=bookings')} variant="ghost" className="text-gray-400 hover:text-white hover:bg-white/10">
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to Portal
            </Button>
            <h1 className="text-3xl font-bold text-white">Order #{booking.id}</h1>
            <span className="px-3 py-1 bg-blue-500/20 text-blue-300 border border-blue-500/30 rounded-full text-sm font-semibold uppercase tracking-wider">
            {booking.status?.replace(/_/g, ' ')}
            </span>
        </div>
        {canReschedule && (
            <Button onClick={() => setIsRescheduleOpen(true)} className="bg-yellow-500 hover:bg-yellow-600 text-black font-semibold">
                <RefreshCw className="w-4 h-4 mr-2" /> Reschedule
            </Button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="bg-white/5 border-white/10 text-white">
          <CardHeader>
            <CardTitle className="text-xl flex items-center text-yellow-400">
              <Package className="mr-2 h-5 w-5" /> Service Details
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-sm text-gray-400">Plan</p>
              <p className="text-lg font-medium text-white">{planName}</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-gray-400">Drop-off Date</p>
                <p className="flex items-center text-white mt-1">
                  <Calendar className="mr-2 h-4 w-4 text-blue-400" />
                  {booking.drop_off_date ? format(parseISO(booking.drop_off_date), 'MMM d, yyyy') : 'N/A'}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-400">Pickup Date</p>
                <p className="flex items-center text-white mt-1">
                  <Calendar className="mr-2 h-4 w-4 text-blue-400" />
                  {booking.pickup_date ? format(parseISO(booking.pickup_date), 'MMM d, yyyy') : 'N/A'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white/5 border-white/10 text-white">
          <CardHeader>
            <CardTitle className="text-xl flex items-center text-yellow-400">
              <MapPin className="mr-2 h-5 w-5" /> Location & Distance
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-sm text-gray-400">Delivery Address</p>
              <p className="text-white mt-1">
                {booking.delivery_address?.formatted_address || `${booking.street}, ${booking.city}, ${booking.state} ${booking.zip}`}
              </p>
            </div>
            <div className="bg-black/20 p-3 rounded-lg border border-white/5">
                <p className="text-sm text-gray-400 flex items-center mb-1">
                    <Navigation className="mr-2 h-4 w-4 text-blue-400" /> Delivery Distance
                </p>
                {distanceInfo.loading ? (
                    <div className="flex items-center text-gray-300 text-sm">
                        <Loader2 className="h-3 w-3 animate-spin mr-2" /> Calculating...
                    </div>
                ) : distanceInfo.error ? (
                    <p className="text-red-400 text-sm">{distanceInfo.error}</p>
                ) : (
                    <div>
                        <div className="flex items-center gap-2">
                            <span className={`text-lg font-bold ${isHighDistance ? 'text-red-400' : 'text-white'}`}>
                                {distanceInfo.distance.toFixed(1)} mi
                            </span>
                            {isHighDistance && (
                                <span className="bg-red-500/20 text-red-400 border border-red-500/30 px-2 py-0.5 rounded text-xs font-bold flex items-center">
                                    <AlertTriangle className="h-3 w-3 mr-1" /> Extended Range
                                </span>
                            )}
                        </div>
                        <p className="text-sm text-gray-400 mt-1">Est. Travel Time: {distanceInfo.travelTime} mins</p>
                    </div>
                )}
            </div>
            <div>
              <p className="text-sm text-gray-400">Contact Details</p>
              <p className="text-white mt-1">{booking.name} • {booking.phone}</p>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white/5 border-white/10 text-white md:col-span-2">
          <CardHeader>
            <CardTitle className="text-xl flex items-center text-yellow-400">
              <DollarSign className="mr-2 h-5 w-5" /> Payment Summary
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex justify-between items-center py-3 border-b border-white/10">
              <span className="text-gray-300">Total Price</span>
              <span className="text-2xl font-bold text-white">${Number(booking.total_price || 0).toFixed(2)}</span>
            </div>
            {booking.notes && (
              <div className="mt-4 bg-black/20 p-4 rounded-lg border border-white/5">
                <p className="text-sm font-semibold flex items-center text-yellow-400 mb-2">
                  <Info className="mr-2 h-4 w-4" /> Special Instructions
                </p>
                <p className="text-sm text-gray-300">{booking.notes}</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <RescheduleDialog 
        booking={booking} 
        isOpen={isRescheduleOpen} 
        onOpenChange={setIsRescheduleOpen} 
        onSuccess={fetchBookingAndDistance} 
      />
    </div>
  );
}