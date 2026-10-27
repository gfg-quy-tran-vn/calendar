import { describe, expect, it } from 'vitest';
import { parseEmails } from '@/lib/guests';

describe('parseEmails', () => {
  it('splits on commas, semicolons, spaces and new lines', () => {
    expect(parseEmails('a@example.com, b@example.com;c@example.com d@example.com\ne@example.com', [])).toEqual({
      valid: ['a@example.com', 'b@example.com', 'c@example.com', 'd@example.com', 'e@example.com'],
      invalid: [],
      existing: [],
    });
  });

  it('understands pasted "Name <email>" addresses', () => {
    const r = parseEmails('Alex Lee <alex@example.com>, "Sam, Jr." <sam@example.com>, jo@example.com', []);
    expect(r.valid).toEqual(['alex@example.com', 'sam@example.com', 'jo@example.com']);
    expect(r.invalid).toEqual([]);
  });

  it('never swallows a plain address that precedes a "Name <email>" one', () => {
    const r = parseEmails('first@example.com Alex Lee <alex@example.com>', []);
    expect(r.valid).toEqual(['first@example.com', 'alex@example.com']);
    expect(r.invalid).toEqual([]);
  });

  it('reports what is not an email address, and keeps the rest', () => {
    const r = parseEmails('good@example.com, nope, @example.com, x@y', []);
    expect(r.valid).toEqual(['good@example.com']);
    expect(r.invalid).toEqual(['nope', '@example.com', 'x@y']);
  });

  it('ignores repeats and people already on the list, ignoring case', () => {
    const r = parseEmails('A@Example.com, a@example.com, new@example.com, OLD@example.com', ['old@example.com']);
    expect(r.valid).toEqual(['A@Example.com', 'new@example.com']);
    expect(r.existing).toEqual(['OLD@example.com']);
  });

  it('returns nothing for empty input', () => {
    expect(parseEmails('  ,; \n', [])).toEqual({ valid: [], invalid: [], existing: [] });
  });
});
