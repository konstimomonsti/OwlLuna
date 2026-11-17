// Find in Notebook: a bar under the editor bar. The matches are marked on the page and the view goes to each in turn.

import { ChevronDown, ChevronUp, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { IconButton, SearchField } from "../design/controls";
import { loadWords, type PageWords } from "../storage/package";
import type { NotebookDocument } from "./document";
import { findInNotebook } from "./find";
import { goToPage, type Session } from "./session";
import { t } from "../i18n";

export function FindPanel(props: { doc: NotebookDocument; session: Session; version: number; active: boolean }) {
  const { doc, session } = props;
  const [query, setQuery] = useState("");
  const [at, setAt] = useState(0);
  const fresh = useRef(false);
  const [words, setWords] = useState<PageWords["pages"]>({});

  useEffect(() => {
    let live = true;
    void loadWords(doc.fs, doc.id).then((loaded) => { if (live) setWords(loaded.pages); }).catch(() => {});
    return () => { live = false; };
  }, [doc]);

  // `props.version` is the document's, so a match list follows edits made while the bar is open.
  const matches = useMemo(() => findInNotebook(query, doc.manifest.pages, words), [query, words, props.version, doc]);
  const index = matches.length ? Math.min(at, matches.length - 1) : 0;

  // Mark what is found; the current match is outlined darker.
  useEffect(() => {
    const marks = new Map<string, { pageID: string; rects: [number, number, number, number][]; current: boolean }>();
    matches.forEach((match, number) => {
      if (!match.rect) return;
      const key = `${match.pageID}${number === index ? "*" : ""}`;
      const entry = marks.get(key) ?? { pageID: match.pageID, rects: [], current: number === index };
      entry.rects.push([match.rect.x, match.rect.y, match.rect.w, match.rect.h]);
      marks.set(key, entry);
    });
    session.setState({ findMarks: [...marks.values()] });
  }, [matches, index, session]);

  useEffect(() => () => session.setState({ findMarks: [] }), [session]);

  // A new query goes to its first match at once; Enter then steps on.
  useEffect(() => {
    if (fresh.current && matches.length) {
      fresh.current = false;
      show(0);
    }
  }, [matches]);

  const show = (to: number) => {
    if (!matches.length) return;
    const next = (to + matches.length) % matches.length;
    setAt(next);
    const match = matches[next];
    goToPage(session, match.pageID, match.rect);
  };

  // Ctrl+G and Ctrl+Shift+G step through the matches from anywhere in the editor.
  useEffect(() => {
    if (!props.active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "g" || document.querySelector(".scrim")) return;
      event.preventDefault();
      show(index + (event.shiftKey ? -1 : 1));
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const close = () => session.setState({ panel: null });

  return (
    <div className="find-bar" data-testid="find-panel" onKeyDownCapture={(event) => { if (event.key === "Escape") { event.stopPropagation(); close(); } }}>
      <SearchField
        value={query}
        onChange={(value) => { fresh.current = true; setQuery(value); setAt(0); }}
        placeholder={t("Find in notebook")}
        autoFocus
        onEnter={(shift) => {
          if (matches.length) show(index + (shift ? -1 : 1));
        }}
        testid="find-field"
      />
      <span className="meta find-count" data-testid="find-count">
        {query.trim() === "" ? "" : matches.length ? t("{index} of {total}", { index: index + 1, total: matches.length }) : t("No matches")}
      </span>
      <IconButton label={t("Previous (Shift+Enter)")} onClick={() => show(index - 1)} disabled={!matches.length} testid="find-prev"><ChevronUp /></IconButton>
      <IconButton label={t("Next (Enter)")} onClick={() => show(index + 1)} disabled={!matches.length} testid="find-next"><ChevronDown /></IconButton>
      <IconButton label={t("Close")} onClick={close} testid="find-close"><X /></IconButton>
    </div>
  );
}
