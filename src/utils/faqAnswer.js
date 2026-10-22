const HTML_ANSWER = /<(p|br|strong|b|em|i|u|span|h[1-6]|ul|ol|li|a|table|thead|tbody|tr|th|td|mark|blockquote)\b/i;

export function isHtmlAnswer(value) {
  return HTML_ANSWER.test(String(value || ''));
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function stripHtml(value) {
  return String(value || '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(p|div|tr|li|h[1-6]|th|td)>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export function answerToEditorHtml(value) {
  const text = String(value || '');
  if (!text.trim()) return '';
  if (isHtmlAnswer(text)) return text;
  return text
    .split(/\n{2,}/)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

export function answerHasContent(value) {
  return stripHtml(value).length > 0;
}
