import React from 'react';
import { format, parseISO } from 'date-fns';
import { MapPin } from 'lucide-react';
import { formatAddressDisplay } from '@/utils/addressHelpers';
import { collectAddressHistory } from '@/utils/addressChangeReview';

const whenLabel = (value) => {
  if (!value) return '';
  try {
    return format(parseISO(value), 'MMM d, yyyy h:mm a');
  } catch {
    return '';
  }
};

const sourceLabel = (source) => {
  if (source === 'order') return 'Original order address';
  if (source === 'profile') return 'Customer profile';
  if (source === 'admin') return 'Admin update';
  if (source === 'reschedule') return 'Reschedule';
  return 'Address change';
};

export const AddressHistorySection = ({ customer, bookings = [] }) => {
  const rows = collectAddressHistory(customer, bookings);
  if (!rows.length) return null;

  return (
    <div className="md:col-span-2 bg-black/20 rounded-lg p-4 space-y-3">
      <h4 className="font-bold text-yellow-400 flex items-center">
        <MapPin className="mr-2 h-5 w-5" /> Address history
      </h4>
      <p className="text-xs text-blue-200">
        Earlier addresses stay here after a profile change, a reschedule, or the address saved with the order.
      </p>
      <div className="space-y-2 max-h-72 overflow-y-auto">
        {rows.map((entry, index) => {
          const when = whenLabel(entry.resolved_at || entry.requested_at || entry.recorded_at);
          const single = entry.address && !entry.to_address;
          return (
            <div key={entry.id || `${entry.booking_id}-${index}`} className="border border-white/10 rounded-md p-3 text-sm">
              <div className="flex justify-between gap-3 text-xs text-gray-400">
                <span className="text-yellow-200">{sourceLabel(entry.source)}{entry.booking_id ? ` · Booking #${entry.booking_id}` : ''}</span>
                <span>{when}</span>
              </div>
              <p className="text-gray-300 mt-1 capitalize">Status: {String(entry.status || 'recorded').replace(/_/g, ' ')}</p>
              {single ? (
                <p className="text-white mt-1">{formatAddressDisplay(entry.address)}</p>
              ) : (
                <>
                  <p className="text-gray-300 mt-1">From: <span className="text-white">{formatAddressDisplay(entry.from_address) || 'N/A'}</span></p>
                  <p className="text-gray-300">To: <span className="text-white">{formatAddressDisplay(entry.to_address) || 'N/A'}</span></p>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
