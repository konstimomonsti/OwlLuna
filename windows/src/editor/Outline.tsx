// Outline and bookmarks: the bookmarked pages, and for a notebook made from a PDF, the PDF's own outline.

import { Bookmark, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { backdrops } from "../canvas/backdrops";
import { plainText } from "../canvas/textLayout";
import { EmptyPlate, IconButton } from "../design/controls";
import type { Manifest, Page } from "../model/notebook";
import type { NotebookDocument } from "./document";
import { goToPage, type Session } from "./session";

export interface OutlineNode {
  title: string;
  pageID: string | null;
  children: OutlineNode[];
}

/** The first line of typed text on a page, or an empty string. */
export function firstLine(page: Page): string {
  for (const item of page.items) {
    if (item.kind !== "text") continue;
    const line = plainText(item).split("\n").find((text) => text.trim() !== "");
    if (line) return line.trim();
  }
  return "";
}

interface RawOutline {
  title: string;
  dest: string | unknown[] | null;
  items: RawOutline[];
}

async function resolveOutline(doc: NotebookDocument, file: string, raw: RawOutline[], pdf: NonNullable<Awaited<ReturnType<typeof backdrops.pdf>>>): Promise<OutlineNode[]> {
  const pageFor = (index: number): string | null => doc.manifest.pages.find((page) => page.background.kind === "pdf" && page.background.file === file && page.background.index === index)?.id ?? null;
  const walk = async (entries: RawOutline[]): Promise<OutlineNode[]> => {
    const out: OutlineNode[] = [];
    for (const entry of entries) {
      let pageID: string | null = null;
      try {
        const dest = typeof entry.dest === "string" ? await pdf.getDestination(entry.dest) : entry.dest;
        if (Array.isArray(dest) && dest[0] !== null && dest[0] !== undefined) {
          const index = typeof dest[0] === "object" ? await pdf.getPageIndex(dest[0] as Parameters<typeof pdf.getPageIndex>[0]) : Number(dest[0]);
          pageID = pageFor(index);
        }
      } catch {
        // A destination that can't be followed is shown but doesn't go anywhere.
      }
      out.push({ title: entry.title || "Untitled", pageID, children: await walk(entry.items ?? []) });
    }
    return out;
  };
  return walk(raw);
}

function Tree(props: { nodes: OutlineNode[]; depth: number; session: Session }) {
  return (
    <>
      {props.nodes.map((node, index) => (
        <div key={index}>
          <button
            type="button"
            className="outline-row"
            style={{ paddingLeft: 8 + props.depth * 14 }}
            disabled={!node.pageID}
            onClick={() => node.pageID && goToPage(props.session, node.pageID)}
            data-testid="outline-node"
          >
            <span className="truncate">{node.title}</span>
          </button>
          {node.children.length > 0 && <Tree nodes={node.children} depth={props.depth + 1} session={props.session} />}
        </div>
      ))}
    </>
  );
}

export function Outline(props: { doc: NotebookDocument; session: Session; version: number }) {
  const { doc, session } = props;
  const manifest: Manifest = doc.manifest;
  const bookmarks = manifest.pages.map((page, index) => ({ page, index })).filter((entry) => entry.page.bookmark);
  const files = useMemo(() => [...new Set(manifest.pages.flatMap((page) => (page.background.kind === "pdf" ? [page.background.file] : [])))], [manifest.pages]);
  const [tree, setTree] = useState<{ file: string; nodes: OutlineNode[] }[]>([]);

  useEffect(() => {
    let live = true;
    void (async () => {
      const found: { file: string; nodes: OutlineNode[] }[] = [];
      for (const file of files) {
        const pdf = await backdrops.pdf(doc.fs, doc.id, file);
        if (!pdf) continue;
        try {
          const raw = (await pdf.getOutline()) as RawOutline[] | null;
          if (raw?.length) found.push({ file, nodes: await resolveOutline(doc, file, raw, pdf) });
        } catch {
          // A PDF without a readable outline just has none.
        }
      }
      if (live) setTree(found);
    })();
    return () => { live = false; };
  }, [doc, files]);

  return (
    <aside className="side-panel right outline-panel" data-testid="outline-panel">
      <div className="side-head">
        <h3 className="display grow" style={{ fontSize: 16 }}>Outline</h3>
        <IconButton label="Close" onClick={() => session.setState({ panel: null })} testid="outline-close"><X /></IconButton>
      </div>
      <div className="side-body">
        {tree.length > 0 && (
          <div className="outline-section">
            <span className="label">Contents</span>
            {tree.map((entry) => <Tree key={entry.file} nodes={entry.nodes} depth={0} session={session} />)}
          </div>
        )}
        <div className="outline-section">
          <span className="label">Bookmarks</span>
          {bookmarks.length === 0 ? (
            <EmptyPlate icon={<Bookmark />} title="No bookmarks">Press Ctrl+B on a page to mark it.</EmptyPlate>
          ) : bookmarks.map(({ page, index }) => (
            <button key={page.id} type="button" className="outline-row bookmark" onClick={() => goToPage(session, page.id)} data-testid="outline-bookmark">
              <Bookmark />
              <span className="outline-number">{index + 1}</span>
              <span className="truncate grow">{firstLine(page) || (page.date ?? "")}</span>
              {page.date && firstLine(page) && <span className="meta">{page.date}</span>}
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}
