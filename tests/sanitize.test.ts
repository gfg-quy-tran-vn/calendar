import { describe, expect, it } from 'vitest';
import { toDisplayHtml } from '@/lib/sanitize';

describe('toDisplayHtml', () => {
  it('returns empty string for empty input', () => {
    expect(toDisplayHtml('')).toBe('');
    expect(toDisplayHtml(null)).toBe('');
  });

  it('keeps formatting tags', () => {
    expect(toDisplayHtml('<b>bold</b> <ul><li>x</li></ul>')).toBe('<b>bold</b> <ul><li>x</li></ul>');
  });

  it('strips scripts, event handlers and images', () => {
    expect(toDisplayHtml('<p onclick="x()">hi</p><script>alert(1)</script><img src=x onerror=alert(1)>')).toBe('<p>hi</p>');
  });

  it('drops javascript: links and hardens real links', () => {
    expect(toDisplayHtml('<a href="javascript:alert(1)">x</a>')).toBe('<a target="_blank" rel="noopener noreferrer">x</a>');
    expect(toDisplayHtml('<a href="https://example.com">x</a>')).toBe(
      '<a href="https://example.com" target="_blank" rel="noopener noreferrer">x</a>',
    );
  });

  it('converts plain text: escapes, links URLs, keeps line breaks', () => {
    expect(toDisplayHtml('a < b\nsee https://meet.google.com/abc')).toBe(
      'a &lt; b<br>see <a href="https://meet.google.com/abc" target="_blank" rel="noopener noreferrer">https://meet.google.com/abc</a>',
    );
  });

  it('keeps the text inside unknown tags such as Google html-blob', () => {
    expect(toDisplayHtml('<html-blob>Join <b>now</b></html-blob>')).toBe('Join <b>now</b>');
  });
});
