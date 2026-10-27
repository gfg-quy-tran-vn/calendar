import DOMPurify from 'isomorphic-dompurify';

const ALLOWED_TAGS = [
  'a', 'b', 'strong', 'i', 'em', 'u', 's', 'p', 'br', 'hr', 'span', 'div',
  'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'blockquote', 'code', 'pre',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
];
const ALLOWED_ATTR = ['href', 'target', 'rel', 'colspan', 'rowspan'];

const HAS_TAG = /<\/?[a-z][\s\S]*?>/i;
const URL_RE = /(https?:\/\/[^\s<]+)/g;

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, { ALLOWED_TAGS, ALLOWED_ATTR });
}

/** Google descriptions are either HTML or plain text; normalise both to safe HTML. */
export function toDisplayHtml(raw: string | null | undefined): string {
  if (!raw) return '';
  const html = HAS_TAG.test(raw)
    ? raw
    : escapeHtml(raw).replace(URL_RE, '<a href="$1">$1</a>').replace(/\r?\n/g, '<br>');
  return sanitizeHtml(html);
}
