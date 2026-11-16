// The words cache: what can be read on each page that isn't typed text, kept in the notebook so search and Find
// don't have to read it again. PDF text is read here; handwriting is read by a function the caller supplies.

import { pdfTextBoxes, type TextBox } from "../canvas/pdfText";
import { fnv1a } from "../model/ids";
import type { Stroke } from "../model/ink";
import type { Page } from "../model/notebook";
import type { FS } from "../platform/fs";
import { loadWords, saveWords, type PageWords } from "../storage/package";
import type { Manifest } from "../model/notebook";

export type Recogniser = (strokes: Stroke[]) => Promise<string>;

/** What a cache entry was made from. It changes when the page's paper or, once handwriting is read, its ink does. */
export function wordsKey(page: Page, inkSignature = ""): string {
  const paper = page.background.kind === "template" ? "t" : page.background.kind === "pdf" ? `pdf:${page.background.file}#${page.background.index}` : `img:${page.background.file}`;
  return fnv1a(`${paper}|${Math.round(page.size.w)}x${Math.round(page.size.h)}|${inkSignature}`);
}

/** A short signature of ink: how many strokes and which was last. Enough to tell that it changed. */
export function inkSignature(strokes: Stroke[]): string {
  return strokes.length === 0 ? "" : `${strokes.length}:${strokes[strokes.length - 1].id}`;
}

/** Joins the parts that exist into one text, one space between. */
export function mergeWordText(...parts: (string | undefined | null)[]): string {
  return parts.map((part) => (part ?? "").replace(/\s+/g, " ").trim()).filter(Boolean).join(" ");
}

/** The words of a PDF page in reading order, from its text boxes. */
export function textOfBoxes(boxes: TextBox[]): string {
  // Boxes are first gathered into lines by height, then each line is read left to right.
  const lines: { middle: number; height: number; boxes: TextBox[] }[] = [];
  for (const box of [...boxes].sort((a, b) => a.y - b.y)) {
    const middle = box.y + box.h / 2;
    const line = lines.find((candidate) => Math.abs(candidate.middle - middle) < Math.max(candidate.height, box.h) * 0.5);
    if (line) line.boxes.push(box);
    else lines.push({ middle, height: box.h, boxes: [box] });
  }
  return lines
    .sort((a, b) => a.middle - b.middle)
    .map((line) => line.boxes.sort((a, b) => a.x - b.x).map((box) => box.str).join(" "))
    .join("\n")
    .replace(/[ \t]+/g, " ");
}

/** Which of a notebook's pages have no entry made from what they hold now. */
export function stalePages(pages: Page[], words: PageWords["pages"], signatures: Record<string, string> = {}): Page[] {
  return pages.filter((page) => {
    const wantsText = page.background.kind === "pdf" || signatures[page.id] !== undefined;
    if (!wantsText) return false;
    return words[page.id]?.key !== wordsKey(page, signatures[page.id] ?? "");
  });
}

export interface WordsSource {
  fs: FS;
  id: string;
  manifest: Manifest;
  ensureInk?(pageID: string): Promise<Stroke[]>;
}

/**
 * Fills the cache for pages whose entry is missing or out of date: PDF text always, handwriting when `recognise` is
 * given. Typed text is not stored here; it is read from the pages themselves. Entries of deleted pages are dropped.
 * Returns whether anything was written.
 */
export async function refreshWords(source: WordsSource, recognise?: Recogniser, onProgress?: (done: number, total: number) => void): Promise<boolean> {
  const loaded = await loadWords(source.fs, source.id);
  const words = { ...loaded.pages };
  let changed = false;
  const known = new Set(source.manifest.pages.map((page) => page.id));
  for (const id of Object.keys(words)) if (!known.has(id)) { delete words[id]; changed = true; }

  const signatures: Record<string, string> = {};
  const strokes = new Map<string, Stroke[]>();
  if (recognise && source.ensureInk) {
    for (const page of source.manifest.pages) {
      const ink = await source.ensureInk(page.id);
      if (ink.length) { signatures[page.id] = inkSignature(ink); strokes.set(page.id, ink); }
    }
  }
  const stale = stalePages(source.manifest.pages, words, signatures);
  let done = 0;
  for (const page of stale) {
    const pdf = page.background.kind === "pdf" ? textOfBoxes(await pdfTextBoxes(source.fs, source.id, page)) : "";
    let handwriting = "";
    const ink = strokes.get(page.id);
    if (recognise && ink?.length) {
      try { handwriting = await recognise(ink); } catch { handwriting = ""; }
    }
    words[page.id] = { key: wordsKey(page, signatures[page.id] ?? ""), text: mergeWordText(pdf, handwriting) };
    changed = true;
    onProgress?.(++done, stale.length);
  }
  if (changed) await saveWords(source.fs, source.id, { version: 1, pages: words });
  return changed;
}
