// Cut, copy and paste for ink and items. What is copied is kept here for pasting within the app, and also put on
// the system clipboard as text so it survives into another window.

import { inkBounds, transformStroke, type Point, type Stroke } from "../model/ink";
import { uuid } from "../model/ids";
import type { PageItem } from "../model/notebook";

export interface Clipping {
  strokes: Stroke[];
  items: PageItem[];
  /** The notebook the items' pictures live in. */
  notebook: string;
}

const MARK = "owlluna-clipping:";
let held: Clipping | null = null;

export function copyClipping(clipping: Clipping): void {
  held = structuredClone(clipping);
  try {
    void navigator.clipboard?.writeText(MARK + JSON.stringify(held)).catch(() => {});
  } catch {
    // The clipping is still held for this window.
  }
}

export function heldClipping(): Clipping | null {
  return held;
}

/** A clipping from the system clipboard's text, if that is what it holds. */
export function readClipping(text: string): Clipping | null {
  if (!text.startsWith(MARK)) return null;
  try {
    const parsed = JSON.parse(text.slice(MARK.length)) as Clipping;
    if (!Array.isArray(parsed.strokes) || !Array.isArray(parsed.items)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** The clipping with new identities, its middle moved to `centre`. */
export function placed(clipping: Clipping, centre: Point): { strokes: Stroke[]; items: PageItem[] } {
  const boxes = clipping.items.map((item) => ({ x: item.x - item.w / 2, y: item.y - item.h / 2, w: item.w, h: item.h }));
  const ink = inkBounds(clipping.strokes);
  const all = ink ? [...boxes, ink] : boxes;
  if (all.length === 0) return { strokes: [], items: [] };
  const minX = Math.min(...all.map((box) => box.x)), minY = Math.min(...all.map((box) => box.y));
  const maxX = Math.max(...all.map((box) => box.x + box.w)), maxY = Math.max(...all.map((box) => box.y + box.h));
  const dx = centre.x - (minX + maxX) / 2, dy = centre.y - (minY + maxY) / 2;
  return {
    strokes: clipping.strokes.map((stroke) => transformStroke(stroke, dx, dy, 1, { x: 0, y: 0 }, true)),
    items: clipping.items.map((item) => ({ ...item, id: uuid(), x: item.x + dx, y: item.y + dy })),
  };
}
