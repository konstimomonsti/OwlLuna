// A whiteboard's own controls: zoom, show everything, back to the start, and a small map of where the view is.

import { House, Maximize2, Minus, Plus } from "lucide-react";
import { useEffect, useRef, useSyncExternalStore, type RefObject } from "react";
import { useStore } from "zustand";
import { BOARD_MAX_ZOOM, BOARD_MIN_ZOOM, boardContentBounds, fitBoard } from "../canvas/board";
import { displayColor } from "../canvas/strokeGeometry";
import { IconButton } from "../design/controls";
import { STRIDE, unionRects, type Rect } from "../model/ink";
import { isDarkPaper, paperCSS } from "../model/paper";
import type { NotebookDocument } from "./document";
import type { EditorCanvasHandle } from "./EditorCanvas";
import type { Session } from "./session";
import { capturePointer } from "../canvas/pointer";

export const START_VIEW = { x: -40, y: -40 };

export function backToStart(session: Session): void {
  session.setState({ board: { ...START_VIEW }, zoom: 1, fit: null });
}

/** Brings all the content into the view; an empty board goes back to the start. */
export function showEverything(doc: NotebookDocument, session: Session, view: { w: number; h: number }): void {
  const page = doc.manifest.pages[0];
  const bounds = page ? boardContentBounds(doc.ink(page.id), page.items) : null;
  if (!bounds || view.w <= 0 || view.h <= 0) return backToStart(session);
  const { zoom, origin } = fitBoard(bounds, view);
  session.setState({ zoom, board: origin, fit: null });
}

const MAP_W = 160, MAP_H = 110, MAX_POINTS = 4000;

interface MapFrame {
  scale: number;
  /** The board point at the map's top-left. */
  x: number;
  y: number;
}

function frameFor(content: Rect | null, view: Rect): MapFrame {
  const extent = unionRects(content ? [content, view] : [view])!;
  const room = 6;
  const scale = Math.min((MAP_W - room * 2) / Math.max(extent.w, 1), (MAP_H - room * 2) / Math.max(extent.h, 1));
  return { scale, x: extent.x + extent.w / 2 - MAP_W / 2 / scale, y: extent.y + extent.h / 2 - MAP_H / 2 / scale };
}

