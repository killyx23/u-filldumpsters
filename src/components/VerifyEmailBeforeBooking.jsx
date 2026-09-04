
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Mail, ShieldCheck, Loader2, CheckCircle2, Calendar, MapPin, Package, Receipt, AlertTriangle, XCircle, RefreshCw, Info, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';
import { format, isValid } from 'date-fns';
import { retrievePendingBooking, hydratePlanFromPending, mapPendingToBookingState, isDriverVerificationComplete } from '@/utils/bookingDataPersistence';
import { attachCheckoutVerificationDocuments } from '@/utils/verificationImageHelper';
import { getPriceForEquipment } from '@/utils/equipmentPricingIntegration';
import { isValidEquipmentId } from '@/utils/equipmentIdValidator';
import { PriceBreakdownCategory } from '@/components/pricing/PriceBreakdownCategory';
import { formatTimeWindow, shouldShowTimeWindow } from '@/utils/timeWindowFormatter';
import { UiControlGuide } from '@/components/UiControlGuide';
import { getBookingGuideEntries } from '@/config/uiControlGuideEntries';
import { getServiceSpecificDateLabel, isSelfServiceTrailer } from '@/utils/serviceSpecificLabels';
import { getFormattedServiceTimes } from '@/utils/serviceAvailabilityHelper';
import { useTaxRate } from '@/utils/getTaxRate';
import { calculateBookingTaxBreakdown } from '@/utils/bookingTaxCalculator';
import { useBookingTaxOptions } from '@/hooks/useBookingTaxOptions';
import { formatCustomerFacingPlanName } from '@/utils/displayPlanName';
import { parseEdgeFunctionError } from '@/utils/parseEdgeFunctionError';
import { getAppOrigin } from '@/utils/getAppOrigin';
import { publishCheckoutSyncEvent } from '@/utils/checkoutTabSync';
import { useBookingFlowOptional } from '@/contexts/BookingFlowContext';
import { markVerifiedEmailSession } from '@/utils/checkoutEmailVerification';
import { clearCheckoutTeardownDone } from '@/utils/checkoutIdleGuard';
import {
    saveVerificationDeadline,
    readVerificationDeadline,
    clearVerificationDeadline,
    formatCountdown,
} from '@/utils/verificationCodeWindow';

const LOADING_TIMEOUT_MS = 30000; // 30 seconds timeout

const CodeWindowNotice = ({ remainingMs }) => (
    <div className="mt-3 rounded-lg border border-yellow-400/30 bg-yellow-400/10 px-3 py-2 text-left">
        <div className="flex items-start gap-2">
            <Clock className="h-4 w-4 shrink-0 text-yellow-300 mt-0.5" aria-hidden />
            <p className="text-xs text-yellow-100 leading-relaxed">
                Your verification code is good for 15 minutes. Once it expires, the code will no
                longer work and your booking will be released, so you would need to start again.
                {remainingMs != null && remainingMs > 0 && (
                    <span className="block mt-1 font-semibold text-white">
                        Code expires in {formatCountdown(remainingMs)}
                    </span>
                )}
            </p>
            <Popover>
                <PopoverTrigger asChild>
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 shrink-0 text-yellow-300 hover:text-white hover:bg-white/10"
                        aria-label="Why codes expire in 15 minutes"
                    >
                        <Info className="h-4 w-4" />
                    </Button>
                </PopoverTrigger>
                <PopoverContent
                    align="end"
                    className="w-80 bg-gray-950 border-white/15 text-white p-4 shadow-xl"
                >
                    <p className="font-semibold text-sm text-blue-200 mb-2">
                        Why codes expire in 15 minutes
                    </p>
                    <p className="text-xs text-gray-300 leading-relaxed">
                        While you verify your email, we hold your selected date and time so that no
                        one else can book it. Keeping that hold short prevents the same slot from
                        being double-booked and gives other customers who are waiting a fair chance
                        at it if you decide not to continue. If your code expires, you are welcome to
                        start a new booking at any time.
                    </p>
                </PopoverContent>
            </Popover>
        </div>
    </div>
);

function buildVerificationAttachPayload(addons, email, pendingToken, customerId = null) {
    if (!email || addons?.wasVerificationSkipped) return null;

    const urls = addons.licenseImageUrls;
    const front = Array.isArray(urls) ? urls[0] : urls?.front;
    const back = Array.isArray(urls) ? urls[1] : urls?.back;
    const insurance = addons.insuranceImageUrl;

    const hasDocs = Boolean(
      front?.url || front?.path || back?.url || back?.path || insurance?.url || insurance?.path
    );
    if (!hasDocs) return null;

    return {
        customerId,
        email,
        pendingToken,
        licensePlate: addons.licensePlate || null,
        licenseFrontUrl: front?.url || null,
        licenseFrontPath: front?.path || null,
        licenseBackUrl: back?.url || null,
        licenseBackPath: back?.path || null,
        insuranceUrl: insurance?.url || null,
        insurancePath: insurance?.path || null,
    };
}

