'use client';

import { useEffect, useRef } from 'react';
import { removeAccount, setCalendarColor, setCalendarShown } from './api';

export type CalendarView = {
  id: number; name: string; color: string; colorOverride: string | null; shown: boolean; canWrite: boolean;
};
export type AccountView = { id: number; email: string; needsReauth: boolean; calendars: CalendarView[] };

type Props = { accounts: AccountView[]; onChange: () => void };

// React's onChange fires on every drag inside the picker; the native `change` fires once, when the picker closes.
function ColorInput({ value, onCommit }: { value: string; onCommit: (color: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handler = () => onCommit(el.value);
    el.addEventListener('change', handler);
    return () => el.removeEventListener('change', handler);
  }, [onCommit]);
  return <input ref={ref} key={value} type="color" className="swatch" defaultValue={value} title="Change color" />;
}

export function Sidebar({ accounts, onChange }: Props) {
  async function toggle(c: CalendarView) {
    await setCalendarShown(c.id, !c.shown);
    onChange();
  }

  async function recolor(c: CalendarView, color: string | null) {
    await setCalendarColor(c.id, color);
    onChange();
  }

  async function disconnect(a: AccountView) {
    if (!window.confirm(`Disconnect ${a.email}? Its events stay in Google; this only removes it from this app.`)) return;
    await removeAccount(a.id);
    onChange();
  }

  return (
    <aside className="sidebar">
      <h1>Calendars</h1>
      {accounts.map((a) => (
        <section key={a.id} className="account">
          <div className="account-head">
            <span title={a.email}>{a.email}</span>
            <button className="icon" title="Disconnect account" onClick={() => disconnect(a)}>✕</button>
          </div>
          {a.needsReauth && (
            <a className="reconnect" href={`/api/auth/start?login_hint=${encodeURIComponent(a.email)}`}>
              Login expired — Reconnect
            </a>
          )}
          <ul>
            {a.calendars.map((c) => (
              <li key={c.id}>
                <ColorInput value={c.colorOverride ?? c.color} onCommit={(color) => void recolor(c, color)} />
                <label>
                  <input type="checkbox" checked={c.shown} onChange={() => toggle(c)} />
                  <span>{c.name}</span>
                </label>
                {c.colorOverride && (
                  <button className="icon" title="Use Google's color" onClick={() => void recolor(c, null)}>↺</button>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
      <a className="add-account" href="/api/auth/start">+ Add Google account</a>
    </aside>
  );
}
