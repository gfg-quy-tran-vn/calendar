'use client';

import type { EventApi } from '@fullcalendar/core';
import type { EventMeta } from '@/lib/events';
import { hideDomain } from '@/lib/names';
import { HtmlView } from './HtmlView';

export type HoverState = { event: EventApi; rect: DOMRect };

const WIDTH = 340;
const MAX_HEIGHT = 320;
const GAP = 6;
const MARGIN = 8;

/** Read-only preview shown while the mouse rests on an event. It ignores the mouse, so it never steals the hover. */
export function EventHoverCard({ event, rect }: HoverState) {
  const meta = event.extendedProps as EventMeta;
  const left = Math.min(Math.max(MARGIN, rect.left), window.innerWidth - WIDTH - MARGIN);
  // Below the event when there is room for a full-height card, otherwise above it.
  const below = rect.bottom + GAP + MAX_HEIGHT <= window.innerHeight;
  const position = below ? { top: rect.bottom + GAP } : { bottom: window.innerHeight - rect.top + GAP };

  return (
    <div className="hover-card" style={{ left, width: WIDTH, maxHeight: MAX_HEIGHT, borderLeftColor: event.borderColor, ...position }}>
      <div className="hover-title">{event.title}</div>
      <div className="muted">{hideDomain(meta.calendarName)}</div>
      {meta.location && <div className="hover-row">📍 {meta.location}</div>}
      {meta.description.trim() && <HtmlView html={meta.description} />}
    </div>
  );
}
