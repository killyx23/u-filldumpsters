import React, { useEffect, useMemo, useState } from 'react';
import { getBookingWindow } from '@/utils/pinTiming';
import { isCustomerPickupService } from '@/utils/customerPickupService';

/**
 * @param {number} ms
 * @returns {string}
 */
function formatRemaining(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;

  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  parts.push(`${hours}h`);
  parts.push(`${String(minutes).padStart(2, '0')}m`);
  parts.push(`${String(seconds).padStart(2, '0')}s`);
  return parts.join(' ');
}

/**
 * Label for the next appointment based on service type and whether start has passed.
 * @param {object} booking
 * @param {boolean} countingToEnd
 * @returns {string}
 */
function getCountdownLabel(booking, countingToEnd) {
  const isPickup = isCustomerPickupService(booking.plan, booking.addons || {});
  if (isPickup) {
    return countingToEnd ? 'Until return' : 'Until pickup';
  }

  const planId = Number(booking.plan?.id);
  const isDumpsterOrMaterial = planId === 1 || planId === 3;
  if (isDumpsterOrMaterial) {
    return countingToEnd ? 'Until pickup' : 'Until delivery';
  }

  // Trailer delivery / service 4 / other company drop-off
  return countingToEnd ? 'Until pickup' : 'Until drop-off';
}

/**
 * Resolve which appointment instant to count toward.
 * @param {object} booking
 * @param {number} nowMs
 * @returns {{ targetMs: number, label: string, reached: boolean }|null}
 */
function resolveCountdownTarget(booking, nowMs) {
  if (!booking?.drop_off_date) return null;

  const { startMs, endMs } = getBookingWindow(booking);
  if (!Number.isFinite(startMs)) return null;

  if (nowMs < startMs) {
    return {
      targetMs: startMs,
      label: getCountdownLabel(booking, false),
      reached: false,
    };
  }

  if (Number.isFinite(endMs)) {
    if (nowMs < endMs) {
      return {
        targetMs: endMs,
        label: getCountdownLabel(booking, true),
        reached: false,
      };
    }
    return {
      targetMs: endMs,
      label: getCountdownLabel(booking, true),
      reached: true,
    };
  }

  // No end time (e.g. material delivery-only) — start already passed
  return {
    targetMs: startMs,
    label: getCountdownLabel(booking, false),
    reached: true,
  };
}

/**
 * Live countdown under the Active Rental status badge.
 * @param {{ booking: object }} props
 */
export function AppointmentCountdown({ booking }) {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const target = useMemo(() => resolveCountdownTarget(booking, nowMs), [booking, nowMs]);

  if (!target) return null;

  const remainingMs = Math.max(0, target.targetMs - nowMs);

  return (
    <div className="mt-1.5 text-right" aria-live="polite" aria-atomic="true">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-yellow-400/80">
        {target.label}
      </p>
      <p className="text-sm font-bold tabular-nums text-yellow-300">
        {target.reached ? 'Time reached' : formatRemaining(remainingMs)}
      </p>
    </div>
  );
}
