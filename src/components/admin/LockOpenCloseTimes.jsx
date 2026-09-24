import React from 'react';
import { format, formatDistanceToNow } from 'date-fns';

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

export default function LockOpenCloseTimes({ lastOpenedAt, lastClosedAt, align = 'left' }) {
  return (
    <div
      className={`text-xs ${align === 'right' ? 'text-right' : 'text-left'} space-y-0.5`}
    >
      <TimeRow label="Last opened" value={lastOpenedAt} />
      <TimeRow label="Last closed" value={lastClosedAt} />
    </div>
  );
}
