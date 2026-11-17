// Turns pen, mouse and finger input on the pages into ink and edits. One controller serves a whole editor: the
// page under the pointer when it lands owns the stroke.

import type { NotebookDocument } from "../editor/document";
import { setTool, swapTool, type Session } from "../editor/session";
import {
  STRIDE, eraseFromStroke, inkBounds, makeStroke, pointInPolygon, strokeHit, strokesInLasso, transformStroke, type Point, type Rect, type Stroke,
} from "../model/ink";
import { uuid } from "../model/ids";
import type { Page, PageItem } from "../model/notebook";
import type { ToolPreset } from "../model/tools";
import type { PenAction, Settings } from "../storage/libraryFiles";
import type { PageSurface } from "./pageSurface";
import { draggedShape, holdDuration, holdSlop, loopOutline, recognizeShape, scribbleErased, shapePolylines, type SnappedShape } from "./shapeSnap";
import { snapToLine } from "./pdfText";
import { capturePointer, stepsAlong } from "./pointer";
import { t } from "../i18n";

export interface PagePoint {
  pageID: string;
  x: number;
  y: number;
}

export interface Overlay {
  /** The lasso being drawn. */
  lasso?: { pageID: string; points: Point[] };
  eraser?: { pageID: string; x: number; y: number; radius: number };
  /** A strip of tape being pulled out. */
  band?: { pageID: string; rect: Rect };
  /** The laser pointer's fading trail, in client pixels with the time each was made. */
  laser?: { x: number; y: number; at: number }[];
  /** The selection as it is being dragged or scaled. */
  moving?: { dx: number; dy: number; scale: number };
}

export interface ControllerEnv {
  doc: NotebookDocument;
  session: Session;
  settings(): Settings;
  /** The page under a point of the window, and the point in it. With `nearest`, the closest page when none is under it. */
  pageAt(clientX: number, clientY: number, nearest?: boolean): PagePoint | null;
  /** A point of the window in a given page's points. */
  toPage(pageID: string, clientX: number, clientY: number): Point;
  surface(pageID: string): PageSurface | undefined;
  zoom(): number;
  setOverlay(overlay: Overlay): void;
  panBy(dx: number, dy: number): void;
  zoomAt(factor: number, clientX: number, clientY: number): void;
  /** A tap that made no mark: lift tape, follow a link, tick a box. True if something took it. */
  tap(at: PagePoint, event: PointerEvent): boolean;
  /** The item under a point, topmost first, for the lasso's tap. */
  itemAt(at: PagePoint): PageItem | null;
  act(action: PenAction): void;
  turnPage?(direction: 1 | -1): void;
  /** The lines of text on a PDF page, in page points, once they have been read: where a highlighter snaps. */
  snapLines?(pageID: string): Rect[] | null;
}

interface Operation {
  move(event: PointerEvent): void;
  up(event: PointerEvent): void;
  cancel(): void;
}

const TAP_SLOP = 4;
const TAP_TIME = 350;

function penOf(settings: Settings, session: Session): ToolPreset | undefined {
  const tool = session.getState().tool;
  const pens = settings.pens;
  if (tool.kind === "pen") return pens.find((pen) => pen.id === tool.penID) ?? pens[0];
  const previous = session.getState().previousTool;
  return (previous.kind === "pen" ? pens.find((pen) => pen.id === previous.penID) : undefined) ?? pens[0];
}

function strokePoints(stroke: { pts: number[] }): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < stroke.pts.length; i += STRIDE) out.push({ x: stroke.pts[i], y: stroke.pts[i + 1] });
  return out;
}

export class InkController {
  private operation: Operation | null = null;
  private operationPointer = -1;
  private touches = new Map<number, { x: number; y: number; startX: number; startY: number; at: number }>();
  private gesture: { moved: boolean; count: number; startedAt: number; lastDistance: number; velocity: Point; lastAt: number } | null = null;
  private inertia = 0;
  private overlay: Overlay = {};
  /** Set while the space bar is down: the pointer pans. */
  spaceDown = false;
  private laserTimer = 0;

