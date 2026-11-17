// The outline a stroke is filled with. Pure geometry: the canvas and the PDF export both fill the same polygons,
// so ink is vector in both.

import { getStroke } from "perfect-freehand";
import { STRIDE, pointCount, type Stroke } from "../model/ink";
import type { InkKind } from "../model/tools";

export interface InkLook {
  /** Multiplies the colour's own alpha. */
  alpha: number;
  /** Highlighter ink darkens what is under it and never hides it. */
  multiply: boolean;
  /** Pencil and crayon are filled with grain, not flat colour. */
  texture: "none" | "grain" | "wax";
  /** Watercolour pools at its edge. */
  edge: boolean;
}

export const inkLooks: Record<InkKind, InkLook> = {
  pen: { alpha: 1, multiply: false, texture: "none", edge: false },
  fineliner: { alpha: 1, multiply: false, texture: "none", edge: false },
  fountain: { alpha: 1, multiply: false, texture: "none", edge: false },
  calligraphy: { alpha: 1, multiply: false, texture: "none", edge: false },
  pencil: { alpha: 0.9, multiply: false, texture: "grain", edge: false },
  highlighter: { alpha: 1, multiply: true, texture: "none", edge: false },
  crayon: { alpha: 0.95, multiply: false, texture: "wax", edge: false },
  watercolour: { alpha: 0.45, multiply: false, texture: "none", edge: true },
};

interface Shaping {
  thinning: number;
  smoothing: number;
  streamline: number;
  taperStart: number;
  taperEnd: number;
}

const shaping: Record<Exclude<InkKind, "calligraphy">, Shaping> = {
  pen: { thinning: 0.5, smoothing: 0.5, streamline: 0.35, taperStart: 0, taperEnd: 0 },
  fineliner: { thinning: 0, smoothing: 0.5, streamline: 0.35, taperStart: 0, taperEnd: 0 },
  fountain: { thinning: 0.78, smoothing: 0.55, streamline: 0.4, taperStart: 0, taperEnd: 1 },
  pencil: { thinning: 0.3, smoothing: 0.45, streamline: 0.3, taperStart: 0, taperEnd: 0 },
  highlighter: { thinning: 0, smoothing: 0.6, streamline: 0.4, taperStart: 0, taperEnd: 0 },
  crayon: { thinning: 0.2, smoothing: 0.4, streamline: 0.3, taperStart: 0, taperEnd: 0 },
  watercolour: { thinning: 0.35, smoothing: 0.7, streamline: 0.45, taperStart: 0, taperEnd: 0 },
};

/** Whether the stroke carries a real pen's pressure, or a mouse's flat half. */
export function hasPressure(stroke: Stroke): boolean {
  for (let i = 2; i < stroke.pts.length; i += STRIDE) if (Math.abs(stroke.pts[i] - 0.5) > 0.01) return true;
  return false;
}

function signedArea(poly: number[]): number {
  let area = 0;
  for (let i = 0; i < poly.length; i += 2) {
    const j = (i + 2) % poly.length;
    area += poly[i] * poly[j + 1] - poly[j] * poly[i + 1];
  }
  return area / 2;
}

/** Turned the same way round, so pieces that overlap fill solid under the nonzero rule. */
function oriented(poly: number[]): number[] {
  if (signedArea(poly) >= 0) return poly;
  const out: number[] = [];
  for (let i = poly.length - 2; i >= 0; i -= 2) out.push(poly[i], poly[i + 1]);
  return out;
}

function disc(x: number, y: number, radius: number, sides = 14): number[] {
  const out: number[] = [];
  for (let i = 0; i < sides; i++) {
    const angle = (i / sides) * Math.PI * 2;
    out.push(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius);
  }
  return out;
}

/** A broad nib held at 45 degrees: thick across it, a hairline along it. */
function calligraphyOutline(stroke: Stroke): number[][] {
  const count = pointCount(stroke);
  const half = stroke.width / 2;
  const nx = Math.cos(-Math.PI / 4) * half, ny = Math.sin(-Math.PI / 4) * half;
  const hair = Math.max(stroke.width * 0.12, 0.35);
  const polys: number[][] = [];
  const at = (i: number) => [stroke.pts[i * STRIDE], stroke.pts[i * STRIDE + 1]] as const;
  if (count === 1) {
    const [x, y] = at(0);
    return [oriented([x - nx, y - ny, x + nx, y + ny, x + nx + hair, y + ny + hair, x - nx + hair, y - ny + hair])];
  }
  for (let i = 0; i < count - 1; i++) {
    const [ax, ay] = at(i), [bx, by] = at(i + 1);
    if (ax === bx && ay === by) continue;
    polys.push(oriented([ax - nx, ay - ny, ax + nx, ay + ny, bx + nx, by + ny, bx - nx, by - ny]));
  }
  // The hairline, so a stroke along the nib's own angle still leaves a mark.
  const spine: number[][] = [];
  for (let i = 0; i < count; i++) spine.push([...at(i), 0.5]);
  const thin = getStroke(spine, { size: hair * 2, thinning: 0, smoothing: 0.5, streamline: 0.3, simulatePressure: false, last: true });
  if (thin.length >= 3) polys.push(oriented(thin.flat()));
  return polys;
}

