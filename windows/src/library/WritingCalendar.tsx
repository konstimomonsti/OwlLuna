// The writing calendar: a month of days, the ones written marked, and the notebooks written in a chosen day.

import { BookOpen, CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { EmptyPlate, IconButton, Sheet } from "../design/controls";
import { locale, t, tp } from "../i18n";
import { addDays, dayKey, longDate } from "../model/days";
import { openCalendar, openNotebook, openSettings, updateSettings, useApp } from "../state/app";

/** Short weekday names in the active language, Monday first. */
function weekdays(): string[] {
  return Array.from({ length: 7 }, (_, index) => new Date(2024, 0, 1 + index).toLocaleDateString(locale(), { weekday: "short" }));
}

/** The 6 weeks of a month as day keys, Monday first, with the days of the neighbouring months that fill the rows. */
export function monthGrid(year: number, month: number): { key: string; inMonth: boolean; day: number }[] {
  const first = new Date(year, month, 1);
  const lead = (first.getDay() + 6) % 7;
  const start = addDays(first, -lead);
  return Array.from({ length: 42 }, (_, index) => {
    const date = addDays(start, index);
    return { key: dayKey(date), inMonth: date.getMonth() === month, day: date.getDate() };
  });
}

export function WritingCalendar() {
  const writingHistory = useApp((state) => state.settings.writingHistory);
  const activity = useApp((state) => state.activity);
  const manifests = useApp((state) => state.manifests);
  const now = new Date();
  const [shown, setShown] = useState({ year: now.getFullYear(), month: now.getMonth() });
  const [picked, setPicked] = useState<string | null>(null);
  const close = () => openCalendar(false);

  const cells = useMemo(() => monthGrid(shown.year, shown.month), [shown]);
  const today = dayKey(now);
  const monthName = new Date(shown.year, shown.month, 1).toLocaleDateString(locale(), { month: "long", year: "numeric" });

  const totals = useMemo(() => {
    let days = 0, strokes = 0;
    const books = new Set<string>();
    for (const cell of cells) {
      const day = cell.inMonth ? activity.days[cell.key] : undefined;
      if (!day || day.strokes <= 0) continue;
      days++;
      strokes += day.strokes;
      for (const id of day.notebooks) books.add(id);
    }
    return { days, strokes, books: books.size };
  }, [cells, activity]);

  const step = (by: number) => {
    const date = new Date(shown.year, shown.month + by, 1);
    setShown({ year: date.getFullYear(), month: date.getMonth() });
    setPicked(null);
  };

  if (!writingHistory) {
    return (
      <Sheet title={t("Writing Calendar")} onClose={close} testid="calendar-sheet" foot={<button type="button" className="btn" onClick={close} data-testid="calendar-close">{t("Close")}</button>}>
        <EmptyPlate icon={<CalendarDays />} title={t("Writing history is off")}>
          {t("The calendar is drawn from a small record kept on this PC of how much you wrote each day and in which notebooks. With it off, nothing is recorded and nothing is shown.")}
        </EmptyPlate>
        <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
          <button type="button" className="btn primary" onClick={() => updateSettings({ writingHistory: true })} data-testid="calendar-turn-on">{t("Turn On")}</button>
          <button type="button" className="btn" onClick={() => { close(); openSettings(true); }} data-testid="calendar-settings">{t("Open Settings")}</button>
        </div>
      </Sheet>
    );
  }

  const day = picked ? activity.days[picked] : undefined;
  const pickedDate = picked ? new Date(+picked.slice(0, 4), +picked.slice(5, 7) - 1, +picked.slice(8, 10)) : null;

  return (
    <Sheet title={t("Writing Calendar")} onClose={close} testid="calendar-sheet" foot={<button type="button" className="btn" onClick={close} data-testid="calendar-close">{t("Close")}</button>}>
      <div className="calendar-head">
        <h3 data-testid="calendar-month">{monthName}</h3>
        <IconButton label={t("Previous month")} onClick={() => step(-1)} testid="calendar-prev"><ChevronLeft /></IconButton>
        <IconButton label={t("Next month")} onClick={() => step(1)} testid="calendar-next"><ChevronRight /></IconButton>
      </div>
      <div className="calendar-weekdays meta">{weekdays().map((name) => <span key={name}>{name}</span>)}</div>
      <div className="calendar-grid" data-testid="calendar-grid">
        {cells.map((cell) => {
          const wrote = (activity.days[cell.key]?.strokes ?? 0) > 0;
          return (
            <button
              key={cell.key}
              type="button"
              className={`calendar-day${cell.inMonth ? "" : " other"}${wrote ? " wrote" : ""}${cell.key === today ? " today" : ""}${cell.key === picked ? " picked" : ""}`}
              aria-label={wrote ? t("{date}, written", { date: cell.key }) : cell.key}
              aria-pressed={cell.key === picked}
              onClick={() => setPicked(cell.key === picked ? null : cell.key)}
              data-testid="calendar-day"
              data-day={cell.key}
              data-wrote={wrote}
            >
              {cell.day}
            </button>
          );
        })}
      </div>
      <p className="meta" data-testid="calendar-totals">
        {totals.days === 0
          ? t("Nothing written this month")
          : [
            tp(totals.days, "{count} day written", "{count} days written"),
            tp(totals.strokes, "{count} stroke", "{count} strokes"),
            tp(totals.books, "{count} notebook", "{count} notebooks"),
          ].join(" · ")}
      </p>
      {picked && pickedDate && (
        <section data-testid="calendar-picked">
          <h3 className="display" style={{ fontSize: 16, marginBottom: 6 }}>{longDate(pickedDate)}</h3>
          {!day || day.notebooks.length === 0 ? (
            <p className="secondary">{t("Nothing was written this day.")}</p>
          ) : (
            <div className="plate day-list">
              {day.notebooks.map((id) => {
                const manifest = manifests[id];
                // A notebook that is gone is named as such, and a locked one stays unnamed.
                const name = !manifest ? t("A notebook that is no longer here") : manifest.locked ? t("Locked notebook") : manifest.title;
                return (
                  <div key={id} className="row-line" data-testid="calendar-notebook">
                    <span className="truncate grow">{name}</span>
                    {manifest && manifest.trashedAt === null && (
                      <button type="button" className="btn small" onClick={() => { close(); void openNotebook(id); }} data-testid="calendar-open"><BookOpen /> {t("Open")}</button>
                    )}
                    {manifest && manifest.trashedAt !== null && <span className="meta">{t("Recently Deleted")}</span>}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}
    </Sheet>
  );
}
