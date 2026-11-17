// Adding or editing a link: to a page of this notebook, to another notebook, or to a web address.

import { useEffect, useMemo, useState } from "react";
import { pageThumbnailURL } from "../canvas/thumbnail";
import { Segmented, Sheet } from "../design/controls";
import { webAddress, type LinkItem, type LinkTarget } from "../model/notebook";
import { useApp } from "../state/app";
import type { NotebookDocument } from "./document";
import { t, tp } from "../i18n";

type Tab = "page" | "notebook" | "web";

function PageChoice(props: { doc: NotebookDocument; pageID: string; number: number; chosen: boolean; onChoose: () => void }) {
  const [url, setURL] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void pageThumbnailURL(props.doc, props.pageID, 120).then((found) => { if (live) setURL(found); });
    return () => { live = false; };
  }, [props.doc, props.pageID]);
  return (
    <button type="button" className={`link-page${props.chosen ? " on" : ""}`} aria-pressed={props.chosen} onClick={props.onChoose} data-testid="link-page">
      {url ? <img src={url} alt="" draggable={false} /> : <div className="link-page-blank" />}
      <span>{props.number}</span>
    </button>
  );
}

export interface LinkSheetProps {
  doc: NotebookDocument;
  /** The link being edited, or none for a new one. */
  editing?: LinkItem | null;
  onClose: () => void;
  onSave: (target: LinkTarget, label: string) => void;
}

export function LinkSheet(props: LinkSheetProps) {
  const { doc, editing } = props;
  const manifests = useApp((state) => state.manifests);
  const first = editing?.target;
  const [tab, setTab] = useState<Tab>(first ? first.to : "page");
  const [pageID, setPageID] = useState<string>(first?.to === "page" ? first.page : doc.manifest.pages[0].id);
  const [notebookID, setNotebookID] = useState<string | null>(first?.to === "notebook" ? first.notebook : null);
  const [notebookPage, setNotebookPage] = useState<string>(first?.to === "notebook" ? first.page ?? "" : "");
  const [address, setAddress] = useState(first?.to === "web" ? first.url : "");
  const [label, setLabel] = useState(editing?.label ?? "");
  const [tried, setTried] = useState(false);

  const notebooks = useMemo(
    () => Object.values(manifests).filter((manifest) => manifest.trashedAt === null && !manifest.locked).sort((a, b) => a.title.localeCompare(b.title)),
    [manifests],
  );
  const chosen = notebookID ? manifests[notebookID] : undefined;
  const checked = webAddress(address);
  const problem = tab === "web" && (tried || address.trim() !== "") && !checked ? t("That doesn't look like a web address.") : tab === "notebook" && tried && !chosen ? t("Choose a notebook.") : null;

  const save = () => {
    setTried(true);
    if (tab === "page") return props.onSave({ to: "page", page: pageID }, label.trim());
    if (tab === "notebook") {
      if (!chosen) return;
      return props.onSave({ to: "notebook", notebook: chosen.id, page: notebookPage || undefined, name: chosen.title }, label.trim());
    }
    if (!checked) return;
    props.onSave({ to: "web", url: checked }, label.trim());
  };

  return (
    <Sheet
      title={editing ? t("Edit Link") : t("Add Link")}
      onClose={props.onClose}
      testid="link-sheet"
      foot={
        <>
          <button type="button" className="btn" onClick={props.onClose} data-testid="link-cancel">{t("Cancel")}</button>
          <button type="button" className="btn primary" onClick={save} data-testid="link-save">{editing ? t("Save") : t("Add Link")}</button>
        </>
      }
    >
      <Segmented<Tab> label={t("Link to")} value={tab} onChange={setTab} options={[{ value: "page", label: t("Page") }, { value: "notebook", label: t("Notebook") }, { value: "web", label: t("Web") }]} />

      {tab === "page" && (
        <div className="link-pages" data-testid="link-pages">
          {doc.manifest.pages.map((page, index) => (
            <PageChoice key={page.id} doc={doc} pageID={page.id} number={index + 1} chosen={page.id === pageID} onChoose={() => setPageID(page.id)} />
          ))}
        </div>
      )}

      {tab === "notebook" && (
        <>
          <div className="ledger link-notebooks" data-testid="link-notebooks">
            {notebooks.map((manifest) => (
              <button
                key={manifest.id}
                type="button"
                className={`ledger-row${manifest.id === notebookID ? " chosen" : ""}`}
                aria-pressed={manifest.id === notebookID}
                onClick={() => { setNotebookID(manifest.id); setNotebookPage(""); }}
                data-testid="link-notebook"
              >
                <span className="truncate grow">{manifest.title}</span>
                <span className="meta">{manifest.kind === "whiteboard" ? t("Whiteboard") : tp(manifest.pages.length, "{count} page", "{count} pages")}</span>
              </button>
            ))}
          </div>
          {chosen && chosen.kind !== "whiteboard" && (
            <div>
              <label className="label" htmlFor="link-notebook-page">{t("Page (optional)")}</label>
              <select id="link-notebook-page" className="field" value={notebookPage} onChange={(event) => setNotebookPage(event.target.value)} data-testid="link-notebook-page">
                <option value="">{t("Wherever it was left")}</option>
                {chosen.pages.map((page, index) => <option key={page.id} value={page.id}>{t("Page {number}", { number: index + 1 })}</option>)}
              </select>
            </div>
          )}
        </>
      )}

      {tab === "web" && (
        <div>
          <label className="label" htmlFor="link-address">{t("Web Address")}</label>
          <input
            id="link-address"
            className="field"
            autoFocus
            value={address}
            placeholder="example.com"
            onChange={(event) => setAddress(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") save(); }}
            data-testid="link-address"
          />
        </div>
      )}
      {problem && <p className="field-error" role="alert" data-testid="link-error">{problem}</p>}

      <div>
        <label className="label" htmlFor="link-label">{t("Label (optional)")}</label>
        <input id="link-label" className="field" value={label} placeholder={t("What the link says")} onChange={(event) => setLabel(event.target.value)} data-testid="link-label" />
      </div>
    </Sheet>
  );
}
