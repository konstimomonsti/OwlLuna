// Paper templates as lists of rules to draw. Ported from OwlLuna/Canvas/PaperTemplates.swift: rules scale with the
// page width on an 800-unit grid. The canvas and the PDF export both draw from these lists.

import { isDarkPaper, type PaperColor, type PaperTemplate } from "../model/paper";
import type { Rect } from "../model/ink";

export type RGBA = [number, number, number, number];

export type TemplateOp =
  | { op: "lines"; segs: number[]; color: RGBA; width: number; dash?: number[]; round?: boolean }
  | { op: "dots"; pts: number[]; radius: number; color: RGBA }
  | { op: "rects"; rects: number[]; color: RGBA; width: number; corner: number; fill?: boolean }
  | { op: "text"; text: string; x: number; y: number; size: number; color: RGBA; align: "left" | "right" };

export interface TemplateInk {
  line: RGBA;
  accent: RGBA;
  strong: RGBA;
  grid: number;
  dots: number;
}

/** The colours a template draws with on a given paper. */
export function templateInk(color: PaperColor): TemplateInk {
  switch (color) {
    case "white": case "ivory": case "yellow": case "gray":
      return { line: [0.55, 0.68, 0.84, 0.55], accent: [0.9, 0.35, 0.35, 0.45], strong: [0.35, 0.35, 0.35, 0.7], grid: 0.35, dots: 0.9 };
    case "charcoal":
      return { line: [1, 1, 1, 0.16], accent: [1, 0.45, 0.45, 0.35], strong: [1, 1, 1, 0.3], grid: 0.12, dots: 0.35 };
    case "kraft":
      return { line: [0.42, 0.31, 0.19, 0.45], accent: [0.72, 0.24, 0.18, 0.45], strong: [0.3, 0.21, 0.12, 0.72], grid: 0.3, dots: 0.6 };
    case "sage":
      return { line: [0.3, 0.45, 0.35, 0.45], accent: [0.75, 0.3, 0.3, 0.4], strong: [0.2, 0.3, 0.23, 0.72], grid: 0.3, dots: 0.7 };
    case "blush":
      return { line: [0.7, 0.42, 0.44, 0.4], accent: [0.78, 0.28, 0.3, 0.45], strong: [0.42, 0.22, 0.24, 0.72], grid: 0.32, dots: 0.7 };
    case "chalkboard":
      return { line: [1, 1, 1, 0.2], accent: [0.91, 0.69, 0.14, 0.45], strong: [1, 1, 1, 0.5], grid: 0.12, dots: 0.35 };
  }
}

const withAlpha = (color: RGBA, alpha: number): RGBA => [color[0], color[1], color[2], alpha];
const faded = (color: RGBA, factor: number): RGBA => [color[0], color[1], color[2], Math.min(1, color[3] * factor)];

/** The gap between the lines written on, in units of an 800-wide page; 0 for paper without an even ruling. */
export function lineGap(template: PaperTemplate): number {
  switch (template) {
    case "grid": case "dotted": return 26;
    case "narrowRuled": return 28;
    case "cornell": return 30;
    case "wideRuled": case "checklist": return 38;
    default: return 0;
  }
}

/** Positions summed step by step, as the original loops did. */
function steps(from: number, by: number, keep: (value: number) => boolean): number[] {
  const values: number[] = [];
  if (by <= 0) return values;
  for (let value = from; keep(value) && values.length < 5000; value += by) values.push(value);
  return values;
}

function hLines(ys: number[], from: number, to: number): number[] {
  return ys.flatMap((y) => [from, y, to, y]);
}

function vLines(xs: number[], from: number, to: number): number[] {
  return xs.flatMap((x) => [x, from, x, to]);
}

function boxes(rects: Rect[]): number[] {
  return rects.flatMap((rect) => [rect.x, rect.y, rect.w, rect.h]);
}

/** Lines at `angle` across the whole page, `spacing` apart, each cut to the page. */
function diagonalFamily(angle: number, spacing: number, width: number, height: number): number[] {
  const slope = Math.tan(angle), step = spacing / Math.cos(angle);
  const segs: number[] = [];
  // y = slope * x + c. c runs over every value whose line touches the page.
  const low = Math.min(0, -slope * width), high = Math.max(height, height - slope * width);
  const first = Math.ceil(low / step), last = Math.floor(high / step);
  for (let index = first; index <= last && segs.length < 40000; index++) {
    const c = index * step;
    const points: [number, number][] = [];
    const push = (x: number, y: number) => {
      if (x >= -1e-6 && x <= width + 1e-6 && y >= -1e-6 && y <= height + 1e-6) points.push([x, y]);
    };
    push(0, c);
    push(width, slope * width + c);
    if (slope !== 0) {
      push(-c / slope, 0);
      push((height - c) / slope, height);
    }
    if (points.length < 2) continue;
    points.sort((a, b) => a[0] - b[0]);
    const a = points[0], b = points[points.length - 1];
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) > 0.5) segs.push(a[0], a[1], b[0], b[1]);
  }
  return segs;
}

