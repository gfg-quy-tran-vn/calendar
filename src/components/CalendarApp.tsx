'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import type { EventInput, EventSourceFuncArg } from '@fullcalendar/core';
import type { CalendarError, EventsResponse } from '@/lib/aggregate';
import { Sidebar, type AccountView } from './Sidebar';

export function CalendarApp() {
  const calendarRef = useRef<FullCalendar>(null);
  const [accounts, setAccounts] = useState<AccountView[]>([]);
  const [warnings, setWarnings] = useState<CalendarError[]>([]);

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

  return (
    <div className="app">
      <Sidebar
        accounts={accounts}
        onChange={() => {
          void loadAccounts();
          refetch();
        }}
      />
      <main className="main">
        {warnings.length > 0 && <div className="warning">Could not load: {warnings.map((w) => w.name).join(', ')}</div>}
        {accounts.length === 0 && <p className="muted">No accounts yet — use “+ Add Google account” to connect one.</p>}
        <div className="calendar">
          <FullCalendar
            ref={calendarRef}
            plugins={[dayGridPlugin, timeGridPlugin]}
            initialView="timeGridWeek"
            headerToolbar={{ left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek,timeGridDay' }}
            height="100%"
            nowIndicator
            events={fetchEvents}
          />
        </div>
      </main>
    </div>
  );
}
