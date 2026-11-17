// Pure helpers for a whiteboard's view: where its content is, and how to bring it all into sight.

import { inkBounds, unionRects, type Point, type Rect, type Stroke } from "../model/ink";
import type { Page, PageItem } from "../model/notebook";

/** How far a whiteboard zooms. Pages keep their own, narrower range. */
export const BOARD_MIN_ZOOM = 0.05;
export const BOARD_MAX_ZOOM = 5;
/** "Show Everything" never magnifies past this, so a single dot does not fill the screen. */
const FIT_MAX_ZOOM = 2;

/** The smallest upright box round an item, which may be turned. */
export function itemBounds(item: PageItem): Rect {
  const cos = Math.abs(Math.cos(item.rotation)), sin = Math.abs(Math.sin(item.rotation));
  const w = item.w * cos + item.h * sin, h = item.w * sin + item.h * cos;
  return { x: item.x - w / 2, y: item.y - h / 2, w, h };
}

/** Everything drawn on a board, as one box; null when it is empty. */
export function boardContentBounds(strokes: Stroke[], items: PageItem[]): Rect | null {
  const parts: Rect[] = [];
  const ink = inkBounds(strokes);
  if (ink) parts.push(ink);
  for (const item of items) parts.push(itemBounds(item));
  return unionRects(parts);
}

/** The zoom, and the board point at the view's top-left, that put `bounds` in the middle of a view of this size. */
export function fitBoard(bounds: Rect, view: { w: number; h: number }, padding = 48): { zoom: number; origin: Point } {
  const roomW = Math.max(view.w - padding * 2, 1), roomH = Math.max(view.h - padding * 2, 1);
  const wanted = Math.min(bounds.w > 0 ? roomW / bounds.w : Infinity, bounds.h > 0 ? roomH / bounds.h : Infinity);
  const zoom = Math.min(Math.max(wanted, BOARD_MIN_ZOOM), Math.min(FIT_MAX_ZOOM, BOARD_MAX_ZOOM));
  const centre = { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 };
  return { zoom, origin: { x: centre.x - view.w / zoom / 2, y: centre.y - view.h / zoom / 2 } };
}

const EMPTY_BOARD: Rect = { x: 0, y: 0, w: 612, h: 400 };

/** The part of a page that is drawn when it is taken off screen: the page itself, or for a whiteboard what is on it with room round it. */
export function pageRegion(page: Page, strokes: Stroke[]): Rect {
  if (!page.edgeless) return { x: 0, y: 0, w: page.size.w, h: page.size.h };
  const bounds = boardContentBounds(strokes, page.items);
  if (!bounds) return { ...EMPTY_BOARD };
  const pad = 40;
  return { x: bounds.x - pad, y: bounds.y - pad, w: bounds.w + pad * 2, h: bounds.h + pad * 2 };
}
