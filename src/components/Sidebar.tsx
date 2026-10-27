'use client';

import { removeAccount, setCalendarShown } from './api';

export type CalendarView = { id: number; name: string; color: string; shown: boolean; canWrite: boolean };
export type AccountView = { id: number; email: string; needsReauth: boolean; calendars: CalendarView[] };

type Props = { accounts: AccountView[]; onChange: () => void };

export function Sidebar({ accounts, onChange }: Props) {
  async function toggle(c: CalendarView) {
    await setCalendarShown(c.id, !c.shown);
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
                <label>
                  <input type="checkbox" checked={c.shown} onChange={() => toggle(c)} />
                  <span className="swatch" style={{ background: c.color }} />
                  <span>{c.name}</span>
                  {!c.canWrite && <span className="muted"> · read-only</span>}
                </label>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <a className="add-account" href="/api/auth/start">+ Add Google account</a>
    </aside>
  );
}
