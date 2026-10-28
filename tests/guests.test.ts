import { describe, expect, it } from 'vitest';
import { applyResponse, parseEmails, sortGuests } from '@/lib/guests';

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

describe('applyResponse', () => {
  const guests = [
    { email: 'boss@example.com', organizer: true, responseStatus: 'accepted' },
    { email: 'me@example.com', self: true, responseStatus: 'needsAction', displayName: 'Me' },
    { email: 'pat@example.com', responseStatus: 'declined' },
  ];

  it('changes only my own entry', () => {
    expect(applyResponse(guests, 'tentative', 'Running late')).toEqual([
      guests[0],
      { email: 'me@example.com', self: true, responseStatus: 'tentative', displayName: 'Me', comment: 'Running late' },
      guests[2],
    ]);
  });

  it('trims the note, and removes it when it is empty', () => {
    expect(applyResponse(guests, 'accepted', '  See you there  ')[1].comment).toBe('See you there');
    const withNote = [guests[0], { ...guests[1], comment: 'old note' }, guests[2]];
    expect(applyResponse(withNote, 'declined', '   ')[1]).not.toHaveProperty('comment');
  });

  it('does not modify the list it is given, and ignores a list without me in it', () => {
    const before = JSON.stringify(guests);
    applyResponse(guests, 'accepted', 'x');
    expect(JSON.stringify(guests)).toBe(before);
    const others = [guests[0], guests[2]];
    expect(applyResponse(others, 'accepted', 'x')).toEqual(others);
  });
});

describe('sortGuests', () => {
  const g = (email: string, responseStatus?: string, organizer?: boolean) => ({ email, responseStatus, organizer });

  it('puts the organizer first, then yes, maybe, no, and no response', () => {
    const sorted = sortGuests([
      g('none@x.com'), g('no@x.com', 'declined'), g('maybe@x.com', 'tentative'),
      g('yes@x.com', 'accepted'), g('org@x.com', 'needsAction', true),
    ]);
    expect(sorted.map((x) => x.email)).toEqual(['org@x.com', 'yes@x.com', 'maybe@x.com', 'no@x.com', 'none@x.com']);
  });

  it('keeps Google\'s order within the same answer and does not change the input', () => {
    const input = [g('b@x.com', 'accepted'), g('a@x.com', 'accepted'), g('c@x.com', 'bogus')];
    expect(sortGuests(input).map((x) => x.email)).toEqual(['b@x.com', 'a@x.com', 'c@x.com']);
    expect(input.map((x) => x.email)).toEqual(['b@x.com', 'a@x.com', 'c@x.com']);
  });
});
