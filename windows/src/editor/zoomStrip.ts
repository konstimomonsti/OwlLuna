// Where the zoom window's strip sits on the page and how it moves, apart from the window that shows it.

import { lineGap } from "../canvas/templates";

export const ZOOM_WINDOW_HEIGHT = 180;

/** How much the strip is magnified: three times the page's zoom, never less than two. */
export function magnification(zoom: number): number {
  return Math.max(2, zoom * 3);
}

export interface Strip { x: number; y: number; w: number; h: number }

/** Keeps a strip on its page; a page without edges lets it go anywhere. */
export function clampStrip(strip: Strip, page: { size: { w: number; h: number }; edgeless?: boolean }): Strip {
  if (page.edgeless) return strip;
  return {
    ...strip,
    x: Math.min(Math.max(strip.x, 0), Math.max(page.size.w - strip.w, 0)),
    y: Math.min(Math.max(strip.y, 0), Math.max(page.size.h - strip.h, 0)),
  };
}

/** Moves the strip on after a line is written to its end: right by 60% of its width, or to the start of the next line at the page's edge. */
export function advanceStrip(strip: Strip, page: { size: { w: number; h: number }; edgeless?: boolean }, lineStep: number): Strip {
  const right = strip.x + strip.w * 0.6;
  if (page.edgeless || right + strip.w <= page.size.w + 0.5) return clampStrip({ ...strip, x: right }, page);
  // Not enough page to the right to move on a whole step: if the strip is already at the end, wrap.
  if (strip.x + strip.w < page.size.w - 0.5) return clampStrip({ ...strip, x: page.size.w - strip.w }, page);
  return clampStrip({ ...strip, x: 0, y: strip.y + lineStep }, page);
}

/** How far "next line" goes: the paper's ruling scaled to the page's width, or 30 points where it has none. */
export function lineStepOf(page: { background: { kind: string; template?: string }; size: { w: number } }): number {
  const gap = page.background.kind === "template" ? lineGap(page.background.template as Parameters<typeof lineGap>[0]) : 0;
  return gap > 0 ? gap * (page.size.w / 800) : 30;
}
