import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import {
  Calendar,
  Clock,
  FileText,
  MapPin,
  Navigation,
  ChevronRight,
  AlertCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getPickupWindowTimes, getPickupLocationPhase } from '@/utils/bookingPickupWindow';
import { formatTimeWindow } from '@/utils/timeWindowFormatter';
import {
  calculateDistanceViaGoogleMaps,
  getBusinessAddress,
} from '@/utils/distanceCalculationHelper';
import { getServiceIdFromBooking } from '@/utils/servicePlan';

const ACTIVE_STATUSES = new Set([
  'pending_payment',
  'Confirmed',
  'Delivered',
  'waiting_to_be_returned',
  'Rescheduled',
]);

function isPickupBookingFromAudit(booking) {
  if (!booking) return false;
  const addons = booking.addons || {};
  if (addons.isDelivery || addons.deliveryService || booking.delivery_service) return false;
  const plan = booking.plan || {};
  const serviceId = getServiceIdFromBooking(booking);
  if (serviceId != null) {
    const pickupIds = [2, 5, 8];
    return pickupIds.includes(Number(serviceId));
  }
  if (plan.customer_pickup === true) return true;
  if (plan.id != null) return [2, 5, 8].includes(Number(plan.id));
  return false;
}

function getCustomerAddress(booking) {
  return (
    booking?.delivery_address?.formatted_address ||
    (booking?.street
      ? `${booking.street}, ${booking.city || ''}, ${booking.state || ''} ${booking.zip || ''}`.trim().replace(/,\s*$/, '')
      : null)
  );
}

function DistanceBadge({ bookingId, customerAddress }) {
  const [info, setInfo] = useState({ loading: true, distance: null, travelTime: null, error: false });
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    if (!customerAddress) {
      setInfo({ loading: false, distance: null, travelTime: null, error: true });
      return;
    }

    let cancelled = false;
    const load = async () => {
      try {
        const origin = await getBusinessAddress();
        const res = await calculateDistanceViaGoogleMaps(origin, customerAddress);
        const travelTime = res.travelTime || Math.round(res.distance * 2);
        if (!cancelled && mounted.current) {
          setInfo({ loading: false, distance: res.distance, travelTime, error: false });
        }
      } catch {
        if (!cancelled && mounted.current) {
          setInfo({ loading: false, distance: null, travelTime: null, error: true });
        }
      }
    };
    load();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingId, customerAddress]);

  useEffect(() => () => { mounted.current = false; }, []);

  if (info.loading) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-gray-400 animate-pulse">
        <Navigation className="h-3.5 w-3.5" />
        <span>Calculating drive…</span>
      </div>
    );
  }

  if (info.error || info.distance === null) return null;

  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="flex items-center gap-1.5 font-semibold text-white">
        <Navigation className="h-4 w-4 text-yellow-400" />
        {info.distance.toFixed(1)} mi
      </span>
      <span className="text-gray-300">Est. {info.travelTime} min drive</span>
    </div>
  );
}

