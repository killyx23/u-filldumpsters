import React from 'react';

/** Red deal name shown with a customer total. */
export function PromoTotalLabel({ label }) {
  const text = String(label || '').trim();
  if (!text) return null;
  return (
    <div className="mb-1 leading-tight">
      <p className="text-lg font-extrabold uppercase tracking-wide text-red-500 animate-pulse">{text}</p>
      <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-red-400">Limited time</p>
    </div>
  );
}
