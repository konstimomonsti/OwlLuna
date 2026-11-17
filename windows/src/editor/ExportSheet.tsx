// Export: one sheet for every format. Choose the format, the pages on a strip of thumbnails, and the options that format has.

import { useEffect, useMemo, useState } from "react";
import { pageThumbnailURL } from "../canvas/thumbnail";
import { notify } from "../state/app";
import { Segmented, Sheet, Slab, Thread } from "../design/controls";
import { safeFileName, saveFile } from "../platform/host";
import { exportImages } from "../services/exportImages";
import { browserHooks, exportPdf } from "../services/exportPdf";
import { exportText } from "../services/exportText";
import { recordTimelapse, recordingType } from "../services/timelapse";
import { loadWords } from "../storage/package";
import type { NotebookDocument } from "./document";
import type { Session } from "./session";
import { t, tp } from "../i18n";

export type ExportFormat = "pdf" | "png" | "text" | "markdown" | "video";

const formatNames = (): { value: ExportFormat; label: string }[] => [
  { value: "pdf", label: "PDF" }, { value: "png", label: t("Images") }, { value: "text", label: t("Text") }, { value: "markdown", label: "Markdown" }, { value: "video", label: t("Time-lapse") },
];

/** The pages from `start` to `end` (1-based, either order), as IDs. */
export function pageRange(ids: string[], start: number, end: number): string[] {
  const low = Math.min(Math.max(Math.min(start, end), 1), ids.length), high = Math.min(Math.max(Math.max(start, end), 1), ids.length);
  return ids.slice(low - 1, high);
}

function Proof(props: { doc: NotebookDocument; id: string; number: number; inside: boolean; onPick: (shift: boolean) => void }) {
  const [url, setURL] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void pageThumbnailURL(props.doc, props.id, 90).then((found) => { if (live) setURL(found); });
    return () => { live = false; };
  }, [props.doc, props.id]);
  return (
    <button
      type="button"
      className={`proof${props.inside ? " on" : ""}`}
      aria-pressed={props.inside}
      onClick={(event) => props.onPick(event.shiftKey)}
      title={t("Click to start here; Shift-click to end here")}
      data-testid="proof-page"
    >
      {url ? <img src={url} alt="" draggable={false} /> : <div className="proof-blank" />}
      <span>{props.number}</span>
    </button>
  );
}

