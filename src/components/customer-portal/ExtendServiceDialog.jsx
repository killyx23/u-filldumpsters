import React, { useEffect, useMemo, useRef, useState } from 'react';
import { addDays, format, parseISO } from 'date-fns';
import { CalendarClock, Loader2, Printer } from 'lucide-react';
import { useReactToPrint } from 'react-to-print';
import { supabase } from '@/lib/customSupabaseClient';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from '@/components/ui/use-toast';
import { ComprehensiveAgreement } from '@/components/ComprehensiveAgreement';
import { PrintableReceipt } from '@/components/PrintableReceipt';
import { canExtendBooking, quoteRentalExtension } from '@/utils/rentalExtension';

const formatClock = (timeString) => {
  if (!timeString) return 'the scheduled return time';
  const match = String(timeString).match(/^(\d{1,2}):(\d{2})/);
  if (!match) return String(timeString);
  const date = new Date();
  date.setHours(parseInt(match[1], 10), parseInt(match[2], 10), 0, 0);
  return format(date, 'h:mm a');
};

const money = (amount) => `$${Number(amount || 0).toFixed(2)}`;

export const ExtendServiceDialog = ({
  booking,
  open,
  onClose,
  customer,
  onReorder,
  onExtended,
}) => {
  const [availability, setAvailability] = useState({});
  const [loadingDates, setLoadingDates] = useState(false);
  const [selectedDate, setSelectedDate] = useState(null);
  const [reorderDate, setReorderDate] = useState(null);
  const [step, setStep] = useState('dates');
  const [charging, setCharging] = useState(false);
  const [extendedBooking, setExtendedBooking] = useState(null);
  const receiptRef = useRef(null);
  const handlePrint = useReactToPrint({ content: () => receiptRef.current });

  const currentPickup = booking?.pickup_date ? String(booking.pickup_date).slice(0, 10) : '';
  const firstExtraDay = currentPickup ? addDays(parseISO(currentPickup), 1) : null;
  const horizonEnd = firstExtraDay ? addDays(firstExtraDay, 90) : null;

  useEffect(() => {
    if (!open) return;
    setAvailability({});
    setSelectedDate(null);
    setReorderDate(null);
    setStep('dates');
    setCharging(false);
    setExtendedBooking(null);
  }, [open, booking?.id]);

  useEffect(() => {
    if (!open || !booking?.plan?.id || !currentPickup) return;
    const rangeStart = addDays(parseISO(currentPickup), 1);
    const rangeEnd = addDays(rangeStart, 90);
    let cancelled = false;
    const load = async () => {
      setLoadingDates(true);
      try {
        const { data, error } = await supabase.functions.invoke('get-availability', {
          body: {
            serviceId: booking.plan.id,
            isDelivery: Boolean(booking.addons?.isDelivery || booking.addons?.deliveryService),
            startDate: format(rangeStart, 'yyyy-MM-dd'),
            endDate: format(rangeEnd, 'yyyy-MM-dd'),
          },
        });
        if (cancelled) return;
        if (error || data?.error) throw error || new Error(data.error);
        setAvailability(data?.availability || {});
      } catch (err) {
        if (!cancelled) {
          toast({
            title: 'Availability error',
            description: err?.message || 'Could not load open dates.',
            variant: 'destructive',
          });
        }
      } finally {
        if (!cancelled) setLoadingDates(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [open, booking?.id, booking?.plan?.id, currentPickup]);

  const quote = useMemo(() => {
    if (!booking || !selectedDate) return null;
    return quoteRentalExtension(booking, format(selectedDate, 'yyyy-MM-dd'), availability);
  }, [booking, selectedDate, availability]);

  const nextDayBlocked = useMemo(() => {
    if (!firstExtraDay || loadingDates) return false;
    const row = availability[format(firstExtraDay, 'yyyy-MM-dd')];
    if (!row) return Object.keys(availability).length > 0;
    return row.inventoryAvailable === false;
  }, [firstExtraDay, availability, loadingDates]);

  const customerName = customer || booking?.customers || {};
  const nameParts = String(customerName.name || booking?.name || '').trim().split(/\s+/);
  const agreementBooking = {
    firstName: customerName.first_name || customerName.firstName || nameParts[0] || '',
    lastName: customerName.last_name || customerName.lastName || nameParts.slice(1).join(' ') || '',
  };

  const handleDayClick = (day) => {
    if (!booking || !firstExtraDay || day < firstExtraDay) return;
    const result = quoteRentalExtension(booking, format(day, 'yyyy-MM-dd'), availability);
    if (!result.ok) {
      setSelectedDate(null);
      setReorderDate(day);
      return;
    }
    setReorderDate(null);
    setSelectedDate(day);
  };

  const handleAccept = async ({ agreementSignature, agreementSignatureDate }) => {
    if (!quote?.ok || !booking) return;
    setCharging(true);
    try {
      const { data, error } = await supabase.functions.invoke('extend-booking', {
        body: {
          bookingId: booking.id,
          newPickupDate: quote.newPickup,
          agreementSignature,
          agreementSignatureDate,
        },
      });
      if (error) {
        let message = error.message;
        const response = error.context;
        if (response && typeof response.clone === 'function') {
          const raw = await response.clone().text().catch(() => '');
          if (raw) {
            try {
              const body = JSON.parse(raw);
              message = body.error || body.message || body.msg || raw;
            } catch {
              message = raw;
            }
          }
        }
        throw new Error(message || 'Could not extend this rental.');
      }
      if (data?.error) throw new Error(data.error);
      setExtendedBooking({ ...booking, ...data.booking, customers: booking.customers || customer });
      setStep('done');
      onExtended?.();
      toast({ title: 'Rental extended', description: `Charged ${money(quote.total)}.` });
    } catch (err) {
      toast({
        title: 'Extension was not completed',
        description: err?.message || 'The card was not charged for a new return date.',
        variant: 'destructive',
      });
    } finally {
      setCharging(false);
    }
  };

  if (!booking || !canExtendBooking(booking)) return null;

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !charging) onClose?.(); }}>
      <DialogContent className="bg-gray-950 text-white border-white/20 max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-yellow-300">
            <CalendarClock className="h-5 w-5" /> Extend service
          </DialogTitle>
        </DialogHeader>

        {step === 'dates' && (
          <div className="space-y-4">
            <div className="rounded-md border border-white/10 bg-white/5 p-3 text-sm">
              <p className="font-semibold text-white">Already booked</p>
              <p className="text-blue-100">Out: {format(parseISO(String(booking.drop_off_date).slice(0, 10)), 'MMM d, yyyy')}</p>
              <p className="text-blue-100">
                In: {format(parseISO(currentPickup), 'MMM d, yyyy')} by {formatClock(booking.pickup_time_slot)}
              </p>
            </div>

            {loadingDates && (
              <p className="flex items-center text-sm text-blue-200"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading open dates</p>
            )}

            {nextDayBlocked && (
              <div className="rounded-md border border-amber-500/40 bg-amber-950/40 p-3 text-sm text-amber-100">
                <p>The day after this rental is not open, so it cannot be extended. The trailer has to come back, and those later days need a new booking.</p>
                <Button className="mt-3" onClick={() => onReorder?.(booking)}>Start a new booking</Button>
              </div>
            )}

            {!nextDayBlocked && (
              <Calendar
                mode="single"
                selected={selectedDate}
                onDayClick={handleDayClick}
                disabled={(day) => !firstExtraDay || day < firstExtraDay || day > horizonEnd}
                defaultMonth={firstExtraDay || undefined}
              />
            )}

            {reorderDate && (
              <div className="rounded-md border border-amber-500/40 bg-amber-950/40 p-3 text-sm text-amber-100">
                <p>
                  {format(reorderDate, 'MMM d, yyyy')} is not a consecutive open day after this rental.
                  Return the trailer, then start a new booking for those days.
                </p>
                <Button className="mt-3" onClick={() => onReorder?.(booking)}>Start a new booking</Button>
              </div>
            )}

            {quote?.ok && (
              <div className="rounded-md border border-emerald-500/40 bg-emerald-950/30 p-3 text-sm space-y-1">
                <p className="font-semibold text-emerald-200">Extra dates</p>
                <p>{quote.dates.map((date) => format(parseISO(date), 'MMM d, yyyy')).join(', ')}</p>
                <p>{quote.days} day{quote.days === 1 ? '' : 's'} at {money(quote.dayRate)} per day</p>
                <p>Tax ({Number(quote.taxRate).toFixed(2)}%): {money(quote.tax)}</p>
                <p className="font-semibold text-white">Added total: {money(quote.total)}</p>
                <p>
                  The return moves to {format(parseISO(quote.newPickup), 'MMM d, yyyy')} by {formatClock(booking.pickup_time_slot)}.
                  It must be back, locked, and secured by that time.
                </p>
                <Button className="mt-2" onClick={() => setStep('agreement')}>Continue to agreement</Button>
              </div>
            )}
          </div>
        )}

        {step === 'agreement' && quote?.ok && (
          <div>
            <p className="mb-3 text-sm text-blue-100">
              Extending through {format(parseISO(quote.newPickup), 'MMM d, yyyy')} adds {money(quote.total)}.
              Have the trailer back, locked, and secured by {formatClock(booking.pickup_time_slot)} that day.
            </p>
            <ComprehensiveAgreement
              bookingData={agreementBooking}
              isProcessing={charging}
              onBack={() => setStep('dates')}
              onAccept={handleAccept}
            />
          </div>
        )}

        {step === 'done' && extendedBooking && (
          <div className="space-y-3">
            <p>The rental now returns {format(parseISO(String(extendedBooking.pickup_date).slice(0, 10)), 'MMM d, yyyy')} by {formatClock(extendedBooking.pickup_time_slot)}.</p>
            <p>New total: {money(extendedBooking.total_price)}. A confirmation was sent.</p>
            <div className="hidden">
              <PrintableReceipt ref={receiptRef} booking={extendedBooking} />
            </div>
            <Button onClick={handlePrint}><Printer className="mr-2 h-4 w-4" /> Print receipt</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
