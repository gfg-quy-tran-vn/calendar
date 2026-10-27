'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin, { type EventResizeDoneArg } from '@fullcalendar/interaction';
import type { DateSelectArg, DatesSetArg, EventApi, EventClickArg, EventDropArg, EventHoveringArg, EventInput, EventSourceFuncArg } from '@fullcalendar/core';
import type { CalendarError, EventsResponse } from '@/lib/aggregate';
import { addDays, localTimeZone } from '@/lib/dates';
import { hideDomain } from '@/lib/names';
import type { EventDraft, EventMeta } from '@/lib/events';
import { updateEvent } from './api';
import { EventDialog, type DialogState, type WritableCalendar } from './EventDialog';
import { EventHoverCard, type HoverState } from './EventHoverCard';
import { MiniCalendar } from './MiniCalendar';
import { Sidebar, type AccountView } from './Sidebar';

const HOUR = 3_600_000;
const HOVER_DELAY_MS = 300;

function timesOf(e: EventApi): Pick<EventDraft, 'start' | 'end' | 'allDay' | 'timeZone'> {
  const end = e.endStr || (e.allDay ? addDays(e.startStr, 1) : new Date(e.start!.getTime() + HOUR).toISOString());
  return { start: e.allDay ? e.startStr.slice(0, 10) : e.startStr, end, allDay: e.allDay, timeZone: localTimeZone() };
}

export function CalendarApp() {
  const calendarRef = useRef<FullCalendar>(null);
  const [accounts, setAccounts] = useState<AccountView[]>([]);
  const [warnings, setWarnings] = useState<CalendarError[]>([]);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [hover, setHover] = useState<HoverState | null>(null);
  const [period, setPeriod] = useState<{ start: Date; end: Date } | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const loadAccounts = useCallback(async () => {
    const res = await fetch('/api/accounts');
    setAccounts(await res.json());
  }, []);

  useEffect(() => {
    // setState only inside the promise callback, not synchronously in the effect body
    let cancelled = false;
    fetch('/api/accounts')
      .then((res) => res.json())
      .then((data: AccountView[]) => {
        if (!cancelled) setAccounts(data);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const refetch = useCallback(() => calendarRef.current?.getApi().refetchEvents(), []);

  const fetchEvents = useCallback(
    (info: EventSourceFuncArg, success: (events: EventInput[]) => void, failure: (error: Error) => void) => {
      const qs = new URLSearchParams({ start: info.startStr, end: info.endStr });
      fetch(`/api/events?${qs}`)
        .then(async (res) => {
          if (!res.ok) throw new Error(`Failed to load events (${res.status})`);
          const data = (await res.json()) as EventsResponse;
          setWarnings(data.errors);
          if (data.errors.some((e) => e.kind === 'reauth')) void loadAccounts();
          success(data.events);
        })
        .catch(failure);
    },
    [loadAccounts],
  );

  const writable: WritableCalendar[] = useMemo(
    () =>
      accounts.flatMap((a) =>
        a.needsReauth
          ? []
          : a.calendars
              .filter((c) => c.canWrite)
              .map((c) => {
                const name = hideDomain(c.name);
                const owner = hideDomain(a.email);
                return { id: c.id, label: name === owner ? name : `${name} — ${owner}` };
              }),
      ),
    [accounts],
  );

  // The middle of the visible period decides which month the mini calendar shows (a week can straddle two).
  const focus = period ? new Date((period.start.getTime() + period.end.getTime()) / 2) : new Date();

  async function onTimeChange(info: EventDropArg | EventResizeDoneArg) {
    const meta = info.event.extendedProps as EventMeta;
    try {
      const updated = await updateEvent(meta.calendarId, meta.googleEventId, timesOf(info.event), meta.etag);
      info.event.setExtendedProp('etag', updated.extendedProps.etag);
    } catch (err) {
      info.revert();
      window.alert(err instanceof Error ? err.message : String(err));
    }
  }

  function onSelect(info: DateSelectArg) {
    info.view.calendar.unselect();
    if (writable.length === 0) {
      window.alert('Connect a Google account with a writable calendar first.');
      return;
    }
    setDialog({ mode: 'create', start: info.startStr, end: info.endStr, allDay: info.allDay });
  }

  function onDatesSet(info: DatesSetArg) {
    setPeriod({ start: info.view.currentStart, end: info.view.currentEnd });
  }

  function hideHover() {
    clearTimeout(hoverTimer.current);
    setHover(null);
  }

  function onEventMouseEnter(info: EventHoveringArg) {
    clearTimeout(hoverTimer.current);
    const { event, el } = info;
    hoverTimer.current = setTimeout(() => setHover({ event, rect: el.getBoundingClientRect() }), HOVER_DELAY_MS);
  }

  function onEventClick(info: EventClickArg) {
    info.jsEvent.preventDefault();
    hideHover();
    setDialog({ mode: 'view', event: info.event });
  }

  return (
    <div className="app">
      <Sidebar
        accounts={accounts}
        onChange={() => {
          void loadAccounts();
          refetch();
        }}
      >
        <MiniCalendar
          // Follow the main calendar to another month, but not when only the day or week changes within one.
          key={focus.getFullYear() * 12 + focus.getMonth()}
          initialMonth={focus}
          rangeStart={period?.start ?? null}
          rangeEnd={period?.end ?? null}
          onPick={(date) => calendarRef.current?.getApi().gotoDate(date)}
        />
      </Sidebar>
      <main className="main">
        {warnings.length > 0 && <div className="warning">Could not load: {warnings.map((w) => w.name).join(', ')}</div>}
        {accounts.length === 0 && <p className="muted">No accounts yet — use “+ Add Google account” to connect one.</p>}
        <div className="calendar">
          <FullCalendar
            ref={calendarRef}
            plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
            initialView="timeGridWeek"
            headerToolbar={{ left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek,timeGridDay' }}
            height="100%"
            nowIndicator
            displayEventTime={false}
            selectable
            selectMirror
            events={fetchEvents}
            select={onSelect}
            datesSet={onDatesSet}
            eventClick={onEventClick}
            eventMouseEnter={onEventMouseEnter}
            eventMouseLeave={hideHover}
            eventDragStart={hideHover}
            eventResizeStart={hideHover}
            eventDrop={onTimeChange}
            eventResize={onTimeChange}
          />
        </div>
      </main>
      {hover && !dialog && <EventHoverCard {...hover} />}
      {dialog && <EventDialog state={dialog} calendars={writable} onClose={() => setDialog(null)} onChanged={refetch} />}
    </div>
  );
}
