import React, { useCallback, useEffect, useRef, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { AlertCircle, Clock, Key, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';
import { parseEdgeFunctionError } from '@/utils/parseEdgeFunctionError';
import { getBookingWindow, isBookingEnded, isWithinPinGenerationWindow } from '@/utils/pinTiming';
import { convertTo12Hour } from '@/utils/timeFormatConverter';
import { BookingLockStatusSection } from '@/components/customer-portal/BookingLockStatusSection';
import { mentionsDumpTrailer } from '@/utils/displayPlanName';

const PENDING_POLL_MS = 30_000;
const PENDING_POLL_MAX_MS = 20 * 60 * 1000;
const MAX_RETRIES = 5;

function requiresAccessCode(booking) {
  const planName = booking?.plan?.name?.toLowerCase() || '';
  return (
    mentionsDumpTrailer(planName) ||
    planName.includes('trailer') ||
    parseInt(booking?.plan?.id, 10) === 2
  );
}

function formatDateTime(dateStr, timeSlot) {
  if (!dateStr) return 'N/A';
  try {
    const date = parseISO(dateStr);
    const dateFormatted = format(date, 'MMM dd, yyyy');
    const timeLabel = timeSlot ? convertTo12Hour(timeSlot) || timeSlot : '';
    return `${dateFormatted}${timeLabel ? ` at ${timeLabel}` : ''}`;
  } catch {
    return dateStr;
  }
}

export const BookingAccessCodeSection = ({ booking }) => {
  const [loading, setLoading] = useState(true);
  const [accessCode, setAccessCode] = useState(null);
  const [accessCodes, setAccessCodes] = useState([]);
  const [issuingBackup, setIssuingBackup] = useState(false);
  const [generatingPin, setGeneratingPin] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [issuingToLock, setIssuingToLock] = useState(false);
  const hasLoadedOnceRef = useRef(false);
  const pendingPollStartedAtRef = useRef(null);

  const needsCode = requiresAccessCode(booking);
  const bookingId = booking?.id;

  const fetchAccessCode = useCallback(async ({ silent = false } = {}) => {
    if (!bookingId || !needsCode) return;

    try {
      if (!silent || !hasLoadedOnceRef.current) {
        setLoading(true);
      }

      const { data, error } = await supabase
        .from('rental_access_codes')
        .select('*')
        .eq('order_id', bookingId)
        .eq('status', 'active')
        .order('created_at', { ascending: false });

      if (error) {
        console.error('[BookingAccessCodeSection] Access code query error:', error);
        return;
      }

      const rows = data || [];
      setAccessCodes(rows);
      if (rows.length > 0) {
        const codeRecord = booking?.pin_failsafe_at
          ? (rows.find((row) => row.pin_type === 'algopin') || rows[0])
          : (rows.find((row) => row.pin_type === 'bridge_proxied') || rows[0]);
        setAccessCode(codeRecord);
        setIssuingToLock(
          !!codeRecord.access_pin &&
            !codeRecord.lock_confirmed_at &&
            codeRecord.pin_type === 'bridge_proxied'
        );
        if (codeRecord.access_pin && (codeRecord.lock_confirmed_at || codeRecord.pin_type === 'algopin')) {
          setRetryCount(0);
          pendingPollStartedAtRef.current = null;
        }
      } else {
        setAccessCode(null);
        setAccessCodes([]);
        setIssuingToLock(false);
      }
    } catch (err) {
      console.error('[BookingAccessCodeSection] Unexpected error:', err);
    } finally {
      hasLoadedOnceRef.current = true;
      setLoading(false);
    }
  }, [bookingId, needsCode, booking?.pin_failsafe_at]);

  useEffect(() => {
    if (bookingId && needsCode) {
      fetchAccessCode({ silent: false });
    } else {
      setLoading(false);
      setAccessCode(null);
    }
  }, [bookingId, needsCode, fetchAccessCode]);

  useEffect(() => {
    if (!booking || !needsCode) return;

    const pinReady =
      !!accessCode?.access_pin &&
      (!!accessCode.lock_confirmed_at || accessCode.pin_type === 'algopin');
    const windowOpen = isWithinPinGenerationWindow(booking) && !isBookingEnded(booking);
    if (!windowOpen || pinReady) {
      pendingPollStartedAtRef.current = null;
      return;
    }

    if (!pendingPollStartedAtRef.current) {
      pendingPollStartedAtRef.current = Date.now();
    }

    const intervalId = setInterval(() => {
      const started = pendingPollStartedAtRef.current || Date.now();
      if (Date.now() - started > PENDING_POLL_MAX_MS) {
        clearInterval(intervalId);
        return;
      }
      fetchAccessCode({ silent: true });
    }, PENDING_POLL_MS);

    return () => clearInterval(intervalId);
  }, [booking, accessCode, needsCode, fetchAccessCode]);

  useEffect(() => {
    if (!bookingId || !needsCode) return;

    const channel = supabase
      .channel(`booking-detail-access-codes-${bookingId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'rental_access_codes',
          filter: `order_id=eq.${bookingId}`,
        },
        () => {
          fetchAccessCode({ silent: true });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [bookingId, needsCode, fetchAccessCode]);

  const handleRefreshClick = () => {
    if (retryCount >= MAX_RETRIES) {
      toast({
        title: 'Maximum Retries Reached',
        description: 'Please contact support if your access code has not appeared.',
        variant: 'destructive',
      });
      return;
    }

    setRetryCount((prev) => prev + 1);
    fetchAccessCode({ silent: true });
  };

  const handleGeneratePin = async () => {
    if (!booking?.id) {
      toast({
        title: 'Booking Not Ready',
        description: 'Please refresh and try again.',
        variant: 'destructive',
      });
      return;
    }

    if (isBookingEnded(booking)) {
      toast({
        title: 'Rental Ended',
        description: 'This rental period has ended. Access codes are no longer available.',
        variant: 'destructive',
      });
      return;
    }

    if (!isWithinPinGenerationWindow(booking)) {
      toast({
        title: 'Not Available Yet',
        description: 'Access codes are issued 12 hours before your scheduled pickup.',
        variant: 'destructive',
      });
      return;
    }

    setRetryCount(0);

    try {
      setGeneratingPin(true);

      const { data, error } = await supabase.functions.invoke('generate-pin', {
        body: {
          bookingId: booking.id,
          callerType: 'customer',
        },
      });

      if (error) {
        throw new Error(await parseEdgeFunctionError(error, data));
      }
      if (data?.success === false || !data?.pin) {
        throw new Error(data?.error || 'Failed to generate access PIN');
      }

      setAccessCode({
        order_id: booking.id,
        access_pin: data.pin,
        pin_id: data.pinId || '',
        pin_type: data.pinType || '',
        start_time: `${booking.drop_off_date}T00:00:00Z`,
        end_time: `${booking.pickup_date}T23:59:59Z`,
        status: 'active',
        lock_confirmed_at: data.lockConfirmed ? new Date().toISOString() : null,
      });
      setIssuingToLock(!data.lockConfirmed && data.pinType === 'bridge_proxied');
      setRetryCount(0);
      await fetchAccessCode({ silent: true });

      toast({
        title: data.lockConfirmed ? 'Access PIN Ready' : 'PIN Issuing to Lock',
        description: data.lockConfirmed
          ? 'Your access PIN is confirmed and ready.'
          : 'Your PIN was queued on the lock. This page will update when confirmation arrives.',
      });
    } catch (err) {
      console.error('[BookingAccessCodeSection] Generate PIN error:', err);
      toast({
        title: 'PIN Generation Failed',
        description: err.message || 'Unable to generate your access PIN. Please try again or contact support.',
        variant: 'destructive',
      });
    } finally {
      setGeneratingPin(false);
    }
  };

  if (!booking || !needsCode) return null;

  const pinWindowOpen = isWithinPinGenerationWindow(booking);
  const bookingEnded = isBookingEnded(booking);
  const pinEligibleFrom = new Date(getBookingWindow(booking).pinEligibleFromMs);
  const pinReady = (accessCodes.length ? accessCodes : accessCode ? [accessCode] : []).some(
    (code) => code?.access_pin && (code.lock_confirmed_at || code.pin_type === 'algopin'),
  );
  const rentalExpired = bookingEnded;

  const visibleStartLabel = formatDateTime(booking.drop_off_date, booking.drop_off_time_slot);
  const visibleEndLabel = formatDateTime(booking.pickup_date, booking.pickup_time_slot);

  if (loading) {
    return (
      <div className="bg-black/20 p-4 rounded-lg border border-white/5">
        <div className="flex items-center gap-2 text-gray-300 text-sm">
          <Loader2 className="h-4 w-4 animate-spin text-yellow-400" />
          Loading access code…
        </div>
      </div>
    );
  }

  if (rentalExpired) {
    return (
      <div className="space-y-3">
        <div className="bg-red-500/10 p-4 rounded-lg border border-red-500/30">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-red-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-red-300">Rental Period Ended</p>
              <p className="text-sm text-gray-300 mt-1">
                This rental period has ended. Your access code is no longer valid.
              </p>
            </div>
          </div>
        </div>
        <BookingLockStatusSection bookingId={bookingId} />
      </div>
    );
  }

  if (!pinWindowOpen) {
    return (
      <div className="bg-black/20 p-4 rounded-lg border border-white/5">
        <div className="flex items-start gap-3">
          <Clock className="h-5 w-5 text-blue-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-white">Access Code Not Yet Available</p>
            <p className="text-sm text-gray-300 mt-2 leading-relaxed">
              Your access code will be available 12 hours before your scheduled pickup
              {Number.isFinite(pinEligibleFrom.getTime()) ? (
                <>
                  {' '}
                  on{' '}
                  <span className="text-white font-medium">
                    {format(pinEligibleFrom, 'MMM dd, yyyy')} at {format(pinEligibleFrom, 'h:mm a')}
                  </span>
                </>
              ) : null}
              . Please come back when it is within 12 hours of your rental pickup time.
            </p>
            <p className="text-xs text-gray-400 mt-2">
              Scheduled pickup: {visibleStartLabel}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const rentalStarted = Boolean(booking.rented_out_at) || getBookingWindow(booking).startMs <= Date.now();
  const requestBackupCode = async () => {
    setIssuingBackup(true);
    try {
      const { data, error } = await supabase.functions.invoke('issue-return-algopin', {
        body: { bookingId, callerType: 'customer' },
      });
      if (error) throw new Error(await parseEdgeFunctionError(error, data));
      if (!data?.pin) throw new Error(data?.error || 'Could not create a backup return code.');
      await fetchAccessCode({ silent: true });
      toast({
        title: 'Backup return code ready',
        description: data.activationRequired
          ? 'Enter it once on the lock within 24 hours of its start.'
          : 'Use this code if you need another way back into the trailer.',
      });
    } catch (err) {
      toast({ title: 'Backup code unavailable', description: err.message, variant: 'destructive' });
    } finally {
      setIssuingBackup(false);
    }
  };

  if (pinReady) {
    const listed = (accessCodes.length ? accessCodes : [accessCode]).filter(
      (code) => code && (!booking?.pin_failsafe_at || code.pin_type === 'algopin'),
    );
    return (
      <div className="space-y-3">
        {listed.map((code) => {
          const hours = code.start_time && code.end_time
            ? (new Date(code.end_time).getTime() - new Date(code.start_time).getTime()) / (60 * 60 * 1000)
            : 0;
              const label = booking?.pin_failsafe_at
                ? 'Access code'
                : (code.pin_type === 'algopin' ? 'Return code' : 'Original code');
          return (
            <div key={code.id || code.access_pin} className="bg-black/30 p-4 rounded-lg border border-yellow-400/40 space-y-3">
              <div className="flex items-center gap-2">
                <Key className="h-4 w-4 text-yellow-400" />
                <p className="text-xs uppercase tracking-widest text-yellow-400 font-semibold">{label}</p>
              </div>
              <div className="bg-slate-950/80 rounded-lg px-4 py-3 text-center border border-white/10">
                <p className="text-4xl font-bold font-mono text-white tracking-wider">{code.access_pin}</p>
              </div>
              {code.pin_type === 'algopin' && hours > 24 && (
                <p className="text-sm text-amber-200">Enter this code once during the first 24 hours after it starts, or it will not work later.</p>
              )}
            </div>
          );
        })}
        {booking?.pin_failsafe_at && (
          <p className="text-sm text-amber-200">
            This code replaced your custom PIN because the lock did not confirm it before your appointment window.
          </p>
        )}
        <p className="text-sm text-gray-300">
          Pickup {visibleStartLabel}. Return by {visibleEndLabel}.
        </p>
        {rentalStarted && !bookingEnded && (
          <Button onClick={requestBackupCode} disabled={issuingBackup} size="sm" className="bg-yellow-500 hover:bg-yellow-600 text-black">
            {issuingBackup ? 'Creating backup code…' : 'Get a backup return code'}
          </Button>
        )}
        <BookingLockStatusSection bookingId={bookingId} />
      </div>
    );
  }

  return (
    <div className="bg-yellow-500/10 p-4 rounded-lg border border-yellow-500/30 space-y-3">
      <div className="flex items-start gap-3">
        <Key className="h-5 w-5 text-yellow-400 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white">
            {issuingToLock || accessCode?.access_pin
              ? 'Issuing to Lock…'
              : 'Preparing Your Access PIN'}
          </p>
          {retryCount >= MAX_RETRIES ? (
            <p className="text-sm text-red-300 mt-2">
              Your PIN is taking longer than expected. Support has been or will be alerted
              automatically. You can still try generating manually or contact us.
            </p>
          ) : (
            <p className="text-sm text-gray-300 mt-2 leading-relaxed">
              {issuingToLock || accessCode?.access_pin
                ? 'Your PIN was sent to the padlock and we are waiting for confirmation. This usually finishes within a few minutes.'
                : 'Your pickup window is open. Our system creates your PIN automatically within about 5 minutes. You can also generate it manually below.'}
            </p>
          )}
          {retryCount > 0 && retryCount < MAX_RETRIES && (
            <p className="text-xs text-gray-400 mt-2">
              Refresh attempts: {retryCount} of {MAX_RETRIES}
            </p>
          )}
        </div>
      </div>

      {rentalStarted && !bookingEnded && (
        <Button onClick={requestBackupCode} disabled={issuingBackup} size="sm" className="bg-yellow-500 hover:bg-yellow-600 text-black">
          {issuingBackup ? 'Creating backup code…' : 'Get a backup return code'}
        </Button>
      )}
      <div className="flex flex-col sm:flex-row gap-2">
        <Button
          onClick={handleGeneratePin}
          disabled={generatingPin || !pinWindowOpen}
          className="bg-yellow-500 hover:bg-yellow-600 text-black"
          size="sm"
        >
          {generatingPin ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Generating...
            </>
          ) : (
            <>
              <Key className="h-4 w-4 mr-2" />
              Generate Access PIN
            </>
          )}
        </Button>
        <Button
          onClick={handleRefreshClick}
          disabled={retryCount >= MAX_RETRIES || generatingPin}
          variant="outline"
          size="sm"
          className="border-white/30 text-white hover:bg-white/10"
        >
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>
    </div>
  );
};

export default BookingAccessCodeSection;
