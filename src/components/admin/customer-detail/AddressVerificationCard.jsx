import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';
import { MapPin, Check, X, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { formatAddressDisplay, formatAddressParts } from '@/utils/addressHelpers';
import { getVerificationDeadlineInfo, VERIFICATION_LEAD_HOURS } from '@/utils/verificationDeadline';
import { loadCancellationFee } from '@/utils/cancellationFee';
import { isLicenseSkipBooking } from '@/utils/paymentDelta';
import { reinstatePinTrackingPatch, expireActiveRentalAccessCodesForOrder } from '@/utils/bookingPinReinstate';
import { RefundDialog } from './CustomerVerification';

const DEFAULT_REASON = 'Address entered manually';

function unverifiedAddressText(booking) {
  if (booking?.unverified_address) return booking.unverified_address;
  return (
    formatAddressDisplay(booking?.delivery_address) ||
    formatAddressDisplay(booking?.contact_address) ||
    formatAddressParts(booking?.street, booking?.city, booking?.state, booking?.zip) ||
    'No address was saved.'
  );
}

function deadlineCopy(booking) {
  const info = getVerificationDeadlineInfo(booking);
  if (!info.deadlineAt) {
    return `This address must be reviewed at least ${VERIFICATION_LEAD_HOURS} hours before pickup. Pickup time is not set, so the hours remaining cannot be calculated.`;
  }
  if (info.isPastDeadline) {
    return `The deadline has passed. This address had to be verified ${VERIFICATION_LEAD_HOURS} hours before pickup. The order can be canceled, and a cancellation fee from pricing will be charged.`;
  }
  const hoursLabel = info.hoursRemaining === 1 ? '1 hour' : `${info.hoursRemaining} hours`;
  return `${hoursLabel} left before this address verification expires (${VERIFICATION_LEAD_HOURS} hours before pickup).`;
}

export const AddressVerificationCard = ({ booking, customer, onUpdate }) => {
  const { user } = useAuth();
  const [fee, setFee] = useState(null);
  const [approving, setApproving] = useState(false);
  const [refundOpen, setRefundOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadCancellationFee(booking).then((next) => {
      if (!cancelled) setFee(next);
    }).catch(() => {
      if (!cancelled) setFee(null);
    });
    return () => {
      cancelled = true;
    };
  }, [booking]);

  const statement = (booking?.pending_verification_reason || '').trim();
  const showStatement = statement && statement !== DEFAULT_REASON;
  const licenseStillNeeded = isLicenseSkipBooking(booking);

  const handleApprove = async () => {
    setApproving(true);
    try {
      const adminEmail = user?.email || 'admin';
      const prevStatus = booking.status;
      const nextStatus = licenseStillNeeded ? prevStatus : 'Confirmed';
      const { error: updateError } = await supabase
        .from('bookings')
        .update({
          pending_address_verification: false,
          unverified_address: null,
          pending_verification_reason: null,
          address_verified_by_admin: adminEmail,
          address_verified_date: new Date().toISOString(),
          status: nextStatus,
          addons: {
            ...(booking.addons || {}),
            pending_address_verification: false,
          },
          ...reinstatePinTrackingPatch(prevStatus, nextStatus),
        })
        .eq('id', booking.id);
      if (updateError) throw updateError;

      if (booking.customer_id) {
        const { error: customerError } = await supabase
          .from('customers')
          .update({
            street: booking.street,
            city: booking.city,
            state: booking.state,
            zip: booking.zip,
            unverified_address: false,
          })
          .eq('id', booking.customer_id);
        if (customerError) throw customerError;
      }

      if (prevStatus === 'pending_review' && nextStatus === 'Confirmed') {
        await expireActiveRentalAccessCodesForOrder(booking.id);
      }

      await supabase.from('customer_notes').insert({
        customer_id: booking.customer_id,
        booking_id: booking.id,
        source: 'Address Verification',
        content: `Address manually verified and approved by ${adminEmail}. Status updated to ${nextStatus}.`,
        author_type: 'admin',
      });

      if (nextStatus === 'Confirmed') {
        await supabase.functions.invoke('send-booking-confirmation', {
          body: { bookingId: booking.id },
        });
      }

      toast({
        title: 'Address verified',
        description: licenseStillNeeded
          ? 'The address hold is cleared. License verification is still pending.'
          : 'The booking is confirmed and the customer has been notified.',
      });
      onUpdate?.();
    } catch (error) {
      toast({ title: 'Approval failed', description: error.message, variant: 'destructive' });
    } finally {
      setApproving(false);
    }
  };

  return (
    <>
      <RefundDialog
        booking={booking}
        customer={customer}
        open={refundOpen}
        onOpenChange={setRefundOpen}
        onUpdate={onUpdate}
        initialReason="Address could not be verified. Order canceled and the cancellation fee from admin pricing was applied."
      />
      <div className="bg-orange-900/20 border border-orange-500/50 rounded-xl p-6 space-y-4">
        <div>
          <h3 className="text-xl font-bold text-orange-300 flex items-center">
            <MapPin className="mr-2 h-6 w-6" />
            Address verification needed — booking #{booking.id}
          </h3>
          <p className="text-sm text-orange-100 mt-2">
            This is an address verification. Google did not validate the address the customer entered. It is not a license, insurance, or scheduling review.
          </p>
        </div>
        <div className="rounded-md border border-orange-500/40 bg-black/30 p-4 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-orange-300">Address that was not validated</p>
          <p className="text-white font-medium">{unverifiedAddressText(booking)}</p>
          {showStatement && (
            <p className="text-sm text-gray-200">
              <span className="font-semibold text-gray-400">Customer statement: </span>
              {statement}
            </p>
          )}
        </div>
        <p className="text-sm text-yellow-100">{deadlineCopy(booking)}</p>
        <p className="text-sm text-gray-200">
          {fee ? (
            <>
              Canceling this order charges the {fee.feeType === 'late' ? 'late' : 'advance'} cancellation fee of {fee.percentage}%
              {' '}(${Number(fee.feeAmount).toFixed(2)}) from admin pricing. The refund would be ${Number(fee.refundAmount).toFixed(2)} of the ${Number(fee.total).toFixed(2)} total.
              {' '}Accepting the address clears this hold{licenseStillNeeded ? ' and leaves the license verification in place' : ' and confirms the booking'}.
            </>
          ) : (
            <>Canceling charges the cancellation fee from admin pricing. Accepting the address clears this hold{licenseStillNeeded ? ' and leaves the license verification in place' : ' and confirms the booking'}.</>
          )}
        </p>
        <div className="flex flex-wrap justify-end gap-2">
          <Button size="sm" variant="destructive" onClick={() => setRefundOpen(true)} disabled={approving}>
            <X className="mr-2 h-4 w-4" /> Cancel & Refund
          </Button>
          <Button size="sm" className="bg-green-600 hover:bg-green-700" onClick={handleApprove} disabled={approving}>
            {approving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
            Accept address
          </Button>
        </div>
      </div>
    </>
  );
};
