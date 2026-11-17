// The text of a PDF page, placed in the notebook page's points: for selecting it, marking it, and snapping a
// highlighter to its lines. The geometry is pure; reading the PDF is done once per page and kept.

import type { Point, Rect } from "../model/ink";
import type { Page } from "../model/notebook";
import type { FS } from "../platform/fs";
import { backdrops } from "./backdrops";

export interface TextBox {
  str: string;
  /** The top left, in page points, and the size of the box the glyphs sit in. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Radians, clockwise, as the text runs on the page. */
  angle: number;
}

export interface RawTextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
}

/** The product of two 2D affine matrices as pdf.js writes them: [a, b, c, d, e, f]. */
export function multiply(m1: number[], m2: number[]): number[] {
  return [
    m1[0] * m2[0] + m1[2] * m2[1], m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3], m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4], m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

/**
 * Text items as boxes on the page. `viewport` is the page's pdf.js viewport transform at the scale that makes the
 * PDF page as wide as the notebook page, so what comes out is in the notebook's points.
 */
export function textBoxes(items: RawTextItem[], viewport: number[]): TextBox[] {
  const out: TextBox[] = [];
  for (const item of items) {
    if (!item.str || item.str.trim() === "") continue;
    const m = multiply(viewport, item.transform);
    const h = Math.hypot(m[2], m[3]);
    if (!(h > 0)) continue;
    const scale = Math.hypot(viewport[0], viewport[1]);
    const w = Math.max(item.width * scale, 0);
    const angle = Math.atan2(m[1], m[0]);
    // The baseline sits about four fifths down the box; the origin of the text is on the baseline.
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const up = h * 0.82;
    out.push({ str: item.str, x: m[4] + sin * up, y: m[5] - cos * up, w, h, angle });
  }
  return out;
}

/** Joins the boxes of one visual line into a rectangle each, so a highlight is one band per line. Upright text only. */
export function mergeLines(boxes: TextBox[]): Rect[] {
  const upright = boxes.filter((box) => Math.abs(box.angle) < 0.05).sort((a, b) => a.y - b.y || a.x - b.x);
  const lines: Rect[] = [];
  for (const box of upright) {
    const middle = box.y + box.h / 2;
    const line = lines.find((candidate) => Math.abs(candidate.y + candidate.h / 2 - middle) < Math.min(candidate.h, box.h) * 0.4);
    if (!line) {
      lines.push({ x: box.x, y: box.y, w: box.w, h: box.h });
      continue;
    }
    const left = Math.min(line.x, box.x), right = Math.max(line.x + line.w, box.x + box.w);
    const top = Math.min(line.y, box.y), bottom = Math.max(line.y + line.h, box.y + box.h);
    line.x = left; line.y = top; line.w = right - left; line.h = bottom - top;
  }
  return lines;
}

/**
 * A highlighter stroke begun on a line of text, made straight: along the line's middle, over the x-range that was
 * drawn, as high as the line. Null when the stroke did not start on a line.
 */
export function snapToLine(points: Point[], lines: Rect[], slack = 0.25): { from: Point; to: Point; height: number } | null {
  if (points.length === 0 || lines.length === 0) return null;
  const start = points[0];
  let best: Rect | null = null, distance = Infinity;
  for (const line of lines) {
    const pad = line.h * slack;
    if (start.x < line.x - pad || start.x > line.x + line.w + pad) continue;
    const middle = line.y + line.h / 2;
    if (start.y < line.y - pad || start.y > line.y + line.h + pad) continue;
    const away = Math.abs(start.y - middle);
    if (away < distance) { best = line; distance = away; }
  }
  if (!best) return null;
  let left = Infinity, right = -Infinity;
  for (const point of points) {
    left = Math.min(left, point.x);
    right = Math.max(right, point.x);
  }
  // A dab on the line, not a drag along it, still marks a little.
  if (right - left < 2) right = left + Math.min(best.h, 12);
  const y = best.y + best.h / 2;
  return { from: { x: left, y }, to: { x: right, y }, height: best.h };
}

/** Rectangles of a selection as bands per line: the rects that share a line are joined. Input and output are in page points. */
export function bandsOf(rects: Rect[]): Rect[] {
  const sorted = rects.filter((rect) => rect.w > 0.5 && rect.h > 0.5).sort((a, b) => a.y - b.y || a.x - b.x);
  const bands: Rect[] = [];
  for (const rect of sorted) {
    const middle = rect.y + rect.h / 2;
    const band = bands.find((candidate) => Math.abs(candidate.y + candidate.h / 2 - middle) < Math.min(candidate.h, rect.h) * 0.5);
    if (!band) { bands.push({ ...rect }); continue; }
    const left = Math.min(band.x, rect.x), right = Math.max(band.x + band.w, rect.x + rect.w);
    const top = Math.min(band.y, rect.y), bottom = Math.max(band.y + band.h, rect.y + rect.h);
    band.x = left; band.y = top; band.w = right - left; band.h = bottom - top;
  }
  return bands;
}

// Reading a page's text from its PDF, once.

const boxCache = new Map<string, Promise<TextBox[]>>();
const lineCache = new Map<string, Rect[]>();

function keyOf(notebookID: string, page: Page): string | null {
  return page.background.kind === "pdf" ? `${notebookID}/${page.background.file}#${page.background.index}@${Math.round(page.size.w)}x${Math.round(page.size.h)}` : null;
}

export function pdfTextBoxes(fs: FS, notebookID: string, page: Page): Promise<TextBox[]> {
  const key = keyOf(notebookID, page);
  if (!key || page.background.kind !== "pdf") return Promise.resolve([]);
  let pending = boxCache.get(key);
  if (!pending) {
    const { file, index } = page.background;
    pending = (async () => {
      try {
        const pdf = await backdrops.pdf(fs, notebookID, file);
        if (!pdf || index >= pdf.numPages) return [];
        const source = await pdf.getPage(index + 1);
        const natural = source.getViewport({ scale: 1 });
        const viewport = source.getViewport({ scale: page.size.w / natural.width });
        const content = await source.getTextContent();
        const items = content.items.filter((item): item is typeof item & RawTextItem => "str" in item) as RawTextItem[];
        const boxes = textBoxes(items, viewport.transform as number[]);
        lineCache.set(key, mergeLines(boxes));
        return boxes;
      } catch {
        return [];
      }
    })();
    boxCache.set(key, pending);
  }
  return pending;
}

/** The lines of a PDF page's text if they have been read; otherwise they are fetched for next time. */
export function cachedLines(fs: FS, notebookID: string, page: Page): Rect[] | null {
  const key = keyOf(notebookID, page);
  if (!key) return null;
  const have = lineCache.get(key);
  if (have) return have;
  void pdfTextBoxes(fs, notebookID, page);
  return null;
}

/** Forgets what was read from a notebook's PDFs, when its files change. */
export function forgetPdfText(notebookID: string): void {
  for (const map of [boxCache, lineCache] as Map<string, unknown>[]) {
    for (const key of [...map.keys()]) if (key.startsWith(notebookID + "/")) map.delete(key);
  }
}
