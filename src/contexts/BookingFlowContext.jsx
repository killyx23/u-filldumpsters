import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { LeaveBookingDialog } from '@/components/LeaveBookingDialog';

export const BOOKING_FLOW_STORAGE_KEY = 'ufill_booking_flow';

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

  const isInBookingFlow = flowMeta.isActive && flowMeta.currentStep > 0;

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
    [setFlowMetaState]
  );

  const requestLeaveBooking = useCallback(() => {
    setDialogOpen(true);
  }, []);

  const cancelLeaveBooking = useCallback(() => {
    setDialogOpen(false);
  }, []);

  const confirmLeaveBooking = useCallback(() => {
    setDialogOpen(false);
    resetCallbackRef.current?.();
    setFlowMetaState(defaultFlowMeta);
    writeStoredFlowMeta(defaultFlowMeta);
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

  const value = {
    flowMeta,
    isInBookingFlow,
    highestStep: flowMeta.highestStep,
    currentStep: flowMeta.currentStep,
    requiresDriverVerification: flowMeta.requiresDriverVerification,
    pendingToken: flowMeta.pendingToken,
    updateFlowProgress,
    registerResetCallback,
    unregisterResetCallback,
    requestLeaveBooking,
    confirmLeaveBooking,
    cancelLeaveBooking,
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
