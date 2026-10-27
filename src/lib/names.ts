/** Shown instead of a full email address: `alex@example.com` → `alex`. Other text is returned unchanged. */
export function hideDomain(text: string): string {
  return /^[^\s@]+@[^\s@]+$/.test(text) ? text.split('@')[0] : text;
}
