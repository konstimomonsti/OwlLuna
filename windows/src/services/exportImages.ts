// Pages as PNG pictures: one file for one page, a zip of them for more.

import { zipSync } from "fflate";
import { renderPageToCanvas } from "../canvas/thumbnail";
import type { Stroke } from "../model/ink";
import type { Manifest } from "../model/notebook";
import type { FS } from "../platform/fs";
import { safeFileName } from "../platform/host";
import { t } from "../i18n";

export interface ImageSource {
  fs: FS;
  id: string;
  manifest: Manifest;
  ensureInk(pageID: string): Promise<Stroke[]>;
}

export interface ExportedFile {
  name: string;
  data: Uint8Array;
  mime: string;
}

/** A page's file name inside a zip or alone: the title and the page's number, padded so they sort. */
export function imageName(title: string, number: number, total: number): string {
  return `${safeFileName(title)} ${String(number).padStart(String(total).length, "0")}.png`;
}

export async function pagePNG(source: ImageSource, pageID: string, scale: number): Promise<Uint8Array> {
  const page = source.manifest.pages.find((candidate) => candidate.id === pageID);
  if (!page) throw new Error(t("That page is gone."));
  const canvas = await renderPageToCanvas(source.fs, source.id, page, await source.ensureInk(pageID), scale, { manifest: source.manifest });
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error(t("A page couldn't be drawn as a picture."));
  return new Uint8Array(await blob.arrayBuffer());
}

/** PNGs of the pages at a scale (1 is a point to a pixel). One page is a PNG; several come zipped. */
export async function exportImages(source: ImageSource, pageIDs: string[], scale: number, onProgress?: (done: number, total: number) => void): Promise<ExportedFile> {
  const title = source.manifest.title;
  const files: Record<string, Uint8Array> = {};
  let first: Uint8Array | null = null;
  for (const [index, id] of pageIDs.entries()) {
    const data = await pagePNG(source, id, scale);
    first ??= data;
    const number = source.manifest.pages.findIndex((page) => page.id === id) + 1;
    files[imageName(title, number, source.manifest.pages.length)] = data;
    onProgress?.(index + 1, pageIDs.length);
  }
  if (pageIDs.length === 1 && first) {
    const [name] = Object.keys(files);
    return { name, data: first, mime: "image/png" };
  }
  // PNG is already compressed: the zip just holds the files.
  return { name: `${safeFileName(title)}.zip`, data: zipSync(files, { level: 0 }), mime: "application/zip" };
}
