// A sitting of review: one card at a time, front first. Space turns it over; then Again (1), Good (2) or Easy (3).

import { X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { IconButton, Thread } from "../design/controls";
import "../design/study.css";
import { intervalAfter, type CardGrade } from "../model/flashcard";
import type { FS } from "../platform/fs";
import { CardFace } from "./CardFace";
import { ensureCards, gradeCard, sittingKeys, useCards } from "./cardStore";
import { answer, currentKey, intervalLabel, isFinished, progress, splitKey, startQueue, studiedCount, type Queue } from "./queue";

export function Review(props: {
  fs: FS;
  notebooks: string[];
  /** Study every card, not only those due. */
  all?: boolean;
  onClose: () => void;
  onGoToPage?: (notebook: string, pageID: string) => void;
}) {
  const { fs, notebooks } = props;
  const [queue, setQueue] = useState<Queue | null>(null);
  const [turned, setTurned] = useState(false);
  const cards = useCards((state) => state.cards);

  useEffect(() => {
    let live = true;
    void Promise.all(notebooks.map((notebook) => ensureCards(fs, notebook))).then(() => {
      if (live) setQueue(startQueue(sittingKeys(notebooks, props.all === true)));
    }).catch(() => { if (live) setQueue(startQueue([])); });
    return () => { live = false; };
  }, [fs, notebooks.join("|"), props.all]);

  const key = queue ? currentKey(queue) : undefined;
  const target = key ? splitKey(key) : null;
  const card = target ? cards[target.notebook]?.find((candidate) => candidate.id === target.cardID) : undefined;

  const grade = async (choice: CardGrade) => {
    if (!queue || !target || !turned) return;
    setTurned(false);
    setQueue(answer(queue, choice));
    await gradeCard(fs, target.notebook, target.cardID, choice);
  };

  const finished = queue !== null && isFinished(queue);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        props.onClose();
        return;
      }
      if (!queue || finished || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.code === "Space") {
        event.preventDefault();
        event.stopPropagation();
        if (!turned) setTurned(true);
        else void grade("good");
      } else if (turned && (event.key === "1" || event.key === "2" || event.key === "3")) {
        event.stopPropagation();
        void grade(event.key === "1" ? "again" : event.key === "2" ? "good" : "easy");
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  const when = useMemo(() => {
    if (!card) return null;
    const now = new Date();
    return {
      again: intervalLabel(intervalAfter("again", card, now)),
      good: intervalLabel(intervalAfter("good", card, now)),
      easy: intervalLabel(intervalAfter("easy", card, now)),
    };
  }, [card]);

  return createPortal(
    <div className="scrim dim" style={{ zIndex: 960 }}>
      <div className="review" role="dialog" aria-modal="true" aria-label="Review" data-testid="review">
        <div className="review-top">
          <Thread value={queue ? progress(queue) : 0} label="Cards remembered" />
          <span className="meta" data-testid="review-progress">{queue ? `${studiedCount(queue)} / ${queue.total}` : ""}</span>
          <IconButton label="Leave (Esc)" onClick={props.onClose} testid="review-close"><X /></IconButton>
        </div>

        {queue === null && <p className="secondary">Opening the cards…</p>}

        {queue !== null && queue.total === 0 && (
          <div className="review-summary" data-testid="review-empty">
            <h2>Nothing to study</h2>
            <p className="secondary">No cards are due today.</p>
            <button type="button" className="btn primary" onClick={props.onClose} data-testid="review-done">Done</button>
          </div>
        )}

        {finished && queue.total > 0 && (
          <div className="review-summary" data-testid="review-summary">
            <h2>Finished</h2>
            <p>
              You studied {queue.total === 1 ? "1 card" : `${queue.total} cards`}
              {queue.again > 0 ? `, and ${queue.again === 1 ? "1 answer was" : `${queue.again} answers were`} Again.` : "."}
            </p>
            <button type="button" className="btn primary" onClick={props.onClose} data-testid="review-done">Done</button>
          </div>
        )}

        {card && target && !finished && (
          <>
            <div className="index-card review-card" data-testid="review-card" data-card={card.id}>
              <CardFace fs={fs} notebook={target.notebook} side={card.front} empty="(empty)" />
              {turned && <div className="rule" />}
              {turned && (
                <div data-testid="review-back" style={{ display: "flex", flexDirection: "column", gap: "var(--x3)" }}>
                  <CardFace fs={fs} notebook={target.notebook} side={card.back} empty="(empty)" />
                </div>
              )}
            </div>
            <div className="review-actions">
              {card.pageID && props.onGoToPage && (
                <button type="button" className="btn flat small" onClick={() => props.onGoToPage!(target.notebook, card.pageID!)} data-testid="review-go-to-page">Go to Page</button>
              )}
              <div className="grow" />
            </div>
            {!turned ? (
              <button type="button" className="btn primary" style={{ minHeight: 46 }} onClick={() => setTurned(true)} data-testid="show-answer">Show Answer</button>
            ) : (
              <div className="grades">
                <div className="grade">
                  <button type="button" className="btn" onClick={() => void grade("again")} data-testid="grade-again">Again</button>
                  <span className="when" data-testid="when-again">{when?.again}</span>
                </div>
                <div className="grade">
                  <button type="button" className="btn primary" onClick={() => void grade("good")} data-testid="grade-good">Good</button>
                  <span className="when" data-testid="when-good">{when?.good}</span>
                </div>
                <div className="grade">
                  <button type="button" className="btn" onClick={() => void grade("easy")} data-testid="grade-easy">Easy</button>
                  <span className="when" data-testid="when-easy">{when?.easy}</span>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
