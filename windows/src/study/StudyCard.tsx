// On All Notebooks: a card that offers to study whatever is due across the unlocked notebooks.

import { Layers } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import "../design/study.css";
import { openNotebook, useApp } from "../state/app";
import { dueByNotebook, refreshSummaries, useCards } from "./cardStore";
import { dueSentence, summariseDue } from "./queue";
import { Review } from "./Review";

export function StudyCard() {
  const manifests = useApp((state) => state.manifests);
  const unlocked = useApp((state) => state.unlocked);
  const fs = useApp((state) => state.fs);
  const summaries = useCards((state) => state.summaries);
  // The notebooks are fixed when the sitting begins; grading changes what is due, but not what is being studied.
  const [reviewing, setReviewing] = useState<string[] | null>(null);

  // Each notebook's cards are read once; the store keeps them current after that.
  useEffect(() => {
    void refreshSummaries(fs, manifests, unlocked);
  }, [fs, manifests, unlocked]);

  const perNotebook = useMemo(() => dueByNotebook(manifests, unlocked, summaries), [manifests, unlocked, summaries]);
  const summary = summariseDue(perNotebook);
  const withDue = Object.keys(perNotebook).filter((id) => perNotebook[id] > 0);

  if (summary.cards === 0 && !reviewing) return null;

  return (
    <>
      {summary.cards > 0 && (
        <section className="plate study-card" data-testid="study-card" aria-label="Study">
          <div className="symbol"><Layers /></div>
          <div className="info">
            <h2>Study</h2>
            <span className="secondary" data-testid="study-summary">{dueSentence(summary)}</span>
          </div>
          <button type="button" className="btn primary" onClick={() => setReviewing(withDue)} data-testid="study-open">Study</button>
        </section>
      )}
      {reviewing && (
        <Review
          fs={fs}
          notebooks={reviewing}
          onClose={() => setReviewing(null)}
          onGoToPage={(notebook, pageID) => { setReviewing(null); void openNotebook(notebook, pageID); }}
        />
      )}
    </>
  );
}
