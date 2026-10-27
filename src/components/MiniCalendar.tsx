'use client';

import { useState } from 'react';
import { monthGrid } from '@/lib/dates';

type Props = {
  /** Month shown first; remount (change `key`) to jump elsewhere. */
  initialMonth: Date;
  /** The main calendar's visible period, highlighted here (`rangeEnd` exclusive). */
  rangeStart: Date | null;
  rangeEnd: Date | null;
  onPick: (date: Date) => void;
};

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** Small month picker for jumping the main calendar to a date. */
export function MiniCalendar({ initialMonth, rangeStart, rangeEnd, onPick }: Props) {
  const [shown, setShown] = useState({ year: initialMonth.getFullYear(), month: initialMonth.getMonth() });
  const [today] = useState(() => new Date());

  const title = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(new Date(shown.year, shown.month, 1));
  const label = new Intl.DateTimeFormat(undefined, { dateStyle: 'full' });

  function shift(delta: number) {
    const d = new Date(shown.year, shown.month + delta, 1);
    setShown({ year: d.getFullYear(), month: d.getMonth() });
  }

  return (
    <div className="mini-cal">
      <div className="mini-head">
        <button className="icon" onClick={() => shift(-1)} aria-label="Previous month" title="Previous month">‹</button>
        <span>{title}</span>
        <button className="icon" onClick={() => shift(1)} aria-label="Next month" title="Next month">›</button>
      </div>
      <div className="mini-grid">
        {WEEKDAYS.map((w, i) => (
          <span key={i} className="mini-weekday">{w}</span>
        ))}
        {monthGrid(shown.year, shown.month).map((d) => {
          const isToday = sameDay(d, today);
          const inRange = rangeStart !== null && rangeEnd !== null && d >= rangeStart && d < rangeEnd;
          const classes = ['mini-day', d.getMonth() !== shown.month && 'outside', inRange && 'in-range', isToday && 'today'];
          return (
            <button
              key={d.getTime()}
              className={classes.filter(Boolean).join(' ')}
              onClick={() => onPick(d)}
              aria-label={label.format(d)}
              aria-current={isToday ? 'date' : undefined}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}
