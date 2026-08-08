import React from 'react';
import { Calendar, MapPin, Package, MessageSquare, Clock } from 'lucide-react';
import {
  isChangeRequestNote,
  parseChangeRequestNote,
  formatFriendlyDateTime,
  formatFriendlyTimestamp,
} from '@/utils/changeRequestNoteFormatter';

function DetailRow({ label, value }) {
  if (!value) return null;
  return (
    <div className="flex flex-col sm:flex-row sm:gap-2 text-sm">
      <span className="text-blue-300/80 font-medium shrink-0">{label}</span>
      <span className="text-white">{value}</span>
    </div>
  );
}

function ScheduleBlock({ title, dropOff, pickup }) {
  if (!dropOff && !pickup) return null;
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold uppercase tracking-wide text-yellow-400/90">{title}</p>
      <div className="rounded-md bg-black/25 border border-white/10 p-3 space-y-2">
        <div className="flex items-start gap-2 text-sm">
          <Calendar className="h-4 w-4 text-orange-300 mt-0.5 shrink-0" />
          <div>
            <p className="text-blue-200 text-xs">Drop-off (delivery)</p>
            <p className="text-white font-medium">{dropOff || 'Not specified'}</p>
          </div>
        </div>
        <div className="flex items-start gap-2 text-sm">
          <Clock className="h-4 w-4 text-orange-300 mt-0.5 shrink-0" />
          <div>
            <p className="text-blue-200 text-xs">Pickup (return)</p>
            <p className="text-white font-medium">{pickup || 'Not specified'}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Renders change-request / reschedule notes in a clear, everyday layout.
 * Falls back to plain text for unrelated note content.
 */
export function ChangeRequestNoteContent({ content, source, className = '' }) {
  if (!isChangeRequestNote(source, content)) {
    return (
      <p className={`text-white whitespace-pre-wrap ${className}`.trim()}>
        {content}
      </p>
    );
  }

  const parsed = parseChangeRequestNote(content);
  if (!parsed) {
    return (
      <p className={`text-white whitespace-pre-wrap ${className}`.trim()}>
        {content}
      </p>
    );
  }

  const serviceChanged =
    parsed.serviceFrom &&
    parsed.serviceTo &&
    parsed.serviceFrom !== parsed.serviceTo;

  const originalDropOff =
    parsed._friendlyOriginalDropOff ||
    formatFriendlyDateTime(parsed.originalDropOffDate, parsed.originalDropOffTime);
  const originalPickup =
    parsed._friendlyOriginalPickup ||
    formatFriendlyDateTime(parsed.originalPickupDate, parsed.originalPickupTime);
  const requestedDropOff =
    parsed._friendlyRequestedDropOff ||
    formatFriendlyDateTime(parsed.requestedDropOffDate, parsed.requestedDropOffTime);
  const requestedPickup =
    parsed._friendlyRequestedPickup ||
    formatFriendlyDateTime(parsed.requestedPickupDate, parsed.requestedPickupTime);

  return (
    <div className={`space-y-4 not-italic ${className}`.trim()}>
      <div>
        <p className="text-white font-semibold">
          {parsed.bookingId
            ? `Reschedule request for booking #${parsed.bookingId}`
            : 'Reschedule request'}
        </p>
        <p className="text-orange-300 text-sm mt-1">
          Needs scheduling approval before the booking is updated.
        </p>
      </div>

      {(parsed.serviceFrom || parsed.serviceTo) && (
        <div className="flex items-start gap-2">
          <Package className="h-4 w-4 text-yellow-400 mt-0.5 shrink-0" />
          <div className="text-sm">
            <p className="text-blue-200 text-xs mb-0.5">Service</p>
            {serviceChanged ? (
              <p className="text-white">
                <span className="text-gray-300">{parsed.serviceFrom}</span>
                <span className="mx-2 text-yellow-400">→</span>
                <span className="font-medium">{parsed.serviceTo}</span>
              </p>
            ) : (
              <p className="text-white font-medium">
                {parsed.serviceTo || parsed.serviceFrom}
              </p>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3">
        <ScheduleBlock
          title="Current schedule"
          dropOff={originalDropOff}
          pickup={originalPickup}
        />
        <ScheduleBlock
          title="Requested schedule"
          dropOff={requestedDropOff}
          pickup={requestedPickup}
        />
      </div>

      {parsed.deliveryAddress && (
        <div className="flex items-start gap-2">
          <MapPin className="h-4 w-4 text-yellow-400 mt-0.5 shrink-0" />
          <div className="text-sm">
            <p className="text-blue-200 text-xs mb-0.5">Delivery address</p>
            <p className="text-white">{parsed.deliveryAddress}</p>
            {parsed.addressNeedsVerification && (
              <p className="text-orange-300 text-xs mt-1">
                Address needs verification by customer service.
              </p>
            )}
            {parsed.distance != null && parsed.distance !== '' && parsed.distance !== '0' && (
              <p className="text-gray-400 text-xs mt-1">{parsed.distance} miles</p>
            )}
          </div>
        </div>
      )}

      {(parsed.originalAddons || parsed.requestedAddons) && (
        <div className="space-y-1 text-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-yellow-400/90">Add-ons</p>
          <DetailRow label="Current:" value={parsed.originalAddons || 'None'} />
          <DetailRow label="Requested:" value={parsed.requestedAddons || 'None'} />
        </div>
      )}

      {(parsed.equipmentReturn || parsed.equipmentAllocate || parsed.equipmentUnchanged) && (
        <div className="space-y-1 text-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-yellow-400/90">Equipment</p>
          <DetailRow label="To return:" value={parsed.equipmentReturn} />
          <DetailRow label="To allocate:" value={parsed.equipmentAllocate} />
          <DetailRow label="Unchanged:" value={parsed.equipmentUnchanged} />
        </div>
      )}

      {parsed.comments && (
        <div className="flex items-start gap-2">
          <MessageSquare className="h-4 w-4 text-yellow-400 mt-0.5 shrink-0" />
          <div className="text-sm">
            <p className="text-blue-200 text-xs mb-0.5">Customer comments</p>
            <p className="text-white whitespace-pre-wrap">{parsed.comments}</p>
          </div>
        </div>
      )}

      {parsed.submittedAt && (
        <p className="text-xs text-gray-400">
          Submitted {formatFriendlyTimestamp(parsed.submittedAt) || parsed.submittedAt}
        </p>
      )}
    </div>
  );
}