  constructor(private env: ControllerEnv) {}

  dispose(): void {
    this.operation?.cancel();
    cancelAnimationFrame(this.inertia);
    cancelAnimationFrame(this.laserTimer);
  }

  private show(patch: Overlay): void {
    this.overlay = { ...this.overlay, ...patch };
    this.env.setOverlay(this.overlay);
  }

  get busy(): boolean {
    return this.operation !== null;
  }

  // Pointer events

  down = (event: PointerEvent): void => {
    if (event.pointerType === "touch") {
      this.touchDown(event);
      return;
    }
    if (this.operation) return;
    const target = event.target as HTMLElement;
    capturePointer(target, event.pointerId);
    const settings = this.env.settings();
    const isPen = event.pointerType === "pen";
    // A mouse's middle button, or any button with the space bar held, drags the pages.
    if (event.button === 1 || this.spaceDown) return this.begin(event, this.panOperation(event));
    // The pen's eraser end, and its barrel button, which Windows reports as the right button.
    if (isPen && (event.buttons & 32 || event.button === 5)) return this.begin(event, this.eraseOperation(event));
    if (isPen && (event.buttons & 2 || event.button === 2)) {
      const action = settings.barrelButton;
      if (action === "eraser") return this.begin(event, this.eraseOperation(event));
      if (action === "lasso") return this.begin(event, this.lassoOperation(event));
      if (action !== "none") this.env.act(action);
      return;
    }
    if (event.button !== 0) return;
    this.begin(event, this.toolOperation(event));
  };

  private begin(event: PointerEvent, operation: Operation | null): void {
    if (!operation) return;
    event.preventDefault();
    this.operation = operation;
    this.operationPointer = event.pointerId;
  }

  move = (event: PointerEvent): void => {
    if (event.pointerType === "touch" && this.touches.has(event.pointerId) && !this.touchDraws(event)) {
      this.touchMove(event);
      return;
    }
    if (this.operation && event.pointerId === this.operationPointer) {
      event.preventDefault();
      this.operation.move(event);
    } else if (!this.operation && event.pointerType !== "touch" && this.env.session.getState().tool.kind === "eraser") {
      const at = this.env.pageAt(event.clientX, event.clientY);
      this.show({ eraser: at ? { pageID: at.pageID, x: at.x, y: at.y, radius: this.env.settings().eraserWidth / 2 } : undefined });
    }
  };

  up = (event: PointerEvent): void => {
    if (event.pointerType === "touch" && this.touches.has(event.pointerId) && !this.touchDraws(event)) {
      this.touchUp(event);
      return;
    }
    this.touches.delete(event.pointerId);
    if (this.operation && event.pointerId === this.operationPointer) {
      const operation = this.operation;
      this.operation = null;
      this.operationPointer = -1;
      operation.up(event);
    }
  };

  cancel = (event: PointerEvent): void => {
    this.touches.delete(event.pointerId);
    if (this.touches.size === 0) this.gesture = null;
    if (this.operation && event.pointerId === this.operationPointer) {
      const operation = this.operation;
      this.operation = null;
      this.operationPointer = -1;
      operation.cancel();
    }
  };

  leave = (): void => {
    if (!this.operation && this.overlay.eraser) this.show({ eraser: undefined });
  };

  // Fingers

  private touchDraws(event: PointerEvent): boolean {
    return this.operation !== null && this.operationPointer === event.pointerId;
  }

  private touchDown(event: PointerEvent): void {
    cancelAnimationFrame(this.inertia);
    const settings = this.env.settings();
    const tool = this.env.session.getState().tool;
    this.touches.set(event.pointerId, { x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, at: performance.now() });
    capturePointer(event.target as HTMLElement, event.pointerId);
    // One finger alone writes when fingers draw; a second finger turns it into a pinch and takes the mark back.
    const fingerDraws = settings.drawWith === "penAndFinger" && tool.kind !== "hand";
    if (this.touches.size === 1 && fingerDraws && !this.operation) {
      this.begin(event, this.toolOperation(event));
      if (this.operation) return;
    }
    if (this.operation && this.touches.has(this.operationPointer)) {
      const operation = this.operation;
      this.operation = null;
      this.operationPointer = -1;
      operation.cancel();
    }
    if (this.operation) return; // The pen is writing: a finger landing is the writing hand.
    const now = performance.now();
    this.gesture = {
      moved: this.gesture?.moved ?? false,
      count: Math.max(this.gesture?.count ?? 0, this.touches.size),
      startedAt: this.gesture?.startedAt ?? now,
      lastDistance: this.spread(),
      velocity: { x: 0, y: 0 },
      lastAt: now,
    };
  }

