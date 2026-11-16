// Drawing paper and ink into a 2D canvas. The context is already scaled so that one unit is one page point.

import { rectsIntersect, strokeBounds, type Rect, type Stroke } from "../model/ink";
import type { Page } from "../model/notebook";
import { isDarkPaper, paperCSS } from "../model/paper";
import { rgbaCSS } from "../model/tools";
import { displayColor, inkLooks, strokePath } from "./strokeGeometry";
import { boardOps, rgbaString, templateOps, type TemplateOp } from "./templates";

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

const path2DCache = new WeakMap<Stroke, Path2D>();

function pathOf(stroke: Stroke): Path2D {
  let path = path2DCache.get(stroke);
  if (!path) {
    path = new Path2D(strokePath(stroke));
    path2DCache.set(stroke, path);
  }
  return path;
}

const patterns = new Map<string, CanvasPattern>();

/** Grain for pencil and crayon: a tile of the ink's colour with holes in it, so paper shows through. */
function texture(ctx: Ctx, kind: "grain" | "wax", css: string): CanvasPattern | string {
  const key = kind + css;
  const have = patterns.get(key);
  if (have) return have;
  const size = 48;
  const tile = document.createElement("canvas");
  tile.width = tile.height = size;
  const tctx = tile.getContext("2d")!;
  tctx.fillStyle = css;
  tctx.fillRect(0, 0, size, size);
  const image = tctx.getImageData(0, 0, size, size);
  let seed = kind === "grain" ? 0x2f6e2b1 : 0x9e3779b9;
  const random = () => {
    seed ^= seed << 13; seed >>>= 0;
    seed ^= seed >>> 17;
    seed ^= seed << 5; seed >>>= 0;
    return seed / 0x100000000;
  };
  for (let i = 3; i < image.data.length; i += 4) {
    const r = random();
    const keep = kind === "grain" ? 0.45 + r * 0.55 : r < 0.16 ? 0.25 : 0.8 + r * 0.2;
    image.data[i] = Math.round(image.data[i] * keep);
  }
  tctx.putImageData(image, 0, 0);
  const pattern = ctx.createPattern(tile, "repeat");
  if (!pattern) return css;
  // The tile is drawn at a third of a point a pixel, so the grain stays fine at any zoom.
  pattern.setTransform(new DOMMatrix().scale(1 / 3));
  if (patterns.size > 96) patterns.clear();
  patterns.set(key, pattern);
  return pattern;
}

export type InkLayer = "all" | "marker" | "ink";

export interface InkOptions {
  darkPaper: boolean;
  layer?: InkLayer;
  /** Only strokes that reach this rectangle are drawn. */
  visible?: Rect;
  /** Strokes left out, by ID: those being moved or rubbed out. */
  hidden?: Set<string> | null;
  /** Fills highlighter flat, where the canvas itself is blended with what is under it. */
  blendedByCanvas?: boolean;
}

export function drawStroke(ctx: Ctx, stroke: Stroke, options: InkOptions): void {
  const look = inkLooks[stroke.ink];
  const color = displayColor(stroke.color, options.darkPaper);
  const css = rgbaCSS(color, look.alpha);
  const path = pathOf(stroke);
  if (look.multiply && !options.blendedByCanvas && !options.darkPaper) {
    ctx.save();
    ctx.globalCompositeOperation = "multiply";
    ctx.fillStyle = css;
    ctx.fill(path, "nonzero");
    ctx.restore();
    return;
  }
  ctx.fillStyle = look.texture === "none" ? css : texture(ctx, look.texture, css);
  ctx.fill(path, "nonzero");
  if (look.edge) {
    ctx.strokeStyle = rgbaCSS(color, 0.28);
    ctx.lineWidth = Math.max(stroke.width * 0.06, 0.4);
    ctx.stroke(path);
  }
}

export function drawStrokes(ctx: Ctx, strokes: Stroke[], options: InkOptions): void {
  const layer = options.layer ?? "all";
  for (const stroke of strokes) {
    const marker = inkLooks[stroke.ink].multiply;
    if (layer === "marker" ? !marker : layer === "ink" ? marker : false) continue;
    if (options.hidden?.has(stroke.id)) continue;
    if (options.visible && !rectsIntersect(strokeBounds(stroke), options.visible)) continue;
    drawStroke(ctx, stroke, options);
  }
}

export function drawOps(ctx: Ctx, ops: TemplateOp[]): void {
  for (const op of ops) {
    switch (op.op) {
      case "lines":
        ctx.save();
        ctx.beginPath();
        for (let i = 0; i < op.segs.length; i += 4) {
          ctx.moveTo(op.segs[i], op.segs[i + 1]);
          ctx.lineTo(op.segs[i + 2], op.segs[i + 3]);
        }
        ctx.strokeStyle = rgbaString(op.color);
        ctx.lineWidth = op.width;
        if (op.dash) ctx.setLineDash(op.dash);
        if (op.round) ctx.lineCap = "round";
        ctx.stroke();
        ctx.restore();
        break;
      case "dots":
        ctx.fillStyle = rgbaString(op.color);
        ctx.beginPath();
        for (let i = 0; i < op.pts.length; i += 2) {
          ctx.moveTo(op.pts[i] + op.radius, op.pts[i + 1]);
          ctx.arc(op.pts[i], op.pts[i + 1], op.radius, 0, Math.PI * 2);
        }
        ctx.fill();
        break;
      case "rects":
        ctx.beginPath();
        for (let i = 0; i < op.rects.length; i += 4) {
          if (op.corner > 0) ctx.roundRect(op.rects[i], op.rects[i + 1], op.rects[i + 2], op.rects[i + 3], op.corner);
          else ctx.rect(op.rects[i], op.rects[i + 1], op.rects[i + 2], op.rects[i + 3]);
        }
        if (op.fill) {
          ctx.fillStyle = rgbaString(op.color);
          ctx.fill();
        } else {
          ctx.strokeStyle = rgbaString(op.color);
          ctx.lineWidth = op.width;
          ctx.stroke();
        }
        break;
      case "text":
        ctx.fillStyle = rgbaString(op.color);
        ctx.font = `600 ${op.size}px "Segoe UI", system-ui, sans-serif`;
        ctx.textAlign = op.align;
        ctx.textBaseline = "alphabetic";
        ctx.fillText(op.text, op.x, op.y);
        break;
    }
  }
}

export type Picture = CanvasImageSource & { width: number; height: number };

export interface PaperOptions {
  /** The part of the page being drawn, in points. */
  visible: Rect;
  /** How many screen pixels a point takes, for a whiteboard's rules. */
  pixelsPerPoint: number;
  /** The PDF page or picture behind the page, once it has been read. */
  backdrop?: Picture | null;
}

/** The paper: its colour, then its rules, or the PDF page or picture it is. */
export function drawPaper(ctx: Ctx, page: Page, options: PaperOptions): void {
  const { visible } = options;
  if (page.background.kind === "template") {
    ctx.fillStyle = paperCSS(page.paperColor);
    ctx.fillRect(visible.x, visible.y, visible.w, visible.h);
    if (page.edgeless) drawOps(ctx, boardOps(page.background.template, page.paperColor, visible, options.pixelsPerPoint));
    else drawOps(ctx, templateOps(page.background.template, page.paperColor, page.size));
    return;
  }
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(visible.x, visible.y, visible.w, visible.h);
  if (options.backdrop) {
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(options.backdrop, 0, 0, page.size.w, page.size.h);
  }
}

export function pageIsDark(page: Page): boolean {
  return page.background.kind === "template" && isDarkPaper(page.paperColor);
}
