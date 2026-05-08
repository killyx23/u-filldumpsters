import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, CreditCard, Lock, Loader2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { toast } from '@/components/ui/use-toast';
import { format, isValid, parseISO } from 'date-fns';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { supabase } from '@/lib/customSupabaseClient';
import { DeliveryLocationMap } from '@/components/DeliveryLocationMap';
import { useInsurancePricing } from '@/hooks/useInsurancePricing';
import { getEquipmentPricingMetaMap } from '@/utils/equipmentPricingIntegration';
import { isValidEquipmentId } from '@/utils/equipmentIdValidator';
import { formatTimeWindow } from '@/utils/timeWindowFormatter';
import { getServiceSpecificDateLabel, isSelfServiceTrailer } from '@/utils/serviceSpecificLabels';
import { getFormattedServiceTimes } from '@/utils/serviceAvailabilityHelper';
import { useTaxRate } from '@/utils/getTaxRate';
import { calculateItemizedTax, resolveDeliveryType } from '@/utils/calculateTaxAmount';
import { useNavigate } from 'react-router-dom';

const stripePublishableKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;
const stripePromise =
  typeof stripePublishableKey === 'string' && stripePublishableKey.trim()
    ? loadStripe(stripePublishableKey)
    : null;

const formatMoney = (amount) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount ?? 0);

const ConfirmationLine = ({ label, value }) => (
  <div className="flex justify-between items-start py-1.5 border-b border-white/5 last:border-0">
    <p className="font-medium text-blue-200/80 w-1/3 pr-2">{label}:</p>
    <p className="text-right w-2/3 text-white font-medium whitespace-pre-line">{value ?? 'N/A'}</p>
  </div>
);

const BreakdownLine = ({ label, value, icon = null, dim = false }) => (
  <div className={`flex justify-between items-center py-1 ${dim ? 'opacity-60' : ''}`}>
    <span className="flex items-center">
      {icon && <span className="mr-2">{icon}</span>}
      {label}
    </span>
    <span>{formatMoney(value)}</span>
  </div>
);

const CategoryHeader = ({ icon, title }) => (
  <div className="flex items-center text-yellow-400 font-bold text-sm mt-4 mb-2 pb-1 border-b border-white/20">
    <span className="text-lg mr-2">{icon}</span>
    <span>{title}</span>
  </div>
);

