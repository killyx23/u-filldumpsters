import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import {
  IDLE_MS,
  COUNTDOWN_MS,
  MORE_TIME_MS,
  CEILING_MS,
  HEARTBEAT_MS,
  isPaymentInFlight,
  isCheckoutTeardownDone,
  clearCheckoutTeardownDone,
  markIdlePromptShownOnBooking,
  touchCheckoutPresence,
  endUnfinishedCheckout,
  beaconEndUnfinishedCheckout,
  resolveCheckoutContext,
  resolveTeardownTarget,
  markCheckoutTeardownDone,
} from '@/utils/checkoutIdleGuard';
import {
  subscribeCheckoutSyncEvents,
  isCheckoutCompletedElsewhere,
  markCheckoutCompletedElsewhere,
} from '@/utils/checkoutTabSync';

/** Poll often enough to catch idle even when setTimeout is throttled in background tabs. */
const IDLE_CHECK_MS = 5 * 1000;
const COMPLETION_POLL_MS = 10 * 1000;

/**
 * Idle / unload guard for booking flow from step 5 onward (after contact is saved).
 *
 * Uses wall-clock last-activity timestamps so background-tab timer throttling
 * does not prevent the "Are you still here?" prompt from appearing.
 *
 * @param {object} options
 * @param {boolean} options.enabled
 * @param {string|null} options.pendingToken
 * @param {(result: object) => void} options.onTeardownComplete — reset flow + navigate home
 * @param {(payload: { bookingId?: number|null, pendingId?: string|null }) => void} [options.onCheckoutCompleted]
 */
