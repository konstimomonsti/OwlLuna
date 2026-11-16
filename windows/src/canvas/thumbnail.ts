// Pages drawn off screen: thumbnails for the navigator and the library, and the canvas the exports build on.

import type { NotebookDocument } from "../editor/document";
import { fnv1a } from "../model/ids";
import type { Stroke } from "../model/ink";
import type { Manifest, Page } from "../model/notebook";
import type { FS } from "../platform/fs";
import { loadInk } from "../storage/package";
import { backdrops } from "./backdrops";
import { pageRegion } from "./board";
import { drawItems, drawMarks } from "./renderItems";
import { drawPaper, drawStrokes, pageIsDark } from "./renderPage";

const MAX_PIXELS = 4096 * 4096;

export { pageRegion };
export async function renderPageToCanvas(
  fs: FS, notebookID: string, page: Page, strokes: Stroke[], scale: number,
  options: { items?: boolean; background?: boolean; manifest?: Pick<Manifest, "pages"> } = {},
): Promise<HTMLCanvasElement> {
  const region = pageRegion(page, strokes);
  const fit = Math.min(scale, Math.sqrt(MAX_PIXELS / Math.max(region.w * region.h, 1)));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(region.w * fit));
  canvas.height = Math.max(1, Math.round(region.h * fit));
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  ctx.scale(canvas.width / region.w, canvas.height / region.h);
  ctx.translate(-region.x, -region.y);
  const withItems = options.items !== false;
  if (options.background !== false) {
    const backdrop = await backdrops.ready(fs, notebookID, page.background, page.size, fit);
    drawPaper(ctx, page, { visible: region, pixelsPerPoint: fit, backdrop });
  }
  if (options.background !== false) drawMarks(ctx, page);
  if (withItems) await drawItems(ctx, fs, notebookID, page, "under", undefined, options.manifest);
  drawStrokes(ctx, strokes, { darkPaper: pageIsDark(page), layer: "all", visible: region });
  if (withItems) await drawItems(ctx, fs, notebookID, page, "over", undefined, options.manifest);
  return canvas;
}

// An in-memory cache of finished thumbnails, as blob addresses. Oldest out first.

const LIMIT = 200;
const cache = new Map<string, string>();
const pending = new Map<string, Promise<string | null>>();

function remember(key: string, url: string): void {
  cache.delete(key);
  cache.set(key, url);
  while (cache.size > LIMIT) {
    const oldest = cache.keys().next().value as string;
    URL.revokeObjectURL(cache.get(oldest)!);
    cache.delete(oldest);
  }
}

export function thumbnailKey(notebookID: string, page: Page, width: number, inkVersion: number | string): string {
  const look = fnv1a(JSON.stringify([page.background, page.paperColor, page.size, page.items, page.edgeless === true]));
  return [notebookID, page.id, width, page.inkHash ?? "", look, inkVersion].join("|");
}

async function thumbnail(fs: FS, manifest: Manifest, page: Page, strokes: () => Promise<Stroke[]>, width: number, version: number | string): Promise<string | null> {
  const key = thumbnailKey(manifest.id, page, width, version);
  const have = cache.get(key);
  if (have) {
    remember(key, have);
    return have;
  }
  let work = pending.get(key);
  if (!work) {
    work = (async () => {
      try {
        const ink = await strokes();
        const region = pageRegion(page, ink);
        const canvas = await renderPageToCanvas(fs, manifest.id, page, ink, width / region.w, { manifest });
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
        if (!blob) return null;
        const url = URL.createObjectURL(blob);
        remember(key, url);
        return url;
      } catch {
        return null;
      } finally {
        pending.delete(key);
      }
    })();
    pending.set(key, work);
  }
  return work;
}

/** A thumbnail of a page of an open notebook, `width` pixels wide. It is made again when the page's ink or look changes. */
export async function pageThumbnailURL(
  doc: { fs: FS; id: string; manifest: Manifest; ensureInk(pageID: string): Promise<Stroke[]> } | NotebookDocument,
  pageID: string,
  width: number,
): Promise<string | null> {
  const page = doc.manifest.pages.find((candidate) => candidate.id === pageID);
  if (!page) return null;
  // The ink is waited for first, so its version in the key is the loaded one.
  await doc.ensureInk(pageID);
  const version = "inkVersion" in doc ? (doc as NotebookDocument).inkVersion(pageID) : 0;
  return thumbnail(doc.fs, doc.manifest, page, () => doc.ensureInk(pageID), width, version);
}

/** A thumbnail for a notebook that is not open: its ink is read from disk. */
export async function manifestThumbnailURL(fs: FS, manifest: Manifest, pageID: string, width: number): Promise<string | null> {
  const page = manifest.pages.find((candidate) => candidate.id === pageID);
  if (!page) return null;
  return thumbnail(fs, manifest, page, () => loadInk(fs, manifest.id, pageID), width, "disk");
}
