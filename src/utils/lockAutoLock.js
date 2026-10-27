/**
 * Igloo's padlock relocks on its own right after an unlock. The rental state
 * machine treats that close as an auto-lock, not a return:
 * `isAutolockDwell` / `AUTOLOCK_DWELL_MS` in supabase/functions/_shared/lockEventState.ts.
 * Log type 13 is the padlock auto-lock. A device clock a few seconds behind the
 * unlock is the same case `MANUAL_AUTOLOCK_SKEW_MS` covers in lockDeviceState.ts.
 */

export const AUTOLOCK_DWELL_MS = 2 * 60 * 1000;
export const PADLOCK_AUTOLOCK_LOG_TYPE = 13;
const AUTOLOCK_CLOCK_SKEW_MS = 30 * 1000;

export function eventTimeMs(event) {
  const raw = event?.event_timestamp ?? event?.occurred_at ?? null;
  if (!raw) return NaN;
  const ms = new Date(raw).getTime();
  return Number.isNaN(ms) ? NaN : ms;
}

export function logTypeOf(event) {
  const direct = event?.log_type ?? event?.logType;
  if (typeof direct === 'number' && Number.isFinite(direct)) return direct;
  if (typeof direct === 'string' && /^\d+$/.test(direct.trim())) return Number(direct.trim());
  const match = String(event?.notes || '').match(/logType\s+(\d+)/i);
  return match ? Number(match[1]) : null;
}

export function isLockKind(event) {
  const kind = event?.event_type || event?.event_kind;
  return kind === 'lock';
}

export function isUnlockKind(event) {
  const kind = event?.event_type || event?.event_kind;
  return kind === 'unlock';
}

/** True when this close is the automatic relock after `unlockMs`. */
export function isAutolockDwell(unlockMs, lockMs) {
  return Number.isFinite(unlockMs)
    && Number.isFinite(lockMs)
    && lockMs >= unlockMs
    && lockMs - unlockMs <= AUTOLOCK_DWELL_MS;
}

function isSkewedAutolock(lockEvent, unlockMs) {
  if (logTypeOf(lockEvent) !== PADLOCK_AUTOLOCK_LOG_TYPE) return false;
  const lockMs = eventTimeMs(lockEvent);
  if (!Number.isFinite(lockMs) || !Number.isFinite(unlockMs)) return false;
  return lockMs <= unlockMs && unlockMs - lockMs <= AUTOLOCK_CLOCK_SKEW_MS;
}

/**
 * Drop automatic relocks. A later lock outside the dwell stays, so a real
 * close is counted once. Same-second pairs sort the unlock first so the
 * relock does not win the tie.
 */
export function withoutAutoLocks(events) {
  const sorted = [...(events || [])].filter(Boolean).sort((a, b) => {
    const delta = eventTimeMs(a) - eventTimeMs(b);
    if (Number.isFinite(delta) && delta !== 0) return delta;
    if (isUnlockKind(a) && isLockKind(b)) return -1;
    if (isLockKind(a) && isUnlockKind(b)) return 1;
    return 0;
  });

  let precedingUnlockMs = null;
  const kept = [];
  for (const event of sorted) {
    if (isUnlockKind(event)) {
      const ms = eventTimeMs(event);
      const previous = kept[kept.length - 1];
      if (previous && isLockKind(previous) && isSkewedAutolock(previous, ms)) {
        kept.pop();
      }
      if (Number.isFinite(ms)) precedingUnlockMs = ms;
      kept.push(event);
      continue;
    }
    if (isLockKind(event) && isAutolockDwell(precedingUnlockMs, eventTimeMs(event))) {
      continue;
    }
    kept.push(event);
  }
  return kept;
}

/**
 * Optimistic admin bar after a remote command. An unlock stays open even when
 * the bridge response already includes the automatic relock.
 */
export function lockDisplayFromCommand(data, previous = {}) {
  if (data?.action === 'remote_unlock') {
    const openedAt = data.lastOpenedAt ?? previous.lastOpenedAt ?? null;
    const openedMs = openedAt ? new Date(openedAt).getTime() : NaN;
    const priorClosed = previous.lastClosedAt ?? null;
    const priorMs = priorClosed ? new Date(priorClosed).getTime() : NaN;
    const keepPrior = Number.isFinite(priorMs) && (!Number.isFinite(openedMs) || priorMs < openedMs);
    return {
      lastOpenedAt: openedAt,
      lastClosedAt: keepPrior ? priorClosed : null,
      currentState: 'unlocked',
    };
  }
  if (data?.action === 'remote_lock') {
    return {
      lastOpenedAt: previous.lastOpenedAt ?? data.lastOpenedAt ?? null,
      lastClosedAt: data.lastClosedAt ?? previous.lastClosedAt ?? null,
      currentState: 'locked',
    };
  }
  return null;
}
