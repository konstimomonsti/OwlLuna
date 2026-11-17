// The daily journal's looking back: pages from this day in earlier years, and from a week and a month ago.

import { t, tp } from "../i18n";
import { addDays, dateOfKey, dayKey } from "../model/days";
import type { Manifest } from "../model/notebook";

export interface Memory {
  notebook: string;
  page: string;
  date: string;
  label: string;
}

function monthsAgo(date: Date, months: number): string {
  const target = new Date(date.getFullYear(), date.getMonth() - months, 1);
  // A month ago from the 31st is the last day of the shorter month.
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  return dayKey(new Date(target.getFullYear(), target.getMonth(), Math.min(date.getDate(), last)));
}

/** Pages of the journal that fall on today's month and day in earlier years, or exactly a week or a month back. */
export function onThisDay(journal: Manifest | undefined, today: Date = new Date()): Memory[] {
  if (!journal || !journal.journal || journal.trashedAt !== null || journal.locked) return [];
  const week = dayKey(addDays(today, -7));
  const month = monthsAgo(today, 1);
  const out: Memory[] = [];
  for (const page of journal.pages) {
    const date = page.date ? dateOfKey(page.date) : null;
    if (!page.date || !date) continue;
    const years = today.getFullYear() - date.getFullYear();
    let label: string | null = null;
    if (years >= 1 && date.getMonth() === today.getMonth() && date.getDate() === today.getDate()) label = tp(years, "A year ago", "{count} years ago");
    else if (page.date === week) label = t("A week ago");
    else if (page.date === month) label = t("A month ago");
    if (label) out.push({ notebook: journal.id, page: page.id, date: page.date, label });
  }
  return out.sort((a, b) => (a.date < b.date ? 1 : -1));
}
