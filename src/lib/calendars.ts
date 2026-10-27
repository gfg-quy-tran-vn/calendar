/**
 * The calendar a new event is saved to unless the user picks another. Events saved to a calendar that is hidden in the
 * sidebar are created but never drawn, so prefer one that is shown.
 */
export function defaultCalendarId(calendars: { id: number; shown: boolean }[]): number {
  return (calendars.find((c) => c.shown) ?? calendars[0])?.id ?? 0;
}
