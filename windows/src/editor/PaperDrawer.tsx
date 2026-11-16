// The paper drawer: templates, colours and sizes, applied to this page, every page, or the pages still to come.
// Also the notebook's own paper: a picture or a PDF page kept to write on.

import { FilePlus2, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import { openPdf } from "../canvas/backdrops";
import { drawOps } from "../canvas/renderPage";
import { templateOps } from "../canvas/templates";
import { renderPageToCanvas } from "../canvas/thumbnail";
import { confirm, IconButton, Segmented } from "../design/controls";
import { uuid } from "../model/ids";
import { newPage, type Manifest, type NotebookPaper, type Page } from "../model/notebook";
import {
  familyNames, familyTemplates, pageSizeNames, pageSizePoints, pageSizes, paperColorNames, paperColors, paperCSS, paperFamilies, templateNames,
  type PageSize, type PaperColor, type PaperTemplate,
} from "../model/paper";
import { pickFiles } from "../platform/host";
import { notify } from "../state/app";
import { addAsset } from "../storage/package";
import { extensionOf, pictureSize } from "./actions";
import type { NotebookDocument } from "./document";
import type { Session } from "./session";

type Scope = "page" | "all" | "new";

const PREVIEW = { w: 62, h: 80 };

function TemplatePreview(props: { template: PaperTemplate; color: PaperColor }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const element = canvas.current;
    const ctx = element?.getContext("2d");
    if (!element || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    element.width = PREVIEW.w * dpr;
    element.height = PREVIEW.h * dpr;
    const size = pageSizePoints.letter;
    ctx.setTransform((PREVIEW.w * dpr) / size.w, 0, 0, (PREVIEW.h * dpr) / size.h, 0, 0);
    ctx.fillStyle = paperCSS(props.color);
    ctx.fillRect(0, 0, size.w, size.h);
    drawOps(ctx, templateOps(props.template, props.color, size));
  }, [props.template, props.color]);
  return <canvas ref={canvas} style={{ width: PREVIEW.w, height: PREVIEW.h, display: "block" }} />;
}

/** A page made only to show a kept paper. */
function paperPage(paper: NotebookPaper): Page {
  return newPage({ template: "blank", paperColor: "white", pageSize: "letter" }, { background: paper.background, size: { ...paper.size } });
}

function PaperThumb(props: { doc: NotebookDocument; paper: NotebookPaper }) {
  const [url, setURL] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void renderPageToCanvas(props.doc.fs, props.doc.id, paperPage(props.paper), [], PREVIEW.w / props.paper.size.w, { items: false })
      .then((canvas) => { if (live) setURL(canvas.toDataURL("image/jpeg", 0.8)); })
      .catch(() => {});
    return () => { live = false; };
  }, [props.doc, props.paper]);
  return url ? <img src={url} alt="" style={{ width: PREVIEW.w, display: "block" }} /> : <div style={{ width: PREVIEW.w, height: PREVIEW.h, background: "#fff" }} />;
}

/** Which pages an apply touches: edgeless pages are left to the whiteboard's own menu. */
function targets(manifest: Manifest, current: string, scope: Scope): Page[] {
  if (scope === "new") return [];
  return manifest.pages.filter((page) => !page.edgeless && (scope === "all" || page.id === current));
}

