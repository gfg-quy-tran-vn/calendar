'use client';

import { useState } from 'react';
import type { Guest } from '@/lib/events';
import type { Reply } from '@/lib/guests';

type Props = {
  me: Guest;
  /** Replies for one occurrence of a recurring event only. */
  recurring: boolean;
  onSend: (status: Reply, note: string, notify: boolean) => Promise<void>;
};

const CHOICES: { status: Reply; label: string }[] = [
  { status: 'accepted', label: 'Yes' },
  { status: 'tentative', label: 'Maybe' },
  { status: 'declined', label: 'No' },
];
const WORDS: Record<string, string> = { accepted: 'You said yes', declined: 'You said no', tentative: 'You said maybe', needsAction: 'No reply yet' };

/** "Going?" with Yes / Maybe / No, an optional note, and a button that sends the reply. */
export function RsvpCard({ me, recurring, onSend }: Props) {
  const current = me.responseStatus ?? 'needsAction';
  const [choice, setChoice] = useState<Reply | null>(current === 'needsAction' ? null : (current as Reply));
  const [note, setNote] = useState(me.comment ?? '');
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const changed = choice !== null && (choice !== current || note.trim() !== (me.comment ?? ''));

  async function send() {
    if (!choice) return;
    setBusy(true);
    setError(null);
    try {
      await onSend(choice, note, notify);
      setSent(true);
      setTimeout(() => setSent(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rsvp dlg-section">
      <div className="rsvp-head">
        <strong>Going?</strong>
        <span className="muted">{WORDS[current] ?? WORDS.needsAction}</span>
      </div>
      <div className="seg rsvp-seg" role="group" aria-label="Your reply">
        {CHOICES.map((c) => (
          <button key={c.status} className={choice === c.status ? `active ${c.status}` : ''} aria-pressed={choice === c.status}
            onClick={() => { setChoice(c.status); setSent(false); }} disabled={busy}>
            {c.label}
          </button>
        ))}
      </div>
      <textarea className="rsvp-note" rows={2} value={note} placeholder="Add a note (optional)" aria-label="Note with your reply"
        onChange={(e) => { setNote(e.target.value); setSent(false); }} disabled={busy} />
      <div className="rsvp-actions">
        <label className="inline">
          <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} disabled={busy} /> Let the organizer know
        </label>
        <span className="spacer" />
        {sent && <span className="rsvp-sent">Reply sent ✓</span>}
        <button className="primary" onClick={send} disabled={busy || !changed}>{busy ? 'Sending…' : 'Send reply'}</button>
      </div>
      {recurring && <span className="muted rsvp-hint">This replies to this occurrence only.</span>}
      {error && <p className="error">{error}</p>}
    </section>
  );
}
