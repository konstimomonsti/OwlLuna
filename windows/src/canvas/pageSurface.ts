// The canvases of one page on screen. Only the part of the page in view is backed by pixels, at the screen's own
// sharpness, so ink stays sharp at any zoom and a whiteboard can go on for ever.

import type { Rect, Stroke } from "../model/ink";
import type { Page } from "../model/notebook";
import type { NotebookDocument } from "../editor/document";
import { backdrops } from "./backdrops";
import { drawPaper, drawStrokes, pageIsDark } from "./renderPage";

export interface SurfaceView {
  /** Screen pixels to a page point. */
  zoom: number;
  /** The part of the page to back with pixels, in points: what is in view and a margin round it. */
  visible: Rect;
  dpr: number;
}

export interface LiveInk {
  strokes: Stroke[];
  /** Moves and scales them as they are drawn: a lasso being dragged. */
  dx?: number;
  dy?: number;
  scale?: number;
  origin?: { x: number; y: number };
}

export class PageSurface {
  private view: SurfaceView | null = null;
  private drawnKey = "";
  private live: LiveInk | null = null;
  private override: Stroke[] | null = null;
  private hidden: Set<string> | null = null;
  private frame = 0;
  private stopBackdrops: () => void;

  constructor(
    private doc: NotebookDocument,
    private pageID: string,
    private canvases: { paper: HTMLCanvasElement; marker: HTMLCanvasElement; ink: HTMLCanvasElement; live: HTMLCanvasElement },
  ) {
    this.stopBackdrops = backdrops.subscribe(() => this.invalidate());
  }

  destroy(): void {
    this.stopBackdrops();
    cancelAnimationFrame(this.frame);
    for (const canvas of Object.values(this.canvases)) canvas.width = canvas.height = 0;
  }

  private get page(): Page | undefined {
    return this.doc.page(this.pageID);
  }

  setView(view: SurfaceView): void {
    const same = this.view && this.view.zoom === view.zoom && this.view.dpr === view.dpr
      && this.view.visible.x === view.visible.x && this.view.visible.y === view.visible.y
      && this.view.visible.w === view.visible.w && this.view.visible.h === view.visible.h;
    this.view = view;
    if (!same) this.invalidate();
  }

  /** Ink being written, or being carried by the lasso. */
  setLive(live: LiveInk | null): void {
    this.live = live;
    this.drawLive();
  }

  /** Ink to show in place of the document's, while the eraser is down. */
  setOverride(strokes: Stroke[] | null): void {
    this.override = strokes;
    this.invalidate();
  }

  setHidden(ids: Set<string> | null): void {
    this.hidden = ids && ids.size ? ids : null;
    this.invalidate();
  }

  /** Draws again on the next frame, if anything it shows has changed. */
  invalidate(): void {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => this.draw());
  }

  private place(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
    const view = this.view!;
    const width = Math.max(1, Math.round(view.visible.w * view.zoom * view.dpr));
    const height = Math.max(1, Math.round(view.visible.h * view.zoom * view.dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    canvas.style.left = `${view.visible.x * view.zoom}px`;
    canvas.style.top = `${view.visible.y * view.zoom}px`;
    canvas.style.width = `${view.visible.w * view.zoom}px`;
    canvas.style.height = `${view.visible.h * view.zoom}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const scale = view.zoom * view.dpr;
    ctx.setTransform(scale, 0, 0, scale, -view.visible.x * scale, -view.visible.y * scale);
    return ctx;
  }

  private draw(): void {
    const view = this.view, page = this.page;
    if (!view || !page || view.visible.w <= 0 || view.visible.h <= 0) return;
    const ink = this.override ?? this.doc.ink(this.pageID);
    const dark = pageIsDark(page);
    const scale = view.zoom * view.dpr;
    const backdrop = backdrops.backdrop(this.doc.fs, this.doc.id, page.background, page.size, scale);
    const key = [
      view.zoom, view.dpr, view.visible.x, view.visible.y, view.visible.w, view.visible.h,
      this.doc.inkVersion(this.pageID), this.override ? "o" + this.override.length : "", this.hidden ? [...this.hidden].join() : "",
      JSON.stringify(page.background), page.paperColor, page.size.w, page.size.h,
      backdrop ? `${backdrop.width}x${backdrop.height}` : "none",
    ].join("|");
    if (key === this.drawnKey && !this.override) {
      this.drawLive();
      return;
    }
    this.drawnKey = key;

    const paper = this.place(this.canvases.paper);
    if (paper) drawPaper(paper, page, { visible: view.visible, pixelsPerPoint: scale, backdrop });

    // Highlighter sits on a canvas of its own that the browser multiplies into the page, pictures and text included.
    const hasMarker = ink.some((stroke) => stroke.ink === "highlighter");
    this.canvases.marker.style.mixBlendMode = dark ? "normal" : "multiply";
    if (hasMarker) {
      const marker = this.place(this.canvases.marker);
      if (marker) drawStrokes(marker, ink, { darkPaper: dark, layer: "marker", visible: view.visible, hidden: this.hidden, blendedByCanvas: true });
      this.canvases.marker.style.display = "";
    } else {
      this.canvases.marker.style.display = "none";
    }

    const inkCtx = this.place(this.canvases.ink);
    if (inkCtx) drawStrokes(inkCtx, ink, { darkPaper: dark, layer: "ink", visible: view.visible, hidden: this.hidden });
    this.drawLive();
  }

  private drawLive(): void {
    const view = this.view, page = this.page;
    if (!view || !page) return;
    const canvas = this.canvases.live;
    if (!this.live || this.live.strokes.length === 0) {
      if (canvas.style.display !== "none") {
        canvas.style.display = "none";
        canvas.width = canvas.height = 0;
      }
      return;
    }
    canvas.style.display = "";
    const ctx = this.place(canvas);
    if (!ctx) return;
    const { dx = 0, dy = 0, scale = 1, origin = { x: 0, y: 0 } } = this.live;
    if (dx || dy || scale !== 1) {
      ctx.translate(origin.x + dx, origin.y + dy);
      ctx.scale(scale, scale);
      ctx.translate(-origin.x, -origin.y);
    }
    drawStrokes(ctx, this.live.strokes, { darkPaper: pageIsDark(page), layer: "all" });
  }
}

/**
 * The part of a page to back with pixels: what shows through `viewport` (in the page's own pixels) and a margin
 * round it, cut to the page unless it has no edges. The margin is in steps, so small scrolls draw nothing new.
 */
export function visiblePart(page: Page, zoom: number, viewport: Rect, margin = 160): Rect {
  const step = 128;
  const left = Math.floor((viewport.x - margin) / step) * step;
  const top = Math.floor((viewport.y - margin) / step) * step;
  const right = Math.ceil((viewport.x + viewport.w + margin) / step) * step;
  const bottom = Math.ceil((viewport.y + viewport.h + margin) / step) * step;
  let x0 = left / zoom, y0 = top / zoom, x1 = right / zoom, y1 = bottom / zoom;
  if (!page.edgeless) {
    x0 = Math.max(x0, 0);
    y0 = Math.max(y0, 0);
    x1 = Math.min(x1, page.size.w);
    y1 = Math.min(y1, page.size.h);
  }
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}
