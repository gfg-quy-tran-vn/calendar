'use client';

import { useEffect, useState } from 'react';
import type { EventApi } from '@fullcalendar/core';
import { addDays, fromLocalInput, localTimeZone, toLocalInput } from '@/lib/dates';
import type { EventDraft, EventMeta } from '@/lib/events';
import { hideDomain } from '@/lib/names';
import { toDisplayHtml } from '@/lib/sanitize';
import { createEvent, deleteEvent, updateEvent } from './api';
import { GuestList } from './GuestList';
import { HtmlView } from './HtmlView';
import { Icon } from './Icons';
import { RichTextEditor } from './RichTextEditor';

export type WritableCalendar = { id: number; label: string };
export type DialogState =
  | { mode: 'create'; start: string; end: string; allDay: boolean }
  | { mode: 'view'; event: EventApi };

type Props = { state: DialogState; calendars: WritableCalendar[]; onClose: () => void; onChanged: () => void };

type Form = {
  calendarId: number;
  title: string;
  allDay: boolean;
  start: string; // `YYYY-MM-DD` (all-day, inclusive) or `YYYY-MM-DDTHH:mm` (local)
  end: string;
  location: string;
  description: string;
  descriptionDirty: boolean;
  scope: 'instance' | 'series';
};

const HOUR = 3_600_000;
const DAY = 86_400_000;

function toInputs(start: string, end: string | null, allDay: boolean): Pick<Form, 'start' | 'end'> {
  if (allDay) {
    const s = start.slice(0, 10);
    return { start: s, end: end ? addDays(end, -1) : s }; // exclusive → inclusive end
  }
  const e = end ?? new Date(new Date(start).getTime() + HOUR).toISOString();
  return { start: toLocalInput(start), end: toLocalInput(e) };
}

function initialForm(state: DialogState, calendars: WritableCalendar[]): Form {
  const base = { location: '', description: '', descriptionDirty: false, scope: 'instance' as const };
  if (state.mode === 'create') {
    return { ...base, calendarId: calendars[0]?.id ?? 0, title: '', allDay: state.allDay, ...toInputs(state.start, state.end, state.allDay) };
  }
  const e = state.event;
  const meta = e.extendedProps as EventMeta;
  return {
    ...base,
    calendarId: meta.calendarId,
    title: e.title,
    allDay: e.allDay,
    ...toInputs(e.startStr, e.endStr || null, e.allDay),
    location: meta.location,
    description: toDisplayHtml(meta.description),
  };
}

function toDraft(f: Form, includeDescription: boolean): EventDraft {
  const times = f.allDay
    ? { start: f.start, end: addDays(f.end, 1) }
    : { start: fromLocalInput(f.start), end: fromLocalInput(f.end) };
  return {
    title: f.title.trim() || '(No title)',
    allDay: f.allDay,
    ...times,
    timeZone: localTimeZone(),
    location: f.location,
    ...(includeDescription ? { description: f.description } : {}),
  };
}

function validate(f: Form): string | null {
  if (!f.start || !f.end) return 'Start and end are required.';
  if (f.end < f.start) return 'End must not be before start.';
  return null;
}

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

/** The date on the first line and the time on the second, e.g. "Monday, October 26, 2026" / "3:00 – 3:30 PM". */
function whenLines(e: EventApi): { primary: string; secondary?: string } {
  const start = e.start!;
  const longDate = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  if (e.allDay) {
    const last = e.end ? new Date(e.end.getTime() - DAY) : start;
    const range = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
    return { primary: sameDay(start, last) ? longDate.format(start) : range.formatRange(start, last), secondary: 'All day' };
  }
  const end = e.end ?? start;
  const time = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
  if (sameDay(start, end)) return { primary: longDate.format(start), secondary: end === start ? time.format(start) : time.formatRange(start, end) };
  return { primary: new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).formatRange(start, end) };
}