function AppointmentCard({ booking, isPrimary, onNavigateToTab }) {
  const navigate = useNavigate();

  const plan = booking.plan || {};
  const serviceDisplayName =
    plan.name ||
    (getServiceIdFromBooking(booking) === 2
      ? 'Dump Loader Trailer'
      : getServiceIdFromBooking(booking) === 5
      ? 'Excavator'
      : 'Rental Service');

  const { pickupStart, returnBy } = getPickupWindowTimes(booking);
  const phase = getPickupLocationPhase(booking);
  const customerAddress = getCustomerAddress(booking);

  const pickupDateLabel = booking.drop_off_date
    ? format(parseISO(booking.drop_off_date), 'EEEE, MMMM d, yyyy')
    : 'Date TBD';

  const pickupTimeLabel = formatTimeWindow(booking.drop_off_time_slot, {
    isSelfService: true,
    isReturnBy: false,
  });

  const returnByLabel = returnBy
    ? `by ${format(returnBy, 'EEEE, MMM d')} (${formatTimeWindow(booking.pickup_time_slot, { isSelfService: true, isReturnBy: true })})`
    : null;

  const handleOpenBooking = () => navigate(`/portal/bookings/${booking.id}`);
  const handleViewReceipt = () => onNavigateToTab?.('documents');

  return (
    <div
      className={`rounded-xl border transition-all ${
        isPrimary
          ? 'bg-gradient-to-br from-yellow-900/30 via-amber-900/20 to-transparent border-yellow-500/50 shadow-lg shadow-yellow-900/10 p-5'
          : 'bg-white/5 border-white/10 p-4'
      }`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <p className={`font-bold ${isPrimary ? 'text-yellow-300 text-base' : 'text-white text-sm'}`}>
            {serviceDisplayName}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">Order #{booking.id}</p>
        </div>
        <span
          className={`shrink-0 text-xs font-medium px-2 py-0.5 rounded-full ${
            booking.status === 'Delivered' || booking.status === 'waiting_to_be_returned'
              ? 'bg-green-500/20 text-green-300 border border-green-500/30'
              : 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
          }`}
        >
          {booking.status === 'waiting_to_be_returned'
            ? 'In Use'
            : booking.status}
        </span>
      </div>

      {/* Pickup time */}
      <div className="space-y-2 mb-4">
        <div className="flex items-start gap-2">
          <Calendar className="h-4 w-4 text-yellow-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-xs text-gray-400 uppercase font-semibold tracking-wide mb-0.5">Pickup Date</p>
            <p className="text-white text-sm font-medium">{pickupDateLabel}</p>
            {booking.drop_off_time_slot && (
              <p className="text-yellow-200 text-sm">{pickupTimeLabel}</p>
            )}
          </div>
        </div>

        {returnByLabel && (
          <div className="flex items-start gap-2">
            <Clock className="h-4 w-4 text-blue-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-xs text-gray-400 uppercase font-semibold tracking-wide mb-0.5">Return By</p>
              <p className="text-gray-200 text-sm">{returnByLabel}</p>
            </div>
          </div>
        )}
      </div>

      {/* Yard address / 12h gate */}
      <div className="mb-4">
        {phase === 'revealed' ? (
          <div className="flex items-start gap-2">
            <MapPin className="h-4 w-4 text-green-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-xs text-gray-400 uppercase font-semibold tracking-wide mb-0.5">Pickup Location</p>
              <p className="text-green-300 text-sm font-medium">Full pick up location &amp; map available in booking details</p>
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-2 bg-black/20 rounded-lg px-3 py-2.5">
            <AlertCircle className="h-4 w-4 text-yellow-400 mt-0.5 shrink-0" />
            <p className="text-xs text-yellow-200 leading-relaxed">
              Full pick up location unlocks within 12 hours of your pickup time. Miles and drive estimate below
              so you can plan ahead.
            </p>
          </div>
        )}
      </div>

      {/* Distance */}
      <div className="mb-5">
        <DistanceBadge bookingId={booking.id} customerAddress={customerAddress} />
      </div>

      {/* CTAs */}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={handleOpenBooking}
          className={`border-yellow-500/40 text-yellow-200 hover:bg-yellow-400/10 text-xs ${
            phase === 'revealed' ? 'animate-open-booking-flash' : ''
          }`}
        >
          Open Booking
          <ChevronRight className="ml-1 h-3.5 w-3.5" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={handleViewReceipt}
          className="text-gray-300 hover:text-white hover:bg-white/10 text-xs"
        >
          <FileText className="mr-1.5 h-3.5 w-3.5" />
          View Receipt
        </Button>
      </div>
    </div>
  );
}

export function ImportantAppointmentDetails({ bookings, onNavigateToTab }) {
  const pickupActives = (bookings || [])
    .filter(
      (b) =>
        ACTIVE_STATUSES.has(b.status) &&
        !b.pending_address_verification &&
        isPickupBookingFromAudit(b)
    )
    .sort((a, b) => {
      const da = a.drop_off_date ? parseISO(a.drop_off_date).getTime() : Infinity;
      const db = b.drop_off_date ? parseISO(b.drop_off_date).getTime() : Infinity;
      return da - db;
    });

  if (pickupActives.length === 0) return null;

  const [primary, ...rest] = pickupActives;

  return (
    <div className="rounded-2xl border border-yellow-500/40 bg-gradient-to-br from-yellow-950/40 via-amber-950/20 to-blue-950/30 shadow-xl shadow-yellow-900/10 overflow-hidden">
      {/* Banner header */}
      <div className="flex items-center gap-3 px-5 pt-4 pb-3 border-b border-yellow-500/20">
        <div className="flex items-center justify-center h-8 w-8 rounded-full bg-yellow-400/20 shrink-0">
          <AlertCircle className="h-4.5 w-4.5 text-yellow-400" style={{ height: '1.1rem', width: '1.1rem' }} />
        </div>
        <div>
          <h3 className="text-yellow-300 font-bold text-base leading-tight tracking-wide uppercase">
            Important Appointment Details
          </h3>
          <p className="text-xs text-yellow-200/70 mt-0.5">
            Review your pickup time, drive estimate, and receipt before your service.
          </p>
        </div>
      </div>

      {/* Cards */}
      <div className="p-4 space-y-3">
        <AppointmentCard
          booking={primary}
          isPrimary
          onNavigateToTab={onNavigateToTab}
        />

        {rest.map((b) => (
          <AppointmentCard
            key={b.id}
            booking={b}
            isPrimary={false}
            onNavigateToTab={onNavigateToTab}
          />
        ))}
      </div>
    </div>
  );
}
