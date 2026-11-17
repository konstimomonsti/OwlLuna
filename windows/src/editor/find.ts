// Find in Notebook: what matches, in reading order. Pure, so it can be tested without a page.

import { plainText } from "../canvas/textLayout";
import type { Rect } from "../model/ink";
import type { Page } from "../model/notebook";

export interface FindMatch {
  pageID: string;
  kind: "text" | "link" | "picture" | "words";
  /** The item holding the words, when they are in one. */
  itemID?: string;
  /** Where it is on the page, in points, for words in an item. */
  rect?: Rect;
  /** A little of the line, to tell matches apart. */
  snippet: string;
}

/** Lower case with accents taken off, so "Cafe" finds "café". */
export function fold(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** How many times `needle` (already folded) occurs in `text`, without overlapping, and where the first begins. */
function occurrences(text: string, needle: string): number[] {
  const hay = fold(text);
  const at: number[] = [];
  if (!needle) return at;
  for (let from = hay.indexOf(needle); from !== -1; from = hay.indexOf(needle, from + needle.length)) at.push(from);
  return at;
}

function snippet(text: string, at: number, length: number): string {
  const start = Math.max(0, at - 18), end = Math.min(text.length, at + length + 28);
  return (start > 0 ? "…" : "") + text.slice(start, end).replace(/\s+/g, " ").trim() + (end < text.length ? "…" : "");
}

/**
 * Every place `query` occurs: typed text, link labels, words read from pictures, and the recognised words of a page
 * (handwriting, PDF text), which have no place of their own and are found by their page.
 */
export function findInNotebook(query: string, pages: Page[], words: Record<string, { text: string }> = {}): FindMatch[] {
  const needle = fold(query.trim());
  if (!needle) return [];
  const matches: FindMatch[] = [];
  for (const page of pages) {
    for (const item of page.items) {
      const box: Rect = { x: item.x - item.w / 2, y: item.y - item.h / 2, w: item.w, h: item.h };
      let text = "";
      let kind: FindMatch["kind"] | null = null;
      if (item.kind === "text") { text = plainText(item); kind = "text"; }
      else if (item.kind === "link") { text = item.label; kind = "link"; }
      else if (item.kind === "image" && item.text) { text = item.text; kind = "picture"; }
      if (!kind) continue;
      for (const at of occurrences(text, needle)) matches.push({ pageID: page.id, kind, itemID: item.id, rect: box, snippet: snippet(text, at, needle.length) });
    }
    const recognised = words[page.id]?.text;
    if (recognised) {
      for (const at of occurrences(recognised, needle)) matches.push({ pageID: page.id, kind: "words", snippet: snippet(recognised, at, needle.length) });
    }
  }
  return matches;
}
