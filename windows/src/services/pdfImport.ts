// Bringing PDFs and pictures in as pages. A PDF is stored once as an asset and every page points at it; a picture
// page points at the picture. A notebook that can't be made whole is not left behind half made.

import type { PDFDocumentProxy } from "pdfjs-dist";
import { openPdf } from "../canvas/backdrops";
import type { NotebookDocument } from "../editor/document";
import { newManifest, newPage, type Manifest, type Page } from "../model/notebook";
import { pageSizePoints } from "../model/paper";
import type { FS } from "../platform/fs";
import { addAsset, deletePackage, saveManifest } from "../storage/package";
import { refreshWords } from "./words";
import { t } from "../i18n";

export type Progress = (done: number, total: number, what: string) => void;

export interface PickedFileLike {
  name: string;
  data: Uint8Array;
}

/** The name of a file without its folder or extension, for a title. */
export function titleOfFile(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  return base.replace(/\.[^.]+$/, "").trim() || t("Untitled");
}

export function extensionOfName(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

export function isPdfName(name: string): boolean {
  return extensionOfName(name) === "pdf";
}

export function isPictureName(name: string): boolean {
  return ["png", "jpg", "jpeg", "webp", "gif"].includes(extensionOfName(name));
}

/** pdf.js says a file needs a password with a PasswordException; anything else is a file it can't read. */
export function explainPdfError(error: unknown): Error {
  const name = (error as { name?: string } | null)?.name;
  if (name === "PasswordException") return new Error(t("This PDF is password-protected. Remove the password and try again."));
  if (name === "InvalidPDFException") return new Error(t("That file isn't a PDF, or it is damaged."));
  return new Error(error instanceof Error && error.message ? t("That PDF couldn't be read: {error}", { error: error.message }) : t("That PDF couldn't be read."));
}

/** Lets go of a PDF's memory, where this pdf.js has a way to. */
async function release(pdf: PDFDocumentProxy): Promise<void> {
  try {
    await (pdf as unknown as { destroy?: () => Promise<void> }).destroy?.();
  } catch {
    // Nothing to do about it.
  }
}

async function readPdf(data: Uint8Array): Promise<{ pdf: PDFDocumentProxy; sizes: { w: number; h: number }[] }> {
  let pdf: PDFDocumentProxy;
  try {
    pdf = await openPdf(data);
  } catch (error) {
    throw explainPdfError(error);
  }
  try {
    if (pdf.numPages < 1) throw new Error(t("That PDF has no pages."));
    const sizes: { w: number; h: number }[] = [];
    for (let index = 1; index <= pdf.numPages; index++) {
      const page = await pdf.getPage(index);
      // The viewport applies the page's rotation, so a turned page comes out the way it is shown.
      const view = page.getViewport({ scale: 1 });
      sizes.push({ w: view.width, h: view.height });
    }
    return { pdf, sizes };
  } catch (error) {
    await release(pdf);
    throw explainPdfError(error);
  }
}

const plainDefaults = { template: "blank", paperColor: "white", pageSize: "letter" } as const;

/** The pages for a PDF already stored as `file`. */
export function pdfPages(file: string, sizes: { w: number; h: number }[]): Page[] {
  return sizes.map((size, index) => newPage(plainDefaults, { background: { kind: "pdf", file, index }, size: { ...size } }));
}

/** A picture's page size: as wide as a Letter page, as high as the picture's shape makes it. */
export function picturePageSize(size: { w: number; h: number }): { w: number; h: number } {
  const w = pageSizePoints.letter.w;
  return { w, h: Math.max(w * (size.h / size.w), 1) };
}

async function measurePicture(data: Uint8Array): Promise<{ w: number; h: number } | null> {
  try {
    const bitmap = await createImageBitmap(new Blob([data.slice()]));
    const size = { w: bitmap.width, h: bitmap.height };
    bitmap.close();
    return size.w > 0 && size.h > 0 ? size : null;
  } catch {
    return null;
  }
}

/** Makes a notebook from a PDF. Rejects with a message fit to show when the file can't be used. */
export async function importPdf(fs: FS, data: Uint8Array, title: string, onProgress?: Progress): Promise<Manifest> {
  onProgress?.(0, 1, t("Reading the PDF"));
  const { pdf, sizes } = await readPdf(data);
  await release(pdf);
  const manifest = newManifest({ title: titleOfFile(title), cover: { style: "firstPage" }, pages: [] });
  let stored = false;
  try {
    const file = await addAsset(fs, manifest.id, data, "pdf");
    stored = true;
    manifest.pages = pdfPages(file, sizes);
    manifest.defaults = { ...manifest.defaults, template: "blank" };
    await saveManifest(fs, manifest);
    // Words are a convenience: a PDF without readable text is still a notebook.
    try {
      await refreshWords({ fs, id: manifest.id, manifest }, undefined, (done, total) => onProgress?.(done, total, t("Reading the text")));
    } catch {
      // Search finds it later, when the words are made again.
    }
    return manifest;
  } catch (error) {
    if (stored) await deletePackage(fs, manifest.id).catch(() => {});
    throw error instanceof Error ? error : new Error(t("That PDF couldn't be imported."));
  }
}

/** Makes a notebook whose pages are pictures. Pictures that can't be read are skipped; none readable is an error. */
export async function importPictures(fs: FS, files: PickedFileLike[], title: string, onProgress?: Progress): Promise<Manifest> {
  const manifest = newManifest({ title: titleOfFile(title), cover: { style: "firstPage" }, pages: [] });
  const pages: Page[] = [];
  try {
    for (const [index, file] of files.entries()) {
      onProgress?.(index, files.length, t("Adding pictures"));
      const size = await measurePicture(file.data);
      if (!size) continue;
      const stored = await addAsset(fs, manifest.id, file.data, extensionOfName(file.name) === "jpeg" ? "jpg" : extensionOfName(file.name) || "png");
      pages.push(newPage(plainDefaults, { background: { kind: "image", file: stored }, size: picturePageSize(size) }));
    }
    if (pages.length === 0) throw new Error(t("None of those pictures could be read."));
    manifest.pages = pages;
    await saveManifest(fs, manifest);
    onProgress?.(files.length, files.length, t("Adding pictures"));
    return manifest;
  } catch (error) {
    await deletePackage(fs, manifest.id).catch(() => {});
    throw error instanceof Error ? error : new Error(t("Those pictures couldn't be imported."));
  }
}

/** Adds a PDF's pages to an open notebook after a page, as one undoable step. Returns the new pages. */
export async function appendPdf(doc: NotebookDocument, data: Uint8Array, afterPageID: string | null, onProgress?: Progress): Promise<Page[]> {
  onProgress?.(0, 1, t("Reading the PDF"));
  const { pdf, sizes } = await readPdf(data);
  await release(pdf);
  const file = await addAsset(doc.fs, doc.id, data, "pdf");
  const pages = pdfPages(file, sizes);
  const at = afterPageID ? doc.pageIndex(afterPageID) + 1 : doc.manifest.pages.length;
  doc.insertPages(at, pages, new Map(), pages.length === 1 ? t("Add PDF Page") : t("Add PDF Pages"));
  void refreshWords(doc).catch(() => {});
  return pages;
}

/** Adds pictures to an open notebook as pages after a page, as one undoable step. */
export async function appendPictures(doc: NotebookDocument, files: PickedFileLike[], afterPageID: string | null): Promise<Page[]> {
  const pages: Page[] = [];
  for (const file of files) {
    const size = await measurePicture(file.data);
    if (!size) continue;
    const extension = extensionOfName(file.name);
    const stored = await addAsset(doc.fs, doc.id, file.data, extension === "jpeg" ? "jpg" : extension || "png");
    pages.push(newPage(doc.manifest.defaults, { background: { kind: "image", file: stored }, size: picturePageSize(size) }));
  }
  if (pages.length === 0) throw new Error(t("That picture couldn't be read."));
  const at = afterPageID ? doc.pageIndex(afterPageID) + 1 : doc.manifest.pages.length;
  doc.insertPages(at, pages, new Map(), pages.length === 1 ? t("Add Picture Page") : t("Add Picture Pages"));
  return pages;
}
