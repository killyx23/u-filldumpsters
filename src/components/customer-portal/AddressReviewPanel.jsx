import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { GooglePlacesAutocomplete } from '@/components/GooglePlacesAutocomplete';
import { Loader2, MapPin } from 'lucide-react';
import { applySelectedAddress, formatAddressDisplay } from '@/utils/addressHelpers';
import { formatAddressDeadlineMessage } from '@/utils/verificationDeadline';
import { loadCancellationFee } from '@/utils/cancellationFee';
import { calculateOneWayMilesForAddress } from '@/utils/bookingMileage';
import { reinstatePinTrackingPatch } from '@/utils/bookingPinReinstate';

export const AddressReviewPanel = ({ bookings = [], onUpdate }) => {
  const pending = (bookings || []).filter((b) => b.pending_address_verification);
  const [feesByBooking, setFeesByBooking] = useState({});
  const [selectedByBooking, setSelectedByBooking] = useState({});
  const [statements, setStatements] = useState({});
  const [busyId, setBusyId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const entries = await Promise.all(
        pending.map(async (booking) => [booking.id, await loadCancellationFee(booking)])
      );
      if (!cancelled) {
        setFeesByBooking(Object.fromEntries(entries));
      }
    };
    if (pending.length > 0) load();
    return () => {
      cancelled = true;
    };
  }, [pending.map((b) => b.id).join(',')]);

  if (pending.length === 0) return null;

  const clearHold = async (booking) => {
    const selected = selectedByBooking[booking.id];
    const address = applySelectedAddress(selected);
    if (!address?.isVerified || !address.street || !address.city || !address.state || !address.zip) {
      toast({
        title: 'Choose a validated address',
        description: 'Select the address from the Google suggestions so it can be verified.',
        variant: 'destructive',
      });
      return;
    }

    setBusyId(booking.id);
    try {
      const licenseStillNeeded =
        booking.status === 'pending_verification' || Boolean(booking.was_verification_skipped);
      const nextStatus =
        !licenseStillNeeded && booking.status === 'pending_review' ? 'Confirmed' : booking.status;
      const verifiedAddress = {
        ...address,
        isVerified: true,
        unverifiedAccepted: false,
        formatted_address: formatAddressDisplay(address),
      };
      const nextAddons = {
        ...(booking.addons || {}),
        pending_address_verification: false,
      };
      const update = {
        pending_address_verification: false,
        unverified_address: null,
        pending_verification_reason: null,
        delivery_address: verifiedAddress,
        addons: nextAddons,
        status: nextStatus,
        ...reinstatePinTrackingPatch(booking.status, nextStatus),
      };
      const contactUnverified =
        !booking.contact_address?.isVerified || booking.contact_address?.unverifiedAccepted === true;
      if (contactUnverified) {
        update.contact_address = verifiedAddress;
        update.street = verifiedAddress.street;
        update.city = verifiedAddress.city;
        update.state = verifiedAddress.state;
        update.zip = verifiedAddress.zip;
      }

      try {
        const miles = await calculateOneWayMilesForAddress(formatAddressDisplay(verifiedAddress));
        if (miles != null && Number.isFinite(Number(miles)) && Number(miles) > 0) {
          update.distance_miles = Number(miles);
        }
      } catch (mileageError) {
        console.warn('[AddressReviewPanel] mileage update skipped:', mileageError);
      }

      const { error } = await supabase.from('bookings').update(update).eq('id', booking.id);
      if (error) throw error;

      if (booking.customer_id) {
        const { error: customerError } = await supabase
          .from('customers')
          .update({
            street: verifiedAddress.street,
            city: verifiedAddress.city,
            state: verifiedAddress.state,
            zip: verifiedAddress.zip,
            unverified_address: false,
          })
          .eq('id', booking.customer_id);
        if (customerError) throw customerError;
      }

      if (nextStatus === 'Confirmed') {
        await supabase.functions.invoke('send-booking-confirmation', {
          body: { bookingId: booking.id },
        });
      }

      toast({
        title: 'Address verified',
        description: 'Your address checked out. The booking can proceed.',
      });
      onUpdate?.();
    } catch (error) {
      toast({ title: 'Could not update address', description: error.message, variant: 'destructive' });
    } finally {
      setBusyId(null);
    }
  };

  const submitStatement = async (booking, statementText) => {
    const statement = (statementText || '').trim();
    if (!statement) {
      toast({
        title: 'Statement required',
        description: 'Explain why this address cannot be validated through Google.',
        variant: 'destructive',
      });
      return;
    }

    setBusyId(booking.id);
    try {
      const { error } = await supabase
        .from('bookings')
        .update({ pending_verification_reason: statement })
        .eq('id', booking.id);
      if (error) throw error;
      toast({
        title: 'Submitted for review',
        description: 'Your address stays pending until our team approves it.',
      });
      onUpdate?.();
    } catch (error) {
      toast({ title: 'Could not save statement', description: error.message, variant: 'destructive' });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4 mb-6">
      {pending.map((booking) => {
        const fee = feesByBooking[booking.id];
        const message = formatAddressDeadlineMessage(booking, fee);
        const selected = selectedByBooking[booking.id];
        const verifiedReady = Boolean(applySelectedAddress(selected || {}).isVerified && selected?.street);
        const busy = busyId === booking.id;
        const existingStatement =
          booking.pending_verification_reason &&
          booking.pending_verification_reason !== 'Address entered manually'
            ? booking.pending_verification_reason
            : '';
        const statementValue = statements[booking.id] ?? existingStatement;
        return (
          <Card key={booking.id} className="bg-orange-950/40 border-orange-500/50 text-white">
            <CardHeader>
              <CardTitle className="text-lg font-bold text-orange-300 flex items-center">
                <MapPin className="mr-2 h-5 w-5" /> Address verification — booking #{booking.id}
              </CardTitle>
              <CardDescription className="text-orange-100">
                {booking.unverified_address || formatAddressDisplay(booking.delivery_address)}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {message && (
                <p className="text-sm text-orange-100 bg-orange-900/40 border border-orange-500/30 rounded-lg p-3">
                  {message}
                </p>
              )}
              <div className="space-y-2">
                <Label>Correct the address</Label>
                <GooglePlacesAutocomplete
                  value={selected?.street || ''}
                  onChange={(val) =>
                    setSelectedByBooking((prev) => ({
                      ...prev,
                      [booking.id]: { street: val, isVerified: false, unverifiedAccepted: true },
                    }))
                  }
                  onAddressSelect={(details) =>
                    setSelectedByBooking((prev) => ({
                      ...prev,
                      [booking.id]: applySelectedAddress(details),
                    }))
                  }
                  placeholder="Search for the correct address..."
                />
                <Button
                  type="button"
                  onClick={() => clearHold(booking)}
                  disabled={busy || !verifiedReady}
                  className="bg-green-600 hover:bg-green-700 text-white"
                >
                  {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Use this validated address
                </Button>
              </div>
              <div className="space-y-2 border-t border-white/10 pt-4">
                <Label htmlFor={`address-statement-${booking.id}`}>
                  If Google cannot validate this address, explain why
                </Label>
                <Textarea
                  id={`address-statement-${booking.id}`}
                  value={statementValue}
                  onChange={(e) =>
                    setStatements((prev) => ({ ...prev, [booking.id]: e.target.value }))
                  }
                  placeholder="Tell us why the address cannot be matched in Google and how we should find the delivery location."
                  className="bg-white/10 text-white min-h-[100px]"
                  disabled={busy}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => submitStatement(booking, statementValue)}
                  disabled={busy || !statementValue.trim()}
                  className="border-orange-400 text-orange-200 hover:bg-orange-500/20"
                >
                  Submit for address review
                </Button>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
};
