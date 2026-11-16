// Pages copied in the navigator. Held inside the app, not on the system clipboard: a page is its JSON, its ink and the
// files it refers to, which only another notebook of this library can use.

import { uuid } from "../model/ids";
import type { Stroke } from "../model/ink";
import { duplicatedPage, type Background, type Page } from "../model/notebook";
import { addAsset, assetPath } from "../storage/package";
import { extensionOf } from "./actions";
import type { NotebookDocument } from "./document";

interface HeldPages {
  notebook: string;
  pages: { page: Page; strokes: Stroke[] }[];
}

let held: HeldPages | null = null;

export function hasHeldPages(): boolean {
  return held !== null && held.pages.length > 0;
}

/** Takes the pages, in notebook order, with their ink as it is now. */
export async function copyPages(doc: NotebookDocument, ids: string[]): Promise<number> {
  const wanted = new Set(ids);
  const pages: HeldPages["pages"] = [];
  for (const page of doc.manifest.pages) {
    if (!wanted.has(page.id)) continue;
    const strokes = await doc.ensureInk(page.id);
    pages.push({ page: structuredClone(page), strokes: strokes.map((stroke) => ({ ...stroke })) });
  }
  held = pages.length ? { notebook: doc.id, pages } : null;
  return pages.length;
}

/** Puts the held pages in after `afterID` (or at the end). Files they use are copied into a different notebook. Returns the new pages. */
export async function pastePages(doc: NotebookDocument, afterID: string | null): Promise<Page[]> {
  if (!held) return [];
  const { notebook, pages } = held;
  const copied = new Map<string, string>();
  const bring = async (file: string): Promise<string> => {
    if (notebook === doc.id) return file;
    const have = copied.get(file);
    if (have) return have;
    const data = await doc.fs.read(assetPath(notebook, file));
    if (!data) return file;
    const made = await addAsset(doc.fs, doc.id, data, extensionOf(file) || "bin");
    copied.set(file, made);
    return made;
  };
  const made: Page[] = [];
  const inks = new Map<string, Stroke[]>();
  for (const { page, strokes } of pages) {
    const fresh = duplicatedPage(page);
    if (fresh.background.kind !== "template") fresh.background = { ...fresh.background, file: await bring(fresh.background.file) } as Background;
    for (const item of fresh.items) if (item.kind === "image") item.file = await bring(item.file);
    // A whiteboard's page stays edgeless only in a whiteboard.
    if (fresh.edgeless && doc.manifest.kind !== "whiteboard") delete fresh.edgeless;
    made.push(fresh);
    inks.set(fresh.id, strokes.map((stroke) => ({ ...stroke, id: uuid() })));
  }
  const at = afterID ? doc.pageIndex(afterID) + 1 : doc.manifest.pages.length;
  doc.insertPages(at, made, inks, made.length === 1 ? "Paste Page" : "Paste Pages");
  return made;
}
