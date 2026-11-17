// Day keys: "2026-10-03" in the user's own calendar, as activity.json and flashcards keep them.

import { locale as activeLocale } from "../i18n";

export function dayKey(date: Date = new Date()): string {
  const y = date.getFullYear(), m = date.getMonth() + 1, d = date.getDate();
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Local midnight of a day key, or null when it can't be read. */
export function dateOfKey(key: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return null;
  const year = +match[1], month = +match[2], day = +match[3];
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

export function addDays(date: Date, days: number): Date {
  const copy = new Date(date.getFullYear(), date.getMonth(), date.getDate() + days, date.getHours(), date.getMinutes(), date.getSeconds());
  return copy;
}

/** Whole days from one key to another, counted on the calendar so a clock change doesn't lose one. */
export function daysBetween(fromKey: string, toKey: string): number | null {
  const a = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fromKey), b = /^(\d{4})-(\d{2})-(\d{2})$/.exec(toKey);
  if (!a || !b) return null;
  const from = Date.UTC(+a[1], +a[2] - 1, +a[3]), to = Date.UTC(+b[1], +b[2] - 1, +b[3]);
  return Math.round((to - from) / 86_400_000);
}

/** The Monday-first week holding `date`, as seven day keys. */
export function weekOf(date: Date = new Date(), firstDay = 1): string[] {
  const offset = (date.getDay() - firstDay + 7) % 7;
  const start = addDays(date, -offset);
  return Array.from({ length: 7 }, (_, index) => dayKey(addDays(start, index)));
}

export function longDate(date: Date, locale: string = activeLocale()): string {
  return date.toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

export function shortDate(date: Date, locale: string = activeLocale()): string {
  return date.toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" });
}