export const VerifyEmailBeforeBooking = ({ onBack }) => {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const token = searchParams.get('token');
    const codeFromUrl = searchParams.get('code');
    const loadingTimeoutRef = useRef(null);
    const verificationTimeoutRef = useRef(null);

    const [status, setStatus] = useState('loading');
    const [code, setCode] = useState('');
    const [bookingData, setBookingData] = useState(null);
    const [plan, setPlan] = useState(null);
    const [addonsData, setAddonsData] = useState(null);
    const [pendingRecord, setPendingRecord] = useState(null);
    const [equipmentPrices, setEquipmentPrices] = useState({});
    const [loadingPrices, setLoadingPrices] = useState(true);
    const [availabilityTimes, setAvailabilityTimes] = useState({
        pickupStartTime: 'Time not specified',
        returnByTime: 'Time not specified'
    });
    const [error, setError] = useState('');
    const [retryCount, setRetryCount] = useState(0);
    const [codeDeadline, setCodeDeadline] = useState(null);
    const [codeRemainingMs, setCodeRemainingMs] = useState(null);
    const emailLinkArrivalRef = useRef(/^\d{6}$/.test(String(codeFromUrl || '').trim()));
    const verifiedLocallyRef = useRef(false);
    const continueStartedRef = useRef(false);
    const autoVerifyStartedRef = useRef(false);
    const codeExpiredHandledRef = useRef(false);
    const bookingFlow = useBookingFlowOptional();
    const bookingDataRef = useRef(null);
    const pendingRecordRef = useRef(null);
    const planRef = useRef(null);
    const addonsDataRef = useRef(null);

    const isDelivery = plan?.id === 2 && addonsData?.deliveryService;
    const { taxRate, loading: loadingTaxRate } = useTaxRate();
    const { insurancePrice, taxOptions, drivewayPrice, loading: loadingTaxOptions } = useBookingTaxOptions(plan?.id);

    useEffect(() => {
        bookingDataRef.current = bookingData;
    }, [bookingData]);
    useEffect(() => {
        pendingRecordRef.current = pendingRecord;
    }, [pendingRecord]);
    useEffect(() => {
        planRef.current = plan;
    }, [plan]);
    useEffect(() => {
        addonsDataRef.current = addonsData;
    }, [addonsData]);

    // Cleanup timeouts on unmount
    useEffect(() => {
        return () => {
            if (loadingTimeoutRef.current) {
                clearTimeout(loadingTimeoutRef.current);
            }
            if (verificationTimeoutRef.current) {
                clearTimeout(verificationTimeoutRef.current);
            }
        };
    }, []);

    // Load pending booking data on mount with timeout
    useEffect(() => {
        const loadPendingBooking = async () => {
            const timestamp = new Date().toISOString();
            console.log(`[${timestamp}] [VerifyEmailBeforeBooking] Starting to load pending booking`);
            console.log(`[${timestamp}] [VerifyEmailBeforeBooking] Token from URL:`, token);

            if (!token) {
                const errMsg = 'Verification link is invalid or expired. Please start a new booking.';
                console.error(`[${timestamp}] [VerifyEmailBeforeBooking] No token provided`);
                setStatus('error');
                setError(errMsg);
                return;
            }

            // Set timeout for loading
            loadingTimeoutRef.current = setTimeout(() => {
                const timeoutTs = new Date().toISOString();
                console.error(`[${timeoutTs}] [VerifyEmailBeforeBooking] Loading timeout exceeded (${LOADING_TIMEOUT_MS}ms)`);
                setStatus('error');
                setError('Loading took too long. Please refresh the page or try again.');
            }, LOADING_TIMEOUT_MS);

            try {
                console.log(`[${timestamp}] [VerifyEmailBeforeBooking] Calling retrievePendingBooking with token:`, token);
                const result = await retrievePendingBooking(token);
                
                const resultTs = new Date().toISOString();
                console.log(`[${resultTs}] [VerifyEmailBeforeBooking] retrievePendingBooking result:`, result);

                if (!result.success) {
                    console.error(`[${resultTs}] [VerifyEmailBeforeBooking] Failed to retrieve booking:`, result.error);
                    clearTimeout(loadingTimeoutRef.current);
                    setStatus('error');
                    setError(result.error || 'Could not retrieve your booking details. The link may have expired.');
                    return;
                }

                const pending = result.bookingData;
                console.log(`[${resultTs}] [VerifyEmailBeforeBooking] Successfully retrieved pending booking:`, pending);

                // Reconstruct booking data from pending_customers record
                const reconstructedBookingData = pending.booking_data || {
                    firstName: pending.first_name,
                    lastName: pending.last_name,
                    email: pending.email,
                    phone: pending.phone,
                    contactAddress: pending.contact_address,
                    dropOffDate: pending.drop_off_date,
                    pickupDate: pending.pickup_date,
                    dropOffTimeSlot: pending.drop_off_time_slot,
                    pickupTimeSlot: pending.pickup_time_slot,
                    notes: pending.notes
                };

                console.log(`[${resultTs}] [VerifyEmailBeforeBooking] Reconstructed booking data:`, reconstructedBookingData);
                const hydratedPlan = await hydratePlanFromPending(pending);
                console.log(`[${resultTs}] [VerifyEmailBeforeBooking] Service id:`, pending.service_id);
                console.log(`[${resultTs}] [VerifyEmailBeforeBooking] Addons data:`, pending.addons_data);

                setBookingData(reconstructedBookingData);
                setPlan(hydratedPlan);
                setAddonsData(pending.addons_data || {});
                setPendingRecord(pending);

                clearTimeout(loadingTimeoutRef.current);
                setStatus('idle');
                console.log(`[${resultTs}] [VerifyEmailBeforeBooking] Status set to 'idle', ready for verification`);

            } catch (error) {
                const catchTs = new Date().toISOString();
                console.error(`[${catchTs}] [VerifyEmailBeforeBooking] Exception during loadPendingBooking:`, error);
                clearTimeout(loadingTimeoutRef.current);
                setStatus('error');
                setError(`Failed to load booking details: ${error.message}`);
            }
        };

        loadPendingBooking();
    }, [token, retryCount, navigate]);

    useEffect(() => {
        if (status !== 'idle') return;
        const prefetchedCode = String(codeFromUrl || '').trim();
        if (!/^\d{6}$/.test(prefetchedCode)) return;
        setCode(prefetchedCode);
        setStatus('sent');
        // Email-link arrival: verify in this tab, then tell the original tab to continue.
        emailLinkArrivalRef.current = true;
    }, [status, codeFromUrl]);

    // Deadline is written by whichever tab requested the code, so read it from
    // shared storage (this tab may have been opened straight from the email).
    useEffect(() => {
        if (!token) return;
        setCodeDeadline(readVerificationDeadline(token));
    }, [token, status]);

    useEffect(() => {
        if (!codeDeadline || status === 'verified' || status === 'verified_return' || status === 'error') {
            setCodeRemainingMs(null);
            return undefined;
        }

        const tick = () => setCodeRemainingMs(Math.max(0, codeDeadline - Date.now()));
        tick();
        const interval = setInterval(tick, 1000);
        return () => clearInterval(interval);
    }, [codeDeadline, status]);

    // Window closed without verifying: treat it exactly like an idle timeout so
    // the customer gets the follow-up email and the slot is released.
    useEffect(() => {
        if (codeRemainingMs == null || codeRemainingMs > 0) return;
        if (status === 'verified' || status === 'verified_return' || status === 'verifying') return;
        if (codeExpiredHandledRef.current) return;

        codeExpiredHandledRef.current = true;
        clearVerificationDeadline(token);

        void (async () => {
            const result = await bookingFlow?.runCheckoutTeardown?.('reminded');
            // Verified on another device, or already paid — the booking lives on.
            if (result?.skipped) return;
            toast({
                title: 'Verification code expired',
                description:
                    'Your 15-minute window ended, so the booking hold was released. You can start a new booking at any time.',
                variant: 'destructive',
                duration: 12000,
            });
        })();
    }, [codeRemainingMs, status, token, bookingFlow]);

    // Load equipment prices with error handling
    useEffect(() => {
        const loadPrices = async () => {
            const timestamp = new Date().toISOString();
            console.log(`[${timestamp}] [VerifyEmailBeforeBooking] Starting to load equipment prices`);
            setLoadingPrices(true);
            const prices = {};

            try {
                for (let id = 1; id <= 7; id++) {
                    if (isValidEquipmentId(id)) {
                        console.log(`[${timestamp}] [VerifyEmailBeforeBooking] Loading price for equipment ID ${id}`);
                        prices[id] = await getPriceForEquipment(id);
                        console.log(`[${timestamp}] [VerifyEmailBeforeBooking] Equipment ${id} price: $${prices[id]}`);
                    }
                }
                setEquipmentPrices(prices);
                console.log(`[${timestamp}] [VerifyEmailBeforeBooking] All equipment prices loaded:`, prices);
            } catch (error) {
                console.error(`[${timestamp}] [VerifyEmailBeforeBooking] Error loading equipment prices:`, error);
                toast({
                    title: 'Warning',
                    description: 'Could not load all pricing information. Some prices may be missing.',
                    variant: 'destructive'
                });
            } finally {
                setLoadingPrices(false);
                console.log(`[${timestamp}] [VerifyEmailBeforeBooking] Equipment prices loading complete`);
            }
        };

        if (status === 'idle') {
            loadPrices();
        }
    }, [status]);

    // Load availability times for self-service
    useEffect(() => {
        const loadAvailabilityTimes = async () => {
            if (plan?.id === 2 && !isDelivery && bookingData?.dropOffDate) {
                const timestamp = new Date().toISOString();
                console.log(`[${timestamp}] [VerifyEmailBeforeBooking] Loading availability times for self-service`);
                try {
                    const dropOffTimes = await getFormattedServiceTimes(2, bookingData.dropOffDate);
                    const pickupTimes = bookingData.pickupDate
                        ? await getFormattedServiceTimes(2, bookingData.pickupDate)
                        : dropOffTimes;

                    setAvailabilityTimes({
                        pickupStartTime: dropOffTimes.pickupStartTime,
                        returnByTime: pickupTimes.returnByTime
                    });
                    console.log(`[${timestamp}] [VerifyEmailBeforeBooking] Availability times loaded:`, {
                        pickupStartTime: dropOffTimes.pickupStartTime,
                        returnByTime: pickupTimes.returnByTime
                    });
                } catch (error) {
                    console.error(`[${timestamp}] [VerifyEmailBeforeBooking] Error loading availability times:`, error);
                }
            }
        };

        if (plan && bookingData) {
            loadAvailabilityTimes();
        }
    }, [plan?.id, isDelivery, bookingData?.dropOffDate, bookingData?.pickupDate, plan, bookingData]);

    // Calculate pricing breakdown
    const calculatedTotals = useMemo(() => {
        const basePriceAmount = plan?.price || plan?.base_price || 0;
        const deliveryFeeFlat = addonsData?.deliveryFee || 0;
        const tripMileageCost = addonsData?.mileageCharge || 0;

        const insuranceCost = addonsData?.insurance === 'accept' ? Number(insurancePrice) : 0;
        const drivewayProtectionCost =
            Number(plan?.id) === 1 && addonsData?.drivewayProtection === 'accept'
                ? Number(drivewayPrice)
                : 0;

        let rentEquipmentCost = 0;
        let purchaseItemsCost = 0;

        if (addonsData?.equipment && Array.isArray(addonsData.equipment)) {
            addonsData.equipment.forEach(item => {
                const equipmentId = item.equipment_id || item.dbId || item.id;
                if (!equipmentId || !isValidEquipmentId(equipmentId)) return;

                const price = Number(equipmentPrices[equipmentId] || 0);
                const quantity = Number(item.quantity || 1);
                const itemTotal = price * quantity;

                if (equipmentId === 3) {
                    purchaseItemsCost += itemTotal;
                } else {
                    rentEquipmentCost += itemTotal;
                }
            });
        }

        let disposalCost = 0;
        if (addonsData?.mattressDisposal && addonsData.mattressDisposal > 0) {
            disposalCost += Number(equipmentPrices[4] || 25) * addonsData.mattressDisposal;
        }
        if (addonsData?.tvDisposal && addonsData.tvDisposal > 0) {
            disposalCost += Number(equipmentPrices[5] || 15) * addonsData.tvDisposal;
        }
        if (addonsData?.applianceDisposal && addonsData.applianceDisposal > 0) {
            disposalCost += Number(equipmentPrices[6] || 35) * addonsData.applianceDisposal;
        }

        const taxBreakdown = calculateBookingTaxBreakdown({
            plan,
            addonsData,
            equipmentPrices,
            taxRate,
            deliveryService: addonsData?.deliveryService ?? isDelivery,
            insurancePrice,
            drivewayPrice,
            ...taxOptions,
        });

        let couponDiscount = 0;
        const grossBeforeDiscount = taxBreakdown.lineItems?.reduce((s, l) => s + l.amount, 0) ?? 0;
        if (addonsData?.coupon?.isValid) {
            if (addonsData.coupon.discountType === 'fixed') {
                couponDiscount = Number(addonsData.coupon.discountValue || 0);
            } else if (addonsData.coupon.discountType === 'percentage') {
                couponDiscount = (grossBeforeDiscount * Number(addonsData.coupon.discountValue || 0)) / 100;
            }
        }

        const loyaltyDiscount = Number(addonsData?.loyaltyDiscountAmount || 0);
        const referralDiscount = Number(addonsData?.referralDiscountAmount || 0);
        const discount = couponDiscount + loyaltyDiscount + referralDiscount;

        return {
            basePriceAmount,
            deliveryFeeFlat,
            tripMileageCost,
            insuranceCost,
            drivewayProtectionCost,
            rentEquipmentCost,
            purchaseItemsCost,
            disposalCost,
            discount,
            couponDiscount,
            loyaltyDiscount,
            referralDiscount,
            subtotal: taxBreakdown.subtotalBeforeTax,
            taxableSubtotal: taxBreakdown.taxableSubtotal,
            nonTaxableSubtotal: taxBreakdown.nonTaxableSubtotal,
            tax: taxBreakdown.tax,
            taxRate: taxBreakdown.taxRate,
            total: taxBreakdown.total,
        };
    }, [plan, addonsData, equipmentPrices, isDelivery, taxRate, insurancePrice, drivewayPrice, taxOptions]);

    const handleSendCode = async (retryAttempt = 0) => {
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] [VerifyEmailBeforeBooking] handleSendCode triggered`);
        console.log(`[${timestamp}] [VerifyEmailBeforeBooking] Email to send code to:`, bookingData?.email);

        if (!token || !bookingData?.email) {
            toast({
                title: 'Not ready yet',
                description: 'Please wait for your booking details to finish loading, then try again.',
                variant: 'destructive',
            });
            return;
        }

        setStatus('sending');

        try {
            console.log(`[${timestamp}] [VerifyEmailBeforeBooking] Invoking send-verification-email function`);
            const { data, error } = await supabase.functions.invoke('send-verification-email', {
                body: {
                    email: bookingData.email,
                    name: `${bookingData.firstName || ''} ${bookingData.lastName || ''}`.trim() || 'Customer',
                    pending_customer_id: token,
                    site_url: getAppOrigin(),
                }
            });

            const responseTs = new Date().toISOString();
            console.log(`[${responseTs}] [VerifyEmailBeforeBooking] send-verification-email response:`, { data, error });

            if (error) {
                const message = await parseEdgeFunctionError(error, data);
                throw new Error(message);
            }
            if (data?.error) {
                throw new Error(data.error);
            }

            console.log(`[${responseTs}] [VerifyEmailBeforeBooking] Verification code sent successfully`);
            codeExpiredHandledRef.current = false;
            setCodeDeadline(saveVerificationDeadline(token, data?.expiresAt));
            setStatus('sent');
            toast({
                title: 'Code Sent',
                description: `We sent a verification code to ${bookingData.email}. Please check your inbox.`
            });
        } catch (err) {
            const catchTs = new Date().toISOString();
            console.error(`[${catchTs}] [VerifyEmailBeforeBooking] Exception in handleSendCode:`, err);

            if (retryAttempt < 1) {
                await new Promise((resolve) => setTimeout(resolve, 500));
                return handleSendCode(retryAttempt + 1);
            }

            setStatus('idle');
            toast({
                title: 'Failed to send code',
                description: err.message || 'An error occurred while sending the verification code.',
                variant: 'destructive'
            });
        }
    };

    const continueAfterVerify = async (customerId = null) => {
        if (continueStartedRef.current) return;
        continueStartedRef.current = true;
        // Helper tab may have suppressed teardown; clear so this path can idle/leave normally.
        clearCheckoutTeardownDone();

        const currentBooking = bookingDataRef.current;
        const currentPending = pendingRecordRef.current;
        const currentPlan = planRef.current;
        const currentAddons = addonsDataRef.current;

        const hydratedPlan =
            currentPlan || (currentPending ? await hydratePlanFromPending(currentPending) : null);
        const mapped = currentPending
            ? mapPendingToBookingState(currentPending, hydratedPlan)
            : null;
        const addons = currentPending?.addons_data || currentAddons || {};
        const needsDriverStep =
            mapped?.requiresDriverVerification && !isDriverVerificationComplete(addons);

        if (!needsDriverStep) {
            const attachPayload = buildVerificationAttachPayload(
                addons,
                currentBooking?.email,
                token,
                customerId,
            );
            if (attachPayload) {
                try {
                    await attachCheckoutVerificationDocuments(attachPayload);
                } catch (attachError) {
                    console.error(
                        '[VerifyEmailBeforeBooking] Failed to attach verification documents:',
                        attachError,
                    );
                }
            }
        }

        setStatus('verified');
        toast({
            title: 'Email Verified!',
            description: needsDriverStep
                ? 'Returning to driver verification...'
                : 'Redirecting to payment...',
        });

        setTimeout(() => {
            if (needsDriverStep) {
                navigate('/', { state: { resumeStep: 8, token } });
            } else {
                navigate(`/payment?bookingId=${token}`);
            }
        }, 800);
    };

    const handleVerify = async () => {
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] [VerifyEmailBeforeBooking] handleVerify triggered`);
        console.log(`[${timestamp}] [VerifyEmailBeforeBooking] Verification code entered:`, code);

        if (!code || code.length < 5) {
            console.warn(`[${timestamp}] [VerifyEmailBeforeBooking] Code too short or empty`);
            return;
        }

        setStatus('verifying');

        // Set verification timeout
        verificationTimeoutRef.current = setTimeout(() => {
            const timeoutTs = new Date().toISOString();
            console.error(`[${timeoutTs}] [VerifyEmailBeforeBooking] Verification timeout exceeded`);
            setStatus('sent');
            toast({
                title: 'Verification Timeout',
                description: 'Verification is taking too long. Please try again.',
                variant: 'destructive'
            });
        }, 15000); // 15 second timeout for verification

        try {
            console.log(`[${timestamp}] [VerifyEmailBeforeBooking] Invoking verify-email-code function`);
            const { data, error } = await supabase.functions.invoke('verify-email-code', {
                body: { email: bookingData.email, code, pending_customer_id: token }
            });

            clearTimeout(verificationTimeoutRef.current);

            const responseTs = new Date().toISOString();
            console.log(`[${responseTs}] [VerifyEmailBeforeBooking] verify-email-code response:`, { data, error });

            if (error) {
                console.error(`[${responseTs}] [VerifyEmailBeforeBooking] Error from verify-email-code:`, error);
                const errData = await error.context?.json().catch(() => null);
                throw new Error(errData?.error || error.message || 'Verification failed');
            }

            if (!data.success) {
                console.error(`[${responseTs}] [VerifyEmailBeforeBooking] Verification returned success=false:`, data.error);
                throw new Error(data.error || 'Invalid verification code');
            }

            console.log(`[${responseTs}] [VerifyEmailBeforeBooking] Email verified successfully!`);
            verifiedLocallyRef.current = true;
            markVerifiedEmailSession(bookingData.email, token);
            publishCheckoutSyncEvent({
                type: 'verified',
                pendingId: token,
                email: bookingData.email || null,
            });
            clearVerificationDeadline(token);
            setCodeDeadline(null);

            // Email-link tab owns checkout after verify; original tab stands down.
            if (emailLinkArrivalRef.current) {
                setStatus('verified_return');
                toast({
                    title: 'Email Verified!',
                    description: 'Continue here to finish your booking. Your other window will return to the homepage.',
                });
                return;
            }

            await continueAfterVerify(data.customer?.id ?? null);
        } catch (err) {
            clearTimeout(verificationTimeoutRef.current);
            const catchTs = new Date().toISOString();
            console.error(`[${catchTs}] [VerifyEmailBeforeBooking] Exception in handleVerify:`, err);
            setStatus('sent');
            setCode(''); // Clear the code input
            toast({
                title: 'Verification Failed',
                description: err.message || 'Invalid or expired code. Please try again.',
                variant: 'destructive'
            });
        }
    };

    // Auto-verify when the emailed link supplied a 6-digit code.
    useEffect(() => {
        if (status !== 'sent' || !emailLinkArrivalRef.current) return;
        if (autoVerifyStartedRef.current) return;
        if (!/^\d{6}$/.test(String(code || '').trim()) || !bookingData?.email) return;
        autoVerifyStartedRef.current = true;
        void handleVerify();
        // eslint-disable-next-line react-hooks/exhaustive-deps -- run once when code is ready from the email link
    }, [status, code, bookingData?.email]);

    const handleRetry = () => {
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] [VerifyEmailBeforeBooking] Retry button clicked, incrementing retry count`);
        setStatus('loading');
        setError('');
        setRetryCount(prev => prev + 1);
    };

    const formatDate = (date) => {
        if (!date) return 'N/A';
        try {
            const parsedDate = date instanceof Date ? date : new Date(date);
            if (!isValid(parsedDate)) return "Invalid Date";
            return format(parsedDate, 'PPP');
        } catch (e) {
            return "Invalid Date";
        }
    };

    // Prepare category items for price breakdown
    const serviceItems = [];
    if (calculatedTotals.basePriceAmount > 0) {
        serviceItems.push({ label: 'Base Rental', amount: calculatedTotals.basePriceAmount });
    }
    if (calculatedTotals.deliveryFeeFlat > 0) {
        serviceItems.push({ label: 'Base Delivery Fee', amount: calculatedTotals.deliveryFeeFlat });
    }
    if (calculatedTotals.tripMileageCost > 0) {
        serviceItems.push({
            label: 'Mileage Charge',
            amount: calculatedTotals.tripMileageCost,
            sublabel: addonsData?.distanceFeeDisplay
        });
    }

    const protectionItems = [];
    if (calculatedTotals.insuranceCost > 0) {
        protectionItems.push({ label: 'Rental Insurance', amount: calculatedTotals.insuranceCost });
    }
    if (calculatedTotals.drivewayProtectionCost > 0) {
        protectionItems.push({ label: 'Driveway Protection', amount: calculatedTotals.drivewayProtectionCost });
    }

    const rentEquipmentItems = [];
    if (addonsData?.equipment && Array.isArray(addonsData.equipment)) {
        addonsData.equipment.forEach(item => {
            const equipmentId = item.equipment_id || item.dbId || item.id;
            if (!equipmentId || !isValidEquipmentId(equipmentId) || equipmentId === 3) return;

            const price = Number(equipmentPrices[equipmentId] || 0);
            const quantity = Number(item.quantity || 1);
            const itemName = equipmentId === 1 ? 'Wheelbarrow' :
                equipmentId === 2 ? 'Hand Truck' :
                    `Equipment #${equipmentId}`;

            rentEquipmentItems.push({
                label: `${itemName} (x${quantity})`,
                amount: price * quantity
            });
        });
    }

    const purchaseItems = [];
    if (addonsData?.equipment && Array.isArray(addonsData.equipment)) {
        const glovesItem = addonsData.equipment.find(item => {
            const id = item.equipment_id || item.dbId || item.id;
            return id === 3;
        });

        if (glovesItem) {
            const price = Number(equipmentPrices[3] || 0);
            const quantity = Number(glovesItem.quantity || 1);
            purchaseItems.push({
                label: `Working Gloves (Pair) (x${quantity})`,
                amount: price * quantity
            });
        }
    }

    const disposalItems = [];
    if (addonsData?.mattressDisposal && addonsData.mattressDisposal > 0) {
        const price = Number(equipmentPrices[4] || 25);
        disposalItems.push({
            label: `Mattress Disposal (x${addonsData.mattressDisposal})`,
            amount: price * addonsData.mattressDisposal
        });
    }
    if (addonsData?.tvDisposal && addonsData.tvDisposal > 0) {
        const price = Number(equipmentPrices[5] || 15);
        disposalItems.push({
            label: `TV Disposal (x${addonsData.tvDisposal})`,
            amount: price * addonsData.tvDisposal
        });
    }
    if (addonsData?.applianceDisposal && addonsData.applianceDisposal > 0) {
        const price = Number(equipmentPrices[6] || 35);
        disposalItems.push({
            label: `Appliance Disposal (x${addonsData.applianceDisposal})`,
            amount: price * addonsData.applianceDisposal
        });
    }

    const discountItems = [];
    if (calculatedTotals.couponDiscount > 0) {
        discountItems.push({
            label: `Coupon (${addonsData.coupon?.code || 'Applied'})`,
            amount: -calculatedTotals.couponDiscount,
            highlight: true
        });
    }
    if (calculatedTotals.loyaltyDiscount > 0) {
        discountItems.push({
            label: `Loyalty Points (${Number(addonsData?.loyaltyPointsToRedeem || 0)} pts)`,
            amount: -calculatedTotals.loyaltyDiscount,
            highlight: true
        });
    }
    if (calculatedTotals.referralDiscount > 0) {
        discountItems.push({
            label: `Referral Wallet ($${Number(addonsData?.referralDollarsToRedeem || 0).toFixed(2)})`,
            amount: -calculatedTotals.referralDiscount,
            highlight: true
        });
    }

    // Service-specific labels
    const showTimeWindow = shouldShowTimeWindow(plan, isDelivery);
    const isSelfService = isSelfServiceTrailer(plan, isDelivery);
    const timeOptions = {
        isWindow: showTimeWindow,
        isSelfService: isSelfService,
        serviceType: plan?.service_type
    };

    const dropoffLabel = getServiceSpecificDateLabel(plan, isDelivery, 'dropoff');
    const pickupLabel = getServiceSpecificDateLabel(plan, isDelivery, 'pickup');

    const getDisplayTime = (timeSlot, isDropOff) => {
        if (plan?.id === 2 && !isDelivery) {
            return isDropOff ? availabilityTimes.pickupStartTime : availabilityTimes.returnByTime;
        }
        return formatTimeWindow(timeSlot, timeOptions);
    };

    // Loading state with proper spinner
    if (status === 'loading' || loadingPrices || loadingTaxRate || loadingTaxOptions) {
        return (
            <div className="container mx-auto py-16 px-4">
                <div className="max-w-4xl mx-auto bg-white/10 backdrop-blur-lg rounded-2xl p-8 shadow-2xl border border-white/20">
                    <motion.div 
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="flex flex-col items-center justify-center gap-4 py-20"
                    >
                        <Loader2 className="h-12 w-12 animate-spin text-yellow-400" />
                        <span className="text-white text-lg font-medium">Loading your booking details...</span>
                        <p className="text-gray-300 text-sm">This should only take a few seconds</p>
                    </motion.div>
                </div>
            </div>
        );
    }

    // Error state with retry
    if (status === 'error') {
        return (
            <div className="container mx-auto py-16 px-4">
                <div className="max-w-2xl mx-auto bg-red-900/40 border border-red-500/50 p-8 rounded-lg shadow-lg">
                    <div className="flex items-center text-red-200 font-bold text-2xl mb-6">
                        <XCircle className="h-10 w-10 mr-3 text-red-400" />
                        {error.includes('timeout') || error.includes('too long') ? 'Loading Timeout' : 'Booking Not Found'}
                    </div>
                    <p className="text-red-100 mb-8 text-lg">{error}</p>
                    <div className="flex flex-col sm:flex-row gap-4">
                        <Button
                            onClick={handleRetry}
                            className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
                        >
                            <RefreshCw className="h-4 w-4 mr-2" />
                            Retry
                        </Button>
                        <Button
                            onClick={() => navigate('/')}
                            className="flex-1 bg-green-600 hover:bg-green-700 text-white"
                        >
                            Start New Booking
                        </Button>
                        {onBack && (
                            <Button
                                onClick={onBack}
                                variant="outline"
                                className="flex-1 text-white hover:bg-white/10"
                            >
                                Go Back
                            </Button>
                        )}
                    </div>
                </div>
            </div>
        );
    }

    return (
        <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -50 }}
            className="container mx-auto py-16 px-4"
        >
            <div className="max-w-4xl mx-auto bg-white/10 backdrop-blur-lg rounded-2xl p-8 shadow-2xl border border-white/20">
                <div className="flex items-center mb-8 border-b border-white/10 pb-4">
                    {onBack && (
                        <Button
                            onClick={onBack}
                            variant="ghost"
                            size="icon"
                            className="mr-4 text-white hover:bg-white/20"
                            disabled={
                                status === 'verifying' ||
                                status === 'verified' ||
                                status === 'verified_return'
                            }
                        >
                            <ArrowLeft />
                        </Button>
                    )}
                    <h2 className="text-3xl font-bold text-white flex items-center">
                        <ShieldCheck className="mr-3 h-8 w-8 text-yellow-400" />
                        Verify Email
                    </h2>
                </div>

                <div className="grid md:grid-cols-2 gap-8">
                    {/* Summary Section */}
                    <div className="bg-black/20 p-6 rounded-xl border border-white/10 space-y-4 text-sm">
                        <h3 className="text-lg font-bold text-yellow-400 border-b border-white/10 pb-2 mb-4 flex items-center">
                            <Receipt className="h-5 w-5 mr-2" /> Booking Summary
                        </h3>

                        <div className="flex items-start text-gray-200">
                            <Package className="h-5 w-5 mr-3 text-blue-400 mt-0.5 flex-shrink-0" />
                            <div>
                                <p className="font-semibold text-white">{formatCustomerFacingPlanName(plan?.name) || 'Selected Plan'}</p>
                                {addonsData?.equipment?.length > 0 && (
                                    <p className="text-gray-400">+ {addonsData.equipment.length} Add-on(s)</p>
                                )}
                            </div>
                        </div>

                        <div className="flex items-start text-gray-200">
                            <Calendar className="h-5 w-5 mr-3 text-green-400 mt-0.5 flex-shrink-0" />
                            <div>
                                <p>
                                    <span className="text-white">{dropoffLabel}:</span>{' '}
                                    {formatDate(bookingData?.dropOffDate)}
                                </p>
                                {isSelfService && (
                                    <p className="text-xs">
                                        Pickup Start Time: {getDisplayTime(bookingData?.dropOffTimeSlot, true)}
                                    </p>
                                )}
                                {!isSelfService && (
                                    <p className="text-xs">{getDisplayTime(bookingData?.dropOffTimeSlot, true)}</p>
                                )}
                                {bookingData?.pickupDate && (
                                    <>
                                        <p className="mt-1">
                                            <span className="text-white">{pickupLabel}:</span>{' '}
                                            {formatDate(bookingData.pickupDate)}
                                        </p>
                                        {isSelfService && (
                                            <p className="text-xs">
                                                Return by Time: {getDisplayTime(bookingData?.pickupTimeSlot, false)}
                                            </p>
                                        )}
                                        {!isSelfService && (
                                            <p className="text-xs">{getDisplayTime(bookingData?.pickupTimeSlot, false)}</p>
                                        )}
                                    </>
                                )}
                            </div>
                        </div>

                        <div className="flex items-start text-gray-200">
                            <MapPin className="h-5 w-5 mr-3 text-red-400 mt-0.5 flex-shrink-0" />
                            <div>
                                <p>{bookingData?.contactAddress?.street || addonsData?.deliveryAddress?.street}</p>
                                <p>
                                    {bookingData?.contactAddress?.city || addonsData?.deliveryAddress?.city},{' '}
                                    {bookingData?.contactAddress?.state || addonsData?.deliveryAddress?.state}{' '}
                                    {bookingData?.contactAddress?.zip || addonsData?.deliveryAddress?.zip}
                                </p>
                            </div>
                        </div>

                        {/* Cost Breakdown */}
                        <div className="mt-6 pt-4 border-t border-white/10 space-y-2">
                            <h4 className="text-white font-semibold mb-3">Cost Breakdown</h4>

                            <div className="max-h-[40vh] overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent space-y-2">
                                {serviceItems.length > 0 && (
                                    <PriceBreakdownCategory
                                        icon="📦"
                                        title="Service Costs"
                                        items={serviceItems}
                                        compact={true}
                                    />
                                )}

                                {protectionItems.length > 0 && (
                                    <PriceBreakdownCategory
                                        icon="🛡️"
                                        title="Protection"
                                        items={protectionItems}
                                        compact={true}
                                    />
                                )}

                                {rentEquipmentItems.length > 0 && (
                                    <PriceBreakdownCategory
                                        icon="🚚"
                                        title="Rent Equipment"
                                        items={rentEquipmentItems}
                                        compact={true}
                                    />
                                )}

                                {purchaseItems.length > 0 && (
                                    <PriceBreakdownCategory
                                        icon="🛒"
                                        title="Purchase Items"
                                        items={purchaseItems}
                                        compact={true}
                                    />
                                )}

                                {disposalItems.length > 0 && (
                                    <PriceBreakdownCategory
                                        icon="♻️"
                                        title="Disposal"
                                        items={disposalItems}
                                        compact={true}
                                    />
                                )}

                                {discountItems.length > 0 && (
                                    <PriceBreakdownCategory
                                        icon="🏷️"
                                        title="Discounts"
                                        items={discountItems}
                                        compact={true}
                                    />
                                )}
                            </div>

                            {/* Totals */}
                            <div className="border-t border-white/20 pt-3 mt-3 space-y-2">
                                <div className="flex justify-between text-sm">
                                    <span className="text-blue-200 font-semibold">Subtotal:</span>
                                    <span className="text-white font-bold">
                                        ${calculatedTotals.subtotal.toFixed(2)}
                                    </span>
                                </div>
                                <div className="flex justify-between text-sm">
                                    <span className="text-blue-200 font-semibold">
                                        Tax ({calculatedTotals.taxRate.toFixed(2)}%):
                                    </span>
                                    <span className="text-white font-bold">
                                        ${calculatedTotals.tax.toFixed(2)}
                                    </span>
                                </div>
                                <div className="flex justify-between text-base pt-2 border-t border-white/10">
                                    <span className="font-bold text-white">Total:</span>
                                    <span className="font-bold text-green-400">
                                        ${calculatedTotals.total.toFixed(2)}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Verification Section */}
                    <div className="flex flex-col justify-center space-y-6">
                        <div className="text-center">
                            <Mail className="mx-auto h-12 w-12 text-blue-400 mb-4" />
                            <h3 className="text-xl font-bold text-white mb-2">Verify Your Email</h3>
                            <p className="text-gray-300 text-sm">
                                We need to verify <strong className="text-yellow-300">{bookingData?.email}</strong>{' '}
                                to secure your booking and send your receipt.
                            </p>
                            {status !== 'verified' &&
                                status !== 'verified_return' && (
                                    <CodeWindowNotice remainingMs={codeRemainingMs} />
                                )}
                        </div>

                        <AnimatePresence mode="wait">
                            {status === 'idle' && (
                                <motion.div
                                    key="initial"
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0 }}
                                >
                                    <Button
                                        onClick={() => handleSendCode()}
                                        disabled={!bookingData?.email || !token}
                                        className="w-full py-6 text-lg font-bold bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
                                    >
                                        Send Verification Code
                                    </Button>
                                </motion.div>
                            )}

                            {(status === 'sending' || status === 'verifying') && (
                                <motion.div
                                    key="loading"
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0 }}
                                    className="flex flex-col items-center justify-center p-6 text-yellow-400"
                                >
                                    <Loader2 className="h-10 w-10 animate-spin mb-4" />
                                    <p className="font-semibold text-white">
                                        {status === 'sending' ? 'Sending verification code...' :
                                            'Verifying your code...'}
                                    </p>
                                </motion.div>
                            )}

                            {status === 'sent' && (
                                <motion.div
                                    key="sent"
                                    initial={{ opacity: 0, scale: 0.95 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    exit={{ opacity: 0 }}
                                    className="space-y-4"
                                >
                                    <div className="bg-black/30 p-4 rounded-lg border border-blue-500/30">
                                        <p className="text-sm text-blue-200 mb-3 text-center">
                                            Enter the 6-digit code sent to your email
                                        </p>
                                        <Input
                                            type="text"
                                            maxLength={6}
                                            placeholder="123456"
                                            value={code}
                                            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                                            onKeyPress={(e) => {
                                                if (e.key === 'Enter' && code.length >= 5) {
                                                    handleVerify();
                                                }
                                            }}
                                            className="text-center text-2xl tracking-[0.5em] h-14 bg-white/10 border-white/30 text-white font-mono placeholder:text-gray-500"
                                            autoFocus
                                        />
                                    </div>

                                    <Button
                                        onClick={handleVerify}
                                        disabled={code.length < 5}
                                        className="w-full py-6 text-lg font-bold bg-green-600 hover:bg-green-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        Verify & Continue
                                    </Button>

                                    <div className="text-center mt-2">
                                        <Button
                                            variant="link"
                                            onClick={handleSendCode}
                                            className="text-gray-400 hover:text-white text-sm"
                                        >
                                            Didn't receive a code? Resend
                                        </Button>
                                    </div>
                                </motion.div>
                            )}

                            {status === 'verified' && (
                                <motion.div
                                    key="success"
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    className="flex flex-col items-center justify-center p-6"
                                >
                                    <CheckCircle2 className="h-12 w-12 text-green-400 mb-4" />
                                    <h3 className="text-xl font-bold text-white mb-2">Email Verified!</h3>
                                    <p className="text-gray-300 text-center flex items-center">
                                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                        Continuing...
                                    </p>
                                </motion.div>
                            )}

                            {status === 'verified_return' && (
                                <motion.div
                                    key="verified-return"
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    className="flex flex-col items-center justify-center p-6 space-y-4"
                                >
                                    <CheckCircle2 className="h-12 w-12 text-green-400" />
                                    <h3 className="text-xl font-bold text-white">Email Verified!</h3>
                                    <p className="text-gray-300 text-center text-sm max-w-sm">
                                        Continue here to finish your booking. Your other window will
                                        return to the homepage on its own.
                                    </p>
                                    <Button
                                        onClick={() => void continueAfterVerify(null)}
                                        className="w-full py-6 text-lg font-bold bg-green-600 hover:bg-green-700 text-white"
                                    >
                                        Continue booking
                                    </Button>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                </div>
                <UiControlGuide
                    stepTitle="Verify Email"
                    entries={getBookingGuideEntries('email')}
                    className="mt-6 flex justify-end"
                />
            </div>
        </motion.div>
    );
};

export default VerifyEmailBeforeBooking;
