import DOMPurify from 'dompurify';

const ALLOWED_TAGS = [
  'p',
  'br',
  'strong',
  'b',
  'em',
  'i',
  'u',
  'span',
  'h1',
  'h2',
  'h3',
  'h4',
  'ul',
  'ol',
  'li',
  'a',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'mark',
  'blockquote',
];

const ALLOWED_ATTR = ['href', 'target', 'rel', 'style', 'colspan', 'rowspan'];

export function sanitizeFaqAnswer(html) {
  return DOMPurify.sanitize(String(html || ''), {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
  });
}
