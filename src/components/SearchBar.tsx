'use client';

import { useEffect, useRef, useState } from 'react';
import type { CalendarEvent } from '@/lib/events';
import { hideDomain } from '@/lib/names';
import { MIN_QUERY_LENGTH, highlightParts, type SearchResponse } from '@/lib/search';
import { Icon } from './Icons';

const DEBOUNCE_MS = 300;

function Highlight({ text, query }: { text: string; query: string }) {
  return (
    <>
      {highlightParts(text, query).map((part, i) => (part.match ? <mark key={i}>{part.text}</mark> : <span key={i}>{part.text}</span>))}
    </>
  );
}

function whenOf(e: CalendarEvent): string {
  const date = new Date(e.start);
  if (e.allDay) return `${new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).format(date)} · All day`;
  return new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date);
}

/** Search box with a results dropdown. `/` or Cmd/Ctrl+K focuses it. */
export function SearchBar({ onPick }: { onPick: (event: CalendarEvent) => void }) {
  const [query, setQuery] = useState('');
  const [data, setData] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const controller = useRef<AbortController>(undefined);

  const trimmed = query.trim();
  const events = data?.events ?? [];

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const typing = e.target instanceof HTMLElement && (e.target.matches('input, textarea, select') || e.target.isContentEditable);
      const slash = e.key === '/' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey;
      const cmdK = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k';
      if ((!slash && !cmdK) || document.querySelector('.overlay')) return; // not while a dialog is open
      e.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    listRef.current?.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
  }, [active, data]);

  async function run(q: string) {
    const ctrl = new AbortController();
    controller.current = ctrl;
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
      if (!res.ok) throw new Error(`Search failed (${res.status})`);
      const body = (await res.json()) as SearchResponse;
      if (ctrl.signal.aborted) return;
      setData(body);
      setFailed(false);
      setActive(0);
    } catch {
      if (!ctrl.signal.aborted) setFailed(true);
    } finally {
      if (!ctrl.signal.aborted) setLoading(false);
    }
  }

  function change(value: string) {
    setQuery(value);
    setOpen(true);
    clearTimeout(timer.current);
    controller.current?.abort();
    if (value.trim().length < MIN_QUERY_LENGTH) {
      setData(null);
      setFailed(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    timer.current = setTimeout(() => void run(value.trim()), DEBOUNCE_MS);
  }

  function clear() {
    change('');
    setOpen(false);
    inputRef.current?.focus();
  }

  function pick(event: CalendarEvent) {
    setOpen(false);
    inputRef.current?.blur();
    onPick(event);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(true);
      if (events.length > 0) setActive((i) => (i + (e.key === 'ArrowDown' ? 1 : events.length - 1)) % events.length);
    } else if (e.key === 'Enter' && open && events[active]) {
      e.preventDefault();
      pick(events[active]);
    } else if (e.key === 'Escape') {
      if (open) setOpen(false);
      else if (query) clear();
      else inputRef.current?.blur();
    }
  }

  let body: React.ReactNode = null;
  if (trimmed.length > 0 && trimmed.length < MIN_QUERY_LENGTH) body = <p className="search-note muted">Type at least {MIN_QUERY_LENGTH} characters.</p>;
  else if (failed) body = <p className="search-note error">Search failed. Try again.</p>;
  else if (data && events.length === 0) body = <p className="search-note muted">{loading ? 'Searching…' : `No events match “${trimmed}”.`}</p>;
  else if (data) {
    body = (
      <>
        <ul id="search-listbox" className={loading ? 'search-list loading' : 'search-list'} role="listbox" ref={listRef}>
          {events.map((e, i) => (
            <li key={e.id} role="option" aria-selected={i === active}>
              <button className={i === active ? 'search-item active' : 'search-item'} onMouseEnter={() => setActive(i)} onClick={() => pick(e)}>
                <span className="search-dot" style={{ background: e.borderColor }} />
                <span className="search-main">
                  <span className="search-title"><Highlight text={e.title} query={trimmed} /></span>
                  <span className="muted search-meta">{whenOf(e)} · {hideDomain(e.extendedProps.calendarName)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        {data.total > events.length && <p className="search-note muted">Showing {events.length} of {data.total} matches. Add more words to narrow it down.</p>}
        {data.errors.length > 0 && <p className="search-note muted">Could not search: {data.errors.map((x) => hideDomain(x.name)).join(', ')}</p>}
      </>
    );
  } else if (loading) body = <p className="search-note muted">Searching…</p>;

  return (
    <div className="search" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false); }}>
      <span className="search-icon"><Icon name="search" size={15} /></span>
      <input
        ref={inputRef} type="text" value={query} placeholder="Search events  ( / )" aria-label="Search events"
        role="combobox" aria-expanded={open} aria-controls="search-listbox" aria-autocomplete="list"
        onChange={(e) => change(e.target.value)} onFocus={() => setOpen(true)} onKeyDown={onKeyDown}
      />
      {query && <button className="icon search-clear" onClick={clear} aria-label="Clear search" title="Clear"><Icon name="x" size={14} /></button>}
      {open && body && <div className="search-results">{body}</div>}
    </div>
  );
}