export interface TemplateLabels {
  hours: string[];
  days: string[];
}

/** The day planner's hours, 7 to 21, and the week planner's days with a box for notes. */
export function templateLabels(locale?: string): TemplateLabels {
  const hours = Array.from({ length: 15 }, (_, index) =>
    new Date(2024, 0, 1, 7 + index).toLocaleTimeString(locale, { hour: "numeric" }).replace(/ /g, " "));
  // 1 January 2024 was a Monday.
  const days = Array.from({ length: 7 }, (_, index) => new Date(2024, 0, 1 + index).toLocaleDateString(locale, { weekday: "long" }));
  return { hours, days: [...days, "Notes"] };
}

export function templateOps(template: PaperTemplate, color: PaperColor, size: { w: number; h: number }, labels: TemplateLabels = templateLabels()): TemplateOp[] {
  const unit = size.w / 800;
  const ink = templateInk(color);
  const width = size.w, height = size.h;
  const hair = Math.max(0.5, unit);
  const ops: TemplateOp[] = [];
  const stroke = (segs: number[], strokeColor: RGBA, lineWidth = hair, extra: { dash?: number[]; round?: boolean } = {}) => {
    if (segs.length) ops.push({ op: "lines", segs, color: strokeColor, width: lineWidth, ...extra });
  };

  switch (template) {
    case "blank":
      break;
    case "narrowRuled":
    case "wideRuled":
      stroke(hLines(steps(120 * unit, lineGap(template) * unit, (y) => y < height - 20 * unit), 0, width), ink.line);
      stroke(vLines([104 * unit], 0, height), ink.accent);
      break;
    case "grid": {
      const spacing = 26 * unit;
      stroke([...vLines(steps(spacing, spacing, (x) => x < width), 0, height), ...hLines(steps(spacing, spacing, (y) => y < height), 0, width)], withAlpha(ink.line, ink.grid));
      break;
    }
    case "dotted": {
      const spacing = 26 * unit;
      const xs = steps(spacing, spacing, (x) => x < width), ys = steps(spacing, spacing, (y) => y < height);
      ops.push({ op: "dots", pts: ys.flatMap((y) => xs.flatMap((x) => [x, y])), radius: Math.max(0.8, 1.6 * unit), color: withAlpha(ink.line, ink.dots) });
      break;
    }
    case "cornell": {
      const summaryTop = height * 0.8, cueRight = 240 * unit;
      stroke(hLines(steps(120 * unit, lineGap(template) * unit, (y) => y < summaryTop), cueRight, width), ink.line);
      stroke([...hLines([90 * unit], 0, width), ...vLines([cueRight], 90 * unit, summaryTop), ...hLines([summaryTop], 0, width)], ink.accent, Math.max(1, 2 * unit));
      break;
    }
    case "music": {
      const staffGap = 10 * unit, staffHeight = staffGap * 4;
      const tops = steps(100 * unit, staffHeight + 60 * unit, (y) => y + staffHeight < height - 60 * unit);
      stroke(hLines(tops.flatMap((top) => [0, 1, 2, 3, 4].map((line) => top + line * staffGap)), 60 * unit, width - 60 * unit), ink.strong);
      break;
    }
    case "engineering": {
      const step = 18 * unit, left = 40 * unit, top = 80 * unit;
      const rows = Math.max(1, Math.floor((height - 40 * unit - top) / step));
      const xs = Array.from({ length: 41 }, (_, index) => left + index * step);
      const ys = Array.from({ length: rows + 1 }, (_, index) => top + index * step);
      const right = xs[xs.length - 1], bottom = ys[ys.length - 1];
      const isMajor = (index: number, count: number) => index % 5 === 0 || index === count - 1;
      stroke([
        ...vLines(xs.filter((_, index) => !isMajor(index, xs.length)), top, bottom),
        ...hLines(ys.filter((_, index) => !isMajor(index, ys.length)), left, right),
      ], faded(ink.line, 0.5));
      stroke([
        ...vLines(xs.filter((_, index) => isMajor(index, xs.length)), top, bottom),
        ...hLines(ys.filter((_, index) => isMajor(index, ys.length)), left, right),
      ], ink.line);
      stroke(hLines([60 * unit], left, right), ink.accent, Math.max(0.75, 1.5 * unit));
      break;
    }
    case "isometric": {
      const spacing = 24.25 * unit;
      const xs = Array.from({ length: Math.max(0, Math.ceil(width / spacing) - 1) }, (_, index) => (index + 1) * spacing);
      stroke([
        ...vLines(xs, 0, height),
        ...diagonalFamily(Math.PI / 6, spacing, width, height),
        ...diagonalFamily(-Math.PI / 6, spacing, width, height),
      ], withAlpha(ink.line, ink.grid));
      break;
    }
    case "checklist": {
      const ys = steps(120 * unit, lineGap(template) * unit, (y) => y < height - 20 * unit);
      stroke(hLines(ys, 0, width), ink.line);
      ops.push({ op: "rects", rects: boxes(ys.map((y) => ({ x: 36 * unit, y: y - 20 * unit, w: 14 * unit, h: 14 * unit }))), color: ink.strong, width: Math.max(0.75, 1.25 * unit), corner: 2.5 * unit });
      stroke(vLines([72 * unit], 0, height), ink.accent);
      break;
    }
    case "penmanship": {
      const band = 20 * unit;
      const groups = steps(110 * unit, band * 3 + 24 * unit, (y) => y + band * 3 < height - 20 * unit);
      stroke(hLines(groups, 0, width), faded(ink.line, 0.9));
      stroke(hLines(groups.map((y) => y + band * 3), 0, width), faded(ink.line, 0.64));
      stroke(hLines(groups.map((y) => y + band * 2), 0, width), ink.line, Math.max(0.75, 1.5 * unit));
      stroke(hLines(groups.map((y) => y + band), 0, width), ink.line, hair, { dash: [6 * unit, 4 * unit] });
      stroke(vLines([72 * unit], 0, height), ink.accent);
      break;
    }
    case "dayPlanner": {
      const top = 130 * unit, bottom = height - 40 * unit;
      const hour = (bottom - top) / 15;
      const hourRules = Array.from({ length: 16 }, (_, index) => top + index * hour);
      const boxRules = Array.from({ length: 6 }, (_, index) => 150 * unit + index * 38 * unit);
      const notesTop = boxRules[boxRules.length - 1] + 68 * unit;
      stroke([
        ...hLines(hourRules, 104 * unit, 540 * unit),
        ...vLines([560 * unit], 100 * unit, bottom),
        ...hLines([...boxRules, ...steps(notesTop, 30 * unit, (y) => y <= bottom)], 576 * unit, 776 * unit),
      ], ink.line);
      stroke(hLines(Array.from({ length: 15 }, (_, index) => top + (index + 0.5) * hour), 104 * unit, 540 * unit), ink.line, Math.max(0.75, 1.25 * unit), { dash: [0, 5 * unit], round: true });
      ops.push({ op: "rects", rects: boxes(boxRules.map((y) => ({ x: 576 * unit, y: y - 20 * unit, w: 14 * unit, h: 14 * unit }))), color: ink.strong, width: Math.max(0.75, 1.25 * unit), corner: 2.5 * unit });
      stroke(hLines([100 * unit], 0, width), ink.accent, Math.max(1, 2 * unit));
      hourRules.slice(0, -1).forEach((y, index) => {
        ops.push({ op: "text", text: labels.hours[index] ?? "", x: 88 * unit, y: y + 14 * unit, size: 13 * unit, color: ink.strong, align: "right" });
      });
      break;
    }
    case "weekPlanner": {
      const [columns, rows] = height >= width ? [2, 4] : [4, 2];
      const margin = 32 * unit, gap = 16 * unit, header = 30 * unit;
      const boxWidth = (width - margin * 2 - gap * (columns - 1)) / columns;
      const boxHeight = (height - margin * 2 - gap * (rows - 1)) / rows;
      const cells: Rect[] = Array.from({ length: 8 }, (_, index) => ({
        x: margin + (index % columns) * (boxWidth + gap), y: margin + Math.floor(index / columns) * (boxHeight + gap), w: boxWidth, h: boxHeight,
      }));
      ops.push({ op: "rects", rects: boxes(cells.map((cell) => ({ x: cell.x, y: cell.y, w: boxWidth, h: header }))), color: faded(ink.line, 0.18), width: 0, corner: 0, fill: true });
      stroke(cells.flatMap((cell) => hLines(steps(cell.y + header * 2, 30 * unit, (y) => y < cell.y + cell.h - 8 * unit), cell.x + 8 * unit, cell.x + cell.w - 8 * unit)), ink.line);
      const frame = faded(ink.line, 0.8 / 0.55);
      ops.push({ op: "rects", rects: boxes(cells), color: frame, width: hair, corner: 0 });
      stroke(cells.flatMap((cell) => hLines([cell.y + header], cell.x, cell.x + cell.w)), frame);
      cells.forEach((cell, index) => {
        ops.push({ op: "text", text: labels.days[index] ?? "", x: cell.x + 10 * unit, y: cell.y + 19.5 * unit, size: 12 * unit, color: ink.strong, align: "left" });
      });
      break;
    }
    case "storyboard": {
      const [columns, rows] = height >= width ? [2, 3] : [3, 2];
      const margin = 40 * unit, gap = 28 * unit, captions = 44 * unit;
      let frameWidth = (width - margin * 2 - gap * (columns - 1)) / columns;
      const tallest = (height - margin * 2 - gap * (rows - 1)) / rows - captions;
      frameWidth = Math.min(frameWidth, (tallest * 16) / 9);
      const frameHeight = (frameWidth * 9) / 16;
      const gridWidth = frameWidth * columns + gap * (columns - 1);
      const gridHeight = (frameHeight + captions) * rows + gap * (rows - 1);
      const originX = (width - gridWidth) / 2, originY = (height - gridHeight) / 2;
      const frames: Rect[] = Array.from({ length: columns * rows }, (_, index) => ({
        x: originX + (index % columns) * (frameWidth + gap), y: originY + Math.floor(index / columns) * (frameHeight + captions + gap), w: frameWidth, h: frameHeight,
      }));
      stroke(frames.flatMap((frame) => hLines([frame.y + frame.h + 22 * unit, frame.y + frame.h + captions], frame.x, frame.x + frame.w)), ink.line);
      ops.push({ op: "rects", rects: boxes(frames), color: ink.strong, width: Math.max(0.75, 1.5 * unit), corner: 0 });
      break;
    }
  }
  return ops;
}