export function PaperDrawer(props: { doc: NotebookDocument; session: Session; version: number }) {
  const { doc, session } = props;
  const state = useStore(session);
  const [scope, setScope] = useState<Scope>("page");
  const page = doc.page(state.currentPage) ?? doc.manifest.pages[0];
  const defaults = doc.manifest.defaults;
  const papers = doc.manifest.papers ?? [];
  const template = page.background.kind === "template" ? page.background.template : null;
  const shownTemplate = scope === "new" ? defaults.template : template;
  const shownColor = scope === "new" ? defaults.paperColor : page.paperColor;
  const shownSize = scope === "new" ? defaults.pageSize : (Object.keys(pageSizePoints) as PageSize[]).find((size) => Math.abs(pageSizePoints[size].w - page.size.w) < 1 && Math.abs(pageSizePoints[size].h - page.size.h) < 1) ?? null;

  const replaces = (pages: Page[]) => pages.filter((candidate) => candidate.background.kind !== "template").length;
  const sureAboutBackdrops = async (pages: Page[]): Promise<boolean> => {
    const count = replaces(pages);
    if (!count) return true;
    return confirm({
      title: count === 1 ? "Replace this page's PDF or picture?" : `Replace ${count} PDF or picture pages?`,
      message: "The paper goes, but the writing and items stay. You can undo this.",
      confirm: "Replace",
      destructive: true,
    });
  };

  const chooseTemplate = async (next: PaperTemplate) => {
    if (scope === "new") {
      doc.transact("Change New Page Paper", (draft) => { draft.manifest.defaults = { ...draft.manifest.defaults, template: next }; });
      return;
    }
    const pages = targets(doc.manifest, page.id, scope);
    if (!(await sureAboutBackdrops(pages))) return;
    const ids = new Set(pages.map((candidate) => candidate.id));
    doc.transact("Change Paper", (draft) => {
      for (const target of draft.manifest.pages) if (ids.has(target.id)) target.background = { kind: "template", template: next };
    });
  };

  const chooseColor = (next: PaperColor) => {
    if (scope === "new") {
      doc.transact("Change New Page Paper", (draft) => { draft.manifest.defaults = { ...draft.manifest.defaults, paperColor: next }; });
      return;
    }
    // A PDF or picture has its own colours; only template pages take the new one.
    const ids = new Set(targets(doc.manifest, page.id, scope).filter((candidate) => candidate.background.kind === "template").map((candidate) => candidate.id));
    doc.transact("Change Paper", (draft) => {
      for (const target of draft.manifest.pages) if (ids.has(target.id)) target.paperColor = next;
    });
  };

  const chooseSize = (next: PageSize) => {
    if (scope === "new") {
      doc.transact("Change New Page Size", (draft) => { draft.manifest.defaults = { ...draft.manifest.defaults, pageSize: next }; });
      return;
    }
    const ids = new Set(targets(doc.manifest, page.id, scope).map((candidate) => candidate.id));
    // Content keeps its place on the page; the page grows or shrinks from its top left.
    doc.transact("Change Page Size", (draft) => {
      for (const target of draft.manifest.pages) if (ids.has(target.id)) target.size = { ...pageSizePoints[next] };
    });
  };

  const usePaper = async (paper: NotebookPaper) => {
    if (scope === "new") {
      notify("Your own paper is applied to pages that already exist.");
      return;
    }
    const pages = targets(doc.manifest, page.id, scope);
    const ids = new Set(pages.map((candidate) => candidate.id));
    doc.transact("Change Paper", (draft) => {
      for (const target of draft.manifest.pages) {
        if (!ids.has(target.id)) continue;
        target.background = structuredClone(paper.background);
        target.size = { ...paper.size };
      }
    });
  };

  const addPaper = async () => {
    const [file] = await pickFiles([{ name: "Pictures and PDFs", extensions: ["png", "jpg", "jpeg", "webp", "pdf"] }], false);
    if (!file) return;
    const extension = extensionOf(file.name) || "png";
    const name = file.name.replace(/\.[^.]+$/, "") || "Paper";
    try {
      let paper: NotebookPaper;
      if (extension === "pdf") {
        const pdf = await openPdf(file.data);
        const first = await pdf.getPage(1);
        const view = first.getViewport({ scale: 1 });
        const stored = await addAsset(doc.fs, doc.id, file.data, "pdf");
        paper = { id: uuid(), name, background: { kind: "pdf", file: stored, index: 0 }, size: { w: view.width, h: view.height } };
      } else {
        const size = await pictureSize(file.data);
        if (!size) throw new Error("That picture couldn't be read.");
        const stored = await addAsset(doc.fs, doc.id, file.data, extension === "jpeg" ? "jpg" : extension);
        const scale = pageSizePoints.letter.w / size.w;
        paper = { id: uuid(), name, background: { kind: "image", file: stored }, size: { w: size.w * scale, h: size.h * scale } };
      }
      doc.transact("Add Paper", (draft) => { draft.manifest.papers = [...(draft.manifest.papers ?? []), paper]; });
    } catch (error) {
      notify(error instanceof Error ? error.message : "That paper couldn't be added.", "trouble");
    }
  };

  const removePaper = (id: string) => {
    doc.transact("Remove Paper", (draft) => { draft.manifest.papers = (draft.manifest.papers ?? []).filter((paper) => paper.id !== id); });
  };

  return (
    <aside className="side-panel right paper-drawer" data-testid="paper-drawer">
      <div className="side-head">
        <h3 className="display grow" style={{ fontSize: 16 }}>Paper</h3>
        <IconButton label="Close" onClick={() => session.setState({ panel: null })} testid="paper-close"><X /></IconButton>
      </div>
      <div className="side-body drawer-body">
        <div>
          <span className="label">Apply To</span>
          <Segmented<Scope>
            label="Apply to"
            value={scope}
            onChange={setScope}
            options={[{ value: "page", label: "This Page" }, { value: "all", label: "All Pages" }, { value: "new", label: "New Pages" }]}
          />
        </div>

        {paperFamilies.map((family) => (
          <div key={family}>
            <span className="label">{familyNames[family]}</span>
            <div className="paper-grid">
              {familyTemplates[family].map((name) => (
                <button
                  key={name}
                  type="button"
                  className={`paper-choice${shownTemplate === name ? " on" : ""}`}
                  aria-pressed={shownTemplate === name}
                  onClick={() => void chooseTemplate(name)}
                  data-testid={`paper-template-${name}`}
                >
                  <TemplatePreview template={name} color={shownColor} />
                  <span>{templateNames[name]}</span>
                </button>
              ))}
            </div>
          </div>
        ))}

        <div>
          <span className="label">Colour</span>
          <div className="swatches">
            {paperColors.map((color) => (
              <button
                key={color}
                type="button"
                className={`swatch${shownColor === color ? " on" : ""}`}
                style={{ background: paperCSS(color) }}
                title={paperColorNames[color]}
                aria-label={paperColorNames[color]}
                aria-pressed={shownColor === color}
                onClick={() => chooseColor(color)}
                data-testid={`paper-colour-${color}`}
              />
            ))}
          </div>
        </div>

        <div>
          <span className="label">Page Size</span>
          <div className="size-list">
            {pageSizes.map((size) => (
              <button
                key={size}
                type="button"
                className={`btn small${shownSize === size ? " primary" : ""}`}
                aria-pressed={shownSize === size}
                onClick={() => chooseSize(size)}
                data-testid={`paper-size-${size}`}
              >
                {pageSizeNames[size]}
              </button>
            ))}
          </div>
        </div>

        <div>
          <span className="label">Your Own Paper</span>
          {papers.length > 0 && (
            <div className="paper-grid">
              {papers.map((paper) => (
                <div key={paper.id} className="paper-choice own" data-testid="own-paper">
                  <button type="button" className="own-face" onClick={() => void usePaper(paper)} title={`Use ${paper.name}`} data-testid="own-paper-use">
                    <PaperThumb doc={doc} paper={paper} />
                  </button>
                  <span className="truncate">{paper.name}</span>
                  <IconButton label={`Remove ${paper.name}`} onClick={() => removePaper(paper.id)} testid="own-paper-remove"><Trash2 /></IconButton>
                </div>
              ))}
            </div>
          )}
          <button type="button" className="btn small" onClick={() => void addPaper()} data-testid="add-own-paper"><FilePlus2 /> Add From Picture or PDF…</button>
        </div>
      </div>
    </aside>
  );
}
