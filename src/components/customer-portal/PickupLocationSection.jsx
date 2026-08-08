import React, { useEffect, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { Clock, CheckCircle2, Loader2, Building2 } from 'lucide-react';
import { getBusinessAddress } from '@/utils/distanceCalculationHelper';
import { getPickupLocationPhase } from '@/utils/bookingPickupWindow';
import { formatTimeWindow } from '@/utils/timeWindowFormatter';
import { PickupLocationInfoButton } from '@/components/customer-portal/PickupLocationInfoButton';

export const PickupLocationSection = ({ booking }) => {
  const [businessAddress, setBusinessAddress] = useState(null);
  const [loadingAddress, setLoadingAddress] = useState(false);

  const phase = getPickupLocationPhase(booking);

  useEffect(() => {
    if (phase !== 'revealed') {
      setBusinessAddress(null);
      return;
    }

    let cancelled = false;
    setLoadingAddress(true);
    getBusinessAddress()
      .then((addr) => {
        if (!cancelled) setBusinessAddress(addr);
      })
      .catch(() => {
        if (!cancelled) setBusinessAddress(null);
      })
      .finally(() => {
        if (!cancelled) setLoadingAddress(false);
      });

    return () => {
      cancelled = true;
    };
  }, [phase, booking?.id]);

  const pickupDateLabel = booking?.drop_off_date
    ? format(parseISO(booking.drop_off_date), 'EEEE, MMMM d, yyyy')
    : 'Date to be confirmed';

  const pickupTimeLabel = formatTimeWindow(booking?.drop_off_time_slot, {
    isSelfService: true,
    isReturnBy: false,
  });

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-gray-400 flex items-center">
          <Building2 className="mr-2 h-4 w-4 text-yellow-400" />
          Pickup Location
        </p>
        <PickupLocationInfoButton />
      </div>

      {phase === 'pending' && (
        <div className="mt-2 bg-black/20 p-3 rounded-lg border border-white/5">
          <p className="text-white font-medium flex items-center gap-2">
            <span aria-hidden>⏳</span>
            Pending pickup
          </p>
          <p className="text-sm text-gray-300 mt-2">
            {pickupDateLabel}
            {booking?.drop_off_time_slot && (
              <span className="block mt-1">Pickup start: {pickupTimeLabel}</span>
            )}
          </p>
          <p className="text-sm text-gray-400 mt-3 leading-relaxed">
            Please come back when it is within 12 hours of your rental pickup time for more information.
          </p>
        </div>
      )}

      {phase === 'revealed' && (
        <div className="mt-2">
          {loadingAddress ? (
            <div className="flex items-center text-gray-300 text-sm mt-1">
              <Loader2 className="h-3 w-3 animate-spin mr-2" />
              Loading pickup location…
            </div>
          ) : businessAddress ? (
            <>
              <p className="text-white mt-1 flex items-start gap-2">
                <span aria-hidden>📍</span>
                <span>{businessAddress}</span>
              </p>
              <p className="text-xs text-gray-400 mt-2 flex items-center gap-1">
                <Clock className="h-3 w-3 text-blue-400" />
                Directions to our yard are available below during your rental period.
              </p>
            </>
          ) : (
            <p className="text-amber-300 text-sm mt-1">
              Pickup location is temporarily unavailable. Please contact us for directions.
            </p>
          )}
        </div>
      )}

      {phase === 'finished' && (
        <p className="text-white mt-2 font-medium flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 text-green-400" />
          <span aria-hidden>✅</span>
          Finished
        </p>
      )}
    </div>
  );
};