/** The polygons to fill for a stroke, each a flat list of x, y. */
export function strokeOutline(stroke: Stroke): number[][] {
  const count = pointCount(stroke);
  if (count === 0) return [];
  if (stroke.ink === "calligraphy" && !stroke.even) return calligraphyOutline(stroke);
  if (count === 1) return [disc(stroke.pts[0], stroke.pts[1], Math.max(stroke.width / 2, 0.3))];
  const shape = stroke.ink === "calligraphy" ? shaping.fineliner : shaping[stroke.ink];
  const real = hasPressure(stroke);
  const input: number[][] = [];
  for (let i = 0; i < count; i++) input.push([stroke.pts[i * STRIDE], stroke.pts[i * STRIDE + 1], stroke.pts[i * STRIDE + 2]]);
  const even = stroke.even === true;
  const outline = getStroke(input, {
    size: stroke.width,
    thinning: even ? 0 : shape.thinning,
    smoothing: even ? 0 : shape.smoothing,
    streamline: even ? 0 : shape.streamline,
    simulatePressure: !even && !real && shape.thinning > 0,
    start: { taper: even ? 0 : shape.taperStart * stroke.width, cap: true },
    end: { taper: even ? 0 : shape.taperEnd * stroke.width * 2, cap: true },
    last: true,
  });
  if (outline.length < 3) return [disc(stroke.pts[0], stroke.pts[1], Math.max(stroke.width / 2, 0.3))];
  return [oriented(outline.flat())];
}

function round(value: number): string {
  return (Math.round(value * 100) / 100).toString();
}

/** An SVG path through a polygon's points, curved through the middle of each side so it reads as ink, not facets. */
export function polygonPath(poly: number[], smooth = true): string {
  const n = poly.length / 2;
  if (n < 3) return "";
  if (!smooth || n < 5) {
    let d = `M${round(poly[0])} ${round(poly[1])}`;
    for (let i = 1; i < n; i++) d += `L${round(poly[i * 2])} ${round(poly[i * 2 + 1])}`;
    return d + "Z";
  }
  const mid = (i: number) => {
    const j = (i + 1) % n;
    return [(poly[i * 2] + poly[j * 2]) / 2, (poly[i * 2 + 1] + poly[j * 2 + 1]) / 2];
  };
  const [sx, sy] = mid(n - 1);
  let d = `M${round(sx)} ${round(sy)}`;
  for (let i = 0; i < n; i++) {
    const [mx, my] = mid(i);
    d += `Q${round(poly[i * 2])} ${round(poly[i * 2 + 1])} ${round(mx)} ${round(my)}`;
  }
  return d + "Z";
}

const pathCache = new WeakMap<Stroke, string>();

/** The stroke as one SVG path. Kept against the stroke, which never changes. */
export function strokePath(stroke: Stroke): string {
  let path = pathCache.get(stroke);
  if (path === undefined) {
    // Straightened shapes keep their corners; calligraphy's pieces are already quads.
    const smooth = !stroke.even && stroke.ink !== "calligraphy";
    path = strokeOutline(stroke).map((poly) => polygonPath(poly, smooth)).join("");
    pathCache.set(stroke, path);
  }
  return path;
}

/**
 * Ink as it shows on dark paper: colours too dark to see are turned light, as PencilKit does. Colours are kept as
 * they are on light paper.
 */
export function displayColor(color: number, darkPaper: boolean): number {
  if (!darkPaper) return color;
  const r = (color >>> 24) & 0xff, g = (color >>> 16) & 0xff, b = (color >>> 8) & 0xff, a = color & 0xff;
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  if (luminance >= 0.4) return color;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const lightness = (max + min) / 510;
  const target = 1 - lightness * 0.6;
  if (max === min) {
    const grey = Math.round(target * 255);
    return ((grey << 24) | (grey << 16) | (grey << 8) | a) >>> 0;
  }
  // Keep the hue: scale each channel's distance from white.
  const scale = (1 - target) / (1 - lightness || 1);
  const lift = (channel: number) => Math.round(255 - (255 - channel) * Math.min(scale, 1));
  return ((lift(r) << 24) | (lift(g) << 16) | (lift(b) << 8) | a) >>> 0;
}
