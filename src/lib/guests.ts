const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type ParsedEmails = {
  /** New, valid, de-duplicated addresses (original case kept). */
  valid: string[];
  /** Pieces that are not email addresses. */
  invalid: string[];
  /** Valid addresses that are already on the list. */
  existing: string[];
};

/** Turns typed or pasted text (`a@x.com, Name <b@x.com>`) into email addresses. */
export function parseEmails(text: string, alreadyInvited: string[]): ParsedEmails {
  const known = new Set(alreadyInvited.map((e) => e.toLowerCase()));
  const result: ParsedEmails = { valid: [], invalid: [], existing: [] };
  // "Name <a@x.com>" and "\"Last, First\" <a@x.com>" → "a@x.com"
  const plain = text.replace(/"[^"]*"|(?<![^\s,;])(?:[^<>,;"@\s]+\s*)*<([^<>]*)>/g, (m, inner?: string) => (inner !== undefined ? ` ${inner} ` : ' '));
  for (const piece of plain.split(/[\s,;]+/).filter(Boolean)) {
    if (!EMAIL.test(piece)) {
      result.invalid.push(piece);
      continue;
    }
    const key = piece.toLowerCase();
    if (known.has(key)) {
      if (alreadyInvited.some((e) => e.toLowerCase() === key)) result.existing.push(piece);
      continue;
    }
    known.add(key);
    result.valid.push(piece);
  }
  return result;
}
