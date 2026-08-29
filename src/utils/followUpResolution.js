/** Follow-up resolution reasons for flagged rentals. */

export const FOLLOW_UP_REASON_HOLD = 'damage_hold_until_repaired';

export const FOLLOW_UP_REASONS = [
  {
    value: 'cleaning_completed',
    label: 'Cleaning fee charged and cleaning completed',
    closesFlag: true,
  },
  {
    value: 'damage_repaired',
    label: 'Damage charged and damage repaired',
    closesFlag: true,
  },
  {
    value: 'damage_operational',
    label: 'Damage charged — operational, still needs repair',
    closesFlag: true,
  },
  {
    value: FOLLOW_UP_REASON_HOLD,
    label: 'Damage charged — must repair before next rental',
    closesFlag: false,
  },
  {
    value: 'unreturned_charged',
    label: 'Unreturned item charged',
    closesFlag: true,
  },
  {
    value: 'unreturned_recovered',
    label: 'Unreturned item recovered',
    closesFlag: true,
  },
  {
    value: 'other',
    label: 'Other',
    closesFlag: true,
    requiresNotes: true,
  },
];

export function getFollowUpReasonMeta(reason) {
  return FOLLOW_UP_REASONS.find((r) => r.value === reason) || null;
}

export function reasonClosesFlag(reason) {
  const meta = getFollowUpReasonMeta(reason);
  return meta ? meta.closesFlag !== false : true;
}

export function reasonRequiresNotes(reason) {
  return Boolean(getFollowUpReasonMeta(reason)?.requiresNotes);
}

export function getFollowUpReasonLabel(reason) {
  return getFollowUpReasonMeta(reason)?.label || String(reason || '').replace(/_/g, ' ');
}

export function isFollowUpHold(resolution) {
  if (!resolution) return false;
  if (resolution.closes_flag === false) return true;
  return resolution.reason === FOLLOW_UP_REASON_HOLD;
}

/**
 * Build the jsonb payload to store on bookings.follow_up_resolution.
 * Appends to existing history when updating a prior hold/resolution.
 */
export function buildFollowUpResolutionPayload({
  reason,
  notes = '',
  updatedBy = null,
  previous = null,
  at = null,
}) {
  const closesFlag = reasonClosesFlag(reason);
  const updatedAt = at || new Date().toISOString();
  const trimmedNotes = String(notes || '').trim();

  const historyEntry = {
    reason,
    notes: trimmedNotes || null,
    closes_flag: closesFlag,
    at: updatedAt,
    by: updatedBy || null,
  };

  const priorHistory = Array.isArray(previous?.history) ? previous.history : [];
  // If there was a previous current resolution, keep it in history (avoid dup of identical current).
  const history = [...priorHistory];
  if (previous?.reason && previous?.updated_at) {
    const last = history[history.length - 1];
    const sameAsLast =
      last &&
      last.reason === previous.reason &&
      last.at === previous.updated_at &&
      (last.notes || null) === (previous.notes || null);
    if (!sameAsLast) {
      history.push({
        reason: previous.reason,
        notes: previous.notes || null,
        closes_flag: previous.closes_flag !== false,
        at: previous.updated_at,
        by: previous.updated_by || null,
      });
    }
  }
  history.push(historyEntry);

  return {
    reason,
    closes_flag: closesFlag,
    notes: trimmedNotes || null,
    updated_at: updatedAt,
    updated_by: updatedBy || null,
    history,
  };
}
