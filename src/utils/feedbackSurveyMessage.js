/**
 * Helpers for How can we do better chat messages.
 * Supports structured message_context and legacy plain-text dumps.
 */

export function isHowCanWeDoBetterMessage(message) {
  const ctx = message?.message_context;
  if (ctx?.type === 'how_can_we_do_better') return true;
  const content = String(message?.message_content || '');
  return /how can we do better/i.test(content) && (content.includes('•') || content.includes('→'));
}

/**
 * Normalize answers from message_context into [{ prompt, field_key, answer }].
 */
export function normalizeFeedbackAnswers(ctxAnswers) {
  if (!ctxAnswers) return [];

  if (Array.isArray(ctxAnswers)) {
    return ctxAnswers
      .map((row) => ({
        prompt: String(row?.prompt || row?.field_key || '').trim(),
        field_key: row?.field_key ? String(row.field_key) : null,
        answer: String(row?.answer ?? row?.value ?? '').trim(),
      }))
      .filter((row) => row.prompt && row.answer);
  }

  if (typeof ctxAnswers === 'object') {
    return Object.entries(ctxAnswers)
      .map(([key, value]) => ({
        prompt: key,
        field_key: key,
        answer: String(value ?? '').trim(),
      }))
      .filter((row) => row.answer);
  }

  return [];
}

/**
 * Parse legacy chat body like:
 * How can we do better — customer feedback submitted:
 *
 * • Why did you leave today?
 *   → Price felt high
 *
 * Comments:\nSome note   (literal backslash-n from SQL bug)
 */
export function parseLegacyFeedbackMessageContent(content) {
  if (!content || typeof content !== 'string') {
    return { answers: [], comments: '' };
  }

  // Normalize literal \n sequences from the SQL Comments bug, then real newlines
  const normalized = content.replace(/\\n/g, '\n');

  const answers = [];
  const qaRegex = /•\s*([^\n]+)\n\s*→\s*([^\n]+)/g;
  let match;
  while ((match = qaRegex.exec(normalized)) !== null) {
    const prompt = match[1].trim();
    const answer = match[2].trim();
    if (prompt && answer) {
      answers.push({ prompt, field_key: null, answer });
    }
  }

  let comments = '';
  const commentsMatch = normalized.match(/Comments:\s*\n?([\s\S]*)$/i);
  if (commentsMatch) {
    comments = commentsMatch[1].trim();
  }

  return { answers, comments };
}

/**
 * Resolve display payload for a feedback chat message.
 */
export function resolveFeedbackSurveyPayload(message) {
  const ctx = message?.message_context || {};
  let answers = normalizeFeedbackAnswers(ctx.answers);
  let comments = typeof ctx.comments === 'string' ? ctx.comments.trim() : '';

  if (answers.length === 0 || !comments) {
    const parsed = parseLegacyFeedbackMessageContent(message?.message_content);
    if (answers.length === 0) answers = parsed.answers;
    if (!comments) comments = parsed.comments;
  }

  return {
    answers,
    comments,
    bookingId: message?.booking_id ?? ctx.booking_id ?? null,
    feedbackResponseId: ctx.feedback_response_id ?? null,
  };
}
