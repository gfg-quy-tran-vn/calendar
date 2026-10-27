'use client';

import { useState } from 'react';
import type { Guest } from '@/lib/events';
import { parseEmails } from '@/lib/guests';
import { Icon } from './Icons';

type Props = {
  guests: Guest[];
  canAdd: boolean;
  /** Occurrences of a recurring event are changed one at a time. */
  recurring: boolean;
  onAdd: (emails: string[], notify: boolean) => Promise<void>;
};

const STATUS: Record<string, { badge: string; label: string; summary: string }> = {
  accepted: { badge: '✓', label: 'Accepted', summary: 'yes' },
  declined: { badge: '✕', label: 'Declined', summary: 'no' },
  tentative: { badge: '?', label: 'Maybe', summary: 'maybe' },
  needsAction: { badge: '', label: 'No reply yet', summary: 'awaiting' },
};
const statusOf = (g: Guest) => STATUS[g.responseStatus ?? 'needsAction'] ?? STATUS.needsAction;

/** A stable colour per person, so the same guest always gets the same avatar. */
function avatarColor(email: string): string {
  let h = 0;
  for (const c of email) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h} 45% 42%)`;
}

function GuestRow({ guest }: { guest: Guest }) {
  const status = statusOf(guest);
  const name = guest.displayName || guest.email;
  return (
    <li className="guest" title={`${name}: ${status.label}`}>
      <span className="avatar" style={{ background: avatarColor(guest.email) }} aria-hidden="true">
        {name[0].toUpperCase()}
        {status.badge && <span className={`avatar-badge ${guest.responseStatus}`}>{status.badge}</span>}
      </span>
      <span className="guest-text">
        <span className="guest-line">
          <span className="guest-name">{name}</span>
          {guest.self && <span className="guest-tag">You</span>}
          {guest.organizer && <span className="guest-tag">Organizer</span>}
          {guest.optional && <span className="guest-tag">Optional</span>}
          {guest.resource && <span className="guest-tag">Room</span>}
          <span className="sr-only">{status.label}</span>
        </span>
        {guest.displayName && <span className="muted guest-email">{guest.email}</span>}
      </span>
    </li>
  );
}

/** "3 yes · 1 awaiting" */
function summarize(guests: Guest[]): string {
  const counts = new Map<string, number>();
  for (const g of guests) {
    const word = statusOf(g).summary;
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return ['yes', 'no', 'maybe', 'awaiting'].filter((w) => counts.has(w)).map((w) => `${counts.get(w)} ${w}`).join(' · ');
}

export function GuestList({ guests, canAdd, recurring, onAdd }: Props) {
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState('');
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (guests.length === 0 && !canAdd) return null;
  // The organizer first, then everyone else in Google's order.
  const ordered = [...guests].sort((a, b) => Number(b.organizer ?? false) - Number(a.organizer ?? false));

  function cancel() {
    setAdding(false);
    setText('');
    setError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const { valid, invalid, existing } = parseEmails(text, guests.map((g) => g.email));
    if (invalid.length > 0) return setError(`Not an email address: ${invalid.join(', ')}`);
    if (valid.length === 0) return setError(existing.length > 0 ? 'Already invited.' : 'Enter at least one email address.');
    setBusy(true);
    setError(null);
    try {
      await onAdd(valid, notify);
      cancel();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="guests dlg-section">
      {guests.length > 0 && (
        <>
          <div className="guests-head">
            <Icon name="users" />
            <strong>{guests.length === 1 ? '1 guest' : `${guests.length} guests`}</strong>
            <span className="muted">{summarize(guests)}</span>
          </div>
          <ul className="guest-list">
            {ordered.map((g) => <GuestRow key={g.email} guest={g} />)}
          </ul>
        </>
      )}
      {canAdd && !adding && (
        <button className="ghost add-guests-btn" onClick={() => setAdding(true)}>
          <Icon name="plus" size={14} /> Add guests
        </button>
      )}
      {canAdd && adding && (
        <form className="guest-add" onSubmit={submit}>
          <div className="guest-add-row">
            <input type="text" value={text} placeholder="Email addresses, separated by commas" autoFocus
              onChange={(e) => setText(e.target.value)} disabled={busy} aria-label="Add guests" />
            <button type="submit" className="primary" disabled={busy || text.trim() === ''}>{busy ? 'Adding…' : 'Add'}</button>
            <button type="button" className="ghost" onClick={cancel} disabled={busy}>Cancel</button>
          </div>
          <label className="inline">
            <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} disabled={busy} /> Send invitation emails
          </label>
          {recurring && <span className="muted">Added to this occurrence only.</span>}
          {error && <p className="error">{error}</p>}
        </form>
      )}
    </section>
  );
}
