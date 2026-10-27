import React from 'react';
import { money } from '@/utils/phoneOrderQuote';

function Row({ label, detail, amount, tone = 'charge' }) {
  const amountClass = tone === 'save'
    ? 'text-green-300'
    : tone === 'total'
      ? 'text-yellow-300'
      : 'text-white';
  const formatted = tone === 'save' ? `-${money(amount)}` : money(amount);
  return (
    <div className="flex items-start justify-between gap-4 py-1.5">
      <div className="min-w-0">
        <p className={tone === 'save' ? 'text-green-200' : 'text-gray-100'}>{label}</p>
        {detail ? <p className="mt-0.5 text-xs text-gray-400">{detail}</p> : null}
      </div>
      <p className={`shrink-0 font-medium ${amountClass}`}>{formatted}</p>
    </div>
  );
}

export function OrderAcceptPriceBreakdown({ review }) {
  if (!review) return null;
  const charges = review.charges || [];
  const discounts = (review.discounts || []).filter((line) => Number(line.amount) > 0);
  const rewards = review.rewards || [];
  const taxRate = Number(review.taxRate);
  const taxLabel = Number.isFinite(taxRate) && taxRate > 0 ? `Tax (${taxRate.toFixed(2)}%)` : 'Tax';

  return (
    <div className="mt-4 border-t border-white/10 pt-4">
      <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-yellow-400">Price breakdown</h3>
      {review.promoLabel ? (
        <p className="mt-2 inline-block rounded-full bg-green-400/15 px-3 py-1 text-sm text-green-200">{review.promoLabel}</p>
      ) : null}

      {charges.length > 0 && (
        <div className="mt-3">
          <p className="text-xs uppercase tracking-wide text-gray-400">Included on this order</p>
          {charges.map((line) => (
            <Row key={line.key} label={line.label} amount={line.amount} />
          ))}
          <div className="mt-1 flex justify-between border-t border-white/10 pt-2 text-sm text-gray-300">
            <span>Charges before savings</span>
            <span>{money(review.chargesTotal)}</span>
          </div>
        </div>
      )}

      {discounts.length > 0 && (
        <div className="mt-4 rounded-xl border border-green-400/30 bg-green-400/10 px-3 py-2">
          <p className="text-xs uppercase tracking-wide text-green-200">Your savings</p>
          {discounts.map((line) => (
            <Row key={line.key} label={line.label} detail={line.detail} amount={line.amount} tone="save" />
          ))}
          <div className="mt-1 flex justify-between border-t border-green-400/20 pt-2 text-sm font-semibold text-green-200">
            <span>You save</span>
            <span>{money(review.savings)}</span>
          </div>
        </div>
      )}

      {rewards.length > 0 && (
        <div className="mt-4 rounded-xl border border-yellow-400/30 bg-yellow-400/10 px-3 py-3">
          <p className="text-xs uppercase tracking-wide text-yellow-200">
            {review.rewardCode ? `Also included with ${review.rewardCode}` : 'Also included'}
          </p>
          {rewards.map((reward) => (
            <div key={reward.headline} className="mt-2">
              <p className="text-sm font-medium text-yellow-100">{reward.headline}</p>
              {reward.description ? <p className="text-xs text-yellow-100/80">{reward.description}</p> : null}
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 border-t border-white/10 pt-2">
        {review.subtotal != null && <Row label="Subtotal" amount={review.subtotal} />}
        {review.tax != null && <Row label={taxLabel} amount={review.tax} />}
        <div className="mt-2 flex items-end justify-between border-t border-white/15 pt-3">
          <span className="text-lg">Total due</span>
          <span className="text-2xl text-yellow-300">{money(review.total)}</span>
        </div>
      </div>
    </div>
  );
}