export function BoardControls(props: { doc: NotebookDocument; session: Session; canvas: RefObject<EditorCanvasHandle | null> }) {
  const { doc, session, canvas } = props;
  const version = useSyncExternalStore(doc.subscribe, doc.getVersion);
  const state = useStore(session);
  const page = doc.manifest.pages[0];
  const map = useRef<HTMLCanvasElement>(null);
  const frozen = useRef<MapFrame | null>(null);
  const frame = useRef<MapFrame>({ scale: 1, x: 0, y: 0 });
  const view = canvas.current?.viewSize() ?? { w: 0, h: 0 };
  const strokes = page ? doc.ink(page.id) : [];
  const content = page ? boardContentBounds(strokes, page.items) : null;

  useEffect(() => {
    const element = map.current;
    if (!element || !page || !content) return;
    const dpr = window.devicePixelRatio || 1;
    element.width = MAP_W * dpr;
    element.height = MAP_H * dpr;
    const ctx = element.getContext("2d");
    if (!ctx) return;
    const viewRect: Rect = { x: state.board.x, y: state.board.y, w: view.w / state.zoom, h: view.h / state.zoom };
    const at = frozen.current ?? frameFor(content, viewRect);
    frame.current = at;
    const dark = isDarkPaper(page.paperColor);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = paperCSS(page.paperColor);
    ctx.fillRect(0, 0, MAP_W, MAP_H);
    ctx.translate(-at.x * at.scale, -at.y * at.scale);
    ctx.scale(at.scale, at.scale);
    // A hairline stays a hairline whatever the map's scale.
    ctx.lineWidth = 1 / at.scale;
    ctx.lineJoin = "round";
    const total = strokes.reduce((sum, stroke) => sum + stroke.pts.length / STRIDE, 0);
    const skip = Math.max(1, Math.ceil(total / MAX_POINTS));
    for (const stroke of strokes) {
      const colour = displayColor(stroke.color, dark);
      const alpha = Math.max(((colour & 255) / 255) * (stroke.ink === "highlighter" ? 0.6 : 1), 0.35);
      ctx.strokeStyle = `rgba(${(colour >>> 24) & 255}, ${(colour >>> 16) & 255}, ${(colour >>> 8) & 255}, ${alpha})`;
      ctx.beginPath();
      const count = Math.floor(stroke.pts.length / STRIDE);
      if (count === 0) continue;
      ctx.moveTo(stroke.pts[0], stroke.pts[1]);
      for (let i = skip; i < count; i += skip) ctx.lineTo(stroke.pts[i * STRIDE], stroke.pts[i * STRIDE + 1]);
      // The last point is always kept, so a short stroke still shows its end.
      if (count > 1) ctx.lineTo(stroke.pts[(count - 1) * STRIDE], stroke.pts[(count - 1) * STRIDE + 1]);
      else ctx.lineTo(stroke.pts[0] + 0.5 / at.scale, stroke.pts[1]);
      ctx.stroke();
    }
    ctx.fillStyle = dark ? "rgba(236,230,218,0.55)" : "rgba(27,34,48,0.45)";
    for (const item of page.items) ctx.fillRect(item.x - item.w / 2, item.y - item.h / 2, item.w, item.h);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.strokeStyle = "#2747B8";
    ctx.lineWidth = 1.5;
    ctx.strokeRect((viewRect.x - at.x) * at.scale, (viewRect.y - at.y) * at.scale, viewRect.w * at.scale, viewRect.h * at.scale);
  }, [version, state.board.x, state.board.y, state.zoom, view.w, view.h, !!content]);

  if (!page) return null;

  const centreOn = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const at = frozen.current ?? frame.current;
    const x = at.x + (event.clientX - box.left) / at.scale, y = at.y + (event.clientY - box.top) / at.scale;
    const size = canvas.current?.viewSize() ?? { w: 0, h: 0 };
    session.setState({ board: { x: x - size.w / state.zoom / 2, y: y - size.h / state.zoom / 2 } });
  };

  return (
    <div className="board-controls" data-hot data-testid="board-controls">
      {content && (
        <div className="plate minimap" data-testid="minimap-plate">
          <canvas
            ref={map}
            data-testid="minimap"
            width={MAP_W}
            height={MAP_H}
            style={{ width: MAP_W, height: MAP_H, display: "block", touchAction: "none", cursor: "crosshair" }}
            onPointerDown={(event) => {
              event.stopPropagation();
              capturePointer(event.currentTarget, event.pointerId);
              frozen.current = frame.current;
              centreOn(event);
            }}
            onPointerMove={(event) => { if (frozen.current) centreOn(event); }}
            onPointerUp={() => { frozen.current = null; }}
            onPointerCancel={() => { frozen.current = null; }}
          />
        </div>
      )}
      <div className="board bar-row">
        <IconButton label="Zoom Out" onClick={() => canvas.current?.zoomAt(0.8)} disabled={state.zoom <= BOARD_MIN_ZOOM + 0.0005} testid="board-zoom-out"><Minus /></IconButton>
        <button type="button" className="btn flat small meta zoom-readout" title="Reset to 100%" onClick={() => canvas.current?.zoomAt(1 / state.zoom)} data-testid="board-zoom-reset">
          {Math.round(state.zoom * 100)}%
        </button>
        <IconButton label="Zoom In" onClick={() => canvas.current?.zoomAt(1.25)} disabled={state.zoom >= BOARD_MAX_ZOOM - 0.0005} testid="board-zoom-in"><Plus /></IconButton>
        <span className="tray-rule" />
        <IconButton label="Show Everything (Ctrl+1)" onClick={() => showEverything(doc, session, canvas.current?.viewSize() ?? { w: 0, h: 0 })} testid="board-show-everything"><Maximize2 /></IconButton>
        <IconButton label="Back to Start (Home)" onClick={() => backToStart(session)} testid="board-back-to-start"><House /></IconButton>
      </div>
    </div>
  );
}
