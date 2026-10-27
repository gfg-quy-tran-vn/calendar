'use client';

import { useState } from 'react';
import type { Guest } from '@/lib/events';
import { parseEmails } from '@/lib/guests';

type Props = {
  guests: Guest[];
  canAdd: boolean;
  /** Occurrences of a recurring event are changed one at a time. */
  recurring: boolean;
  onAdd: (emails: string[], notify: boolean) => Promise<void>;
};

const STATUS: Record<string, { icon: string; label: string }> = {
  accepted: { icon: '✓', label: 'Accepted' },
  declined: { icon: '✕', label: 'Declined' },
  tentative: { icon: '?', label: 'Maybe' },
  needsAction: { icon: '•', label: 'No reply yet' },
};

function GuestRow({ guest }: { guest: Guest }) {
  const status = STATUS[guest.responseStatus ?? 'needsAction'] ?? STATUS.needsAction;
  return (
    <li className="guest">
      <span className={`guest-status ${guest.responseStatus ?? 'needsAction'}`} title={status.label} aria-label={status.label}>
        {status.icon}
      </span>
      <span className="guest-name">
        {guest.displayName ? <>{guest.displayName} <span className="muted">{guest.email}</span></> : guest.email}
      </span>
      {guest.self && <span className="guest-tag">You</span>}
      {guest.organizer && <span className="guest-tag">Organizer</span>}
      {guest.optional && <span className="guest-tag">Optional</span>}
      {guest.resource && <span className="guest-tag">Room</span>}
    </li>
  );
}

export function GuestList({ guests, canAdd, recurring, onAdd }: Props) {
  const [text, setText] = useState('');
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (guests.length === 0 && !canAdd) return null;
  // The organizer first, then everyone else in Google's order.
  const ordered = [...guests].sort((a, b) => Number(b.organizer ?? false) - Number(a.organizer ?? false));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const { valid, invalid, existing } = parseEmails(text, guests.map((g) => g.email));
    if (invalid.length > 0) return setError(`Not an email address: ${invalid.join(', ')}`);
    if (valid.length === 0) return setError(existing.length > 0 ? 'Already invited.' : 'Enter at least one email address.');
    setBusy(true);
    setError(null);
    try {
      await onAdd(valid, notify);
      setText('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="guests">
      <div className="field-label">{guests.length === 0 ? 'Guests' : `Guests (${guests.length})`}</div>
      {guests.length > 0 && (
        <ul className="guest-list">
          {ordered.map((g) => <GuestRow key={g.email} guest={g} />)}
        </ul>
      )}
      {canAdd && (
        <form className="guest-add" onSubmit={submit}>
          <div className="guest-add-row">
            <input type="text" value={text} placeholder="Add guests: email addresses, separated by commas"
              onChange={(e) => setText(e.target.value)} disabled={busy} aria-label="Add guests" />
            <button type="submit" disabled={busy || text.trim() === ''}>{busy ? 'Adding…' : 'Add'}</button>
          </div>
          <label className="inline">
            <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} disabled={busy} /> Send invitation emails
          </label>
          {recurring && <span className="muted">Guests are added to this occurrence only (the option below is for Edit and Delete).</span>}
          {error && <p className="error">{error}</p>}
        </form>
      )}
    </section>
  );
}