export function ExportSheet(props: { doc: NotebookDocument; session: Session; onClose: () => void }) {
  const { doc, session } = props;
  const ids = doc.manifest.pages.map((page) => page.id);
  const current = Math.max(doc.pageIndex(session.getState().currentPage), 0) + 1;
  const [format, setFormat] = useState<ExportFormat>("pdf");
  const [start, setStart] = useState(1);
  const [end, setEnd] = useState(ids.length);
  const [templates, setTemplates] = useState(true);
  const [searchable, setSearchable] = useState(true);
  const [flatten, setFlatten] = useState(true);
  const [scale, setScale] = useState<"1" | "2" | "3">("2");
  const [words, setWords] = useState<Record<string, { text: string }>>({});
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void loadWords(doc.fs, doc.id).then((loaded) => { if (live) setWords(loaded.pages); }).catch(() => {});
    return () => { live = false; };
  }, [doc]);

  const handwriting = useMemo(() => doc.manifest.pages.some((page) => page.background.kind !== "pdf" && words[page.id]?.text), [doc, words]);
  const video = format === "video";
  const chosen = video ? [ids[Math.min(Math.max(start, 1), ids.length) - 1]] : pageRange(ids, start, end);
  const busy = progress !== null;
  const canRecord = recordingType() !== null;

  const run = async () => {
    setError(null);
    setProgress(0);
    const title = safeFileName(doc.manifest.title);
    const source = { fs: doc.fs, id: doc.id, manifest: doc.manifest, ensureInk: (id: string) => doc.ensureInk(id) };
    try {
      let saved = false;
      if (format === "pdf") {
        const bytes = await exportPdf(source, {
          pageIDs: chosen, templates, searchable: searchable && handwriting, flattenTape: flatten, words, hooks: browserHooks(),
          onProgress: (done, total) => setProgress(done / total),
        });
        saved = await saveFile(`${title}.pdf`, bytes, { name: "PDF", extensions: ["pdf"] });
      } else if (format === "png") {
        const made = await exportImages(source, chosen, Number(scale), (done, total) => setProgress(done / total));
        saved = await saveFile(made.name, made.data, made.mime === "application/zip" ? { name: "Zip", extensions: ["zip"] } : { name: "PNG", extensions: ["png"] });
      } else if (format === "video") {
        const page = doc.page(chosen[0]);
        if (!page) throw new Error(t("That page is gone."));
        const bytes = await recordTimelapse(source, page, await doc.ensureInk(page.id), (fraction) => setProgress(fraction));
        saved = await saveFile(`${title} page ${start}.webm`, bytes, { name: "WebM video", extensions: ["webm"] });
      } else {
        const text = exportText(doc.manifest, chosen, { markdown: format === "markdown", words });
        saved = await saveFile(`${title}.${format === "markdown" ? "md" : "txt"}`, new TextEncoder().encode(text), format === "markdown" ? { name: "Markdown", extensions: ["md"] } : { name: "Text", extensions: ["txt"] });
      }
      if (saved) {
        notify(t("Exported."));
        props.onClose();
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t("That couldn't be exported."));
    } finally {
      setProgress(null);
    }
  };

  return (
    <Sheet
      title={t("Export")}
      onClose={busy ? () => {} : props.onClose}
      wide
      testid="export-sheet"
      foot={
        <>
          <button type="button" className="btn" onClick={props.onClose} disabled={busy} data-testid="export-cancel">{t("Cancel")}</button>
          <button type="button" className="btn primary" onClick={() => void run()} disabled={busy || chosen.length === 0 || (video && !canRecord)} data-testid="export-go">
            {video ? t("Export Time-lapse") : tp(chosen.length, "Export {count} Page", "Export {count} Pages")}
          </button>
        </>
      }
    >
      <Segmented<ExportFormat> label={t("Format")} value={format} onChange={setFormat} options={formatNames()} />

      <div>
        <span className="label">{video ? t("Page") : t("Pages")}</span>
        <div className="proof-strip" data-testid="proof-strip">
          {doc.manifest.pages.map((page, index) => (
            <Proof
              key={page.id}
              doc={doc}
              id={page.id}
              number={index + 1}
              inside={video ? index + 1 === start : index + 1 >= Math.min(start, end) && index + 1 <= Math.max(start, end)}
              onPick={(shift) => { if (shift && !video) setEnd(index + 1); else { setStart(index + 1); if (!shift && (video || end < index + 1)) setEnd(video ? index + 1 : Math.max(end, index + 1)); } }}
            />
          ))}
        </div>
        <div className="range-row">
          <label className="meta" htmlFor="export-from">{video ? t("Page") : t("From")}</label>
          <input id="export-from" className="field range-field" type="number" min={1} max={ids.length} value={start} onChange={(event) => setStart(Math.min(Math.max(Number(event.target.value) || 1, 1), ids.length))} data-testid="export-from" />
          {!video && (
            <>
              <label className="meta" htmlFor="export-to">{t("to")}</label>
              <input id="export-to" className="field range-field" type="number" min={1} max={ids.length} value={end} onChange={(event) => setEnd(Math.min(Math.max(Number(event.target.value) || 1, 1), ids.length))} data-testid="export-to" />
            </>
          )}
          <button type="button" className="btn small" onClick={() => { setStart(current); setEnd(current); }} data-testid="export-this-page">{t("This Page")}</button>
          <button type="button" className="btn small flat" onClick={() => { setStart(1); setEnd(ids.length); }} data-testid="export-all-pages">{t("All")}</button>
        </div>
      </div>

      {format === "pdf" && (
        <div className="ledger" data-testid="export-pdf-options">
          <div className="ledger-row"><span className="grow">{t("Include paper templates")}</span><Slab checked={templates} onChange={setTemplates} label={t("Include paper templates")} /></div>
          <div className="ledger-row"><span className="grow">{t("Searchable handwriting")}{!handwriting && <span className="meta"> {t("(none recognised yet)")}</span>}</span><Slab checked={searchable && handwriting} onChange={setSearchable} label={t("Searchable handwriting")} disabled={!handwriting} /></div>
          <div className="ledger-row"><span className="grow">{t("Flatten tape")}</span><Slab checked={flatten} onChange={setFlatten} label={t("Flatten tape")} /></div>
        </div>
      )}
      {format === "png" && (
        <div>
          <span className="label">{t("Scale")}</span>
          <Segmented<"1" | "2" | "3"> label={t("Scale")} value={scale} onChange={setScale} options={[{ value: "1", label: "1x" }, { value: "2", label: "2x" }, { value: "3", label: "3x" }]} />
          {chosen.length > 1 && <p className="meta" style={{ marginTop: 8 }}>{t("The pictures are saved together in a zip.")}</p>}
        </div>
      )}
      {video && !canRecord && <p className="field-error" role="alert">{t("This system can't record video.")}</p>}
      {busy && <Thread value={progress ?? 0} label={t("Export progress")} />}
      {error && <p className="field-error" role="alert" data-testid="export-error">{error}</p>}
    </Sheet>
  );
}