export function useCheckoutIdleGuard({ enabled, pendingToken, onTeardownComplete, onCheckoutCompleted }) {
  const [stillHereOpen, setStillHereOpen] = useState(false);
  const [countdownRemainingMs, setCountdownRemainingMs] = useState(COUNTDOWN_MS);

  const idleCheckRef = useRef(null);
  const countdownTickRef = useRef(null);
  const heartbeatRef = useRef(null);
  const lastActivityAtRef = useRef(Date.now());
  const countdownEndsAtRef = useRef(null);
  const moreTimeEndsAtRef = useRef(null);
  const sequenceStartedAtRef = useRef(null);
  const tearingDownRef = useRef(false);
  const stillHereOpenRef = useRef(false);
  const enabledRef = useRef(enabled);
  const pendingTokenRef = useRef(pendingToken);
  const onTeardownCompleteRef = useRef(onTeardownComplete);
  const onCheckoutCompletedRef = useRef(onCheckoutCompleted);
  const startCountdownRef = useRef(() => {});
  const runTeardownRef = useRef(async () => {});
  const checkIdleStateRef = useRef(() => {});
  const handleOtherTabProgressRef = useRef(() => {});
  const handleOtherTabCompletedRef = useRef(() => {});
  const completionPollRef = useRef(null);
  const completedHandledRef = useRef(false);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  useEffect(() => {
    pendingTokenRef.current = pendingToken;
  }, [pendingToken]);

  useEffect(() => {
    onTeardownCompleteRef.current = onTeardownComplete;
  }, [onTeardownComplete]);

  useEffect(() => {
    onCheckoutCompletedRef.current = onCheckoutCompleted;
  }, [onCheckoutCompleted]);

  useEffect(() => {
    stillHereOpenRef.current = stillHereOpen;
  }, [stillHereOpen]);

  const clearIdleCheck = useCallback(() => {
    if (idleCheckRef.current) {
      clearInterval(idleCheckRef.current);
      idleCheckRef.current = null;
    }
  }, []);

  const clearCountdownTick = useCallback(() => {
    if (countdownTickRef.current) {
      clearInterval(countdownTickRef.current);
      countdownTickRef.current = null;
    }
  }, []);

  const clearAllTimers = useCallback(() => {
    clearIdleCheck();
    clearCountdownTick();
    countdownEndsAtRef.current = null;
    moreTimeEndsAtRef.current = null;
  }, [clearIdleCheck, clearCountdownTick]);

  const resolveIds = useCallback(
    (reason = 'left_early') => {
      const { bookingId, pendingId } = resolveTeardownTarget({
        pendingToken: pendingTokenRef.current,
        reason,
      });
      return { bookingId, pendingId };
    },
    [],
  );

  const markActivity = useCallback(() => {
    lastActivityAtRef.current = Date.now();
  }, []);

  const handleOtherTabCompleted = useCallback(
    ({ bookingId = null, pendingId = null } = {}) => {
      if (completedHandledRef.current) return;
      completedHandledRef.current = true;
      const ids = resolveIds('left_early');
      const pending = pendingId || ids.pendingId;
      const paidId = bookingId || ids.bookingId;
      markCheckoutCompletedElsewhere({ pendingId: pending, bookingId: paidId });
      markCheckoutTeardownDone({
        reason: 'converted',
        pendingId: pending,
        bookingId: paidId,
      });
      tearingDownRef.current = true;
      clearAllTimers();
      setStillHereOpen(false);
      stillHereOpenRef.current = false;
      onCheckoutCompletedRef.current?.({ bookingId: paidId, pendingId: pending });
    },
    [clearAllTimers, resolveIds],
  );

  const handleOtherTabProgress = useCallback(() => {
    if (tearingDownRef.current) return;
    markActivity();
    sequenceStartedAtRef.current = null;
    moreTimeEndsAtRef.current = null;
    countdownEndsAtRef.current = null;
    clearCountdownTick();
    setStillHereOpen(false);
    stillHereOpenRef.current = false;
  }, [markActivity, clearCountdownTick]);

  useEffect(() => {
    handleOtherTabCompletedRef.current = handleOtherTabCompleted;
  }, [handleOtherTabCompleted]);

  useEffect(() => {
    handleOtherTabProgressRef.current = handleOtherTabProgress;
  }, [handleOtherTabProgress]);

  const runTeardown = useCallback(
    async (reason, { beacon = false } = {}) => {
      const ids = resolveIds(reason);
      if (
        tearingDownRef.current ||
        isCheckoutCompletedElsewhere(ids) ||
        isCheckoutTeardownDone({
          reason,
          ...ids,
        })
      ) {
        return null;
      }
      if (isPaymentInFlight()) return null;

      const { bookingId, pendingId } = ids;
      if (!bookingId && !pendingId) return null;

      tearingDownRef.current = true;
      clearAllTimers();
      setStillHereOpen(false);
      stillHereOpenRef.current = false;

      const siteUrl = typeof window !== 'undefined' ? window.location.origin : null;

      if (beacon) {
        beaconEndUnfinishedCheckout({ bookingId, pendingId, reason, siteUrl });
        onTeardownCompleteRef.current?.({ success: true, beamed: true, reason });
        return { success: true, beamed: true, reason };
      }

      let result = null;
      try {
        result = await endUnfinishedCheckout({
          bookingId,
          pendingId,
          reason,
          siteUrl,
        });
      } catch (err) {
        console.warn('[useCheckoutIdleGuard] teardown failed:', err);
        result = {
          success: false,
          error: err?.message || String(err),
          reason,
          emailSent: false,
          crmUpdated: false,
        };
      } finally {
        if (result?.skippedReason === 'already_converted') {
          handleOtherTabCompletedRef.current?.({
            bookingId: result.convertedBookingId || result.bookingId,
            pendingId,
          });
        } else {
          onTeardownCompleteRef.current?.(result);
        }
      }

      return result;
    },
    [clearAllTimers, resolveIds],
  );

  const startCountdown = useCallback(() => {
    if (tearingDownRef.current || isPaymentInFlight()) return;
    if (isCheckoutCompletedElsewhere(resolveIds('left_early'))) return;
    if (stillHereOpenRef.current) return;

    clearCheckoutTeardownDone();

    const { bookingId } = resolveIds('reminded');
    if (bookingId) {
      void markIdlePromptShownOnBooking(bookingId);
    } else {
      try {
        window.sessionStorage.setItem('ufill_idle_prompt_shown', '1');
      } catch {
        // ignore
      }
    }

    if (!sequenceStartedAtRef.current) {
      sequenceStartedAtRef.current = Date.now();
    }

    moreTimeEndsAtRef.current = null;
    stillHereOpenRef.current = true;
    setStillHereOpen(true);

    const endsAt = Date.now() + COUNTDOWN_MS;
    countdownEndsAtRef.current = endsAt;
    setCountdownRemainingMs(COUNTDOWN_MS);

    clearCountdownTick();
    countdownTickRef.current = setInterval(() => {
      const left = Math.max(0, (countdownEndsAtRef.current || 0) - Date.now());
      setCountdownRemainingMs(left);
      if (left <= 0 && countdownTickRef.current) {
        clearInterval(countdownTickRef.current);
        countdownTickRef.current = null;
      }
    }, 200);
  }, [resolveIds, clearCountdownTick]);

  /**
   * Wall-clock state machine: idle → countdown → more-time → teardown.
   * Safe to call from intervals and visibility/focus handlers.
   */
  const checkIdleState = useCallback(() => {
    if (!enabledRef.current || tearingDownRef.current || isPaymentInFlight()) return;
    if (isCheckoutCompletedElsewhere(resolveIds('left_early'))) return;

    const now = Date.now();

    // Ceiling across the whole still-here sequence
    if (sequenceStartedAtRef.current && now - sequenceStartedAtRef.current >= CEILING_MS) {
      void runTeardownRef.current('expired');
      return;
    }

    // Countdown dialog open — tear down when wall-clock hits endsAt
    if (stillHereOpenRef.current && countdownEndsAtRef.current != null) {
      if (now >= countdownEndsAtRef.current) {
        const elapsed = sequenceStartedAtRef.current
          ? now - sequenceStartedAtRef.current
          : 0;
        const reason = elapsed >= CEILING_MS ? 'expired' : 'reminded';
        void runTeardownRef.current(reason);
      }
      return;
    }

    // "Need more time" wait — re-prompt when wall-clock hits endsAt
    if (moreTimeEndsAtRef.current != null) {
      if (now >= moreTimeEndsAtRef.current) {
        moreTimeEndsAtRef.current = null;
        const nextElapsed = sequenceStartedAtRef.current
          ? now - sequenceStartedAtRef.current
          : 0;
        if (nextElapsed >= CEILING_MS) {
          void runTeardownRef.current('expired');
        } else {
          startCountdownRef.current();
        }
      }
      return;
    }

    // Waiting for idle — open prompt when idle duration elapsed
    if (now - lastActivityAtRef.current >= IDLE_MS) {
      startCountdownRef.current();
    }
  }, [resolveIds]);

  useEffect(() => {
    runTeardownRef.current = runTeardown;
  }, [runTeardown]);

  useEffect(() => {
    startCountdownRef.current = startCountdown;
  }, [startCountdown]);

  useEffect(() => {
    checkIdleStateRef.current = checkIdleState;
  }, [checkIdleState]);

  const handleNeedMoreTime = useCallback(() => {
    if (tearingDownRef.current) return;

    clearCountdownTick();
    countdownEndsAtRef.current = null;
    stillHereOpenRef.current = false;
    setStillHereOpen(false);

    const elapsed = sequenceStartedAtRef.current
      ? Date.now() - sequenceStartedAtRef.current
      : 0;
    if (elapsed >= CEILING_MS) {
      void runTeardown('expired');
      return;
    }

    moreTimeEndsAtRef.current = Date.now() + MORE_TIME_MS;
  }, [runTeardown, clearCountdownTick]);

  // Enable / disable lifecycle — depends only on `enabled` so opening the dialog
  // does not tear down the live countdown interval.
  useEffect(() => {
    if (!enabled) {
      clearAllTimers();
      stillHereOpenRef.current = false;
      setStillHereOpen(false);
      sequenceStartedAtRef.current = null;
      tearingDownRef.current = false;
      completedHandledRef.current = false;
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }
      if (completionPollRef.current) {
        clearInterval(completionPollRef.current);
        completionPollRef.current = null;
      }
      return undefined;
    }

    tearingDownRef.current = false;
    completedHandledRef.current = false;
    sequenceStartedAtRef.current = null;
    moreTimeEndsAtRef.current = null;
    countdownEndsAtRef.current = null;
    if (!isCheckoutCompletedElsewhere({ pendingId: pendingTokenRef.current })) {
      clearCheckoutTeardownDone();
    }
    markActivity();

    clearIdleCheck();
    idleCheckRef.current = setInterval(() => {
      checkIdleStateRef.current();
    }, IDLE_CHECK_MS);

    const onUserActivity = () => {
      if (!enabledRef.current || tearingDownRef.current) return;
      if (stillHereOpenRef.current) return;
      if (moreTimeEndsAtRef.current != null) return;
      markActivity();
    };

    // Intentional interaction only — do not treat scroll as activity
    // (Agreement step uses an inner ScrollArea; window scroll resets were unreliable).
    const activityEvents = ['pointerdown', 'keydown', 'touchstart'];
    activityEvents.forEach((evt) => window.addEventListener(evt, onUserActivity, { passive: true }));

    const onVisibilityOrFocus = () => {
      if (document.visibilityState === 'hidden') return;
      checkIdleStateRef.current();
    };
    document.addEventListener('visibilitychange', onVisibilityOrFocus);
    window.addEventListener('focus', onVisibilityOrFocus);

    const beat = () => {
      if (isPaymentInFlight()) return;
      if (tearingDownRef.current) return;
      const { bookingId, pendingId } = resolveCheckoutContext({
        pendingToken: pendingTokenRef.current,
      });
      void touchCheckoutPresence({ bookingId, pendingId });
    };
    beat();
    heartbeatRef.current = setInterval(beat, HEARTBEAT_MS);

    const pollCompletion = async () => {
      const pendingId = pendingTokenRef.current;
      if (!pendingId || tearingDownRef.current) return;
      if (isCheckoutCompletedElsewhere({ pendingId })) {
        handleOtherTabCompletedRef.current?.({ pendingId });
        return;
      }
      try {
        const { data } = await supabase.rpc('get_checkout_completion_status', {
          p_pending_id: pendingId,
        });
        if (data?.completed) {
          handleOtherTabCompletedRef.current?.({
            bookingId: data.booking_id,
            pendingId,
          });
        }
      } catch {
        // ignore poll failures
      }
    };
    void pollCompletion();
    completionPollRef.current = setInterval(pollCompletion, COMPLETION_POLL_MS);

    const unsubscribeSync = subscribeCheckoutSyncEvents((event) => {
      const localPending = pendingTokenRef.current;
      if (event.pendingId && localPending && event.pendingId !== localPending) return;
      if (event.type === 'verified') {
        handleOtherTabProgressRef.current?.();
        return;
      }
      if (event.type === 'completed' || event.type === 'paid') {
        handleOtherTabCompletedRef.current?.({
          bookingId: event.bookingId,
          pendingId: event.pendingId || localPending,
        });
      }
    });

    const onBeforeUnload = (event) => {
      if (!enabledRef.current || tearingDownRef.current) return;
      if (isPaymentInFlight() || isCheckoutTeardownDone()) return;
      if (isCheckoutCompletedElsewhere({ pendingId: pendingTokenRef.current })) return;
      const { isProtectedCheckout } = resolveCheckoutContext({
        pendingToken: pendingTokenRef.current,
      });
      if (!isProtectedCheckout) return;
      event.preventDefault();
      event.returnValue = '';
    };

    const onPageHide = () => {
      if (!enabledRef.current || tearingDownRef.current) return;
      if (isPaymentInFlight()) return;
      if (isCheckoutCompletedElsewhere({ pendingId: pendingTokenRef.current })) return;
      const { bookingId } = resolveTeardownTarget({
        pendingToken: pendingTokenRef.current,
        reason: 'left_early',
      });
      // Only beacon left_early once a pending_payment booking exists (payment step).
      // Steps 5–8 are covered by idle reminded/expired + manual leave dialog.
      if (!bookingId) return;
      if (
        isCheckoutTeardownDone({
          reason: 'left_early',
          bookingId,
        })
      ) {
        return;
      }
      void runTeardownRef.current('left_early', { beacon: true });
    };

    window.addEventListener('beforeunload', onBeforeUnload);
    window.addEventListener('pagehide', onPageHide);

    return () => {
      activityEvents.forEach((evt) => window.removeEventListener(evt, onUserActivity));
      document.removeEventListener('visibilitychange', onVisibilityOrFocus);
      window.removeEventListener('focus', onVisibilityOrFocus);
      window.removeEventListener('beforeunload', onBeforeUnload);
      window.removeEventListener('pagehide', onPageHide);
      unsubscribeSync();
      clearAllTimers();
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }
      if (completionPollRef.current) {
        clearInterval(completionPollRef.current);
        completionPollRef.current = null;
      }
    };
  }, [enabled, clearAllTimers, clearIdleCheck, markActivity]);

  return {
    stillHereOpen,
    countdownRemainingMs,
    handleNeedMoreTime,
    runTeardown,
  };
}
