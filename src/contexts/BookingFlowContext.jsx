import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { LeaveBookingDialog } from '@/components/LeaveBookingDialog';
import { StillHereDialog } from '@/components/StillHereDialog';
import { useCheckoutIdleGuard } from '@/hooks/useCheckoutIdleGuard';
import {
  endUnfinishedCheckout,
  clearIdlePromptShownLocal,
  resolveCheckoutContext,
  resolveTeardownTarget,
  isPaymentInFlight,
  BOOKING_FLOW_STORAGE_KEY,
} from '@/utils/checkoutIdleGuard';
import { markVerifiedEmailSession } from '@/utils/checkoutEmailVerification';
import { toast } from '@/components/ui/use-toast';

export { BOOKING_FLOW_STORAGE_KEY };

const defaultFlowMeta = {
  isActive: false,
  currentStep: 0,
  highestStep: 0,
  requiresDriverVerification: true,
  pendingToken: null,
};

const BookingFlowContext = createContext(null);

function readStoredFlowMeta() {
  try {
    const raw = sessionStorage.getItem(BOOKING_FLOW_STORAGE_KEY);
    if (!raw) return defaultFlowMeta;
    return { ...defaultFlowMeta, ...JSON.parse(raw) };
  } catch {
    return defaultFlowMeta;
  }
}

function writeStoredFlowMeta(meta) {
  try {
    if (meta.isActive && meta.currentStep > 0) {
      sessionStorage.setItem(BOOKING_FLOW_STORAGE_KEY, JSON.stringify(meta));
    } else {
      sessionStorage.removeItem(BOOKING_FLOW_STORAGE_KEY);
    }
  } catch {
    // ignore storage errors
  }
}

