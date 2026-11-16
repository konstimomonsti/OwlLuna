// The PDF pages and pictures behind pages, read once and kept. A page asks for its backdrop and draws what is
// ready; when a sharper one arrives, everyone listening draws again.

import type { PDFDocumentProxy } from "pdfjs-dist";
import type { Background } from "../model/notebook";
import type { FS } from "../platform/fs";
import { assetPath } from "../storage/package";
import type { Picture } from "./renderPage";

let pdfjs: Promise<typeof import("pdfjs-dist")> | null = null;

/** pdf.js is large, so it is fetched the first time a PDF is met. */
export function loadPdfjs(): Promise<typeof import("pdfjs-dist")> {
  if (!pdfjs) {
    pdfjs = (async () => {
      const lib = await import("pdfjs-dist");
      const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
      lib.GlobalWorkerOptions.workerSrc = worker.default;
      return lib;
    })();
  }
  return pdfjs;
}

export async function openPdf(data: Uint8Array): Promise<PDFDocumentProxy> {
  const lib = await loadPdfjs();
  // pdf.js takes the buffer for itself, so it gets a copy.
  return lib.getDocument({ data: data.slice() }).promise;
}

const MAX_PIXELS = 4096 * 4096;
const KEEP = 24;

class Backdrops {
  private images = new Map<string, Picture | "loading" | "failed">();
  private pdfs = new Map<string, Promise<PDFDocumentProxy | null>>();
  private rendered = new Map<string, { picture: Picture; scale: number; used: number }>();
  private rendering = new Set<string>();
  private listeners = new Set<() => void>();
  private clock = 0;

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private tell(): void {
    for (const listener of [...this.listeners]) listener();
  }

  pdf(fs: FS, notebookID: string, file: string): Promise<PDFDocumentProxy | null> {
    const key = `${notebookID}/${file}`;
    let pending = this.pdfs.get(key);
    if (!pending) {
      pending = fs.read(assetPath(notebookID, file)).then((data) => (data ? openPdf(data) : null)).catch(() => null);
      this.pdfs.set(key, pending);
    }
    return pending;
  }

  private image(fs: FS, notebookID: string, file: string): Picture | null {
    const key = `${notebookID}/${file}`;
    const have = this.images.get(key);
    if (have === "loading" || have === "failed") return null;
    if (have) return have;
    this.images.set(key, "loading");
    void (async () => {
      try {
        const data = await fs.read(assetPath(notebookID, file));
        if (!data) throw new Error("missing");
        const bitmap = await createImageBitmap(new Blob([data.slice()]));
        this.images.set(key, bitmap);
      } catch {
        this.images.set(key, "failed");
      }
      this.tell();
    })();
    return null;
  }

  /** A picture kept in a notebook, for items on the page. Null until it has been read. */
  picture(fs: FS, notebookID: string, file: string): Picture | null {
    return this.image(fs, notebookID, file);
  }

  /**
   * What lies behind a page, as sharp as is ready. `scale` is the pixels a point should get; a sharper rendering
   * is begun when the one in hand falls short.
   */
  backdrop(fs: FS, notebookID: string, background: Background, size: { w: number; h: number }, scale: number): Picture | null {
    if (background.kind === "template") return null;
    if (background.kind === "image") return this.image(fs, notebookID, background.file);
    const base = `${notebookID}/${background.file}#${background.index}`;
    const cap = Math.sqrt(MAX_PIXELS / Math.max(size.w * size.h, 1));
    const wanted = Math.min(scale <= 1 ? 1 : scale <= 2 ? 2 : scale <= 4 ? 4 : 8, cap);
    const have = this.rendered.get(base);
    if (have) have.used = ++this.clock;
    if ((!have || have.scale < wanted - 0.01) && !this.rendering.has(base)) {
      this.rendering.add(base);
      void this.renderPdf(fs, notebookID, background.file, background.index, size, wanted, base);
    }
    return have?.picture ?? null;
  }

  private async renderPdf(fs: FS, notebookID: string, file: string, index: number, size: { w: number; h: number }, scale: number, key: string): Promise<void> {
    try {
      const pdf = await this.pdf(fs, notebookID, file);
      if (!pdf || index >= pdf.numPages) return;
      const page = await pdf.getPage(index + 1);
      const natural = page.getViewport({ scale: 1 });
      // The page is drawn to fill the notebook page's own size, whatever the PDF calls a point.
      const viewport = page.getViewport({ scale: (size.w / natural.width) * scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(viewport.width));
      canvas.height = Math.max(1, Math.round(viewport.height));
      const context = canvas.getContext("2d")!;
      context.fillStyle = "#FFFFFF";
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: context, viewport, canvas } as Parameters<typeof page.render>[0]).promise;
      this.rendered.set(key, { picture: canvas, scale, used: ++this.clock });
      if (this.rendered.size > KEEP) {
        const oldest = [...this.rendered].sort((a, b) => a[1].used - b[1].used)[0];
        if (oldest && oldest[0] !== key) this.rendered.delete(oldest[0]);
      }
    } catch {
      // A page that can't be drawn stays white; the ink over it is still shown.
    } finally {
      this.rendering.delete(key);
      this.tell();
    }
  }

  /** Waits for a page's backdrop at a given sharpness, for export and thumbnails. */
  async ready(fs: FS, notebookID: string, background: Background, size: { w: number; h: number }, scale: number): Promise<Picture | null> {
    if (background.kind === "template") return null;
    for (let attempt = 0; attempt < 400; attempt++) {
      const picture = this.backdrop(fs, notebookID, background, size, scale);
      const key = background.kind === "image" ? `${notebookID}/${background.file}` : `${notebookID}/${background.file}#${background.index}`;
      const settled = background.kind === "image" ? this.images.get(key) !== "loading" : !this.rendering.has(key);
      if (settled) return picture ?? this.backdrop(fs, notebookID, background, size, scale);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return null;
  }

  /** Forgets a notebook's files, when it closes or its files change under it. */
  forget(notebookID: string): void {
    for (const map of [this.images, this.pdfs, this.rendered] as Map<string, unknown>[]) {
      for (const key of [...map.keys()]) if (key.startsWith(notebookID + "/")) map.delete(key);
    }
  }
}

export const backdrops = new Backdrops();
