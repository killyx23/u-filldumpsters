import React from 'react';
import { format, formatDistanceToNow } from 'date-fns';
import { lockPosition } from '@/utils/lockPresence';

function formatLockWhen(value) {
  if (!value) return { absolute: 'never', relative: null };
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return { absolute: String(value), relative: null };
    return {
      absolute: format(date, 'MMM d, h:mm a'),
      relative: formatDistanceToNow(date, { addSuffix: true }),
    };
  } catch {
    return { absolute: String(value), relative: null };
  }
}

function TimeRow({ label, value }) {
  const { absolute, relative } = formatLockWhen(value);
  return (
    <div className="leading-snug">
      <span className="text-slate-500">{label}</span>{' '}
      <span className="text-slate-200">{absolute}</span>
      {relative && absolute !== 'never' && (
        <span className="text-slate-500"> ({relative})</span>
      )}
    </div>
  );
}

const POSITION_LABEL = {
  open: { text: 'Open', className: 'text-orange-300' },
  closed: { text: 'Closed', className: 'text-emerald-300' },
  unknown: { text: 'Unknown', className: 'text-slate-400' },
};

export default function LockOpenCloseTimes({
  lastOpenedAt,
  lastClosedAt,
  currentState = null,
  align = 'left',
  watching = false,
}) {
  const position = lockPosition({
    current_state: currentState,
    last_opened_at: lastOpenedAt,
    last_closed_at: lastClosedAt,
  });
  const badge = POSITION_LABEL[position] || POSITION_LABEL.unknown;

  return (
    <div
      className={`text-xs ${align === 'right' ? 'text-right' : 'text-left'} space-y-0.5`}
    >
      <div className="leading-snug">
        <span className="text-slate-500">Position</span>{' '}
        <span className={`font-semibold ${badge.className}`}>{badge.text}</span>
        {watching && position === 'open' && (
          <span className="text-slate-500"> — waiting for auto-lock</span>
        )}
      </div>
      <TimeRow label="Last opened" value={lastOpenedAt} />
      <TimeRow label="Last closed" value={lastClosedAt} />
    </div>
  );
}
