// Turning handwriting into a text box: how big the box is and where it goes. Pure, so the placing can be tested.

import type { Rect, Stroke } from "../model/ink";
import type { Page } from "../model/notebook";

const GLYPH = 8.5;
const LINE = 17 * 1.35;

/** The size a text box needs for these words at the default size. */
export function textBoxSize(text: string): { w: number; h: number } {
  const lines = text.split("\n");
  const longest = Math.max(...lines.map((line) => line.length), 8);
  return { w: Math.min(Math.max(longest * GLYPH, 120), 420), h: Math.max(lines.length, 1) * LINE + 4 };
}

/** A box's centre and size, as an item keeps them. */
export interface Placement { x: number; y: number; w: number; h: number }

function keepOnPage(box: Placement, page: Pick<Page, "size" | "edgeless">): Placement {
  if (page.edgeless) return box;
  return {
    ...box,
    x: Math.min(Math.max(box.x, box.w / 2 + 8), Math.max(page.size.w - box.w / 2 - 8, box.w / 2)),
    y: Math.min(Math.max(box.y, box.h / 2 + 8), Math.max(page.size.h - box.h / 2 - 8, box.h / 2)),
  };
}

/** A box just under the handwriting, left edges together. */
export function placeBelow(bounds: Rect, text: string, page: Pick<Page, "size" | "edgeless">): Placement {
  const { w, h } = textBoxSize(text);
  return keepOnPage({ x: bounds.x + w / 2, y: bounds.y + bounds.h + 16 + h / 2, w, h }, page);
}

/** A box where the handwriting was: its top left corner, as wide as the writing was, but never narrower than a short line of text. */
export function placeOver(bounds: Rect, text: string, page: Pick<Page, "size" | "edgeless">): Placement {
  const w = Math.min(Math.max(bounds.w, 120), 420);
  const perLine = Math.max(Math.floor(w / GLYPH), 1);
  const rows = text.split("\n").reduce((sum, line) => sum + Math.max(Math.ceil(line.length / perLine), 1), 0);
  const h = Math.max(rows, 1) * LINE + 4;
  return keepOnPage({ x: bounds.x + w / 2, y: bounds.y + h / 2, w, h }, page);
}

/** The strokes handwriting-to-text reads: the selection if there is one, else everything written on the current page. */
export function strokesToRead(inkOf: (pageID: string) => Stroke[], selection: { pageID: string; ids: string[] } | null, currentPage: string): { pageID: string; strokes: Stroke[] } {
  if (selection) {
    const wanted = new Set(selection.ids);
    return { pageID: selection.pageID, strokes: inkOf(selection.pageID).filter((stroke) => wanted.has(stroke.id)) };
  }
  return { pageID: currentPage, strokes: inkOf(currentPage) };
}
