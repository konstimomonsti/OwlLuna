// Ink as vectors. A page's ink is a list of strokes; a stroke is never changed in place, so a list can be
// kept for undo and a stroke's drawn outline can be cached against the object.

import type { InkKind } from "./tools";
import { uuid } from "./ids";

export interface Stroke {
  id: string;
  ink: InkKind;
  /** 0xRRGGBBAA. */
  color: number;
  /** Points. */
  width: number;
  /** x, y, pressure (0 to 1) and milliseconds since the stroke began: four numbers a point. */
  pts: number[];
  /** When it was begun, in milliseconds since 1970. Replay and time-lapse order ink by it. */
  at: number;
  /** A straightened shape: drawn at one width whatever the pressure. */
  even?: boolean;
}

export interface Point { x: number; y: number }
export interface Rect { x: number; y: number; w: number; h: number }

export const STRIDE = 4;

export function pointCount(stroke: Stroke): number {
  return Math.floor(stroke.pts.length / STRIDE);
}

export function makeStroke(ink: InkKind, color: number, width: number, points: Point[], at = Date.now(), even = true): Stroke {
  const pts: number[] = [];
  points.forEach((point, index) => pts.push(point.x, point.y, 0.5, index * 8));
  return { id: uuid(), ink, color, width, pts, at, even };
}

export function strokeBounds(stroke: Stroke): Rect {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < stroke.pts.length; i += STRIDE) {
    const x = stroke.pts[i], y = stroke.pts[i + 1];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  if (minX === Infinity) return { x: 0, y: 0, w: 0, h: 0 };
  const pad = stroke.width / 2 + 1;
  return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
}