export function EventDialog({ state, calendars, onClose, onChanged }: Props) {
  const [editing, setEditing] = useState(state.mode === 'create');
  const [form, setForm] = useState(() => initialForm(state, calendars));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [guests, setGuests] = useState(() => (state.mode === 'view' ? (state.event.extendedProps as EventMeta).attendees : []));

  // Escape closes the dialog, like Close/Cancel. Not while saving, and not while an IME is composing text.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && !e.isComposing && !busy) onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [busy, onClose]);

  const meta = state.mode === 'view' ? (state.event.extendedProps as EventMeta) : null;
  const recurring = Boolean(meta?.recurringEventId);
  const series = recurring && form.scope === 'series';
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));

  function toggleAllDay(allDay: boolean) {
    setForm((f) => ({
      ...f,
      allDay,
      ...(allDay
        ? { start: f.start.slice(0, 10), end: f.end.slice(0, 10) }
        : { start: `${f.start}T09:00`, end: `${f.end}T10:00` }),
    }));
  }

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      onChanged();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function save() {
    const invalid = validate(form);
    if (invalid) {
      setError(invalid);
      return;
    }
    void run(async () => {
      if (!meta) return createEvent(form.calendarId, toDraft(form, true));
      const draft = toDraft(form, form.descriptionDirty);
      if (series) {
        // Moving a whole series needs the master's own times, so only text fields apply to "All events".
        const { title, location, description } = draft;
        return updateEvent(meta.calendarId, meta.recurringEventId!, { title, location, ...(description !== undefined ? { description } : {}) });
      }
      return updateEvent(meta.calendarId, meta.googleEventId, draft, meta.etag);
    });
  }

  async function copyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError('Could not copy the link.');
    }
  }

  async function addGuests(emails: string[], notify: boolean) {
    if (state.mode !== 'view' || !meta) return;
    const updated = await updateEvent(
      meta.calendarId, meta.googleEventId, { attendees: [...guests, ...emails.map((email) => ({ email }))] }, meta.etag, notify ? 'all' : 'none',
    );
    // Keep the open event current, so a second change doesn't trip over the old etag.
    state.event.setExtendedProp('etag', updated.extendedProps.etag);
    state.event.setExtendedProp('attendees', updated.extendedProps.attendees);
    setGuests(updated.extendedProps.attendees);
  }

  function remove() {
    if (!meta) return;
    if (!window.confirm(`Delete "${form.title}"${series ? ' and all its occurrences' : ''}?`)) return;
    void run(() => deleteEvent(meta.calendarId, series ? meta.recurringEventId! : meta.googleEventId));
  }

  const viewing = !editing && state.mode === 'view';
  const when = viewing ? whenLines(state.event) : null;

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className={viewing ? 'dialog dialog-view' : 'dialog'} role="dialog" aria-modal="true"
        style={viewing ? ({ '--event-color': state.event.borderColor } as React.CSSProperties) : undefined}>
        {editing ? (
          <>
            <input className="title-input" type="text" placeholder="Title" value={form.title} autoFocus
              onChange={(e) => set('title', e.target.value)} />
            {state.mode === 'create' && (
              <label>
                Calendar
                <select value={form.calendarId} onChange={(e) => set('calendarId', Number(e.target.value))}>
                  {calendars.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
              </label>
            )}
            <div className="row">
              <label className="inline">
                <input type="checkbox" checked={form.allDay} disabled={series} onChange={(e) => toggleAllDay(e.target.checked)} /> All day
              </label>
              <label>
                Start
                <input type={form.allDay ? 'date' : 'datetime-local'} value={form.start} disabled={series}
                  onChange={(e) => set('start', e.target.value)} />
              </label>
              <label>
                End
                <input type={form.allDay ? 'date' : 'datetime-local'} value={form.end} disabled={series}
                  onChange={(e) => set('end', e.target.value)} />
              </label>
            </div>
            <label>
              Location
              <input type="text" value={form.location} onChange={(e) => set('location', e.target.value)} />
            </label>
            <div>
              <div className="field-label">Description</div>
              <RichTextEditor value={form.description}
                onChange={(html) => setForm((f) => ({ ...f, description: html === '<p></p>' ? '' : html, descriptionDirty: true }))} />
            </div>
          </>
        ) : (
          state.mode === 'view' && meta && (
            <>
              <header className="dlg-head">
                <h2>{state.event.title}</h2>
                <button className="icon dlg-close" onClick={onClose} aria-label="Close" title="Close (Esc)"><Icon name="x" /></button>
              </header>
              <ul className="dlg-meta">
                <li>
                  <Icon name="clock" />
                  <span>{when?.primary}{when?.secondary && <span className="muted dlg-sub">{when.secondary}</span>}</span>
                </li>
                {meta.conference && (
                  <li>
                    <Icon name="video" />
                    <span className="dlg-join">
                      <span className="dlg-join-row">
                        <a className="join-btn" href={meta.conference.url} target="_blank" rel="noopener noreferrer">
                          {meta.conference.name === 'Video call' ? 'Join video call' : `Join with ${meta.conference.name}`}
                        </a>
                        <button className="ghost copy-link" onClick={() => void copyLink(meta.conference!.url)}>{copied ? 'Copied ✓' : 'Copy link'}</button>
                      </span>
                      <span className="muted dlg-sub">{meta.conference.url.replace(/^https:\/\//, '')}</span>
                    </span>
                  </li>
                )}
                {recurring && <li><Icon name="repeat" /><span className="muted">Recurring event</span></li>}
                {meta.location && <li><Icon name="pin" /><span>{meta.location}</span></li>}
                <li>
                  <Icon name="calendar" />
                  <span className="dlg-cal"><span className="cal-dot" />{hideDomain(meta.calendarName)}</span>
                </li>
              </ul>
              {meta.description.trim() && (
                <div className="dlg-section"><HtmlView html={meta.description} /></div>
              )}
              <GuestList guests={guests} canAdd={meta.canAddGuests} recurring={recurring} onAdd={addGuests} />
            </>
          )
        )}

        {recurring && meta?.canWrite && (
          <fieldset className="row scope">
            <label className="inline">
              <input type="radio" checked={form.scope === 'instance'} onChange={() => set('scope', 'instance')} /> This event
            </label>
            <label className="inline">
              <input type="radio" checked={form.scope === 'series'} onChange={() => set('scope', 'series')} /> All events
              {editing && <span className="muted"> (title, location, description only)</span>}
            </label>
          </fieldset>
        )}

        {error && <p className="error">{error}</p>}

        <div className="actions">
          {meta?.canWrite && <button className="danger ghost" onClick={remove} disabled={busy}>Delete</button>}
          <span className="spacer" />
          {viewing && meta?.htmlLink && (
            <a className="ext-link" href={meta.htmlLink} target="_blank" rel="noopener noreferrer">
              Open in Google Calendar <Icon name="external" size={13} />
            </a>
          )}
          {editing && <button onClick={onClose} disabled={busy}>Cancel</button>}
          {editing ? (
            <button className="primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
          ) : (
            meta?.canWrite && <button className="primary" onClick={() => setEditing(true)}>Edit</button>
          )}
        </div>
      </div>
    </div>
  );
}
