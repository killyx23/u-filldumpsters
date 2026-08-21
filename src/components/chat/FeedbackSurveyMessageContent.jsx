import React from 'react';
import { MessageCircle, StickyNote, Truck } from 'lucide-react';
import {
  isHowCanWeDoBetterMessage,
  resolveFeedbackSurveyPayload,
} from '@/utils/feedbackSurveyMessage';

/**
 * High-end card for How can we do better survey answers in admin/customer chat.
 */
export function FeedbackSurveyMessageContent({ message, className = '' }) {
  if (!isHowCanWeDoBetterMessage(message)) {
    return null;
  }

  const { answers, comments, bookingId } = resolveFeedbackSurveyPayload(message);
  const hasStructure = answers.length > 0 || Boolean(comments);

  if (!hasStructure) {
    return (
      <p className={`text-sm whitespace-pre-wrap leading-relaxed ${className}`.trim()}>
        {String(message?.message_content || '').replace(/\\n/g, '\n')}
      </p>
    );
  }

  return (
    <div className={`space-y-4 not-italic text-left ${className}`.trim()}>
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-400/20 border border-amber-300/40">
          <MessageCircle className="h-4 w-4 text-amber-300" />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-amber-300/90">
            Customer feedback
          </p>
          <p className="text-base font-semibold text-white leading-snug">
            How can we do better
          </p>
          <p className="text-xs text-indigo-100/80 mt-0.5">
            Answers from the leave-early survey
          </p>
        </div>
      </div>

      {bookingId != null && (
        <div className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-black/25 px-2.5 py-1 text-[11px] font-medium text-blue-100">
          <Truck className="h-3 w-3 text-amber-300" />
          Booking #{bookingId}
        </div>
      )}

      {answers.length > 0 && (
        <div className="space-y-2">
          {answers.map((row, index) => (
            <div
              key={`${row.field_key || row.prompt}-${index}`}
              className="rounded-lg border border-white/10 bg-black/25 px-3 py-2.5"
            >
              <p className="text-[11px] font-semibold uppercase tracking-wide text-blue-200/85 mb-1">
                {row.prompt}
              </p>
              <p className="text-sm font-medium text-white leading-snug">{row.answer}</p>
            </div>
          ))}
        </div>
      )}

      {comments ? (
        <div className="rounded-lg border border-amber-400/35 bg-amber-400/10 px-3 py-3">
          <div className="mb-1.5 flex items-center gap-1.5">
            <StickyNote className="h-3.5 w-3.5 text-amber-300" />
            <p className="text-[11px] font-bold uppercase tracking-wide text-amber-200">
              Comments
            </p>
          </div>
          <p className="text-sm text-white whitespace-pre-wrap leading-relaxed">{comments}</p>
        </div>
      ) : null}
    </div>
  );
}

export default FeedbackSurveyMessageContent;
