// The rectangle maths behind a card's clippings: which part of a page is cut out, and which pixels that is.

import type { Rect } from "../model/ink";

/** The room a tape's front clipping shows round the tape, so the card has context. */
export const TAPE_CONTEXT = 60;
/** The margin round selected handwriting. */
export const INK_MARGIN = 8;
/** Clippings are rendered at twice the page's points. */
export const CLIP_SCALE = 2;

export function padRect(rect: Rect, pad: number): Rect {
  return { x: rect.x - pad, y: rect.y - pad, w: rect.w + pad * 2, h: rect.h + pad * 2 };
}

/** The part of `rect` that lies inside `bounds`; null when none of it does. */
export function clampRect(rect: Rect, bounds: Rect): Rect | null {
  const x0 = Math.max(rect.x, bounds.x), y0 = Math.max(rect.y, bounds.y);
  const x1 = Math.min(rect.x + rect.w, bounds.x + bounds.w), y1 = Math.min(rect.y + rect.h, bounds.y + bounds.h);
  if (x1 - x0 <= 0 || y1 - y0 <= 0) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * The pixels of a canvas that hold `rect`, when the canvas shows `region` of the page. Whole pixels, grown outward so
 * no edge of the clipping is lost, and always at least one pixel. Null when `rect` is outside the region.
 */
export function pixelRect(region: Rect, rect: Rect, canvas: { width: number; height: number }): { x: number; y: number; w: number; h: number } | null {
  const inside = clampRect(rect, region);
  if (!inside) return null;
  const sx = canvas.width / region.w, sy = canvas.height / region.h;
  const x0 = Math.max(Math.floor((inside.x - region.x) * sx), 0), y0 = Math.max(Math.floor((inside.y - region.y) * sy), 0);
  const x1 = Math.min(Math.ceil((inside.x + inside.w - region.x) * sx), canvas.width), y1 = Math.min(Math.ceil((inside.y + inside.h - region.y) * sy), canvas.height);
  return { x: x0, y: y0, w: Math.max(x1 - x0, 1), h: Math.max(y1 - y0, 1) };
}

/** What a tape card clips: the back is the tape's own box, the front the same box with context round it. */
export function tapeClips(tapeBox: Rect): { back: Rect; front: Rect } {
  return { back: tapeBox, front: padRect(tapeBox, TAPE_CONTEXT) };
}
