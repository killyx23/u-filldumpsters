import React, { useEffect, useMemo, useRef, useState } from 'react';
import { addDays, addMonths, endOfMonth, format, parse, parseISO, startOfDay, startOfMonth } from 'date-fns';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { Phone, Loader2, Lock, Info, Calendar as CalendarIcon } from 'lucide-react';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { toast } from '@/components/ui/use-toast';
import { parseEdgeFunctionError } from '@/utils/parseEdgeFunctionError';
import { GooglePlacesAutocomplete } from '@/components/GooglePlacesAutocomplete.jsx';
import { useTaxRate } from '@/utils/getTaxRate';
import { useBookingTaxOptions } from '@/hooks/useBookingTaxOptions';
import { useInsurancePricing } from '@/hooks/useInsurancePricing';
import { useDrivewayProtectionPrice } from '@/hooks/useDrivewayProtectionPrice';
import { calculateBookingTotal } from '@/utils/calculateBookingTotal';
import { calculateTaxFromLineItems } from '@/utils/bookingTaxCalculator';
import { getPriceForEquipment } from '@/utils/equipmentPricingIntegration';
import { fetchDistanceAndCalculateFee } from '@/services/DistanceCalculationService';
import { storePendingBooking } from '@/utils/bookingDataPersistence';
import { buildPlanSnapshot } from '@/utils/servicePlan';
import { isCustomerPickupService } from '@/utils/customerPickupService';
import { addressCanProceed, addressReviewAddonFields, applySelectedAddress } from '@/utils/addressHelpers';
import { getServiceSpecificDateLabel } from '@/utils/serviceSpecificLabels';
import { formatTimeWindow } from '@/utils/timeWindowFormatter';
import {
  isHourlySelfPickupPlan,
  usesDeliveryPickupSlots,
  usesDeliveryWindowSlots,
} from '@/utils/availabilityServiceUi';
import { isPickupDateBlockedByRange } from '@/utils/calendarAvailabilityHints';
import { bookableFromInventoryRow } from '@/utils/equipmentInventoryManager';
import { describeBookingCapacityError, isBookingCapacityError } from '@/utils/bookingCapacityError';
import { getProtectionOptionsInfoDescription } from '@/content/protectionOptionsInfoText';
import { ApplianceDisposalAgreementDialog, MattressDisposalAgreementDialog } from '@/components/addons/MattressDisposalAgreementDialog';
import {
  catalogBaseRental,
  money,
  rentalDaysForPlan,
  solvePersistedPricing,
} from '@/utils/phoneOrderQuote';
import { UnlockManualDialog } from '@/components/admin/phone-order/PriceOverrideDialog';
import { PhoneOrderAdjustments } from '@/components/admin/phone-order/PhoneOrderAdjustments';

const stripePromise = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY
  ? loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY)
  : null;

const selectClass = 'w-full rounded-md border border-white/30 bg-gray-900 px-3 py-2 text-white';
const optionClass = 'bg-gray-900 text-white';

const ADDONS = [
  { id: 1, label: 'Wheelbarrow', kind: 'rental' },
  { id: 2, label: 'Hand Truck', kind: 'rental' },
  { id: 3, label: 'Working Gloves (Pair)', kind: 'purchase' },
  { id: 4, label: 'Mattress Disposal', kind: 'disposal' },
  { id: 5, label: 'TV Disposal', kind: 'disposal' },
  { id: 6, label: 'Appliance Disposal', kind: 'disposal' },
];

const emptyAddress = { street: '', city: '', state: 'UT', zip: '', isVerified: false, manualReviewAccepted: false };

const emptyForm = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  serviceId: '',
  delivery: true,
  dropOff: '',
  pickup: '',
  dropOffTime: '',
  pickupTime: '',
  notes: '',
  callNotes: '',
  couponCode: '',
  insurance: 'accept',
  driveway: 'decline',
  smsConsent: false,
  readBack: false,
  paymentChoice: 'customer_link',
  licenseAcknowledged: false,
  acknowledgeDuplicate: false,
  acknowledgePending: false,
  loyaltyPoints: 0,
  referralDollars: 0,
};

function openSlots(slots) {
  return (slots || []).filter((slot) => slot?.available !== false);
}

function slotsFor(plan, isDelivery, day, which) {
  if (!day || (day.available === false)) return [];
  const hourly = isHourlySelfPickupPlan(plan, isDelivery);
  if (which === 'drop') {
    if (usesDeliveryWindowSlots(plan, isDelivery)) return openSlots(day.deliverySlots);
    if (hourly) return openSlots(day.pickupSlots?.length ? day.pickupSlots : day.hourlySlots);
    return openSlots(day.deliverySlots?.length ? day.deliverySlots : (day.pickupSlots || day.hourlySlots));
  }
  if (usesDeliveryPickupSlots(plan, isDelivery)) return openSlots(day.pickupSlots);
  if (hourly) return openSlots(day.returnSlots);
  return openSlots(day.pickupSlots?.length ? day.pickupSlots : day.returnSlots);
}

function toAmPm(timeStr) {
  if (!timeStr) return '';
  try {
    const parsed = parse(String(timeStr), 'HH:mm:ss', new Date());
    if (Number.isNaN(parsed.getTime())) return String(timeStr);
    return format(parsed, 'h:mm a');
  } catch {
    return String(timeStr);
  }
}

async function invokeAdmin(body) {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token) {
    throw new Error('Sign in again. Phone orders use the same admin session as the rest of the dashboard.');
  }
  const result = await supabase.functions.invoke('phone-order-admin', {
    body,
    headers: { Authorization: `Bearer ${token}` },
  });
  if (result.error || result.data?.error) {
    throw new Error(await parseEdgeFunctionError(result.error, result.data));
  }
  return result.data;
}

function bookingDeliveryType(plan, isDelivery) {
  if (isDelivery) return 'delivery';
  if (plan?.customer_pickup === true || [2, 5, 8].includes(Number(plan?.id))) return 'self_service_trailer';
  return 'self_pickup';
}

function stockFromInventoryRow(item, row) {
  if (!row) return 0;
  if (item.kind === 'rental') return bookableFromInventoryRow({ ...row, type: 'rental' });
  const quantity = Number(row.available_quantity ?? row.total_quantity ?? 0);
  return Number.isFinite(quantity) ? Math.max(0, quantity) : 0;
}

function slotLabel(slots, value) {
  return slots.find((slot) => slot.value === value)?.label || formatTimeWindow(value) || value || 'the scheduled time';
}

function spokenDate(dateStr) {
  if (!dateStr) return 'the scheduled date';
  const date = parse(dateStr, 'yyyy-MM-dd', new Date());
  const label = format(date, 'MMMM do');
  const tomorrow = format(addDays(new Date(), 1), 'yyyy-MM-dd');
  return dateStr === tomorrow ? `tomorrow, ${label}` : label;
}

function quoteLineLabel(line, { serviceName, days, quantities }) {
  if (line.key === 'base_rental') {
    const dayLabel = `${days} day${days === 1 ? '' : 's'}`;
    return `${serviceName || 'Rental'} (${dayLabel})`;
  }
  if (line.key === 'insurance') return 'Hardware Protection Plan';
  if (line.key === 'delivery_fee') return 'Delivery fee';
  if (line.key === 'mileage') return 'Mileage';
  if (line.key === 'driveway_protection') return 'Driveway protection';
  const equipmentMatch = String(line.key).match(/^equipment_(\d+)$/);
  if (equipmentMatch) {
    const id = Number(equipmentMatch[1]);
    const qty = Number(quantities[id] || 0);
    const name = ADDONS.find((item) => item.id === id)?.label || line.label;
    return qty > 1 ? `${name} × ${qty}` : name;
  }
  return line.label;
}

