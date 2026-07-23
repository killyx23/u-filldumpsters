import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useBookingFlow } from '@/contexts/BookingFlowContext';
import {
  retrievePendingBooking,
  mapPendingToBookingState,
  hydratePlanFromPending,
} from '@/utils/bookingDataPersistence';

/**
 * Shared stepper/back navigation for verify-email and payment routes.
 */
export function useBookingStepperNavigation(routeStep) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || searchParams.get('bookingId');
  const {
    flowMeta,
    highestStep,
    requiresDriverVerification: contextRequiresDriver,
    updateFlowProgress,
    requestLeaveBooking,
  } = useBookingFlow();

  const [requiresDriverVerification, setRequiresDriverVerification] = useState(
    contextRequiresDriver ?? true
  );

  useEffect(() => {
    const syncFromPending = async () => {
      let requiresDriver = flowMeta.requiresDriverVerification ?? true;
      if (token) {
        const result = await retrievePendingBooking(token);
        if (result.success) {
          const hydrated = await hydratePlanFromPending(result.bookingData);
          const mapped = mapPendingToBookingState(result.bookingData, hydrated);
          requiresDriver = mapped.requiresDriverVerification;
        }
      }
      setRequiresDriverVerification(requiresDriver);
      updateFlowProgress({
        currentStep: routeStep,
        highestStep: Math.max(flowMeta.highestStep, routeStep),
        requiresDriverVerification: requiresDriver,
        pendingToken: token,
      });
    };
    syncFromPending();
  }, [routeStep, token, updateFlowProgress, flowMeta.highestStep, flowMeta.requiresDriverVerification]);

  const handleStepClick = useCallback(
    (step) => {
      if (step >= routeStep) return;
      if (step === 7 && !requiresDriverVerification) return;
      if (step === 8 && !requiresDriverVerification) return;

      if (step === 7 && routeStep === 9 && token && !requiresDriverVerification) {
        navigate(`/verify-email?token=${token}`);
        return;
      }

      if (step === 7 && routeStep === 9 && token && requiresDriverVerification) {
        navigate('/', { state: { resumeStep: 7, token } });
        return;
      }

      if (step === 8 && routeStep === 9 && token && requiresDriverVerification) {
        navigate('/', { state: { resumeStep: 8, token } });
        return;
      }

      if (step < 7 && token) {
        navigate('/', { state: { resumeStep: step, token } });
      }
    },
    [routeStep, token, navigate, requiresDriverVerification]
  );

  const goBackOneStep = useCallback(() => {
    if (routeStep === 7) {
      const backStep = 6;
      if (token) {
        navigate('/', { state: { resumeStep: backStep, token } });
      } else {
        requestLeaveBooking();
      }
      return;
    }

    if (routeStep === 9 && token) {
      if (requiresDriverVerification) {
        navigate('/', { state: { resumeStep: 8, token } });
      } else {
        navigate(`/verify-email?token=${token}`);
      }
      return;
    }

    requestLeaveBooking();
  }, [routeStep, token, navigate, requiresDriverVerification, requestLeaveBooking]);

  return {
    token,
    highestStep: Math.max(highestStep, routeStep),
    requiresDriverVerification,
    handleStepClick,
    goBackOneStep,
    requestLeaveBooking,
  };
}