  private spread(): number {
    const points = [...this.touches.values()];
    return points.length >= 2 ? Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y) : 0;
  }

  private centre(): Point {
    const points = [...this.touches.values()];
    return { x: points.reduce((sum, p) => sum + p.x, 0) / points.length, y: points.reduce((sum, p) => sum + p.y, 0) / points.length };
  }

  private touchMove(event: PointerEvent): void {
    const touch = this.touches.get(event.pointerId);
    if (!touch || !this.gesture) return;
    const before = this.centre();
    touch.x = event.clientX;
    touch.y = event.clientY;
    const after = this.centre();
    if (Math.hypot(touch.x - touch.startX, touch.y - touch.startY) > 10) this.gesture.moved = true;
    if (!this.gesture.moved) return;
    const dx = after.x - before.x, dy = after.y - before.y;
    this.env.panBy(-dx, -dy);
    const now = performance.now(), elapsed = Math.max(now - this.gesture.lastAt, 1);
    this.gesture.velocity = { x: 0.7 * this.gesture.velocity.x + (0.3 * dx) / elapsed, y: 0.7 * this.gesture.velocity.y + (0.3 * dy) / elapsed };
    this.gesture.lastAt = now;
    if (this.touches.size >= 2) {
      const distance = this.spread();
      if (this.gesture.lastDistance > 0 && distance > 0) this.env.zoomAt(distance / this.gesture.lastDistance, after.x, after.y);
      this.gesture.lastDistance = distance;
    }
  }

  private touchUp(event: PointerEvent): void {
    this.touches.delete(event.pointerId);
    const gesture = this.gesture;
    if (!gesture) return;
    if (this.touches.size > 0) {
      gesture.lastDistance = this.spread();
      return;
    }
    this.gesture = null;
    const now = performance.now();
    if (!gesture.moved && now - gesture.startedAt < 400) {
      const settings = this.env.settings();
      if (gesture.count === 2) this.env.act(settings.twoFingerTap);
      else if (gesture.count === 3) this.env.act(settings.threeFingerTap);
      else if (gesture.count === 1) {
        const at = this.env.pageAt(event.clientX, event.clientY);
        if (at) this.env.tap(at, event);
      }
      return;
    }
    if (gesture.count === 1 && now - gesture.lastAt < 60) this.coast(gesture.velocity);
  }

  /** Lets the pages run on after a flick, slowing as they go. */
  private coast(velocity: Point): void {
    let vx = velocity.x * 16, vy = velocity.y * 16;
    const step = () => {
      if (Math.hypot(vx, vy) < 0.4) return;
      this.env.panBy(-vx, -vy);
      vx *= 0.94;
      vy *= 0.94;
      this.inertia = requestAnimationFrame(step);
    };
    this.inertia = requestAnimationFrame(step);
  }

  // Tools

  private toolOperation(event: PointerEvent): Operation | null {
    const state = this.env.session.getState();
    switch (state.tool.kind) {
      case "pen": return this.strokeOperation(event);
      case "eraser": return this.eraseOperation(event);
      case "lasso": return this.selectionOperation(event) ?? this.lassoOperation(event);
      case "shape": return this.shapeOperation(event);
      case "tape": return this.tapeOperation(event);
      case "hand": return this.panOperation(event);
      case "laser": return this.laserOperation(event);
      case "text": return this.tapOnly(event);
    }
  }

  private clamp(page: Page, point: Point): Point {
    if (page.edgeless) return point;
    return { x: Math.min(Math.max(point.x, 0), page.size.w), y: Math.min(Math.max(point.y, 0), page.size.h) };
  }

  /** Takes the ruler's edge when the pen lands close to it: the stroke then runs along the edge. */
  private rulerLine(at: PagePoint): { origin: Point; dir: Point } | null {
    const ruler = this.env.session.getState().ruler;
    if (!ruler || ruler.pageID !== at.pageID) return null;
    const dir = { x: Math.cos(ruler.angle), y: Math.sin(ruler.angle) };
    const offset = (at.x - ruler.x) * -dir.y + (at.y - ruler.y) * dir.x;
    // The ruler is a band 48 points deep below its edge; either edge can be drawn along.
    const reach = 14 / Math.max(this.env.zoom(), 0.25);
    if (Math.abs(offset) <= reach) return { origin: { x: ruler.x, y: ruler.y }, dir };
    if (Math.abs(offset - 48) <= reach) return { origin: { x: ruler.x - dir.y * 48, y: ruler.y + dir.x * 48 }, dir };
    return null;
  }

  private strokeOperation(event: PointerEvent): Operation | null {
    const { env } = this;
    const start = env.pageAt(event.clientX, event.clientY);
    const settings = env.settings();
    const pen = penOf(settings, env.session);
    const page = start && env.doc.page(start.pageID);
    if (!start || !pen || !page) return null;
    const surface = env.surface(start.pageID);
    const isPen = event.pointerType === "pen";
    const began = performance.now(), at = Date.now();
    const pts: number[] = [];
    const edge = this.rulerLine(start);
    let tiltSum = 0, tiltCount = 0;
    let travelled = 0;
    let lastClient = { x: event.clientX, y: event.clientY };
    let restAt = { x: event.clientX, y: event.clientY };
    let holdTimer: ReturnType<typeof setTimeout> | null = null;
    let snapped: Stroke[] | null = null;
    let done = false;
    let frame = 0;

    const width = () => {
      // A pencil laid on its side shades broad, as a real one does.
      if (pen.ink !== "pencil" || tiltCount === 0) return pen.width;
      const tilt = tiltSum / tiltCount;
      return pen.width * (1 + 2.5 * Math.min(Math.max((tilt - 30) / 50, 0), 1));
    };
    const current = (): Stroke => ({ id: "live", ink: pen.ink, color: pen.color, width: width(), pts, at, ...(edge ? { even: true } : {}) });
    const paint = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => surface?.setLive({ strokes: snapped ?? (pts.length ? [current()] : []) }));
    };
    const add = (source: PointerEvent) => {
      let point = this.clamp(page, env.toPage(start.pageID, source.clientX, source.clientY));
      if (edge) {
        const along = (point.x - edge.origin.x) * edge.dir.x + (point.y - edge.origin.y) * edge.dir.y;
        point = { x: edge.origin.x + edge.dir.x * along, y: edge.origin.y + edge.dir.y * along };
      }
      const last = pts.length - STRIDE;
      if (last >= 0 && Math.hypot(pts[last] - point.x, pts[last + 1] - point.y) < 0.25 / env.zoom()) return;
      const pressure = isPen && source.pressure > 0 ? source.pressure : 0.5;
      pts.push(point.x, point.y, pressure, Math.round(performance.now() - began));
      if (isPen) {
        tiltSum += Math.hypot(source.tiltX || 0, source.tiltY || 0);
        tiltCount++;
      }
    };
    const armHold = () => {
      if (holdTimer) clearTimeout(holdTimer);
      if (!settings.drawAndHold || snapped || edge) return;
      holdTimer = setTimeout(() => {
        if (done || travelled < 20) return;
        const points = strokePoints({ pts });
        // A loop held round ink selects it; a held loop round nothing, or one with three or four corners, is a shape.
        const shape = recognizeShape(points);
        const loop = settings.loopSelect ? loopOutline(points) : null;
        if (loop && !(shape?.kind === "polygon" && shape.points.length <= 4)) {
          const inside = strokesInLasso(env.doc.ink(start.pageID), loop);
          if (inside.length > 0) {
            finish(true);
            setTool(env.session, { kind: "lasso" });
            env.session.setState({ selection: { pageID: start.pageID, ids: inside.map((stroke) => stroke.id) } });
            return;
          }
        }
        if (shape) {
          snapped = this.shapeStrokes(shape, pen, at);
          paint();
        }
      }, holdDuration);
    };
    const finish = (discard: boolean) => {
      done = true;
      if (holdTimer) clearTimeout(holdTimer);
      cancelAnimationFrame(frame);
      surface?.setLive(null);
      if (discard) this.operation = null;
    };

    add(event);
    paint();
    armHold();

    return {
      move: (moved) => {
        if (done) return;
        if (snapped) return;
        const events = moved.getCoalescedEvents?.() ?? [];
        for (const piece of events.length ? events : [moved]) add(piece);
        travelled += Math.hypot(moved.clientX - lastClient.x, moved.clientY - lastClient.y);
        lastClient = { x: moved.clientX, y: moved.clientY };
        if (Math.hypot(moved.clientX - restAt.x, moved.clientY - restAt.y) > holdSlop) {
          restAt = lastClient;
          armHold();
        }
        paint();
      },
      up: (lifted) => {
        if (done) return;
        finish(false);
        if (snapped) {
          env.doc.addStrokes(start.pageID, snapped, t("Draw Shape"));
          return;
        }
        if (travelled < TAP_SLOP && performance.now() - began < TAP_TIME && env.tap(start, lifted)) return;
        if (pts.length === 0) return;
        const points = strokePoints({ pts });
        // Pens write; the highlighter, watercolour and crayon shade, and shading goes back and forth over ink all the time.
        const writes = pen.ink !== "highlighter" && pen.ink !== "watercolour" && pen.ink !== "crayon";
        if (settings.scribbleErase && writes && !edge) {
          const ink = env.doc.ink(start.pageID);
          const struck = scribbleErased(points, ink.map(strokePoints));
          if (struck.length > 0) {
            env.doc.removeStrokes(start.pageID, new Set(struck.map((index) => ink[index].id)), t("Scribble to Erase"));
            return;
          }
        }
        // A highlighter begun on a line of a PDF's text lays a straight band along that line.
        if (pen.ink === "highlighter" && !edge) {
          const lines = env.snapLines?.(start.pageID);
          const snap = lines ? snapToLine(points, lines) : null;
          if (snap) {
            env.doc.addStrokes(start.pageID, [{
              id: uuid(), ink: pen.ink, color: pen.color, width: snap.height, at, even: true,
              pts: [snap.from.x, snap.from.y, 0.5, 0, snap.to.x, snap.to.y, 0.5, Math.max(Math.round(performance.now() - began), 16)],
            }], t("Highlight Line"));
            return;
          }
        }
        env.doc.addStrokes(start.pageID, [{ ...current(), id: uuid() }]);
      },
      cancel: () => finish(false),
    };
  }

  private shapeStrokes(shape: SnappedShape, pen: ToolPreset, at: number): Stroke[] {
    return shapePolylines(shape).filter((line) => line.length >= 2).map((line) => makeStroke(pen.ink, pen.color, pen.width, line, at));
  }

  private eraseOperation(event: PointerEvent): Operation | null {
    const { env } = this;
    const settings = env.settings();
    const radius = settings.eraserWidth / 2;
    const working = new Map<string, Stroke[]>();
    const changed = new Set<string>();
    // Where the eraser last was, so a fast swipe is rubbed along its whole length and not just where it was sampled.
    let last: PagePoint | null = null;
    const rub = (source: PointerEvent) => {
      const at = env.pageAt(source.clientX, source.clientY);
      if (!at) { last = null; return; }
      const from = last && last.pageID === at.pageID ? last : null;
      last = at;
      this.show({ eraser: { pageID: at.pageID, x: at.x, y: at.y, radius } });
      for (const point of from ? stepsAlong(from, at, Math.max(radius / 2, 0.5)) : [at]) rubAt(at.pageID, point);
    };
    const rubAt = (pageID: string, at: Point) => {
      const before = working.get(pageID) ?? env.doc.ink(pageID);
      let touched = false;
      const after: Stroke[] = [];
      for (const stroke of before) {
        if (settings.eraserMode === "highlighter" && stroke.ink !== "highlighter") {
          after.push(stroke);
        } else if (settings.eraserMode === "partial") {
          const pieces = eraseFromStroke(stroke, at, radius);
          if (pieces) { after.push(...pieces); touched = true; } else after.push(stroke);
        } else if (strokeHit(stroke, at, radius)) {
          touched = true;
        } else {
          after.push(stroke);
        }
      }
      if (touched) {
        working.set(pageID, after);
        changed.add(pageID);
        env.surface(pageID)?.setOverride(after);
      }
    };
    const end = (commit: boolean) => {
      for (const pageID of working.keys()) env.surface(pageID)?.setOverride(null);
      if (commit && changed.size > 0) {
        env.doc.transact(t("Erase"), (draft) => {
          for (const pageID of changed) draft.setInk(pageID, working.get(pageID)!);
        });
      }
      if (event.pointerType !== "mouse") this.show({ eraser: undefined });
    };
    rub(event);
    return {
      move: (moved) => {
        const events = moved.getCoalescedEvents?.() ?? [];
        for (const piece of events.length ? events : [moved]) rub(piece);
      },
      up: () => end(true),
      cancel: () => end(false),
    };
  }

  /** The selection's box, in its page's points. */
  selectionBounds(): { pageID: string; rect: Rect; strokes: Stroke[] } | null {
    const selection = this.env.session.getState().selection;
    if (!selection) return null;
    const wanted = new Set(selection.ids);
    const strokes = this.env.doc.ink(selection.pageID).filter((stroke) => wanted.has(stroke.id));
    const rect = inkBounds(strokes);
    return rect ? { pageID: selection.pageID, rect, strokes } : null;
  }

  /** Dragging the selection, or one of its corners. Null when the pointer landed elsewhere. */
  private selectionOperation(event: PointerEvent): Operation | null {
    const { env } = this;
    const bounds = this.selectionBounds();
    if (!bounds) return null;
    const handle = (event.target as HTMLElement).closest?.("[data-selection-handle]")?.getAttribute("data-selection-handle") ?? null;
    const start = env.toPage(bounds.pageID, event.clientX, event.clientY);
    const { rect, strokes, pageID } = bounds;
    const pad = 6 / env.zoom();
    const inside = start.x >= rect.x - pad && start.x <= rect.x + rect.w + pad && start.y >= rect.y - pad && start.y <= rect.y + rect.h + pad;
    if (!handle && !inside) return null;
    const surface = env.surface(pageID);
    const ids = new Set(strokes.map((stroke) => stroke.id));
    // A corner scales about the corner opposite it.
    const origin = handle
      ? { x: handle.includes("w") ? rect.x + rect.w : rect.x, y: handle.includes("n") ? rect.y + rect.h : rect.y }
      : { x: 0, y: 0 };
    const startDistance = Math.max(Math.hypot(start.x - origin.x, start.y - origin.y), 1);
    let dx = 0, dy = 0, scale = 1, moved = false;
    surface?.setHidden(ids);
    surface?.setLive({ strokes });
    const end = () => {
      surface?.setHidden(null);
      surface?.setLive(null);
      this.show({ moving: undefined });
    };
    return {
      move: (at) => {
        const now = env.toPage(pageID, at.clientX, at.clientY);
        moved = true;
        if (handle) scale = Math.min(Math.max(Math.hypot(now.x - origin.x, now.y - origin.y) / startDistance, 0.1), 12);
        else { dx = now.x - start.x; dy = now.y - start.y; }
        surface?.setLive({ strokes, dx, dy, scale, origin });
        this.show({ moving: { dx, dy, scale } });
      },
      up: (at) => {
        end();
        if (!moved || (dx === 0 && dy === 0 && scale === 1)) return;
        const target = handle ? null : env.pageAt(at.clientX, at.clientY);
        if (target && target.pageID !== pageID) {
          // Carried to another page: the ink lands where it was let go.
          const here = env.toPage(target.pageID, at.clientX, at.clientY);
          const offsetX = here.x - start.x, offsetY = here.y - start.y;
          const carried = strokes.map((stroke) => transformStroke(stroke, offsetX, offsetY, 1, { x: 0, y: 0 }, true));
          env.doc.transact(t("Move Ink"), (draft) => {
            draft.setInk(pageID, draft.ink(pageID).filter((stroke) => !ids.has(stroke.id)));
            draft.setInk(target.pageID, [...draft.ink(target.pageID), ...carried]);
          });
          env.session.setState({ selection: { pageID: target.pageID, ids: carried.map((stroke) => stroke.id) } });
          return;
        }
        env.doc.transact(handle ? t("Resize Ink") : t("Move Ink"), (draft) => {
          draft.setInk(pageID, draft.ink(pageID).map((stroke) => (ids.has(stroke.id) ? transformStroke(stroke, dx, dy, scale, origin) : stroke)));
        });
      },
      cancel: end,
    };
  }

  private lassoOperation(event: PointerEvent): Operation | null {
    const { env } = this;
    const start = env.pageAt(event.clientX, event.clientY, true);
    if (!start) return null;
    const points: Point[] = [{ x: start.x, y: start.y }];
    let travelled = 0, last = { x: event.clientX, y: event.clientY };
    env.session.setState({ selection: null });
    this.show({ lasso: { pageID: start.pageID, points } });
    return {
      move: (moved) => {
        points.push(env.toPage(start.pageID, moved.clientX, moved.clientY));
        travelled += Math.hypot(moved.clientX - last.x, moved.clientY - last.y);
        last = { x: moved.clientX, y: moved.clientY };
        this.show({ lasso: { pageID: start.pageID, points: points.slice() } });
      },
      up: (lifted) => {
        this.show({ lasso: undefined });
        if (travelled < TAP_SLOP) {
          // A tap picks up what is under it: a picture, a text box, a sticker.
          const item = env.itemAt(start);
          if (item) env.session.setState({ selectedItem: { pageID: start.pageID, itemID: item.id }, selection: null });
          else if (!env.tap(start, lifted)) env.session.setState({ selectedItem: null, editingItem: null });
          return;
        }
        const taken = strokesInLasso(env.doc.ink(start.pageID), points);
        env.session.setState({ selection: taken.length ? { pageID: start.pageID, ids: taken.map((stroke) => stroke.id) } : null, selectedItem: null });
      },
      cancel: () => this.show({ lasso: undefined }),
    };
  }

  private shapeOperation(event: PointerEvent): Operation | null {
    const { env } = this;
    const start = env.pageAt(event.clientX, event.clientY);
    const pen = penOf(env.settings(), env.session);
    const page = start && env.doc.page(start.pageID);
    if (!start || !pen || !page) return null;
    const surface = env.surface(start.pageID);
    const at = Date.now();
    let strokes: Stroke[] = [];
    return {
      move: (moved) => {
        const to = this.clamp(page, env.toPage(start.pageID, moved.clientX, moved.clientY));
        strokes = Math.hypot(to.x - start.x, to.y - start.y) < 3 ? [] : this.shapeStrokes(draggedShape(env.session.getState().shape, start, to, moved.shiftKey), pen, at);
        surface?.setLive({ strokes });
      },
      up: () => {
        surface?.setLive(null);
        if (strokes.length) env.doc.addStrokes(start.pageID, strokes, t("Draw Shape"));
      },
      cancel: () => surface?.setLive(null),
    };
  }

  private tapeOperation(event: PointerEvent): Operation | null {
    const { env } = this;
    const start = env.pageAt(event.clientX, event.clientY);
    if (!start) return null;
    let rect: Rect = { x: start.x, y: start.y, w: 0, h: 0 };
    return {
      move: (moved) => {
        const to = env.toPage(start.pageID, moved.clientX, moved.clientY);
        rect = { x: Math.min(start.x, to.x), y: Math.min(start.y, to.y), w: Math.abs(to.x - start.x), h: Math.abs(to.y - start.y) };
        this.show({ band: { pageID: start.pageID, rect } });
      },
      up: (lifted) => {
        this.show({ band: undefined });
        if (rect.w < 8 && rect.h < 8) {
          if (env.tap(start, lifted)) return;
          rect = { x: start.x - 60, y: start.y - 11, w: 120, h: 22 };
        }
        const w = Math.max(rect.w, 16), h = Math.max(rect.h, 14);
        const mustard = "mustard" as const;
        env.doc.addItem(start.pageID, { id: uuid(), kind: "tape", color: mustard, x: rect.x + rect.w / 2, y: rect.y + rect.h / 2, w, h, rotation: 0 }, t("Add Study Tape"));
      },
      cancel: () => this.show({ band: undefined }),
    };
  }

  private panOperation(event: PointerEvent): Operation {
    let last = { x: event.clientX, y: event.clientY };
    let travelled = 0;
    const start = this.env.pageAt(event.clientX, event.clientY);
    return {
      move: (moved) => {
        this.env.panBy(last.x - moved.clientX, last.y - moved.clientY);
        travelled += Math.hypot(moved.clientX - last.x, moved.clientY - last.y);
        last = { x: moved.clientX, y: moved.clientY };
      },
      up: (lifted) => {
        if (travelled >= TAP_SLOP || !start) return;
        const item = this.env.itemAt(start);
        if (item && item.kind !== "tape" && item.kind !== "link") this.env.session.setState({ selectedItem: { pageID: start.pageID, itemID: item.id } });
        else if (!this.env.tap(start, lifted)) this.env.session.setState({ selectedItem: null, editingItem: null });
      },
      cancel: () => {},
    };
  }

  /** A tool that only taps: the text tool, which the editor answers by placing a box. */
  private tapOnly(event: PointerEvent): Operation | null {
    const start = this.env.pageAt(event.clientX, event.clientY);
    if (!start) return null;
    return { move: () => {}, up: (lifted) => void this.env.tap(start, lifted), cancel: () => {} };
  }

  private laserOperation(event: PointerEvent): Operation {
    let trail = (this.overlay.laser ?? []).slice();
    const push = (source: PointerEvent) => {
      trail.push({ x: source.clientX, y: source.clientY, at: performance.now() });
      this.show({ laser: trail.slice() });
    };
    const fade = () => {
      const now = performance.now();
      trail = trail.filter((point) => now - point.at < 1200);
      this.show({ laser: trail.length ? trail.slice() : undefined });
      if (trail.length) this.laserTimer = requestAnimationFrame(fade);
    };
    cancelAnimationFrame(this.laserTimer);
    push(event);
    return {
      move: push,
      up: () => { this.laserTimer = requestAnimationFrame(fade); },
      cancel: () => { this.laserTimer = requestAnimationFrame(fade); },
    };
  }
}

/** Runs what a pen button or a tap of fingers is set to do. */
export function runPenAction(action: PenAction, doc: NotebookDocument, session: Session): void {
  switch (action) {
    case "none": case "inkDish": return;
    case "undo": doc.undo(); return;
    case "redo": doc.redo(); return;
    case "eraser":
      if (session.getState().tool.kind === "eraser") swapTool(session);
      else setTool(session, { kind: "eraser" });
      return;
    case "lasso":
      if (session.getState().tool.kind === "lasso") swapTool(session);
      else setTool(session, { kind: "lasso" });
      return;
    case "lastTool": swapTool(session); return;
  }
}

/** Whether a point lies in an item's box, turned as the item is. */
export function itemContains(item: PageItem, point: Point, pad = 0): boolean {
  const dx = point.x - item.x, dy = point.y - item.y;
  const cos = Math.cos(-item.rotation), sin = Math.sin(-item.rotation);
  const x = dx * cos - dy * sin, y = dx * sin + dy * cos;
  return Math.abs(x) <= item.w / 2 + pad && Math.abs(y) <= item.h / 2 + pad;
}

export { pointInPolygon };
