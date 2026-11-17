// Handwriting to Text: Windows reads the ink, the words can be corrected, then copied, placed beside the writing, or put in its place.

import { useEffect, useState } from "react";
import { Sheet, Thread } from "../design/controls";
import { uuid } from "../model/ids";
import { inkBounds, type Stroke } from "../model/ink";
import type { PageItem } from "../model/notebook";
import { languageTag, recogniseInk } from "../services/recognition";
import { notify, useApp } from "../state/app";
import { placeText } from "./actions";
import type { NotebookDocument } from "./document";
import { placeBelow, placeOver } from "./inkText";
import { setTool, type Session } from "./session";
import { t } from "../i18n";

export function InkTextSheet(props: { doc: NotebookDocument; session: Session; pageID: string; strokes: Stroke[]; onClose: () => void }) {
  const { doc, session, pageID, strokes } = props;
  const language = useApp((state) => state.settings.language);
  const [status, setStatus] = useState<"reading" | "ready" | "failed">("reading");
  const [text, setText] = useState("");
  const [problem, setProblem] = useState("");

  useEffect(() => {
    let live = true;
    setStatus("reading");
    recogniseInk(strokes, languageTag(language)).then(
      (result) => {
        if (!live) return;
        setText(result.text);
        setStatus("ready");
      },
      (error) => {
        if (!live) return;
        setProblem(error instanceof Error ? error.message : String(error));
        setStatus("failed");
      },
    );
    return () => { live = false; };
  }, [strokes, language]);

  const page = doc.page(pageID);
  const bounds = inkBounds(strokes);
  const usable = status === "ready" && text.trim() !== "" && page !== undefined && bounds !== null;

  const copy = () => {
    void navigator.clipboard.writeText(text).then(() => notify(t("Copied.")), () => notify(t("That couldn't be copied."), "trouble"));
  };

  const place = () => {
    if (!usable || !page || !bounds) return;
    const box = placeBelow(bounds, text, page);
    placeText(doc, session, text, { pageID, x: box.x, y: box.y });
    props.onClose();
  };

  const replace = () => {
    if (!usable || !page || !bounds) return;
    const box = placeOver(bounds, text, page);
    const item: PageItem = { id: uuid(), kind: "text", string: text, fontSize: 17, x: box.x, y: box.y, w: box.w, h: box.h, rotation: 0 };
    const gone = new Set(strokes.map((stroke) => stroke.id));
    // One step, so a single undo brings the handwriting back and takes the text away.
    doc.transact(t("Replace Handwriting"), (draft) => {
      draft.setInk(pageID, draft.ink(pageID).filter((stroke) => !gone.has(stroke.id)));
      draft.manifest.pages.find((candidate) => candidate.id === pageID)?.items.push(item);
    });
    setTool(session, { kind: "lasso" });
    session.setState({ selection: null, selectedItem: { pageID, itemID: item.id } });
    props.onClose();
  };

  return (
    <Sheet
      title={t("Handwriting to Text")}
      testid="ink-text-sheet"
      onClose={props.onClose}
      foot={
        <>
          <button type="button" className="btn flat" onClick={props.onClose} data-testid="ink-text-cancel">{t("Cancel")}</button>
          <button type="button" className="btn" disabled={!usable} onClick={copy} data-testid="ink-text-copy">{t("Copy")}</button>
          <button type="button" className="btn" disabled={!usable} onClick={place} data-testid="ink-text-place">{t("Place on Page")}</button>
          <button type="button" className="btn primary" disabled={!usable} onClick={replace} data-testid="ink-text-replace">{t("Replace Handwriting")}</button>
        </>
      }
    >
      {status === "reading" && (
        <div className="column" data-testid="ink-text-reading">
          <span className="secondary">{t("Reading the handwriting…")}</span>
          <Thread value={0.35} label={t("Reading")} />
        </div>
      )}
      {status === "failed" && <p className="field-error" role="alert" data-testid="ink-text-error">{problem}</p>}
      {status === "ready" && (
        <>
          {text.trim() === "" && <p className="secondary" data-testid="ink-text-nothing">{t("Nothing was recognised. You can type the words yourself.")}</p>}
          <textarea className="field" style={{ minHeight: 140 }} value={text} onChange={(event) => setText(event.target.value)} autoFocus data-testid="ink-text-field" />
        </>
      )}
    </Sheet>
  );
}