const CheckoutForm = ({
  totalPrice,
  bookingData,
  plan,
  addonsData,
  onBack,
  bookingId,
  deliveryService,
  clientSecret,
  insurancePrice,
  // Service-level taxability props passed from parent (loaded from services table)
  serviceTaxable     = true,
  deliveryFeeTaxable = true,
  mileageTaxable     = true,
}) => {
  const stripe   = useStripe();
  const elements = useElements();
  const navigate = useNavigate();

  const [isProcessing,          setIsProcessing]          = useState(false);
  const [isConfirmed,           setIsConfirmed]           = useState(false);
  const [delivery_location_verified, setDeliveryLocation_Verified] = useState(false);
  const [formError,             setFormError]             = useState(null);
  const [isPaymentElementReady, setIsPaymentElementReady] = useState(false);

  // Map of equipmentId → { price, is_taxable }
  const [equipmentMeta,   setEquipmentMeta]   = useState({});
  const [loadingPrices,   setLoadingPrices]   = useState(true);
  const [availabilityTimes, setAvailabilityTimes] = useState({
    pickupStartTime: 'Time not specified',
    returnByTime:    'Time not specified',
  });
  const [taxUpdateStatus, setTaxUpdateStatus] = useState('pending');

  const isDelivery        = plan?.id === 2 && deliveryService;
  const currentPlan       = isDelivery ? { ...plan, name: "Dump Loader Trailer with Delivery" } : (plan || {});
  const planName          = currentPlan?.name || '';
  const isDeliveryService = plan?.id === 1 || plan?.id === 4 || (plan?.id === 2 && deliveryService);

  // Delivery type drives tax rate selection (Utah destination-based sourcing)
  const deliveryType = resolveDeliveryType(plan, deliveryService);
  const deliveryZip  = addonsData?.deliveryAddress?.zip ?? bookingData?.zip ?? null;

  const { taxRate, loading: loadingTaxRate } = useTaxRate(deliveryType, deliveryZip);

  const firstName        = bookingData?.firstName || bookingData?.first_name || '';
  const lastName         = bookingData?.lastName  || bookingData?.last_name  || '';
  const customerFullName = `${firstName} ${lastName}`.trim() || bookingData?.name || 'N/A';

  const contactAddress  = bookingData?.contactAddress;
  const deliveryAddress = addonsData?.deliveryAddress;
  const addressToUse    = (deliveryAddress?.street ? deliveryAddress : null) || contactAddress || {};

  // ── Load equipment pricing meta (price + is_taxable) ───────────────────────
  useEffect(() => {
    const loadPrices = async () => {
      setLoadingPrices(true);
      const idsToLoad = new Set([1, 2, 3, 4, 5, 6, 7]);
      try {
        const meta = await getEquipmentPricingMetaMap([...idsToLoad].filter(isValidEquipmentId));
        setEquipmentMeta(meta);
      } catch (error) {
        console.error('[PaymentPage] Error loading equipment meta:', error);
        // Fallback with safe defaults; insurance (7) non-taxable
        setEquipmentMeta({
          1: { price: 10, is_taxable: true  },
          2: { price: 15, is_taxable: true  },
          3: { price:  5, is_taxable: true  },
          4: { price: 25, is_taxable: true  },
          5: { price: 15, is_taxable: true  },
          6: { price: 35, is_taxable: true  },
          7: { price: 20, is_taxable: false }, // insurance non-taxable
        });
      } finally {
        setLoadingPrices(false);
      }
    };
    loadPrices();
  }, []);

  // ── Load availability times for self-service Dump Loader Trailer ───────────
  useEffect(() => {
    const loadAvailabilityTimes = async () => {
      if (plan?.id === 2 && !deliveryService) {
        try {
          const dropOffDate = bookingData?.dropOffDate || bookingData?.drop_off_date;
          const pickupDate  = bookingData?.pickupDate  || bookingData?.pickup_date;
          if (dropOffDate) {
            const dropOffTimes = await getFormattedServiceTimes(2, dropOffDate);
            const pickupTimes  = pickupDate ? await getFormattedServiceTimes(2, pickupDate) : dropOffTimes;
            setAvailabilityTimes({
              pickupStartTime: dropOffTimes.pickupStartTime,
              returnByTime:    pickupTimes.returnByTime,
            });
          }
        } catch (error) {
          console.error('[PaymentPage] Error loading availability times:', error);
        }
      }
    };
    loadAvailabilityTimes();
  }, [plan?.id, deliveryService, bookingData?.dropOffDate, bookingData?.drop_off_date, bookingData?.pickupDate, bookingData?.pickup_date]);

  // ── Build itemized line items ───────────────────────────────────────────────
  const meta = (id) => equipmentMeta[Number(id)] ?? { price: 0, is_taxable: true };

  const lineItems = [];

  const basePriceAmount = currentPlan?.base_price || currentPlan?.price || 0;
  if (basePriceAmount > 0) lineItems.push({ label: 'Base Rental Price', amount: basePriceAmount, is_taxable: serviceTaxable });

  const deliveryFeeFlat = addonsData?.deliveryFee || 0;
  if (deliveryFeeFlat > 0) lineItems.push({ label: 'Base Delivery Fee', amount: deliveryFeeFlat, is_taxable: deliveryFeeTaxable });

  const tripMileageCost = addonsData?.mileageCharge || addonsData?.distanceInfo?.mileageFee || 0;
  if (tripMileageCost > 0) lineItems.push({ label: 'Mileage Charge', amount: tripMileageCost, is_taxable: mileageTaxable });

  // Insurance — is_taxable from DB (false in Utah)
  if (addonsData?.insurance === 'accept') {
    const ins = meta(7);
    const insuranceCost = ins.price || insurancePrice;
    if (insuranceCost > 0) lineItems.push({ label: 'Rental Insurance', amount: insuranceCost, is_taxable: ins.is_taxable });
  }

  // Driveway protection
  if ((plan?.id === 1 || isDelivery) && addonsData?.drivewayProtection === 'accept') {
    lineItems.push({ label: 'Driveway Protection', amount: 15, is_taxable: true });
  }

  // Rental equipment & consumables
  if (addonsData?.equipment?.length > 0 && !loadingPrices) {
    for (const item of addonsData.equipment) {
      const id = item.equipment_id || item.dbId || item.id;
      if (!id || !isValidEquipmentId(id)) continue;
      const { price, is_taxable } = meta(id);
      const quantity = item.quantity || 1;
      const label    = id === 1 ? 'Wheelbarrow' : id === 2 ? 'Hand Truck' : id === 3 ? 'Working Gloves (Pair)' : `Equipment #${id}`;
      lineItems.push({ label: `${label}${quantity > 1 ? ` (x${quantity})` : ''}`, amount: price * quantity, is_taxable });
    }
  }

  // Disposal items
  const mattressQty   = addonsData?.mattressDisposal   || 0;
  const tvQty         = addonsData?.tvDisposal          || 0;
  const applianceQty  = addonsData?.applianceDisposal   || 0;
  if (mattressQty  > 0) lineItems.push({ label: `Mattress Disposal (x${mattressQty})`,    amount: meta(4).price * mattressQty,   is_taxable: meta(4).is_taxable });
  if (tvQty        > 0) lineItems.push({ label: `TV Disposal (x${tvQty})`,                amount: meta(5).price * tvQty,         is_taxable: meta(5).is_taxable });
  if (applianceQty > 0) lineItems.push({ label: `Appliance Disposal (x${applianceQty})`,  amount: meta(6).price * applianceQty,  is_taxable: meta(6).is_taxable });

  // Coupon discount — reduces taxable subtotal
  const discountAmount = (() => {
    if (!addonsData?.coupon?.isValid) return 0;
    const fullSum = lineItems.reduce((s, i) => s + i.amount, 0);
    if (addonsData.coupon.discountType === 'fixed') return addonsData.coupon.discountValue || 0;
    return fullSum * ((addonsData.coupon.discountValue || 0) / 100);
  })();
  if (discountAmount > 0) {
    lineItems.push({ label: `Coupon (${addonsData.coupon.code || 'Applied'})`, amount: -discountAmount, is_taxable: true });
  }

  const taxCalc        = calculateItemizedTax(lineItems, taxRate);
  const calculatedTotal = taxCalc.total;

  // ── Persist tax info + delivery_type to booking before payment ──────────────
  useEffect(() => {
    const updateBookingTaxInfo = async () => {
      if (!bookingId || loadingPrices || loadingTaxRate || taxUpdateStatus !== 'pending') return;

      const timestamp = new Date().toISOString();
      console.log(`[${timestamp}] [PaymentPage] Updating booking with tax & delivery_type`, {
        bookingId, deliveryType,
        taxableSubtotal:    taxCalc.taxableSubtotal,
        nonTaxableSubtotal: taxCalc.nonTaxableSubtotal,
        taxAmount:          taxCalc.taxAmount,
        taxRate,
        total:              calculatedTotal,
      });

      try {
        const { error } = await supabase
          .from('bookings')
          .update({
            delivery_type:       deliveryType,
            subtotal_before_tax: taxCalc.subtotal,
            tax_amount:          taxCalc.taxAmount,
            tax_rate_used:       taxRate,
            total_price:         calculatedTotal,
          })
          .eq('id', bookingId);

        if (error) {
          console.error(`[${timestamp}] [PaymentPage] Failed to update booking tax info:`, error);
          setTaxUpdateStatus('failed');
        } else {
          console.log(`[${timestamp}] [PaymentPage] ✓ Booking tax info updated`);
          setTaxUpdateStatus('success');
        }
      } catch (err) {
        console.error(`[${timestamp}] [PaymentPage] Error updating booking:`, err);
        setTaxUpdateStatus('failed');
      }
    };

    updateBookingTaxInfo();
  }, [bookingId, taxCalc.subtotal, taxCalc.taxAmount, taxRate, calculatedTotal, deliveryType, loadingPrices, loadingTaxRate, taxUpdateStatus]);

  // ── Date formatting helpers ────────────────────────────────────────────────
  const formatDate = (date) => {
    if (!date) return 'N/A';
    try {
      const parsed = date instanceof Date ? date : parseISO(date.toString());
      return isValid(parsed) ? format(parsed, 'PPP') : 'Invalid Date';
    } catch { return 'Invalid Date'; }
  };

  const isSelfService = isSelfServiceTrailer(plan, isDelivery);
  const dropoffLabel  = getServiceSpecificDateLabel(plan, isDelivery, 'dropoff');
  const pickupLabel   = getServiceSpecificDateLabel(plan, isDelivery, 'pickup');

  const timeOptions = { isWindow: isDeliveryService, isSelfService, serviceType: plan?.service_type };

  const getDisplayTime = (timeSlot, isDropOff) => {
    if (plan?.id === 2 && !deliveryService) {
      return isDropOff ? availabilityTimes.pickupStartTime : availabilityTimes.returnByTime;
    }
    return formatTimeWindow(timeSlot, timeOptions);
  };

  const formatConfirmationValue = (date, timeSlot, isDropOff) => {
    const formattedDate = formatDate(date);
    const time          = getDisplayTime(timeSlot, isDropOff);
    if (isSelfService) {
      const timeLabel = isDropOff ? 'Pickup Start Time' : 'Return by Time';
      return `${formattedDate}\n${timeLabel}: ${time}`;
    }
    return `${formattedDate} ${isDeliveryService ? 'at' : 'by'} ${time}`;
  };

  const canProceedWithPayment =
    isConfirmed && stripe && elements && isPaymentElementReady &&
    (!isDeliveryService || delivery_location_verified) &&
    taxUpdateStatus === 'success';

  // ── Payment submission ─────────────────────────────────────────────────────
  const handlePayment = async (e) => {
    e.preventDefault();
    setFormError(null);

    if (!stripe || !elements) { setFormError("Stripe is still initializing. Please wait a moment and try again."); return; }
    if (!isConfirmed) { toast({ title: "Confirmation Required", description: "Please confirm your details before paying.", variant: "destructive" }); return; }
    if (isDeliveryService && !delivery_location_verified) { toast({ title: "Location Verification Required", description: "Please verify the delivery location map.", variant: "destructive" }); return; }
    if (!isPaymentElementReady) { setFormError("Payment form is not ready yet."); return; }
    if (taxUpdateStatus !== 'success') { setFormError("Tax calculation is still processing. Please wait."); return; }

    setIsProcessing(true);
    try {
      if (isDeliveryService && delivery_location_verified) {
        await supabase.from('bookings').update({ delivery_location_verified: true, delivery_location_verified_at: new Date().toISOString() }).eq('id', bookingId);
      }

      const { error: stripeError, paymentIntent } = await stripe.confirmPayment({
        elements,
        confirmParams: {
          payment_method_data: {
            billing_details: {
              name:    customerFullName,
              email:   bookingData?.email  || '',
              phone:   bookingData?.phone  || '',
              address: { line1: addressToUse?.street || '', city: addressToUse?.city || '', state: addressToUse?.state || '', postal_code: addressToUse?.zip || '', country: 'US' },
            },
          },
        },
        redirect: 'if_required',
      });

      if (stripeError) {
        setFormError(stripeError.message || "An unexpected error occurred. Please try again.");
        toast({ title: "Payment Failed", description: stripeError.message || "An unexpected error occurred.", variant: "destructive" });
        setIsProcessing(false);
        return;
      }

      const confirmationUrl = `${window.location.origin}/confirmation?booking_id=${bookingId}&payment_intent=${paymentIntent?.id}`;
      setTimeout(() => { window.location.href = confirmationUrl; }, 1500);
    } catch (err) {
      setIsProcessing(false);
      setFormError("An error occurred during payment processing.");
      toast({ title: 'Payment Error', description: err.message || 'An unexpected error occurred.', variant: 'destructive' });
    }
  };

  const handleAddressCorrection = () => navigate('/book');

  // ── Loading state ──────────────────────────────────────────────────────────
  if (loadingPrices || loadingTaxRate) {
    return (
      <div className="flex flex-col justify-center items-center h-96 text-white">
        <Loader2 className="h-16 w-16 animate-spin text-yellow-400 mb-4" />
        <span className="text-xl font-medium">Loading price breakdown...</span>
      </div>
    );
  }

  // ── Render line-item display groups ───────────────────────────────────────
  const serviceLIs    = lineItems.filter(i => ['Base Rental Price','Base Delivery Fee','Mileage Charge'].includes(i.label));
  const protectionLIs = lineItems.filter(i => ['Rental Insurance','Driveway Protection'].includes(i.label));
  const equipmentLIs  = lineItems.filter(i => !serviceLIs.includes(i) && !protectionLIs.includes(i) && !i.label.includes('Disposal') && !i.label.startsWith('Coupon') && i.amount > 0 && !i.label.startsWith('Working Gloves'));
  const purchaseLIs   = lineItems.filter(i => i.label.startsWith('Working Gloves'));
  const disposalLIs   = lineItems.filter(i => i.label.includes('Disposal'));
  const discountLIs   = lineItems.filter(i => i.amount < 0);

  return (
    <motion.div initial={{ opacity: 0, x: 100 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -100 }} transition={{ duration: 0.5 }} className="container mx-auto py-16 px-4">
      <div className="max-w-2xl mx-auto bg-slate-900/60 backdrop-blur-lg rounded-2xl p-8 shadow-2xl border border-white/20">
        <div className="flex items-center mb-8">
          <Button onClick={onBack} variant="ghost" size="icon" className="mr-4 text-white hover:bg-white/20" disabled={isProcessing}><ArrowLeft /></Button>
          <h2 className="text-3xl font-bold text-white">Secure Payment</h2>
        </div>

        {taxUpdateStatus === 'failed' && (
          <div className="mb-6 bg-orange-950/40 border border-orange-500/30 rounded-lg p-4">
            <p className="text-orange-300 text-sm">Tax calculation update pending. Payment may proceed once confirmed.</p>
          </div>
        )}

        {/* Booking details */}
        <div className="bg-white/5 p-6 rounded-lg mb-8 border border-white/10">
          <h3 className="text-2xl font-bold text-yellow-400 mb-4 border-b border-white/10 pb-2">Order Summary</h3>
          <div className="space-y-1 text-white">
            <ConfirmationLine label="Service"  value={currentPlan?.name} />
            <ConfirmationLine label="Customer" value={customerFullName} />
            <ConfirmationLine label="Email"    value={bookingData?.email} />
            <ConfirmationLine label="Address"  value={addressToUse?.street ? `${addressToUse.street}, ${addressToUse.city}, ${addressToUse.state} ${addressToUse.zip}` : 'N/A'} />
            <ConfirmationLine label={dropoffLabel} value={formatConfirmationValue(bookingData?.dropOffDate, bookingData?.dropOffTimeSlot, true)} />
            <ConfirmationLine label={pickupLabel}  value={formatConfirmationValue(bookingData?.pickupDate,  bookingData?.pickupTimeSlot,  false)} />
          </div>
        </div>

        {isDeliveryService && (
          <>
            <DeliveryLocationMap deliveryAddress={addressToUse} isVerified={delivery_location_verified} onVerificationChange={setDeliveryLocation_Verified} />
            <div className="mb-8 flex justify-center">
              <Button onClick={handleAddressCorrection} variant="outline" className="text-orange-400 border-orange-500/50 hover:bg-orange-500/10 hover:border-orange-500">
                This is incorrect – Go back to edit address
              </Button>
            </div>
          </>
        )}

        {/* Charges breakdown */}
        <div className="bg-white/5 p-6 rounded-lg mb-8 border border-white/10">
          <h4 className="text-2xl font-bold text-yellow-400 mb-4 border-b border-white/10 pb-2">Charges Breakdown</h4>
          <div className="space-y-1 text-blue-100 font-mono text-sm">

            {serviceLIs.length > 0 && (
              <>
                <CategoryHeader icon="📦" title="Service Costs" />
                {serviceLIs.map((i, idx) => <BreakdownLine key={idx} label={i.label} value={i.amount} />)}
              </>
            )}

            {protectionLIs.length > 0 && (
              <>
                <CategoryHeader icon="🛡️" title="Protection Options" />
                {protectionLIs.map((i, idx) => (
                  <BreakdownLine key={idx} label={i.label} value={i.amount} dim={!i.is_taxable} />
                ))}
                {protectionLIs.some(i => !i.is_taxable) && (
                  <p className="text-xs text-blue-300/60 pl-1 mt-1">* Insurance is non-taxable in Utah</p>
                )}
              </>
            )}

            {equipmentLIs.length > 0 && (
              <>
                <CategoryHeader icon="🚚" title="Rent Equipment" />
                {equipmentLIs.map((i, idx) => <BreakdownLine key={idx} label={i.label} value={i.amount} />)}
              </>
            )}

            {purchaseLIs.length > 0 && (
              <>
                <CategoryHeader icon="🛒" title="Items for Purchase" />
                {purchaseLIs.map((i, idx) => <BreakdownLine key={idx} label={i.label} value={i.amount} />)}
              </>
            )}

            {disposalLIs.length > 0 && (
              <>
                <CategoryHeader icon="♻️" title="Disposal Items" />
                {disposalLIs.map((i, idx) => <BreakdownLine key={idx} label={i.label} value={i.amount} />)}
              </>
            )}

            {discountLIs.length > 0 && (
              <>
                <CategoryHeader icon="🏷️" title="Discounts" />
                {discountLIs.map((i, idx) => <BreakdownLine key={idx} label={i.label} value={i.amount} />)}
              </>
            )}

            {/* Totals */}
            <div className="border-t border-white/20 my-3 pt-3">
              {taxCalc.nonTaxableSubtotal > 0 && (
                <div className="flex justify-between items-center py-1 text-blue-300/60 text-xs">
                  <span>Non-taxable items</span>
                  <span>{formatMoney(taxCalc.nonTaxableSubtotal)}</span>
                </div>
              )}
              <BreakdownLine label="Subtotal" value={taxCalc.subtotal} />
              <BreakdownLine
                label={`Tax (${taxRate.toFixed(2)}% · ${deliveryType === 'delivery' ? 'delivery rate' : 'pickup rate'})`}
                value={taxCalc.taxAmount}
              />
            </div>
            <div className="border-t border-white/20 pt-3 mt-1">
              <div className="flex justify-between items-center text-white">
                <span className="text-lg font-bold">Total Amount:</span>
                <span className="text-2xl font-bold text-green-400">{formatMoney(calculatedTotal)}</span>
              </div>
            </div>

            {isDeliveryService && (
              <div className="bg-yellow-900/20 border border-yellow-500/30 rounded-lg p-3 mt-4">
                <div className="flex items-start">
                  <span className="text-xl mr-2">🏗️</span>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-yellow-400">Landfill/Disposal Fees (TBD)</p>
                    <p className="text-xs text-yellow-200 mt-1">Pending dump fees will be calculated based on actual waste processed</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <form onSubmit={handlePayment}>
          <div className="mb-6">
            <PaymentElement
              onReady={() => setIsPaymentElementReady(true)}
              options={{ layout: 'tabs', fields: { billingDetails: { name: 'never', email: 'never', phone: 'never', address: 'never' } } }}
            />
          </div>
          {formError && (
            <div className="mb-6 flex items-start text-red-400 text-sm bg-red-950/40 p-3 rounded border border-red-500/30">
              <span className="mr-2 flex-shrink-0">⚠</span><p>{formError}</p>
            </div>
          )}
          <div className="flex items-center space-x-3 mb-6 bg-white/5 p-4 rounded-lg border border-white/10">
            <Checkbox id="confirm-details" checked={isConfirmed} onCheckedChange={setIsConfirmed} disabled={isProcessing} className="border-white/50 data-[state=checked]:bg-green-500 data-[state=checked]:border-green-500" />
            <Label htmlFor="confirm-details" className="text-sm text-blue-100 leading-snug cursor-pointer select-none">I have reviewed all the information above and confirm it is correct.</Label>
          </div>
          {!canProceedWithPayment && !isProcessing && isDeliveryService && !delivery_location_verified && (
            <div className="mb-4 text-center text-orange-400 text-sm font-medium bg-orange-950/30 py-2 rounded border border-orange-500/30">Please verify delivery location to continue</div>
          )}
          {!canProceedWithPayment && !isProcessing && taxUpdateStatus !== 'success' && (
            <div className="mb-4 text-center text-orange-400 text-sm font-medium bg-orange-950/30 py-2 rounded border border-orange-500/30">Finalizing tax calculation...</div>
          )}
          <Button
            type="submit"
            disabled={isProcessing || !canProceedWithPayment}
            className={`w-full py-6 text-xl font-bold transition-all duration-300 ${isProcessing || !canProceedWithPayment ? 'bg-white/10 text-white/50 cursor-not-allowed border border-white/10' : 'bg-gradient-to-r from-green-500 to-teal-600 hover:from-green-600 hover:to-teal-700 text-white shadow-xl shadow-green-900/40 border border-green-400/30 active:scale-[0.98]'}`}
          >
            {isProcessing
              ? <><Loader2 className="mr-3 h-6 w-6 animate-spin" />Processing Payment...</>
              : <><CreditCard className="mr-3 h-6 w-6" />Pay {formatMoney(totalPrice)}</>
            }
          </Button>
          <p className="text-xs text-gray-400 mt-4 flex items-center justify-center">
            <Lock className="h-3 w-3 mr-1.5 text-blue-400" /> Secure 256-bit SSL Encrypted Payment
          </p>
        </form>
      </div>
    </motion.div>
  );
};

export const PaymentPage = ({ totalPrice, bookingData, plan, addonsData, onBack, bookingId, deliveryService }) => {
  const [clientSecret, setClientSecret] = useState(null);
  const [error,        setError]        = useState(null);
  const { insurancePrice } = useInsurancePricing();

  useEffect(() => {
    if (!bookingId) { setError("Booking ID is missing. Cannot proceed with payment."); return; }

    const initPaymentIntent = async () => {
      try {
        const { data, error: invokeError } = await supabase.functions.invoke('create-payment-intent', { body: { booking_id: bookingId } });
        if (invokeError) throw invokeError;
        if (data?.error) throw new Error(data.error);
        const secret = data?.clientSecret || data?.client_secret;
        if (!secret) throw new Error("Invalid response from server: missing payment parameters.");
        setClientSecret(secret);
      } catch (err) {
        console.error("Failed to initialize payment intent:", err);
        const errorMessage = err.message && !err.message.includes("Failed to fetch")
          ? `Payment Setup Error: ${err.message}`
          : "Failed to initialize payment gateway. Please try again later.";
        setError(errorMessage);
        toast({ title: "Payment Error", description: errorMessage, variant: "destructive" });
      }
    };

    initPaymentIntent();
  }, [bookingId]);

  if (!stripePromise) {
    return <div className="container mx-auto px-4 py-8"><div className="max-w-4xl mx-auto bg-red-900/40 border border-red-500/50 p-4 rounded-lg text-red-200 font-semibold flex items-center shadow-lg"><AlertTriangle className="h-6 w-6 mr-3 flex-shrink-0 text-red-400" /><p>Payment configuration is missing. Please check your Stripe configuration.</p></div></div>;
  }
  if (error) {
    return <div className="container mx-auto px-4 py-8"><div className="max-w-2xl mx-auto bg-red-900/40 border border-red-500/50 p-6 rounded-lg shadow-lg"><div className="flex items-center text-red-200 font-bold text-xl mb-4"><AlertTriangle className="h-8 w-8 mr-3 text-red-400" />Payment Initialization Failed</div><p className="text-red-100 mb-6 bg-black/20 p-4 rounded font-mono text-sm border border-red-500/20 break-words">{error}</p><div className="flex justify-center"><Button onClick={onBack} variant="outline" className="text-white hover:bg-white/10 w-full sm:w-auto"><ArrowLeft className="mr-2 h-4 w-4" /> Go Back to Review</Button></div></div></div>;
  }
  if (!clientSecret) {
    return <div className="flex flex-col justify-center items-center h-96 text-white"><Loader2 className="h-16 w-16 animate-spin text-yellow-400 mb-4" /><span className="text-xl font-medium">Preparing Secure Payment...</span><p className="text-gray-400 mt-2">Connecting to payment gateway. Please wait.</p></div>;
  }

  const elementsOptions = {
    clientSecret,
    appearance: {
      theme: 'night',
      variables: { colorPrimary: '#facc15', colorBackground: '#1e293b', colorText: '#f1f5f9', colorDanger: '#ef4444', fontFamily: '"Inter", system-ui, sans-serif', borderRadius: '8px' },
      rules: { '.Input': { backgroundColor: '#0f172a', border: '1px solid rgba(255,255,255,0.15)' }, '.Input:focus': { border: '1px solid #facc15', boxShadow: '0 0 0 2px rgba(250,204,21,0.2)' }, '.Label': { color: '#94a3b8' } },
    },
  };

  return (
    <Elements stripe={stripePromise} options={elementsOptions}>
      <CheckoutForm
        totalPrice={totalPrice}
        bookingData={bookingData}
        plan={plan}
        addonsData={addonsData}
        onBack={onBack}
        bookingId={bookingId}
        deliveryService={deliveryService}
        clientSecret={clientSecret}
        insurancePrice={insurancePrice}
      />
    </Elements>
  );
};
