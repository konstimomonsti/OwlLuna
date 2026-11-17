// What sits above the shelf on All Notebooks: where you left off, the journal looking back, and this week.

import { Check, Lock } from "lucide-react";
import { useMemo } from "react";
import { locale, t } from "../i18n";
import { dayKey, shortDate, weekOf, dateOfKey } from "../model/days";
import { openCalendar, openNotebook, useApp } from "../state/app";
import { Cover } from "./Cover";
import { onThisDay } from "./journal";

/** Short weekday names in the active language, Monday first. */
function weekdayLetters(): string[] {
  return Array.from({ length: 7 }, (_, index) => new Date(2024, 0, 1 + index).toLocaleDateString(locale(), { weekday: "short" }));
}

export function Glance() {
  const manifests = useApp((state) => state.manifests);
  const lastOpened = useApp((state) => state.settings.lastOpened);
  const writingHistory = useApp((state) => state.settings.writingHistory);
  const activity = useApp((state) => state.activity);

  const last = lastOpened ? manifests[lastOpened] : undefined;
  // A locked notebook is never offered here: its title and cover stay out of sight until it is opened.
  const resume = last && last.trashedAt === null && !last.locked ? last : undefined;
  const journal = useMemo(() => Object.values(manifests).find((manifest) => manifest.journal && manifest.trashedAt === null), [manifests]);
  const memories = useMemo(() => onThisDay(journal), [journal]);
  const today = dayKey();
  const week = weekOf(new Date());

  if (!resume && memories.length === 0 && !writingHistory) return null;

  const pageIndex = resume ? Math.max(0, resume.pages.findIndex((page) => page.id === resume.lastPage)) : 0;

  return (
    <div className="glance" data-testid="glance">
      {resume ? (
        <section className="plate continue-card" data-testid="continue-card" aria-label={t("Continue writing")}>
          <Cover title={resume.title} cover={resume.cover} whiteboard={resume.kind === "whiteboard"} manifest={resume} />
          <div className="info">
            <span className="meta">{t("Continue writing")}</span>
            <h2 className="truncate">{resume.title}</h2>
            <span className="secondary" data-testid="continue-page">{t("Page {page} of {total}", { page: pageIndex + 1, total: resume.pages.length })}</span>
            <button type="button" className="btn primary" style={{ marginTop: 6 }} onClick={() => void openNotebook(resume.id, resume.lastPage)} data-testid="continue-open">{t("Open")}</button>
          </div>
        </section>
      ) : (
        <div />
      )}
      <div className="glance-stack">
        {memories.length > 0 && (
          <section className="plate memory-card" data-testid="on-this-day" aria-label={t("On This Day")}>
            <h2>{t("On This Day")}</h2>
            <div>
              {memories.map((memory) => {
                const date = dateOfKey(memory.date);
                return (
                  <button key={memory.page} type="button" className="memory-row" onClick={() => void openNotebook(memory.notebook, memory.page)} data-testid="memory-row">
                    <span>{memory.label}</span>
                    <span className="meta">{date ? shortDate(date) : memory.date}</span>
                  </button>
                );
              })}
            </div>
          </section>
        )}
        {writingHistory && (
          <button type="button" className="plate week-card" onClick={() => openCalendar(true)} data-testid="week-strip" aria-label={t("This week. Open the writing calendar.")}>
            <span className="display" style={{ fontSize: 17, fontWeight: 600 }}>{t("This Week")}</span>
            <span className="week-strip">
              {week.map((key, index) => {
                const wrote = (activity.days[key]?.strokes ?? 0) > 0;
                return (
                  <span key={key} className={`week-day${key === today ? " today" : ""}`} data-testid="week-day" data-wrote={wrote}>
                    <span>{weekdayLetters()[index]}</span>
                    <i className={wrote ? "wrote" : undefined} aria-label={wrote ? t("written") : t("not written")}>{wrote && <Check />}</i>
                  </span>
                );
              })}
            </span>
          </button>
        )}
      </div>
    </div>
  );
}

export function LockMark() {
  return <Lock className="lock-mark" aria-label={t("Locked")} />;
}