export function BookingFlowProvider({ children }) {
  const navigate = useNavigate();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [flowMeta, setFlowMeta] = useState(() => readStoredFlowMeta());
  const resetCallbackRef = useRef(null);

  const checkoutContext = useMemo(
    () => resolveCheckoutContext({ flowMeta }),
    [flowMeta],
  );

  const isInBookingFlow =
    (flowMeta.isActive && flowMeta.currentStep > 0) || checkoutContext.isInCheckoutFlow;

  const setFlowMetaState = useCallback((updater) => {
    setFlowMeta((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : { ...prev, ...updater };
      writeStoredFlowMeta(next);
      return next;
    });
  }, []);

  const registerResetCallback = useCallback((callback) => {
    resetCallbackRef.current = callback;
  }, []);

  const unregisterResetCallback = useCallback(() => {
    resetCallbackRef.current = null;
  }, []);

  const updateFlowProgress = useCallback(
    ({ currentStep, highestStep, requiresDriverVerification, pendingToken }) => {
      setFlowMetaState((prev) => ({
        ...prev,
        isActive: currentStep > 0,
        currentStep: currentStep ?? prev.currentStep,
        highestStep: Math.max(highestStep ?? 0, currentStep ?? 0, prev.highestStep),
        requiresDriverVerification:
          requiresDriverVerification ?? prev.requiresDriverVerification,
        pendingToken: pendingToken !== undefined ? pendingToken : prev.pendingToken,
      }));
    },
    [setFlowMetaState],
  );

  const requestLeaveBooking = useCallback(() => {
    setDialogOpen(true);
  }, []);

  const cancelLeaveBooking = useCallback(() => {
    setDialogOpen(false);
  }, []);

  const handleTeardownResult = useCallback((result, { idle = false } = {}) => {
    if (!result || result.beamed) return;

    const failTitle = idle ? 'Could not complete checkout timeout' : 'Could not save your exit';
    const partialTitle = idle ? 'Checkout timeout recorded' : 'Booking exit recorded';
    const toastDuration = 12000;

    if (!result.success) {
      toast({
        title: failTitle,
        description:
          result.error ||
          (idle
            ? "We couldn't record that your checkout timed out. Please contact us if you don't receive a follow-up email."
            : "We couldn't record that you left checkout. Please contact us if you don't receive a follow-up email."),
        variant: 'destructive',
        duration: toastDuration,
      });
      return;
    }

    if (result.warning === 'email_not_sent' && !result.skipped && !result.emailSkipped) {
      toast({
        title: partialTitle,
        description:
          "Your booking was marked as unfinished, but we couldn't send the follow-up email. Please contact us if you need help.",
        variant: 'destructive',
        duration: toastDuration,
      });
    }
  }, []);

  const resetAndGoHome = useCallback(() => {
    resetCallbackRef.current?.();
    setFlowMetaState(defaultFlowMeta);
    writeStoredFlowMeta(defaultFlowMeta);
    clearIdlePromptShownLocal();
    navigate('/');
    window.scrollTo(0, 0);
  }, [navigate, setFlowMetaState]);

  const confirmLeaveBooking = useCallback(async () => {
    setDialogOpen(false);
    const { bookingId, pendingId } = resolveTeardownTarget({
      flowMeta,
      pendingToken: flowMeta.pendingToken,
      reason: 'left_early',
    });

    let result = null;
    try {
      if (bookingId || pendingId) {
        result = await endUnfinishedCheckout({
          bookingId,
          pendingId,
          reason: 'left_early',
          siteUrl: window.location.origin,
          flowMeta,
        });
      }
    } catch (err) {
      console.warn('[BookingFlow] Failed to end unfinished checkout on leave:', err);
      result = {
        success: false,
        error:
          "We couldn't record that you left checkout. Please contact us if you don't receive a follow-up email.",
      };
    }

    // Navigate first so the homepage Toaster owns the message (not a remounted checkout toast).
    resetAndGoHome();
    window.setTimeout(() => {
      if (result) {
        handleTeardownResult(result);
      }
    }, 0);
  }, [flowMeta, resetAndGoHome, handleTeardownResult]);

  const handleIdleTeardownComplete = useCallback(
    (result) => {
      if (result?.skippedReason === 'already_converted') {
        const paidId = result.convertedBookingId || result.bookingId;
        resetCallbackRef.current?.();
        setFlowMetaState(defaultFlowMeta);
        writeStoredFlowMeta(defaultFlowMeta);
        clearIdlePromptShownLocal();
        if (paidId) {
          navigate(`/confirmation?booking_id=${paidId}`);
        } else {
          navigate('/');
        }
        window.scrollTo(0, 0);
        return;
      }
      resetAndGoHome();
      window.setTimeout(() => {
        handleTeardownResult(result, { idle: true });
      }, 0);
    },
    [handleTeardownResult, resetAndGoHome, navigate, setFlowMetaState],
  );

  const handleCheckoutCompleted = useCallback(
    ({ bookingId } = {}) => {
      resetCallbackRef.current?.();
      setFlowMetaState(defaultFlowMeta);
      writeStoredFlowMeta(defaultFlowMeta);
      clearIdlePromptShownLocal();
      // Paying tab owns redirect via PaymentPage (with payment_intent). Skip SPA
      // navigate here so we do not finalize twice before the hard redirect.
      if (isPaymentInFlight()) {
        return;
      }
      if (bookingId) {
        navigate(`/confirmation?booking_id=${bookingId}`);
      } else {
        toast({
          title: 'Booking completed',
          description: 'Your booking was finished in another tab.',
        });
        navigate('/');
      }
      window.scrollTo(0, 0);
    },
    [navigate, setFlowMetaState],
  );

  /**
   * Email verified in another tab (usually the emailed link). That tab owns
   * checkout now — stand this tab down to the homepage with no left_early
   * teardown (idle guard already latched tearingDownRef before this runs).
   */
  const handleCheckoutVerified = useCallback(({ email, pendingId } = {}) => {
    if (email && pendingId) {
      markVerifiedEmailSession(email, pendingId);
    }

    resetCallbackRef.current?.();
    setFlowMetaState(defaultFlowMeta);
    writeStoredFlowMeta(defaultFlowMeta);
    clearIdlePromptShownLocal();

    toast({
      title: 'Continuing in your other window',
      description:
        'Your email was verified in another window. Finish your booking there — this screen is back at the homepage.',
    });

    navigate('/');
    window.scrollTo(0, 0);
  }, [navigate, setFlowMetaState]);

  const handleDialogOpenChange = useCallback((open) => {
    if (!open) {
      cancelLeaveBooking();
    }
  }, [cancelLeaveBooking]);

  useEffect(() => {
    const stored = readStoredFlowMeta();
    if (stored.isActive && stored.currentStep > 0) {
      setFlowMeta(stored);
    }
  }, []);

  // Step 5+ (Terms onward): contact was saved on leaving step 4, so a pendingToken exists.
  const idleEnabled = isInBookingFlow && checkoutContext.isProtectedCheckout;

  const { stillHereOpen, countdownRemainingMs, handleNeedMoreTime, runTeardown } =
    useCheckoutIdleGuard({
      enabled: idleEnabled,
      pendingToken: checkoutContext.pendingId || flowMeta.pendingToken,
      onTeardownComplete: handleIdleTeardownComplete,
      onCheckoutCompleted: handleCheckoutCompleted,
      onCheckoutVerified: handleCheckoutVerified,
    });

  const value = {
    flowMeta,
    isInBookingFlow,
    highestStep: flowMeta.highestStep,
    currentStep: flowMeta.currentStep,
    requiresDriverVerification: flowMeta.requiresDriverVerification,
    pendingToken: checkoutContext.pendingId || flowMeta.pendingToken,
    updateFlowProgress,
    registerResetCallback,
    unregisterResetCallback,
    requestLeaveBooking,
    confirmLeaveBooking,
    cancelLeaveBooking,
    runCheckoutTeardown: runTeardown,
  };

  return (
    <BookingFlowContext.Provider value={value}>
      {children}
      <LeaveBookingDialog
        open={dialogOpen}
        onOpenChange={handleDialogOpenChange}
        onConfirm={confirmLeaveBooking}
        onCancel={cancelLeaveBooking}
      />
      <StillHereDialog
        open={stillHereOpen}
        remainingMs={countdownRemainingMs}
        onNeedMoreTime={handleNeedMoreTime}
      />
    </BookingFlowContext.Provider>
  );
}

export function useBookingFlow() {
  const context = useContext(BookingFlowContext);
  if (!context) {
    throw new Error('useBookingFlow must be used within BookingFlowProvider');
  }
  return context;
}

export function useBookingFlowOptional() {
  return useContext(BookingFlowContext);
}