/** A whiteboard is ruled as a Letter page would be: its unit is a Letter page's. */
export const boardUnit = 612 / 800;

/**
 * A whiteboard's rules have no margins and never end: only those inside `visible` are made. Zoomed far out, every
 * second or fourth rule is left out rather than run together. `pixelsPerPoint` is how big a point is on screen.
 */
export function boardOps(template: PaperTemplate, color: PaperColor, visible: Rect, pixelsPerPoint: number): TemplateOp[] {
  const gap = template === "grid" || template === "dotted" || template === "narrowRuled" || template === "wideRuled" ? lineGap(template) : 0;
  if (gap <= 0 || pixelsPerPoint <= 0) return [];
  let step = gap * boardUnit;
  while (step * pixelsPerPoint < 14) step *= 2;
  const marks = (low: number, high: number): number[] => {
    const first = Math.floor(low / step), last = Math.ceil(high / step);
    if (last - first > 4000) return [];
    return Array.from({ length: last - first + 1 }, (_, index) => (first + index) * step);
  };
  const xs = marks(visible.x, visible.x + visible.w), ys = marks(visible.y, visible.y + visible.h);
  const ink = templateInk(color);
  const hair = Math.max(0.5 / pixelsPerPoint, boardUnit);
  if (template === "dotted") {
    return [{ op: "dots", pts: ys.flatMap((y) => xs.flatMap((x) => [x, y])), radius: Math.max(0.8 / pixelsPerPoint, 1.6 * boardUnit), color: withAlpha(ink.line, ink.dots) }];
  }
  const segs = hLines(ys, visible.x, visible.x + visible.w);
  if (template === "grid") segs.push(...vLines(xs, visible.y, visible.y + visible.h));
  return [{ op: "lines", segs, color: template === "grid" ? withAlpha(ink.line, ink.grid) : ink.line, width: hair }];
}

export function rgbaString(color: RGBA): string {
  return `rgba(${Math.round(color[0] * 255)}, ${Math.round(color[1] * 255)}, ${Math.round(color[2] * 255)}, ${+color[3].toFixed(3)})`;
}

/** The ink colour typed text and ruled labels take on this paper. */
export function paperTextColor(color: PaperColor): string {
  return isDarkPaper(color) ? "#ECE6DA" : "#1B2230";
}