export function unionRects(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const rect of rects) {
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.w);
    maxY = Math.max(maxY, rect.y + rect.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

export function inkBounds(strokes: Stroke[]): Rect | null {
  return unionRects(strokes.map(strokeBounds));
}

/** A copy moved, and scaled about `origin`. New identity only when asked, so a move keeps a stroke's place in time. */
export function transformStroke(stroke: Stroke, dx: number, dy: number, scale = 1, origin: Point = { x: 0, y: 0 }, fresh = false): Stroke {
  const pts = stroke.pts.slice();
  for (let i = 0; i < pts.length; i += STRIDE) {
    pts[i] = origin.x + (pts[i] - origin.x) * scale + dx;
    pts[i + 1] = origin.y + (pts[i + 1] - origin.y) * scale + dy;
  }
  return { ...stroke, id: fresh ? uuid() : stroke.id, pts, width: stroke.width * scale };
}

function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : Math.min(Math.max(((px - ax) * dx + (py - ay) * dy) / length, 0), 1);
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

/** Whether a disc at `point` touches the stroke's line, its width counted in. */
export function strokeHit(stroke: Stroke, point: Point, radius: number): boolean {
  const reach = radius + stroke.width / 2;
  const count = pointCount(stroke);
  if (count === 0) return false;
  if (count === 1) return Math.hypot(point.x - stroke.pts[0], point.y - stroke.pts[1]) <= reach;
  for (let i = 0; i < count - 1; i++) {
    const a = i * STRIDE, b = a + STRIDE;
    if (distanceToSegment(point.x, point.y, stroke.pts[a], stroke.pts[a + 1], stroke.pts[b], stroke.pts[b + 1]) <= reach) return true;
  }
  return false;
}

/**
 * Rubs a disc out of a stroke: the points under it go, and what is left on each side becomes a stroke of its own.
 * Returns null when the disc misses, so the caller can keep the same object.
 */
export function eraseFromStroke(stroke: Stroke, point: Point, radius: number): Stroke[] | null {
  if (!strokeHit(stroke, point, radius)) return null;
  const reach = radius + stroke.width / 2;
  const count = pointCount(stroke);
  const runs: number[][] = [];
  let run: number[] = [];
  const close = () => {
    if (run.length >= STRIDE * 2) runs.push(run);
    run = [];
  };
  for (let i = 0; i < count; i++) {
    const at = i * STRIDE;
    const x = stroke.pts[at], y = stroke.pts[at + 1];
    const inside = Math.hypot(x - point.x, y - point.y) <= reach;
    if (inside) {
      close();
      continue;
    }
    if (run.length > 0 && i > 0) {
      // The segment from the last kept point may cross the disc with neither end inside it.
      const prev = (i - 1) * STRIDE;
      if (distanceToSegment(point.x, point.y, stroke.pts[prev], stroke.pts[prev + 1], x, y) <= reach) close();
    }
    run.push(x, y, stroke.pts[at + 2], stroke.pts[at + 3]);
  }
  close();
  return runs.map((pts) => {
    const start = pts[3];
    for (let i = 3; i < pts.length; i += STRIDE) pts[i] -= start;
    return { ...stroke, id: uuid(), pts, at: stroke.at + start };
  });
}

export function pointInPolygon(point: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if (a.y > point.y !== b.y > point.y && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** The strokes a lasso takes: those with more than half their points inside the loop. */
export function strokesInLasso(strokes: Stroke[], loop: Point[]): Stroke[] {
  if (loop.length < 3) return [];
  const box = unionRects(loop.map((p) => ({ x: p.x, y: p.y, w: 0, h: 0 })))!;
  return strokes.filter((stroke) => {
    if (!rectsIntersect(strokeBounds(stroke), box)) return false;
    const count = pointCount(stroke);
    if (count === 0) return false;
    let inside = 0;
    for (let i = 0; i < count; i++) {
      if (pointInPolygon({ x: stroke.pts[i * STRIDE], y: stroke.pts[i * STRIDE + 1] }, loop)) inside++;
    }
    return inside * 2 > count;
  });
}

/** The length of a stroke's line. */
export function strokeLength(stroke: Stroke): number {
  let total = 0;
  for (let i = STRIDE; i < stroke.pts.length; i += STRIDE) {
    total += Math.hypot(stroke.pts[i] - stroke.pts[i - STRIDE], stroke.pts[i + 1] - stroke.pts[i - STRIDE + 1]);
  }
  return total;
}

/** How long the stroke took to write, in milliseconds. */
export function strokeDuration(stroke: Stroke): number {
  return stroke.pts.length >= STRIDE ? stroke.pts[stroke.pts.length - 1] : 0;
}

/** A page's ink file. */
export interface InkFile {
  version: 1;
  strokes: Stroke[];
}

export function encodeInk(strokes: Stroke[]): string {
  const rounded = strokes.map((stroke) => ({
    ...stroke,
    pts: stroke.pts.map((value, index) => (index % STRIDE === 3 ? Math.round(value) : Math.round(value * 100) / 100)),
  }));
  return JSON.stringify({ version: 1, strokes: rounded } satisfies InkFile);
}

const kinds = new Set(["pen", "fineliner", "fountain", "calligraphy", "pencil", "highlighter", "crayon", "watercolour"]);

/** Reads an ink file, leaving out what can't be drawn. Throws when the file isn't an ink file at all. */
export function decodeInk(text: string): Stroke[] {
  const parsed = JSON.parse(text) as Partial<InkFile>;
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.strokes)) throw new Error("not an ink file");
  const out: Stroke[] = [];
  for (const raw of parsed.strokes as unknown[]) {
    const stroke = raw as Partial<Stroke>;
    if (!stroke || !Array.isArray(stroke.pts) || stroke.pts.length < STRIDE || stroke.pts.length % STRIDE !== 0) continue;
    if (!stroke.pts.every((value) => typeof value === "number" && Number.isFinite(value))) continue;
    if (typeof stroke.ink !== "string" || !kinds.has(stroke.ink)) continue;
    out.push({
      id: typeof stroke.id === "string" ? stroke.id : uuid(),
      ink: stroke.ink,
      color: typeof stroke.color === "number" ? stroke.color >>> 0 : 0x1b2230ff,
      width: typeof stroke.width === "number" && stroke.width > 0 ? stroke.width : 2,
      pts: stroke.pts,
      at: typeof stroke.at === "number" ? stroke.at : 0,
      ...(stroke.even ? { even: true } : {}),
    });
  }
  return out;
}
