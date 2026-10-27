'use client';

import { useState } from 'react';
import type { EventApi } from '@fullcalendar/core';
import { addDays, fromLocalInput, localTimeZone, toLocalInput } from '@/lib/dates';
import type { EventDraft, EventMeta } from '@/lib/events';
import { toDisplayHtml } from '@/lib/sanitize';
import { createEvent, deleteEvent, updateEvent } from './api';
import { HtmlView } from './HtmlView';
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

function formatWhen(e: EventApi): string {
  const fmt = new Intl.DateTimeFormat(undefined, e.allDay ? { dateStyle: 'medium' } : { dateStyle: 'medium', timeStyle: 'short' });
  const start = e.start!;
  const end = e.end && e.allDay ? new Date(e.end.getTime() - DAY) : e.end;
  return end ? fmt.formatRange(start, end) : fmt.format(start);
}

export function EventDialog({ state, calendars, onClose, onChanged }: Props) {
  const [editing, setEditing] = useState(state.mode === 'create');
  const [form, setForm] = useState(() => initialForm(state, calendars));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  function remove() {
    if (!meta) return;
    if (!window.confirm(`Delete "${form.title}"${series ? ' and all its occurrences' : ''}?`)) return;
    void run(() => deleteEvent(meta.calendarId, series ? meta.recurringEventId! : meta.googleEventId));
  }

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true">
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
              <h2>{state.event.title}</h2>
              <p className="muted">{formatWhen(state.event)} · {meta.calendarName}</p>
              {meta.location && <p>📍 {meta.location}</p>}
              <HtmlView html={meta.description} />
              {meta.htmlLink && <a href={meta.htmlLink} target="_blank" rel="noopener noreferrer">Open in Google Calendar</a>}
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
          {meta?.canWrite && <button className="danger" onClick={remove} disabled={busy}>Delete</button>}
          <span className="spacer" />
          <button onClick={onClose} disabled={busy}>{editing ? 'Cancel' : 'Close'}</button>
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