function phoneScript({
  name,
  yardPickup,
  serviceName,
  dropOff,
  pickup,
  dropTime,
  pickTime,
  paymentChoice,
  addressLine,
  smsConsent,
  itemized,
}) {
  const who = name ? `${name}, ` : '';
  const sameDay = dropOff && pickup && dropOff === pickup;
  const serviceLabel = yardPickup ? 'dump trailer rental' : (serviceName || 'rental');
  const schedule = yardPickup
    ? `Your rental is scheduled for ${spokenDate(dropOff)}. You can pick it up starting at ${dropTime || 'the scheduled time'}, and we'll just need it returned by ${pickTime || 'the scheduled time'}${sameDay ? ' that evening' : ` on ${spokenDate(pickup)}`}.`
    : `We will drop off your ${serviceLabel} on ${spokenDate(dropOff)} during ${dropTime || 'the delivery window'}, and pick it up on ${spokenDate(pickup)} during ${pickTime || 'the pickup window'}, at ${addressLine || 'the address on file'}.`;
  const payment = paymentChoice === 'agent_card'
    ? 'Payment is being taken on this call.'
    : 'Since you preferred not to share your credit card details over the phone, payment will be securely processed at the exact same time you complete your paperwork online.';
  const linkChannel = smsConsent ? 'texting and/or emailing' : 'emailing';
  const termsLink = `We are also going to be ${linkChannel} you a link to accept the rental terms and conditions that you will need to accept to finish your order. Otherwise this order will be canceled.`;
  const documents = yardPickup
    ? `Once you open that link, we just need you to upload a few required items at this time, or at least 12 hours before your pickup time if you are not able to do it right now, by logging in to your customer portal. The confirmation you receive will include how to do so.
We will need:
• A photo of your driver's license, both front and back
• Your proof of insurance
• And the license plate number of the vehicle that will be towing the trailer
Then, at least 12 hours before your booking starts, we will open up your specific pickup address and lock code. You'll receive those by email, or by text if you opted in, and they'll also post directly into your customer portal.`
    : 'Once you open that link, you will accept the rental terms and conditions for this drop-off and pickup.';
  const closing = yardPickup
    ? 'Do you have any quick questions about the payment link or the required documents before we wrap up?'
    : 'Do you have any quick questions about the drop-off, the pickup, or the payment link before we wrap up?';
  return [
    `${who}I just wanted to quickly confirm the details for your ${serviceLabel} so we can get everything ready for you.`,
    schedule,
    itemized,
    payment,
    termsLink,
    documents,
    closing,
  ].filter(Boolean).join('\n\n');
}

async function availabilityClock(serviceId, dateStr, column, fallback) {
  const date = parseISO(dateStr);
  const { data: specific } = await supabase
    .from('date_specific_availability')
    .select(column)
    .eq('service_id', serviceId)
    .eq('date', dateStr)
    .maybeSingle();
  if (specific?.[column]) return toAmPm(specific[column]);
  const { data: weekly } = await supabase
    .from('service_availability')
    .select(column)
    .eq('service_id', serviceId)
    .eq('day_of_week', date.getDay())
    .maybeSingle();
  if (weekly?.[column]) return toAmPm(weekly[column]);
  return fallback;
}

