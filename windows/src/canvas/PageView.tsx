// One page on screen: its canvases, the items under and over the ink, and whatever is drawn on top of it.

import { memo, useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import type { NotebookDocument } from "../editor/document";
import { STRIDE, type Rect, type Stroke } from "../model/ink";
import type { Page } from "../model/notebook";
import { paperCSS } from "../model/paper";
import { PageSurface, visiblePart } from "./pageSurface";

const canvasStyle = { position: "absolute", pointerEvents: "none" } as const;

/** The ink as it stood at a moment: strokes begun later are left out, and the one being written is cut short. */
export function inkUntil(strokes: Stroke[], until: number): Stroke[] {
  const out: Stroke[] = [];
  for (const stroke of strokes) {
    if (stroke.at > until) continue;
    const last = stroke.pts.length >= STRIDE ? stroke.pts[stroke.pts.length - 1] : 0;
    if (stroke.at + last <= until) {
      out.push(stroke);
      continue;
    }
    const elapsed = until - stroke.at;
    let end = 0;
    while (end < stroke.pts.length && stroke.pts[end + 3] <= elapsed) end += STRIDE;
    if (end >= STRIDE) out.push({ ...stroke, id: stroke.id + "~", pts: stroke.pts.slice(0, end) });
  }
  return out;
}

export interface PageViewProps {
  doc: NotebookDocument;
  page: Page;
  zoom: number;
  /** The window onto the page, in the page's own screen pixels. */
  viewport: Rect;
  left: number;
  top: number;
  register?: (pageID: string, surface: PageSurface | null) => void;
  /** Shows the ink only up to this moment. */
  until?: number | null;
  under?: ReactNode;
  over?: ReactNode;
  top_?: ReactNode;
  inkVersion: number;
}

export const PageView = memo(function PageView(props: PageViewProps) {
  const { doc, page, zoom, viewport } = props;
  const paper = useRef<HTMLCanvasElement>(null);
  const marker = useRef<HTMLCanvasElement>(null);
  const ink = useRef<HTMLCanvasElement>(null);
  const live = useRef<HTMLCanvasElement>(null);
  const surface = useRef<PageSurface | null>(null);

  useEffect(() => {
    const made = new PageSurface(doc, page.id, { paper: paper.current!, marker: marker.current!, ink: ink.current!, live: live.current! });
    surface.current = made;
    props.register?.(page.id, made);
    void doc.ensureInk(page.id);
    return () => {
      props.register?.(page.id, null);
      surface.current = null;
      made.destroy();
    };
  }, [doc, page.id]);

  useLayoutEffect(() => {
    surface.current?.setView({ zoom, visible: visiblePart(page, zoom, viewport), dpr: window.devicePixelRatio || 1 });
  }, [zoom, viewport.x, viewport.y, viewport.w, viewport.h, page.size.w, page.size.h, page.edgeless]);

  // Anything about the page or its ink may have changed; the surface draws only if what it shows did.
  useEffect(() => {
    surface.current?.invalidate();
  }, [page, props.inkVersion]);

  useEffect(() => {
    const until = props.until;
    surface.current?.setOverride(until === null || until === undefined ? null : inkUntil(doc.ink(page.id), until));
  }, [props.until, props.inkVersion]);

  const edgeless = page.edgeless === true;
  return (
    <div
      className="page"
      data-page={page.id}
      data-testid="page"
      style={{
        position: "absolute", left: props.left, top: props.top,
        width: edgeless ? 0 : page.size.w * zoom, height: edgeless ? 0 : page.size.h * zoom,
        background: edgeless ? undefined : page.background.kind === "template" ? paperCSS(page.paperColor) : "#FFFFFF",
        boxShadow: edgeless ? undefined : "0 1px 2px var(--shade), 0 8px 24px -12px var(--shade)",
        overflow: edgeless ? "visible" : "hidden",
      }}
    >
      <canvas ref={paper} style={canvasStyle} />
      {props.under}
      <canvas ref={marker} style={canvasStyle} />
      <canvas ref={ink} style={canvasStyle} data-testid="ink-canvas" />
      {props.over}
      <canvas ref={live} style={canvasStyle} />
      {props.top_}
    </div>
  );
});
