const pad = (n: number) => String(n).padStart(2, '0');

/** Add whole days to a `YYYY-MM-DD` (or ISO datetime) string; returns `YYYY-MM-DD`. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** ISO instant → value for `<input type="datetime-local">` in the browser's time zone. */
export function toLocalInput(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** `datetime-local` value (local time) → ISO instant. */
export function fromLocalInput(value: string): string {
  return new Date(value).toISOString();
}

export function localTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** The 42 days (six Sunday-first weeks, local midnights) that fill a month grid; `month` is 0–11. */
export function monthGrid(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  return Array.from({ length: 42 }, (_, i) => new Date(year, month, 1 - first.getDay() + i));
}