function DeskDateField({ label, value, onChange, disabledDates, onMonthChange }) {
  const [open, setOpen] = useState(false);
  const selected = value ? parseISO(value) : undefined;
  return (
    <div className="space-y-1">
      <p className="text-sm">{label}</p>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" className="w-full justify-start bg-white/10 border-white/30 text-white hover:bg-white/20">
            <CalendarIcon className="mr-2 h-4 w-4" />
            {value ? format(parseISO(value), 'PPP') : 'Pick a date'}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0 bg-gray-800 border-gray-700 text-white" align="start">
          <Calendar
            mode="single"
            selected={selected}
            onSelect={(date) => {
              onChange(date ? format(date, 'yyyy-MM-dd') : '');
              setOpen(false);
            }}
            disabled={disabledDates}
            onMonthChange={onMonthChange}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

function CardCapture({ onPaid }) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const pay = async () => {
    if (!stripe || !elements) return;
    setBusy(true);
    setError('');
    const result = await stripe.confirmPayment({
      elements,
      redirect: 'if_required',
      confirmParams: { return_url: window.location.href },
    });
    setBusy(false);
    if (result.error) {
      setError(result.error.message || 'The card was not authorized.');
      return;
    }
    onPaid();
  };

  return (
    <div className="space-y-4 rounded-xl border border-yellow-400/40 bg-black/30 p-4">
      <h3 className="text-lg text-white">Card authorization</h3>
      <p className="text-sm text-gray-300">The card is authorized now and captured only after the customer accepts the terms. The full number stays with Stripe.</p>
      <PaymentElement />
      {error && <p className="text-sm text-red-300">{error}</p>}
      <Button onClick={pay} disabled={busy || !stripe} className="bg-yellow-400 text-black hover:bg-yellow-300">
        {busy ? 'Authorizing…' : 'Authorize card'}
      </Button>
    </div>
  );
}

export function PhoneOrderDesk() {
  const { user } = useAuth();
  const [section, setSection] = useState('call');
  const [form, setForm] = useState(emptyForm);
  const [address, setAddress] = useState(emptyAddress);
  const [services, setServices] = useState([]);
  const [qty, setQty] = useState({});
  const [showMattressAgreement, setShowMattressAgreement] = useState(false);
  const [showApplianceAgreement, setShowApplianceAgreement] = useState(false);
  const pendingMattressQty = useRef(0);
  const pendingApplianceQty = useRef(0);
  const ignoreQtyUntil = useRef(0);
  const [stockNote, setStockNote] = useState({});
  const [equipmentPrices, setEquipmentPrices] = useState({});
  const [coupon, setCoupon] = useState(null);
  const [mileage, setMileage] = useState(0);
  const [distanceMiles, setDistanceMiles] = useState(0);
  const [availability, setAvailability] = useState({});
  const [calendarMonth, setCalendarMonth] = useState(() => startOfMonth(new Date()));
  const [fixedTimes, setFixedTimes] = useState({ drop: '', pick: '' });
  const [stockMax, setStockMax] = useState({});
  const [lookup, setLookup] = useState({ customers: [], overlapping: [], openPending: [] });
  const [rewards, setRewards] = useState(null);
  const [customerId, setCustomerId] = useState(null);
  const [overrides, setOverrides] = useState({});
  const [unlock, setUnlock] = useState(null);
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [showProtectionInfo, setShowProtectionInfo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [queue, setQueue] = useState([]);
  const [bookingById, setBookingById] = useState({});
  const [cardSecret, setCardSecret] = useState('');
  const [pendingSendId, setPendingSendId] = useState(null);
  const [draftId, setDraftId] = useState(null);

  const selected = services.find((row) => String(row.id) === String(form.serviceId)) || null;
  const forcedDelivery = selected && [1, 3, 4].includes(Number(selected.id));
  const isDelivery = forcedDelivery ? true : form.delivery;
  const effective = useMemo(() => {
    if (!selected) return null;
    if (!isDelivery) return selected;
    const variantId = Number(selected.delivery_variant_service_id || 0);
    if (!variantId || variantId === Number(selected.id)) return selected;
    return services.find((row) => Number(row.id) === variantId) || selected;
  }, [selected, isDelivery, services]);

  const { taxRate } = useTaxRate();
  const { taxOptions } = useBookingTaxOptions(effective?.id);
  const { insurancePrice } = useInsurancePricing(effective?.id);
  const { drivewayPrice } = useDrivewayProtectionPrice(effective?.id);

  useEffect(() => {
    supabase.from('services').select('*').order('id').then(({ data }) => setServices(data || []));
    Promise.all([1, 2, 3, 4, 5, 6].map(async (id) => [id, await getPriceForEquipment(id)]))
      .then((pairs) => setEquipmentPrices(Object.fromEntries(pairs)));
  }, []);

  useEffect(() => {
    const handle = setTimeout(async () => {
      if (!form.email && !form.phone) {
        setLookup({ customers: [], overlapping: [], openPending: [] });
        return;
      }
      const { data } = await supabase.functions.invoke('phone-order-admin', {
        body: {
          action: 'lookup',
          email: form.email,
          phone: form.phone,
          dropOff: form.dropOff || null,
          pickup: form.pickup || null,
        },
      });
      if (data && !data.error) setLookup(data);
    }, 400);
    return () => clearTimeout(handle);
  }, [form.email, form.phone, form.dropOff, form.pickup]);

  useEffect(() => {
    if (!effective) return undefined;
    const start = format(startOfMonth(calendarMonth), 'yyyy-MM-dd');
    const end = format(endOfMonth(addMonths(calendarMonth, 1)), 'yyyy-MM-dd');
    supabase.functions.invoke('get-availability', {
      body: {
        serviceId: Number(effective.id),
        startDate: start,
        endDate: end,
        isDelivery: Number(effective.id) === 4 ? false : isDelivery,
      },
    }).then(({ data }) => setAvailability(data?.availability || {}));
    return undefined;
  }, [effective, calendarMonth, isDelivery]);

  useEffect(() => {
    if (!effective || !isHourlySelfPickupPlan(effective, isDelivery)) {
      setFixedTimes({ drop: '', pick: '' });
      return undefined;
    }
    let cancelled = false;
    (async () => {
      const drop = form.dropOff
        ? await availabilityClock(Number(effective.id), form.dropOff, 'pickup_start_time', '8:00 AM')
        : '';
      const pick = form.pickup
        ? await availabilityClock(Number(effective.id), form.pickup, 'return_by_time', '6:00 PM')
        : '';
      if (cancelled) return;
      setFixedTimes({ drop, pick });
      if (!unlock) {
        setForm((prev) => ({ ...prev, dropOffTime: drop, pickupTime: pick }));
      }
    })();
    return () => { cancelled = true; };
  }, [effective, isDelivery, form.dropOff, form.pickup, unlock]);

  useEffect(() => {
    if (!form.dropOff) {
      setStockMax({});
      return undefined;
    }
    let cancelled = false;
    const items = ADDONS.filter((item) => Number(effective?.id) === 2 ? item.kind !== 'disposal' : true);
    supabase.functions.invoke('get-equipment-inventory', {
      body: { startDate: form.dropOff, endDate: form.pickup || form.dropOff },
    }).then(async ({ data, error }) => {
      if (cancelled) return;
      let inventory = Array.isArray(data?.inventory) ? data.inventory : null;
      if (error || !inventory) {
        const { data: rows } = await supabase.from('equipment').select('id, type, total_quantity').in('id', items.map((item) => item.id));
        inventory = rows || [];
      }
      if (cancelled) return;
      const next = Object.fromEntries(items.map((item) => {
        const row = inventory.find((inv) => Number(inv.id) === Number(item.id));
        return [item.id, stockFromInventoryRow(item, row)];
      }));
      setStockMax(next);
      if (!unlock) {
        setQty((prev) => {
          const clamped = { ...prev };
          Object.entries(next).forEach(([id, max]) => {
            if (Number(clamped[id] || 0) > max) clamped[id] = max;
          });
          return clamped;
        });
      }
    });
    return () => { cancelled = true; };
  }, [form.dropOff, form.pickup, effective, unlock]);

  useEffect(() => {
    if (!isDelivery || !addressCanProceed(address) || !effective) return undefined;
    let cancelled = false;
    fetchDistanceAndCalculateFee(address, effective.id, effective.mileage_rate).then((result) => {
      if (cancelled || result?.error) return;
      setMileage(Number(result.mileage_charge || result.trip_mileage_cost || 0));
      setDistanceMiles(Number(result.distance || 0));
    });
    return () => { cancelled = true; };
  }, [address, isDelivery, effective]);

  const loadQueue = async () => {
    const { data } = await supabase.from('phone_orders').select('*').order('created_at', { ascending: false }).limit(40);
    const rows = data || [];
    setQueue(rows);
    const ids = rows.map((row) => row.booking_id).filter(Boolean);
    if (!ids.length) {
      setBookingById({});
      return;
    }
    const { data: bookings } = await supabase
      .from('bookings')
      .select('id,status,drop_off_date,pickup_date,drop_off_time_slot,pickup_time_slot,street,city,state,zip,plan')
      .in('id', ids);
    setBookingById(Object.fromEntries((bookings || []).map((row) => [row.id, row])));
  };

  useEffect(() => { loadQueue(); }, []);

  useEffect(() => {
    if (!customerId) {
      setRewards(null);
      return undefined;
    }
    let cancelled = false;
    Promise.all([
      supabase.from('loyalty_points').select('points_balance').eq('customer_id', customerId).maybeSingle(),
      supabase.from('customer_referral_wallets').select('available_balance, pending_balance').eq('customer_id', customerId).maybeSingle(),
      supabase.from('loyalty_settings').select('points_to_dollar').maybeSingle(),
    ]).then(([points, wallet, settings]) => {
      if (cancelled) return;
      setRewards({
        pointsBalance: Number(points.data?.points_balance || 0),
        referralWallet: { availableBalance: Number(wallet.data?.available_balance || 0) },
        conversionRates: { pointsToDollar: Number(settings.data?.points_to_dollar || 100) },
      });
    });
    return () => { cancelled = true; };
  }, [customerId]);

  const set = (key) => (event) => {
    const value = event?.target ? event.target.value : event;
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const days = effective && form.dropOff ? rentalDaysForPlan(effective.id, form.dropOff, form.pickup || form.dropOff) : 1;
  const baseRental = effective ? catalogBaseRental(effective, days) : 0;
  const deliveryFee = isDelivery ? Number(effective?.delivery_fee || 0) : 0;
  const showDisposal = Number(effective?.id) !== 2;
  const addonChoices = ADDONS.filter((item) => showDisposal || item.kind !== 'disposal');
  const selectedEquipment = addonChoices
    .filter((item) => Number(qty[item.id] || 0) > 0)
    .map((item) => ({
      id: item.id,
      dbId: item.id,
      equipment_id: item.id,
      name: item.label,
      quantity: Number(qty[item.id]),
      type: item.kind === 'purchase' ? 'purchase' : 'rental',
    }));

  const pointsToDollar = Number(rewards?.conversionRates?.pointsToDollar || 100);
  const loyaltyDiscount = form.loyaltyPoints > 0 ? Number((Number(form.loyaltyPoints) / pointsToDollar).toFixed(2)) : 0;
  const referralDiscount = Math.min(
    Number(form.referralDollars || 0),
    Number(rewards?.referralWallet?.availableBalance || 0),
  );

  const catalogAddons = {
    equipment: selectedEquipment,
    insurance: form.insurance,
    drivewayProtection: Number(effective?.id) === 1 && isDelivery ? form.driveway : 'decline',
    deliveryFee,
    mileageCharge: isDelivery ? mileage : 0,
    oneWayDistanceMiles: distanceMiles,
    coupon,
    loyaltyDiscountAmount: loyaltyDiscount,
    loyaltyPointsToRedeem: Number(form.loyaltyPoints || 0),
    referralDiscountAmount: referralDiscount,
    referralDollarsToRedeem: referralDiscount,
    deliveryAddress: address,
  };

  const catalogPlan = effective ? { ...effective, price: baseRental } : null;
  const catalogQuote = catalogPlan
    ? calculateBookingTotal(catalogPlan, catalogAddons, equipmentPrices, taxRate, isDelivery, insurancePrice, taxOptions)
    : null;

  const displayLines = (catalogQuote?.lineItems || []).map((line) => ({
    ...line,
    catalogAmount: line.amount,
    amount: overrides[line.key] ? Number(overrides[line.key].amount_after) : line.amount,
  }));
  const approved = catalogQuote
    ? calculateTaxFromLineItems(displayLines, taxRate, catalogQuote.discount)
    : null;
  const chargeTotal = overrides.order_total ? Number(overrides.order_total.amount_after) : approved?.total;
  const quoteRows = displayLines.map((line) => ({
    ...line,
    readLabel: quoteLineLabel(line, { serviceName: effective?.name, days, quantities: qty }),
  }));
  const discountRows = [
    catalogQuote?.couponDiscount > 0 ? { key: 'coupon', label: `Coupon${coupon?.code ? ` (${coupon.code})` : ''}`, amount: -Number(catalogQuote.couponDiscount) } : null,
    catalogQuote?.loyaltyDiscount > 0 ? { key: 'loyalty', label: 'Loyalty points', amount: -Number(catalogQuote.loyaltyDiscount) } : null,
    catalogQuote?.referralDiscount > 0 ? { key: 'referral', label: 'Referral balance', amount: -Number(catalogQuote.referralDiscount) } : null,
  ].filter(Boolean);

  const dropSlots = slotsFor(effective, isDelivery, availability[form.dropOff], 'drop');
  const pickSlots = slotsFor(effective, isDelivery, availability[form.pickup], 'pick');
  const dropLabel = getServiceSpecificDateLabel(effective, isDelivery, 'dropoff');
  const pickLabel = getServiceSpecificDateLabel(effective, isDelivery, 'pickup');
  const dropBlocked = form.dropOff && availability[form.dropOff]?.available === false;
  const rangeBlocked = form.dropOff && form.pickup && isPickupDateBlockedByRange(parseISO(form.dropOff), parseISO(form.pickup), availability);
  const pickupNeeded = effective ? isCustomerPickupService(effective, { isDelivery }) : false;
  const yardPickup = pickupNeeded && !isDelivery;
  const hourlyPickup = isHourlySelfPickupPlan(effective, isDelivery);

  const dropDisabled = useMemo(() => {
    if (unlock) return [];
    const dates = [{ before: startOfDay(addDays(new Date(), 1)) }];
    Object.keys(availability).forEach((dateStr) => {
      const day = availability[dateStr];
      if (!day?.available) {
        dates.push(parse(dateStr, 'yyyy-MM-dd', new Date()));
        return;
      }
      if (hourlyPickup) return;
      const slots = usesDeliveryWindowSlots(effective, isDelivery)
        ? day.deliverySlots || []
        : day.pickupSlots || day.hourlySlots || [];
      if (!slots.some((slot) => slot?.available !== false)) {
        dates.push(parse(dateStr, 'yyyy-MM-dd', new Date()));
      }
    });
    return dates;
  }, [availability, effective, hourlyPickup, isDelivery, unlock]);

  const pickDisabled = useMemo(() => {
    if (unlock) return [];
    const dates = [...dropDisabled];
    if (form.dropOff) {
      const dropOff = startOfDay(parseISO(form.dropOff));
      dates.push({ before: dropOff });
      dates.push((date) => isPickupDateBlockedByRange(dropOff, date, availability));
    }
    if (!hourlyPickup) {
      Object.keys(availability).forEach((dateStr) => {
        const day = availability[dateStr];
        if (!day?.available) return;
        const slots = usesDeliveryPickupSlots(effective, isDelivery)
          ? day.pickupSlots || []
          : day.returnSlots || [];
        if (!slots.some((slot) => slot?.available !== false)) {
          dates.push(parse(dateStr, 'yyyy-MM-dd', new Date()));
        }
      });
    }
    return dates;
  }, [availability, dropDisabled, effective, form.dropOff, hourlyPickup, isDelivery, unlock]);

  const recordChange = (key, label, before, after) => {
    if (!unlock) return;
    if (String(before) === String(after)) {
      setOverrides((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      return;
    }
    const numericBefore = Number(before);
    const numericAfter = Number(after);
    setOverrides((prev) => ({
      ...prev,
      [key]: {
        line_key: key,
        line_label: Number.isFinite(numericBefore) && Number.isFinite(numericAfter) && !String(key).startsWith('field.')
          ? label
          : `${label}: ${before || 'empty'} → ${after || 'empty'}`,
        amount_before: Number.isFinite(numericBefore) ? numericBefore : 0,
        amount_after: Number.isFinite(numericAfter) ? numericAfter : 0,
        reason: unlock.reason,
        initials: unlock.initials,
        signature_data: unlock.signature_data,
      },
    }));
  };

  const applyCustomer = (customer) => {
    const [first, ...rest] = String(customer.name || '').split(' ');
    setCustomerId(customer.id);
    setForm((prev) => ({
      ...prev,
      firstName: customer.first_name || first || prev.firstName,
      lastName: customer.last_name || rest.join(' ') || prev.lastName,
      email: customer.email || prev.email,
      phone: customer.phone || prev.phone,
    }));
    setAddress({
      street: customer.street || '',
      city: customer.city || '',
      state: customer.state || 'UT',
      zip: customer.zip || '',
      isVerified: false,
      manualReviewAccepted: false,
    });
  };

  const commitQty = (item, requested) => {
    const max = stockMax[item.id];
    const capped = !unlock && Number.isFinite(max) ? Math.min(requested, max) : requested;
    setQty((prev) => ({ ...prev, [item.id]: capped }));
    if (!form.dropOff) {
      setStockNote((prev) => ({ ...prev, [item.id]: '' }));
      return;
    }
    if (!unlock && max === 0) {
      setStockNote((prev) => ({ ...prev, [item.id]: 'None available for those dates.' }));
      return;
    }
    if (!unlock && Number.isFinite(max) && requested > max) {
      setStockNote((prev) => ({ ...prev, [item.id]: `Only ${max} available for those dates.` }));
      return;
    }
    setStockNote((prev) => ({ ...prev, [item.id]: '' }));
  };

  const changeQty = (item, value) => {
    if ((Number(item.id) === 4 || Number(item.id) === 6) && Date.now() < ignoreQtyUntil.current) return;
    const requested = Math.max(0, Number(value) || 0);
    const current = Number(qty[item.id] || 0);
    if (Number(item.id) === 4 && requested > 0 && current <= 0) {
      const max = stockMax[item.id];
      if (!unlock && max === 0) {
        commitQty(item, requested);
        return;
      }
      pendingMattressQty.current = requested;
      setShowMattressAgreement(true);
      return;
    }
    if (Number(item.id) === 6 && requested > 0 && current <= 0) {
      const max = stockMax[item.id];
      if (!unlock && max === 0) {
        commitQty(item, requested);
        return;
      }
      pendingApplianceQty.current = requested;
      setShowApplianceAgreement(true);
      return;
    }
    commitQty(item, requested);
  };

  const confirmMattressDisposal = () => {
    const item = ADDONS.find((entry) => entry.id === 4);
    if (!item) return;
    ignoreQtyUntil.current = Date.now() + 500;
    commitQty(item, pendingMattressQty.current || 1);
  };

  const confirmApplianceDisposal = () => {
    const item = ADDONS.find((entry) => entry.id === 6);
    if (!item) return;
    ignoreQtyUntil.current = Date.now() + 500;
    commitQty(item, pendingApplianceQty.current || 1);
  };

  const applyCoupon = async () => {
    if (!effective || !form.couponCode.trim()) return;
    const { data, error } = await supabase.functions.invoke('validate-coupon', {
      body: { couponCode: form.couponCode.trim(), serviceId: effective.id },
    });
    if (error || !data?.isValid) {
      toast({ title: 'Coupon', description: 'That coupon is not valid for this service.', variant: 'destructive' });
      setCoupon(null);
      return;
    }
    setCoupon({
      isValid: true,
      code: data.code,
      discountType: data.discountType,
      discountValue: Number(data.discountValue),
    });
  };

  const readBack = phoneScript({
    name: form.firstName.trim(),
    yardPickup,
    serviceName: effective?.name,
    dropOff: form.dropOff,
    pickup: form.pickup,
    dropTime: slotLabel(yardPickup ? [] : dropSlots, form.dropOffTime),
    pickTime: slotLabel(yardPickup ? [] : pickSlots, form.pickupTime),
    paymentChoice: form.paymentChoice,
    addressLine: [address.street, address.city].filter(Boolean).join(', '),
    smsConsent: form.smsConsent === true,
    itemized: quoteRows.length
      ? [
        'Here is everything on this order.',
        ...quoteRows.map((line) => `${line.readLabel}: ${money(line.amount)}`),
        ...discountRows.map((line) => `${line.label}: ${money(line.amount)}`),
        `Subtotal: ${money(approved?.subtotalBeforeTax || 0)}`,
        `Tax (${Number(approved?.taxRate || taxRate || 0).toFixed(2)}%): ${money(approved?.tax || 0)}`,
        `Total: ${money(chargeTotal || 0)}`,
      ].join('\n')
      : '',
  });

  const sendLink = async (phoneOrderId) => {
    const data = await invokeAdmin({ action: 'send', phoneOrderId, siteUrl: window.location.origin });
    toast({
      title: 'Link sent',
      description: data.emailSent
        ? 'The customer can confirm from the email or text.'
        : (data.emailError || 'The link was saved, but email did not send.'),
    });
    setForm(emptyForm);
    setAddress(emptyAddress);
    setOverrides({});
    setUnlock(null);
    setQty({});
    setStockMax({});
    setCoupon(null);
    setRewards(null);
    setCustomerId(null);
    setCardSecret('');
    setPendingSendId(null);
    setDraftId(null);
    setSection('queue');
    loadQueue();
  };

  const submit = async () => {
    if (!effective || !catalogQuote || !approved) return;
    if (!form.firstName || !form.lastName || !form.email || !form.phone || !form.dropOff || !form.pickup) {
      toast({ title: 'Missing details', description: 'Name, email, phone, and both dates are required.', variant: 'destructive' });
      return;
    }
    if (!form.readBack) {
      toast({ title: 'Read back', description: 'Read the service-specific script to the caller before sending.', variant: 'destructive' });
      return;
    }
    if (!form.dropOffTime || !form.pickupTime) {
      toast({ title: 'Times', description: hourlyPickup ? 'Choose both dates so the Availability times fill in.' : 'Choose a time for both dates.', variant: 'destructive' });
      return;
    }
    if (!unlock) {
      if (!addressCanProceed(address)) {
        toast({ title: 'Address', description: 'Choose the address from Google, or accept it for manual review.', variant: 'destructive' });
        return;
      }
      if (dropBlocked || rangeBlocked) {
        toast({ title: 'Dates unavailable', description: 'Those dates are already booked or closed. Unlock manual changes only if an admin must override the calendar.', variant: 'destructive' });
        return;
      }
      if (hourlyPickup) {
        if (!form.dropOffTime || !form.pickupTime || form.dropOffTime !== fixedTimes.drop || form.pickupTime !== fixedTimes.pick) {
          toast({ title: 'Trailer times', description: 'Pickup and return use the times from Availability. Choose both dates so those times fill in.', variant: 'destructive' });
          return;
        }
      } else {
        if (dropSlots.length && !dropSlots.some((slot) => slot.value === form.dropOffTime)) {
          toast({ title: dropLabel, description: 'Choose a time from this service’s availability.', variant: 'destructive' });
          return;
        }
        if (pickSlots.length && !pickSlots.some((slot) => slot.value === form.pickupTime)) {
          toast({ title: pickLabel, description: 'Choose a time from this service’s availability.', variant: 'destructive' });
          return;
        }
      }
      if (Object.entries(qty).some(([id, quantity]) => Number(quantity) > 0 && stockMax[id] === 0)) {
        toast({ title: 'Add-on stock', description: 'An add-on has no stock for those dates.', variant: 'destructive' });
        return;
      }
      if (Object.values(stockNote).some(Boolean)) {
        toast({ title: 'Add-on stock', description: 'An add-on is not available for those dates.', variant: 'destructive' });
        return;
      }
    }
    if (pickupNeeded && !form.licenseAcknowledged) {
      toast({ title: 'License', description: 'Confirm the caller will upload their license from the link or the customer portal at least 12 hours before pickup.', variant: 'destructive' });
      return;
    }
    if (lookup.overlapping?.length && !form.acknowledgeDuplicate) {
      toast({ title: 'Possible duplicate', description: 'Confirm with the caller that this is a new order.', variant: 'destructive' });
      return;
    }
    if (lookup.openPending?.length && !form.acknowledgePending) {
      toast({ title: 'Open checkout', description: 'This email already has an unfinished checkout. Confirm before replacing it.', variant: 'destructive' });
      return;
    }

    const solved = solvePersistedPricing({
      plan: catalogPlan,
      addons: catalogAddons,
      equipmentPrices,
      taxRate,
      deliveryService: isDelivery,
      insurancePrice,
      taxOptions,
    }, chargeTotal);
    if (!solved.ok) {
      toast({ title: 'Price', description: solved.error, variant: 'destructive' });
      return;
    }

    setBusy(true);
    try {
      const takenAt = new Date().toISOString();
      const phoneOrderMeta = {
        agentEmail: user?.email || null,
        agentUserId: user?.id || null,
        takenAt,
        readBackConfirmed: true,
        smsRequested: form.smsConsent === true,
        licenseUploadAcknowledged: pickupNeeded ? true : false,
        unlock: unlock ? {
          reason: unlock.reason,
          initials: unlock.initials,
          passwordAcceptedAt: unlock.password_accepted_at || null,
        } : null,
      };
      const contactAddress = {
        street: address.street,
        city: address.city,
        state: address.state,
        zip: address.zip,
        isVerified: address.isVerified === true,
        manualReviewAccepted: address.manualReviewAccepted === true,
      };
      const addons = {
        ...solved.addons,
        ...addressReviewAddonFields(contactAddress),
        orderChannel: 'phone',
        phoneOrder: phoneOrderMeta,
        customerPickup: pickupNeeded,
        isDelivery,
        deliveryService: isDelivery,
        deliveryFee,
        mileageCharge: isDelivery ? mileage : 0,
        oneWayDistanceMiles: distanceMiles,
        deliveryAddress: contactAddress,
        wasVerificationSkipped: false,
        smsTransactionalOptIn: false,
        smsMarketingOptIn: false,
        taxLineItemsSnapshot: (solved.quote.lineItems || []).map((line) => ({
          key: line.key,
          label: line.label,
          amount: line.amount,
          is_taxable: line.is_taxable,
          amountAfterDiscount: line.amountAfterDiscount,
        })),
      };
      const bookingData = {
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        email: form.email.trim(),
        phone: form.phone,
        contactAddress,
        dropOffDate: form.dropOff,
        pickupDate: form.pickup,
        dropOffTimeSlot: form.dropOffTime,
        pickupTimeSlot: form.pickupTime,
        notes: form.notes,
        smsTransactionalOptIn: false,
        smsMarketingOptIn: false,
      };
      const planSnapshot = buildPlanSnapshot(effective, {
        price: solved.planPrice,
        mileage_rate: effective.mileage_rate,
        delivery_fee: effective.delivery_fee,
      });
      const pending = await storePendingBooking(bookingData, { ...effective, price: solved.planPrice }, addons, {
        totalPrice: solved.total,
        basePrice: solved.planPrice,
        deliveryService: isDelivery,
      });
      if (!pending.success) throw new Error(pending.error || 'Could not save the draft.');

      const { data: created, error: createError } = await supabase.rpc('create_pending_booking', {
        payload: {
          name: `${bookingData.firstName} ${bookingData.lastName}`,
          first_name: bookingData.firstName,
          last_name: bookingData.lastName,
          email: bookingData.email.trim().toLowerCase(),
          phone: bookingData.phone,
          street: address.street,
          city: address.city,
          state: address.state,
          zip: address.zip,
          contact_address: contactAddress,
          delivery_address: contactAddress,
          drop_off_date: form.dropOff,
          pickup_date: form.pickup,
          drop_off_time_slot: form.dropOffTime,
          pickup_time_slot: form.pickupTime,
          plan: planSnapshot,
          addons,
          total_price: solved.total,
          subtotal_before_tax: solved.quote.subtotal,
          tax_amount: solved.quote.tax,
          tax_rate_used: solved.quote.taxRate,
          delivery_type: bookingDeliveryType(effective, isDelivery),
          notes: form.notes,
          was_verification_skipped: false,
          verification_notes: null,
          pending_customer_id: pending.token,
        },
      });
      if (createError) {
        if (isBookingCapacityError(createError)) {
          const described = describeBookingCapacityError(createError);
          throw new Error(described.description);
        }
        throw createError;
      }
      if (created?.already_converted) {
        throw new Error(`This customer already has booking ${created.id} for these dates.`);
      }

      const phoneOrderRow = {
        pending_customer_id: pending.token,
        booking_id: created.id,
        status: 'draft',
        agent_user_id: user?.id || null,
        agent_email: user?.email || null,
        call_notes: form.callNotes,
        payment_choice: form.paymentChoice,
        sms_consent: form.smsConsent,
        read_back_confirmed: true,
        customer_name: `${bookingData.firstName} ${bookingData.lastName}`,
        customer_email: bookingData.email.trim().toLowerCase(),
        customer_phone: form.phone,
        service_name: effective.name,
        total_price: solved.total,
        verification_skipped: false,
        verification_notes: null,
        draft_payload: null,
        updated_at: new Date().toISOString(),
      };
      const phoneOrderQuery = draftId
        ? supabase.from('phone_orders').update(phoneOrderRow).eq('id', draftId).select('*').single()
        : supabase.from('phone_orders').insert(phoneOrderRow).select('*').single();
      const { data: phoneOrder, error: orderError } = await phoneOrderQuery;
      if (orderError) throw orderError;

      if (created.customer_id) {
        const unlockLine = phoneOrderMeta.unlock
          ? ` Manual unlock approved by ${phoneOrderMeta.unlock.initials}. Reason: ${phoneOrderMeta.unlock.reason}. Password accepted at ${phoneOrderMeta.unlock.passwordAcceptedAt ? new Date(phoneOrderMeta.unlock.passwordAcceptedAt).toLocaleString() : 'the time recorded on the adjustment'}.`
          : '';
        const { error: noteError } = await supabase.from('customer_notes').insert({
          customer_id: created.customer_id,
          booking_id: created.id,
          source: 'Phone order',
          content: `Phone order taken by ${user?.email || 'admin'} at ${new Date(takenAt).toLocaleString()}. Script read: yes. Confirmation link by text: ${form.smsConsent ? 'yes' : 'no'}. That text is only this link. Order texts and marketing texts stay off until the customer checks them on the agreement.${pickupNeeded ? ' Caller acknowledged the license must be uploaded from the confirmation link or customer portal at least 12 hours before pickup.' : ''}${unlockLine}`,
          author_type: 'admin',
        });
        if (noteError) throw noteError;
      }

      const adjustmentRows = [
        ...(unlock ? [{
          line_key: 'field.unlock',
          line_label: `Manual unlock · password accepted ${unlock.password_accepted_at ? new Date(unlock.password_accepted_at).toLocaleString() : 'before save'}`,
          amount_before: 0,
          amount_after: 0,
          reason: unlock.reason,
          initials: unlock.initials,
          signature_data: unlock.signature_data,
        }] : []),
        ...Object.values(overrides),
      ];
      if (adjustmentRows.length) {
        const { error: adjustmentError } = await supabase.from('phone_order_adjustments').insert(
          adjustmentRows.map((row) => ({
            ...row,
            phone_order_id: phoneOrder.id,
            booking_id: created.id,
            agent_user_id: user?.id || null,
            agent_email: user?.email || null,
          })),
        );
        if (adjustmentError) throw adjustmentError;
      }

      if (form.paymentChoice === 'agent_card') {
        const data = await invokeAdmin({ action: 'authorize', bookingId: created.id });
        if (!data?.clientSecret) {
          throw new Error('Could not start the card form.');
        }
        setPendingSendId(phoneOrder.id);
        setCardSecret(data.clientSecret);
        toast({ title: 'Order saved', description: 'Authorize the card, then the confirmation link is sent.' });
      } else {
        await sendLink(phoneOrder.id);
      }
    } catch (error) {
      toast({ title: 'Phone order', description: error.message, variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const queueAction = async (action, phoneOrderId) => {
    try {
      await invokeAdmin({ action, phoneOrderId, siteUrl: window.location.origin });
      loadQueue();
    } catch (error) {
      toast({ title: 'Queue', description: error.message, variant: 'destructive' });
    }
  };

  const saveForLater = async () => {
    if (!form.phone && !form.email && !form.firstName) {
      toast({ title: 'Save for later', description: 'Add a name, phone, or email so the call can be found in the queue.', variant: 'destructive' });
      return;
    }
    setBusy(true);
    try {
      const payload = {
        form,
        address,
        qty,
        coupon,
        customerId,
        overrides,
      };
      const row = {
        status: 'draft',
        agent_user_id: user?.id || null,
        agent_email: user?.email || null,
        call_notes: form.callNotes,
        payment_choice: form.paymentChoice,
        sms_consent: form.smsConsent,
        read_back_confirmed: form.readBack === true,
        customer_name: `${form.firstName} ${form.lastName}`.trim() || form.phone || form.email,
        customer_email: form.email.trim().toLowerCase() || null,
        customer_phone: form.phone || null,
        service_name: effective?.name || null,
        total_price: chargeTotal || null,
        draft_payload: payload,
        updated_at: new Date().toISOString(),
      };
      const query = draftId
        ? supabase.from('phone_orders').update(row).eq('id', draftId).eq('status', 'draft').select('id').single()
        : supabase.from('phone_orders').insert(row).select('id').single();
      const { data, error } = await query;
      if (error) throw error;
      setDraftId(data.id);
      toast({ title: 'Saved in the queue', description: 'When they call back, open it from the queue and the form fills back in.' });
      setSection('queue');
      loadQueue();
    } catch (error) {
      toast({ title: 'Save for later', description: error.message, variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const resumeDraft = (order) => {
    const payload = order.draft_payload || {};
    if (payload.form) setForm({ ...emptyForm, ...payload.form });
    if (payload.address) setAddress({ ...emptyAddress, ...payload.address });
    setQty(payload.qty || {});
    setCoupon(payload.coupon || null);
    setCustomerId(payload.customerId || null);
    setOverrides(payload.overrides || {});
    setUnlock(null);
    setDraftId(order.id);
    setSection('call');
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-yellow-400">Call desk</p>
          <h2 className="text-3xl font-semibold text-white">Phone orders</h2>
        </div>
        <div className="flex gap-2">
          {[['call', 'New call'], ['queue', 'Queue'], ['audit', 'Adjustments']].map(([id, label]) => (
            <Button key={id} variant={section === id ? 'default' : 'outline'} onClick={() => setSection(id)} className={section === id ? 'bg-yellow-400 text-black' : 'border-white/20 text-white'}>
              {label}
            </Button>
          ))}
        </div>
      </div>

      {section === 'audit' && <PhoneOrderAdjustments />}

      {section === 'queue' && (
        <div className="space-y-3">
          {queue.length === 0 && <p className="text-gray-400">No phone orders yet.</p>}
          {queue.map((order) => {
            const booking = bookingById[order.booking_id] || {};
            const plan = booking.plan || {};
            const delivered = booking.plan?.id === 1 || booking.plan?.id === 4 || order.service_name?.toLowerCase().includes('deliver');
            return (
              <article key={order.id} className="rounded-xl border border-white/10 bg-black/20 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1 text-sm">
                    <h3 className="text-lg text-white">{order.customer_name}</h3>
                    <p className="text-gray-300">{order.service_name} · {money(order.total_price)}</p>
                    <p className="text-gray-400">{order.customer_phone} · {order.customer_email}</p>
                    <p className="text-gray-300">
                      {getServiceSpecificDateLabel(plan, delivered, 'dropoff')}: {booking.drop_off_date || order.draft_payload?.form?.dropOff || '—'} {formatTimeWindow(booking.drop_off_time_slot || order.draft_payload?.form?.dropOffTime)}
                    </p>
                    <p className="text-gray-300">
                      {getServiceSpecificDateLabel(plan, delivered, 'pickup')}: {booking.pickup_date || order.draft_payload?.form?.pickup || '—'} {formatTimeWindow(booking.pickup_time_slot || order.draft_payload?.form?.pickupTime)}
                    </p>
                    <p className="text-gray-400">{[booking.street, booking.city, booking.state, booking.zip].filter(Boolean).join(', ') || [order.draft_payload?.address?.street, order.draft_payload?.address?.city].filter(Boolean).join(', ') || 'Address on the booking'}</p>
                    <p className="text-gray-500">
                      {order.status === 'draft' && !order.booking_id ? 'saved' : String(order.status || '').replaceAll('_', ' ')} · {order.payment_choice === 'agent_card' ? 'Card authorized on the call' : 'Customer pays on the link'}
                      {order.agent_email ? ` · taken by ${order.agent_email}` : ''}
                      {order.link_expires_at ? ` · link expires ${new Date(order.link_expires_at).toLocaleString()}` : ''}
                    </p>
                    {booking.status && <p className="text-gray-500">Booking #{order.booking_id} is {booking.status}</p>}
                    {order.call_notes && <p className="text-gray-300">{order.call_notes}</p>}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {order.status === 'draft' && !order.booking_id && (
                      <Button className="bg-yellow-400 text-black hover:bg-yellow-300" onClick={() => resumeDraft(order)}>Open call</Button>
                    )}
                    <a className="rounded-md border border-white/20 px-3 py-2 text-sm" href={`tel:${order.customer_phone}`}>Call back</a>
                    {order.status === 'waiting_on_customer' && (
                      <>
                        <Button variant="outline" className="border-white/20" onClick={() => queueAction('send', order.id)}>Resend</Button>
                        <Button variant="outline" className="border-white/20" onClick={() => queueAction('extend', order.id)}>Extend 4 hours</Button>
                        <Button variant="outline" className="border-red-400 text-red-200" onClick={() => queueAction('expire', order.id)}>Expire</Button>
                      </>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {section === 'call' && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_420px]">
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/20 p-4">
              <p className="text-sm text-gray-300">
                {unlock ? `Manual changes are unlocked · ${unlock.initials}` : 'Prices, closed dates, and unavailable times follow the live catalog.'}
              </p>
              <Button type="button" variant="outline" className="border-yellow-400 text-yellow-200" onClick={() => setUnlockOpen(true)}>
                <Lock className="mr-2 h-4 w-4" /> Unlock manual changes
              </Button>
            </div>

            <section className="space-y-3 rounded-xl border border-white/10 bg-black/20 p-4">
              <h3 className="flex items-center gap-2 text-lg text-white"><Phone className="h-4 w-4 text-yellow-400" /> Caller</h3>
              <div className="space-y-2">
                <Input placeholder="Phone" value={form.phone} onChange={set('phone')} className="bg-white/10 border-white/30" />
                <label className="flex items-start gap-2 text-sm">
                  <Checkbox checked={form.smsConsent} onCheckedChange={(checked) => setForm((prev) => ({ ...prev, smsConsent: checked === true }))} />
                  Text this confirmation link for this call. Email is always sent. This does not opt them into order texts or marketing texts.
                </label>
              </div>
              <Input placeholder="Email" value={form.email} onChange={set('email')} className="bg-white/10 border-white/30" />
              <div className="grid gap-3 sm:grid-cols-2">
                <Input placeholder="First name" value={form.firstName} onChange={set('firstName')} className="bg-white/10 border-white/30" />
                <Input placeholder="Last name" value={form.lastName} onChange={set('lastName')} className="bg-white/10 border-white/30" />
              </div>
              {lookup.customers?.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {lookup.customers.map((customer) => (
                    <button key={customer.id} type="button" className="rounded-full border border-yellow-400/40 px-3 py-1 text-sm text-yellow-200" onClick={() => applyCustomer(customer)}>
                      Use {customer.name || customer.email}
                    </button>
                  ))}
                </div>
              )}
              {lookup.overlapping?.length > 0 && (
                <label className="flex items-start gap-2 text-sm text-amber-200">
                  <Checkbox checked={form.acknowledgeDuplicate} onCheckedChange={(checked) => setForm((prev) => ({ ...prev, acknowledgeDuplicate: checked === true }))} />
                  Overlapping booking {lookup.overlapping.map((row) => `#${row.id}`).join(', ')}. Caller confirmed this is a new order.
                </label>
              )}
              {lookup.openPending?.length > 0 && (
                <label className="flex items-start gap-2 text-sm text-amber-200">
                  <Checkbox checked={form.acknowledgePending} onCheckedChange={(checked) => setForm((prev) => ({ ...prev, acknowledgePending: checked === true }))} />
                  This email has an unfinished online checkout. Saving continues that draft as this phone order.
                </label>
              )}
            </section>

            <section className="space-y-3 rounded-xl border border-white/10 bg-black/20 p-4">
              <h3 className="text-lg text-white">Order</h3>
              <select
                value={form.serviceId}
                onChange={(event) => {
                  const nextId = event.target.value;
                  const next = services.find((row) => String(row.id) === nextId);
                  const nextDelivery = !next || [1, 3, 4].includes(Number(next.id));
                  setForm((prev) => ({ ...prev, serviceId: nextId, delivery: nextDelivery, dropOffTime: '', pickupTime: '' }));
                }}
                className={selectClass}
                style={{ colorScheme: 'dark' }}
              >
                <option className={optionClass} value="">Choose a service</option>
                {services.map((row) => (
                  <option className={optionClass} key={row.id} value={row.id}>{row.name}</option>
                ))}
              </select>
              {selected && !forcedDelivery && (
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={form.delivery}
                    disabled={!unlock && forcedDelivery}
                    onCheckedChange={(checked) => setForm((prev) => ({ ...prev, delivery: checked === true, dropOffTime: '', pickupTime: '' }))}
                  />
                  Deliver to the customer
                </label>
              )}
              {forcedDelivery && <p className="text-sm text-gray-400">This service is a delivery. Drop-off and pickup use the delivery windows from Availability.</p>}

              <GooglePlacesAutocomplete
                value={address.street}
                onChange={(value) => setAddress((prev) => ({ ...prev, street: value, isVerified: false, manualReviewAccepted: false }))}
                onAddressSelect={(details) => setAddress((prev) => ({ ...prev, ...applySelectedAddress(details) }))}
                placeholder="Start typing the address..."
              />
              <div className="grid gap-3 sm:grid-cols-3">
                <Input placeholder="City" value={address.city} onChange={(event) => setAddress((prev) => ({ ...prev, city: event.target.value, isVerified: false }))} className="bg-white/10 border-white/30" />
                <Input placeholder="State" value={address.state} onChange={(event) => setAddress((prev) => ({ ...prev, state: event.target.value, isVerified: false }))} className="bg-white/10 border-white/30" />
                <Input placeholder="ZIP" value={address.zip} onChange={(event) => setAddress((prev) => ({ ...prev, zip: event.target.value, isVerified: false }))} className="bg-white/10 border-white/30" />
              </div>
              {address.street && !addressCanProceed(address) && (
                <label className="flex items-start gap-2 text-sm text-amber-200">
                  <Checkbox checked={address.manualReviewAccepted === true} onCheckedChange={(checked) => setAddress((prev) => ({ ...prev, manualReviewAccepted: checked === true, isVerified: false }))} />
                  Google did not verify this address. Accept it for the same manual review the website uses.
                </label>
              )}
              {address.isVerified && <p className="text-sm text-emerald-300">Address verified with Google. {isDelivery && distanceMiles ? `${distanceMiles.toFixed(1)} miles · mileage ${money(mileage)}.` : ''}</p>}

              <div className="grid gap-3 sm:grid-cols-2">
                <DeskDateField
                  label={dropLabel}
                  value={form.dropOff}
                  disabledDates={dropDisabled}
                  onMonthChange={setCalendarMonth}
                  onChange={(value) => {
                    recordChange('field.drop_off', dropLabel, form.dropOff, value);
                    setForm((prev) => ({ ...prev, dropOff: value, dropOffTime: hourlyPickup ? prev.dropOffTime : '' }));
                  }}
                />
                <DeskDateField
                  label={pickLabel}
                  value={form.pickup}
                  disabledDates={pickDisabled}
                  onMonthChange={setCalendarMonth}
                  onChange={(value) => {
                    recordChange('field.pickup', pickLabel, form.pickup, value);
                    setForm((prev) => ({ ...prev, pickup: value, pickupTime: hourlyPickup ? prev.pickupTime : '' }));
                  }}
                />
                {hourlyPickup ? (
                  <>
                    <p className="rounded-md border border-white/15 bg-black/20 px-3 py-2 text-sm">Pickup start: {form.dropOffTime || 'Choose the pickup date'}</p>
                    <p className="rounded-md border border-white/15 bg-black/20 px-3 py-2 text-sm">Return by: {form.pickupTime || 'Choose the return date'}</p>
                  </>
                ) : (
                  <>
                    <select value={form.dropOffTime} onChange={set('dropOffTime')} className={selectClass} style={{ colorScheme: 'dark' }}>
                      <option className={optionClass} value="">{dropLabel} time</option>
                      {dropSlots.map((slot) => <option className={optionClass} key={slot.value} value={slot.value}>{slot.label}</option>)}
                    </select>
                    <select value={form.pickupTime} onChange={set('pickupTime')} className={selectClass} style={{ colorScheme: 'dark' }}>
                      <option className={optionClass} value="">{pickLabel} time</option>
                      {pickSlots.map((slot) => <option className={optionClass} key={slot.value} value={slot.value}>{slot.label}</option>)}
                    </select>
                  </>
                )}
              </div>
              {unlock && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Input placeholder="Custom first time" value={form.dropOffTime} onChange={(event) => { recordChange('field.drop_time', `${dropLabel} time`, fixedTimes.drop || '', event.target.value); set('dropOffTime')(event); }} className="bg-white/10 border-white/30" />
                  <Input placeholder="Custom second time" value={form.pickupTime} onChange={(event) => { recordChange('field.pick_time', `${pickLabel} time`, fixedTimes.pick || '', event.target.value); set('pickupTime')(event); }} className="bg-white/10 border-white/30" />
                </div>
              )}
              {!unlock && dropBlocked && <p className="text-sm text-red-300">That {dropLabel.toLowerCase()} is closed or already booked.</p>}
              {!unlock && rangeBlocked && <p className="text-sm text-red-300">A night between those dates is already booked.</p>}

              <div className="rounded-lg border border-white/10 p-3 space-y-3">
                <div className="flex items-center gap-2">
                  <h4 className="text-white">Hardware Protection Plan · {money(insurancePrice)}</h4>
                  <button type="button" className="text-yellow-400" onClick={() => setShowProtectionInfo((open) => !open)} aria-label="Hardware protection details">
                    <Info className="h-4 w-4" />
                  </button>
                </div>
                {showProtectionInfo && <p className="whitespace-pre-line text-sm text-gray-300">{getProtectionOptionsInfoDescription(effective?.name || '')}</p>}
                <div className="flex gap-4 text-sm">
                  <label className="flex items-center gap-2"><input type="radio" name="hpp" checked={form.insurance === 'accept'} onChange={() => setForm((prev) => ({ ...prev, insurance: 'accept' }))} /> Accept</label>
                  <label className="flex items-center gap-2"><input type="radio" name="hpp" checked={form.insurance === 'decline'} onChange={() => setForm((prev) => ({ ...prev, insurance: 'decline' }))} /> Decline</label>
                </div>
                {Number(effective?.id) === 1 && isDelivery && (
                  <div className="text-sm">
                    <p className="text-white">Driveway protection · {money(drivewayPrice)}</p>
                    <div className="mt-2 flex gap-4">
                      <label className="flex items-center gap-2"><input type="radio" name="driveway" checked={form.driveway === 'accept'} onChange={() => setForm((prev) => ({ ...prev, driveway: 'accept' }))} /> Accept</label>
                      <label className="flex items-center gap-2"><input type="radio" name="driveway" checked={form.driveway === 'decline'} onChange={() => setForm((prev) => ({ ...prev, driveway: 'decline' }))} /> Decline</label>
                    </div>
                  </div>
                )}
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                {addonChoices.map((item) => {
                  const max = stockMax[item.id];
                  const blocked = !unlock && max === 0;
                  return (
                    <label key={item.id} className="text-sm">
                      <span className="flex items-center justify-between gap-2">
                        <span>{item.label}{equipmentPrices[item.id] != null ? ` · ${money(equipmentPrices[item.id])}` : ''}</span>
                        <Input
                          type="number"
                          min="0"
                          max={unlock || !Number.isFinite(max) ? undefined : max}
                          disabled={blocked}
                          value={qty[item.id] || 0}
                          onChange={(event) => changeQty(item, event.target.value)}
                          className="w-20 bg-white/10 border-white/30"
                        />
                      </span>
                      {blocked && <span className="text-xs text-red-300">None available for those dates.</span>}
                      {!blocked && stockNote[item.id] && <span className="text-xs text-red-300">{stockNote[item.id]}</span>}
                    </label>
                  );
                })}
              </div>

              {(rewards?.pointsBalance > 0 || rewards?.referralWallet?.availableBalance > 0) && (
                <div className="grid gap-3 sm:grid-cols-2 text-sm">
                  {rewards.pointsBalance > 0 && (
                    <Label>Loyalty points ({rewards.pointsBalance} available)
                      <Input type="number" min="0" value={form.loyaltyPoints} onChange={set('loyaltyPoints')} className="bg-white/10 border-white/30" />
                    </Label>
                  )}
                  {rewards.referralWallet?.availableBalance > 0 && (
                    <Label>Referral balance ({money(rewards.referralWallet.availableBalance)})
                      <Input type="number" min="0" value={form.referralDollars} onChange={set('referralDollars')} className="bg-white/10 border-white/30" />
                    </Label>
                  )}
                </div>
              )}

              <div className="flex gap-2">
                <Input placeholder="Coupon" value={form.couponCode} onChange={set('couponCode')} className="bg-white/10 border-white/30" />
                <Button type="button" variant="outline" className="border-white/20" onClick={applyCoupon}>Apply</Button>
              </div>
              <Textarea placeholder="Notes for the crew" value={form.notes} onChange={set('notes')} className="bg-white/10 border-white/30" />
              <Textarea placeholder="Call notes, not shown to the customer" value={form.callNotes} onChange={set('callNotes')} className="bg-white/10 border-white/30" />
            </section>
          </div>

          <aside className="h-fit space-y-4 rounded-xl border border-yellow-400/30 bg-gradient-to-b from-yellow-400/10 to-transparent p-4 lg:sticky lg:top-4">
            <h3 className="text-lg text-white">Quote</h3>
            {quoteRows.map((line) => (
              <div key={line.key} className="flex items-start justify-between gap-2 text-sm">
                <p>{line.readLabel}</p>
                {unlock ? (
                  <Input
                    className="w-24 bg-white/10 border-white/30 text-right"
                    value={line.amount}
                    onChange={(event) => recordChange(line.key, line.readLabel, line.catalogAmount, event.target.value)}
                  />
                ) : (
                  <p>{money(line.amount)}</p>
                )}
              </div>
            ))}
            {discountRows.map((line) => (
              <div key={line.key} className="flex items-start justify-between gap-2 text-sm text-green-300">
                <p>{line.label}</p>
                <p>{money(line.amount)}</p>
              </div>
            ))}
            <div className="space-y-1 border-t border-white/15 pt-2 text-sm">
              <div className="flex justify-between gap-2">
                <p>Subtotal</p>
                <p>{money(approved?.subtotalBeforeTax || 0)}</p>
              </div>
              <div className="flex justify-between gap-2">
                <p>Tax ({Number(approved?.taxRate || taxRate || 0).toFixed(2)}%)</p>
                <p>{money(approved?.tax || 0)}</p>
              </div>
            </div>
            {unlock && (
              <Label className="text-sm">Approved total
                <Input className="bg-white/10 border-white/30" value={overrides.order_total ? overrides.order_total.amount_after : (chargeTotal || 0)} onChange={(event) => recordChange('order_total', 'Order total', approved?.total, event.target.value)} />
              </Label>
            )}
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-sm text-white">Total</p>
              <p className="text-2xl font-semibold text-yellow-300">{money(chargeTotal || 0)}</p>
            </div>
            <p className="text-xs text-gray-400">{days} day{days === 1 ? '' : 's'} · {effective?.name || 'choose a service'}</p>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <label className={`flex items-start gap-2 rounded-md border p-2 ${form.paymentChoice === 'customer_link' ? 'border-yellow-400 bg-yellow-400/10' : 'border-white/20'}`}>
                <input type="radio" name="pay" className="mt-1" checked={form.paymentChoice === 'customer_link'} onChange={() => setForm((prev) => ({ ...prev, paymentChoice: 'customer_link' }))} />
                Customer pays on the link
              </label>
              <label className={`flex items-start gap-2 rounded-md border p-2 ${form.paymentChoice === 'agent_card' ? 'border-yellow-400 bg-yellow-400/10' : 'border-white/20'}`}>
                <input type="radio" name="pay" className="mt-1" checked={form.paymentChoice === 'agent_card'} onChange={() => setForm((prev) => ({ ...prev, paymentChoice: 'agent_card' }))} />
                Enter their card now
              </label>
            </div>
            <div className="whitespace-pre-line rounded-lg bg-black/30 p-3 text-sm text-gray-200">{readBack}</div>
            <label className="flex items-start gap-2 text-sm">
              <Checkbox
                checked={form.readBack && (!pickupNeeded || form.licenseAcknowledged)}
                onCheckedChange={(checked) => setForm((prev) => ({
                  ...prev,
                  readBack: checked === true,
                  licenseAcknowledged: pickupNeeded ? checked === true : prev.licenseAcknowledged,
                }))}
              />
              <span>
                {pickupNeeded
                  ? 'I read this script to the caller, and they understand they must upload their driver\'s license (front and back), proof of insurance, and the towing vehicle\'s license plate on the confirmation link now, or in the customer portal at least 12 hours before pickup. The confirmation email explains how to log in. If they do not, the order stays on the same pending-verification path as the website.'
                  : 'I read this script to the caller.'}
              </span>
            </label>
            <Button type="button" variant="outline" className="w-full border-white/20 text-white" onClick={saveForLater} disabled={busy}>
              Save for later
            </Button>
            <Button onClick={submit} disabled={busy || !form.readBack || (pickupNeeded && !form.licenseAcknowledged)} className="w-full bg-yellow-400 text-black hover:bg-yellow-300">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save and send link'}
            </Button>
            {cardSecret && stripePromise && (
              <Elements stripe={stripePromise} options={{ clientSecret: cardSecret }}>
                <CardCapture onPaid={() => sendLink(pendingSendId)} />
              </Elements>
            )}
          </aside>
        </div>
      )}

      <MattressDisposalAgreementDialog
        open={showMattressAgreement}
        onOpenChange={setShowMattressAgreement}
        onAgree={confirmMattressDisposal}
      />

      <ApplianceDisposalAgreementDialog
        open={showApplianceAgreement}
        onOpenChange={setShowApplianceAgreement}
        onAgree={confirmApplianceDisposal}
      />

      <UnlockManualDialog
        open={unlockOpen}
        onClose={() => setUnlockOpen(false)}
        onUnlocked={(session) => {
          setUnlock(session);
          setUnlockOpen(false);
        }}
      />
    </div>
  );
}
