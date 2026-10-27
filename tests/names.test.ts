import { describe, expect, it } from 'vitest';
import { hideDomain } from '@/lib/names';

describe('hideDomain', () => {
  it('keeps only the part before @ when the whole text is an email address', () => {
    expect(hideDomain('alex@example.com')).toBe('alex');
    expect(hideDomain('sam.lee@example.org')).toBe('sam.lee');
    expect(hideDomain('jo99@example.net')).toBe('jo99');
  });

  it('leaves ordinary names alone, even if they contain an @', () => {
    expect(hideDomain('Holidays in Vietnam')).toBe('Holidays in Vietnam');
    expect(hideDomain('Standup @ 9am')).toBe('Standup @ 9am');
    expect(hideDomain('Acme Tech & Design')).toBe('Acme Tech & Design');
    expect(hideDomain('')).toBe('');
  });
});
