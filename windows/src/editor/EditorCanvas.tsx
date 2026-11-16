// The pages of a notebook, scrolled and zoomed, with pen input. Only the pages in view are mounted, so cost
// follows what is on screen, not the notebook's size.

import { Plus } from "lucide-react";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useStore } from "zustand";
import { InkController, itemContains, runPenAction, type Overlay, type PagePoint } from "../canvas/inkController";
import { ItemFrame, ItemsLayer } from "../canvas/ItemsLayer";
import { PageView } from "../canvas/PageView";
import type { PageSurface } from "../canvas/pageSurface";
import { uuid } from "../model/ids";
import { inkBounds, type Point, type Rect } from "../model/ink";
import type { LinkItem, Page, PageItem } from "../model/notebook";
import { paperCSS } from "../model/paper";
import { openURL } from "../platform/host";
import { clearJump, notify, openNotebook, useApp } from "../state/app";
import type { NotebookDocument } from "./document";
import { BOARD_MAX_ZOOM, BOARD_MIN_ZOOM } from "../canvas/board";
import { CropView } from "./CropView";
import { clampStrip } from "./zoomStrip";
import { clampZoom, goToPage, setTool, type Session } from "./session";
import { capturePointer } from "../canvas/pointer";

const PAD = 28;
const GAP = 22;
const ADD_CARD = 84;

interface PageRect {
  page: Page;
  left: number;
  top: number;
  w: number;
  h: number;
}

export interface EditorCanvasHandle {
  controller: InkController | null;
  zoomAt(factor: number, clientX?: number, clientY?: number): void;
  /** A point of the window in a page's points. */
  toPage(pageID: string, clientX: number, clientY: number): Point;
  /** The middle of what is in view, as a point on the current page. */
  centre(): PagePoint | null;
  /** Moves the view by screen pixels: a whiteboard's view, or the pages' scroll. */
  panBy(dx: number, dy: number): void;
  /** The size of the view in screen pixels. */
  viewSize(): { w: number; h: number };
  element: HTMLDivElement | null;
}

export interface EditorCanvasProps {
  doc: NotebookDocument;
  session: Session;
  /** Whether the pen writes here. A page shown to an audience only listens for the laser. */
  interactive?: boolean;
  /** One page filling the view, with nothing round it. */
  presenting?: boolean;
  selectionBar?: (bounds: { pageID: string; rect: Rect }) => ReactNode;
  itemBar?: (pageID: string, item: PageItem) => ReactNode;
  /** More to draw on a page, under the ink: a PDF's selectable text. */
  pageExtras?: (page: Page, zoom: number) => ReactNode;
}

export const EditorCanvas = forwardRef<EditorCanvasHandle, EditorCanvasProps>(function EditorCanvas(props, ref) {
  const { doc, session } = props;
  const interactive = props.interactive !== false;
  useSyncExternalStore(doc.subscribe, doc.getVersion);
  const state = useStore(session);
  const settings = useApp((app) => app.settings);
  const container = useRef<HTMLDivElement>(null);
  const surfaces = useRef(new Map<string, PageSurface>());
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [scroll, setScroll] = useState({ x: 0, y: 0 });
  const [overlay, setOverlay] = useState<Overlay>({});
  const [draft, setDraft] = useState<PageItem | null>(null);
  const anchor = useRef<{ pageID: string; x: number; y: number; cx: number; cy: number } | null>(null);

  const pages = doc.manifest.pages;
  const board = pages[0]?.edgeless === true;
  const single = props.presenting || (settings.pageFlow === "single" && !board);
  const zoom = state.zoom;
  const current = pages.find((page) => page.id === state.currentPage) ?? pages[0];

  // Layout

  const layout = useMemo(() => {
    const shown = board ? [pages[0]] : single ? [current] : pages;
    const pad = props.presenting ? 0 : PAD;
    const widest = Math.max(...shown.map((page) => page.size.w * zoom), 1);
    const contentW = board ? size.w : Math.max(size.w, widest + pad * 2);
    const rects: PageRect[] = [];
    let top = pad;
    for (const page of shown) {
      const w = page.size.w * zoom, h = page.size.h * zoom;
      if (board) rects.push({ page, left: -state.board.x * zoom, top: -state.board.y * zoom, w: Infinity, h: Infinity });
      else rects.push({ page, left: (contentW - w) / 2, top: single ? Math.max(pad, (size.h - h) / 2) : top, w, h });
      top += h + GAP;
    }
    const last = rects[rects.length - 1];
    const contentH = board ? size.h : single ? Math.max(size.h, (last?.h ?? 0) + pad * 2) : top - GAP + pad + (interactive ? ADD_CARD : 0);
    return { rects, contentW, contentH, zoom, board };
  }, [pages, board, single, current, zoom, size.w, size.h, state.board.x, state.board.y, interactive, props.presenting]);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  const rectOf = (pageID: string) => layoutRef.current.rects.find((rect) => rect.page.id === pageID);

  const toPage = useCallback((pageID: string, clientX: number, clientY: number): Point => {
    const element = container.current, rect = rectOf(pageID);
    if (!element || !rect) return { x: 0, y: 0 };
    const box = element.getBoundingClientRect();
    const z = layoutRef.current.zoom;
    return { x: (clientX - box.left + element.scrollLeft - rect.left) / z, y: (clientY - box.top + element.scrollTop - rect.top) / z };
  }, []);

  const pageAt = useCallback((clientX: number, clientY: number, nearest = false): PagePoint | null => {
    const element = container.current;
    if (!element) return null;
    const box = element.getBoundingClientRect();
    const x = clientX - box.left + element.scrollLeft, y = clientY - box.top + element.scrollTop;
    let best: PageRect | null = null, bestDistance = Infinity;
    for (const rect of layoutRef.current.rects) {
      if (x >= rect.left && x <= rect.left + rect.w && y >= rect.top && y <= rect.top + rect.h) {
        best = rect;
        bestDistance = 0;
        break;
      }
      if (nearest) {
        const dx = Math.max(rect.left - x, 0, x - rect.left - rect.w), dy = Math.max(rect.top - y, 0, y - rect.top - rect.h);
        const distance = Math.hypot(dx, dy);
        if (distance < bestDistance) { best = rect; bestDistance = distance; }
      }
    }
    if (!best) return null;
    const point = toPage(best.page.id, clientX, clientY);
    return { pageID: best.page.id, ...point };
  }, [toPage]);

  const panBy = useCallback((dx: number, dy: number) => {
    if (layoutRef.current.board) {
      // The session, not the last layout: a pinch pans and zooms in one event, before React has laid out again.
      session.setState((s) => ({ board: { x: s.board.x + dx / s.zoom, y: s.board.y + dy / s.zoom } }));
    } else {
      container.current?.scrollBy(dx, dy);
    }
  }, [session]);

  const zoomAt = useCallback((factor: number, clientX?: number, clientY?: number) => {
    const element = container.current;
    if (!element) return;
    const box = element.getBoundingClientRect();
    const cx = clientX ?? box.left + box.width / 2, cy = clientY ?? box.top + box.height / 2;
    const now = session.getState().zoom;
    if (layoutRef.current.board) {
      const next = clampZoom(now * factor, BOARD_MIN_ZOOM, BOARD_MAX_ZOOM);
      if (Math.abs(next - now) < 0.0005) return;
      // The board point under the pointer, read from the session so a pan made a moment ago still counts.
      const origin = session.getState().board;
      const px = origin.x + (cx - box.left) / now, py = origin.y + (cy - box.top) / now;
      session.setState({ zoom: next, fit: null, board: { x: px - (cx - box.left) / next, y: py - (cy - box.top) / next } });
      return;
    }
    const next = clampZoom(now * factor);
    if (Math.abs(next - now) < 0.0005) return;
    const at = pageAt(cx, cy, true);
    // Several steps may land before the pages are laid out again; the first one's page point is the one to keep still.
    if (at && !anchor.current) anchor.current = { ...at, cx, cy };
    else if (anchor.current) { anchor.current.cx = cx; anchor.current.cy = cy; }
    session.setState({ zoom: next, fit: null });
  }, [session, pageAt]);

  useLayoutEffect(() => {
    const element = container.current, keep = anchor.current;
    if (!element || !keep) return;
    anchor.current = null;
    const rect = rectOf(keep.pageID);
    if (!rect) return;
    const box = element.getBoundingClientRect();
    element.scrollLeft = rect.left + keep.x * layout.zoom - (keep.cx - box.left);
    element.scrollTop = rect.top + keep.y * layout.zoom - (keep.cy - box.top);
    setScroll({ x: element.scrollLeft, y: element.scrollTop });
  }, [layout]);

  // The view's size, and zoom kept fitted to it.

  useLayoutEffect(() => {
    const element = container.current;
    if (!element) return;
    const measure = () => setSize({ w: element.clientWidth, h: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (board || size.w === 0 || !current) return;
    const fit = props.presenting ? "page" : state.fit;
    if (!fit) return;
    const pad = props.presenting ? 0 : PAD;
    const byWidth = (size.w - pad * 2) / current.size.w;
    const byHeight = (size.h - pad * 2) / current.size.h;
    const wanted = clampZoom(fit === "width" ? byWidth : Math.min(byWidth, byHeight));
    if (Math.abs(wanted - zoom) > 0.001) session.setState({ zoom: wanted });
  }, [state.fit, size.w, size.h, current?.size.w, current?.size.h, board, props.presenting]);

  // Scrolling: which pages are in view, and which is the current one.

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    let frame = 0;
    const onScroll = () => {
      // A board is moved by its own view, never by scrolling; a focused text box may try anyway.
      if (layoutRef.current.board && (element.scrollLeft || element.scrollTop)) { element.scrollLeft = 0; element.scrollTop = 0; }
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        setScroll({ x: element.scrollLeft, y: element.scrollTop });
        if (layoutRef.current.rects.length > 1) {
          const middle = element.scrollTop + element.clientHeight / 2;
          const at = layoutRef.current.rects.find((rect) => middle <= rect.top + rect.h + GAP / 2) ?? layoutRef.current.rects[layoutRef.current.rects.length - 1];
          if (at && session.getState().currentPage !== at.page.id) session.setState({ currentPage: at.page.id });
        }
      });
    };
    element.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      element.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [session]);

  // Asked to show a page: from the navigator, a link, a search result.
  const lastScroll = useRef(0);
  useLayoutEffect(() => {
    const ask = state.scrollTo, element = container.current;
    if (!ask || !element || ask.nonce === lastScroll.current || size.w === 0) return;
    const rect = rectOf(ask.pageID);
    if (!rect) return;
    lastScroll.current = ask.nonce;
    if (board) {
      if (ask.rect) session.setState({ board: { x: ask.rect.x + ask.rect.w / 2 - size.w / zoom / 2, y: ask.rect.y + ask.rect.h / 2 - size.h / zoom / 2 } });
      return;
    }
    if (single) element.scrollTop = ask.rect ? Math.max(0, rect.top + ask.rect.y * zoom - size.h / 3) : 0;
    else element.scrollTop = ask.rect ? rect.top + ask.rect.y * zoom - size.h / 3 : rect.top - PAD;
    setScroll({ x: element.scrollLeft, y: element.scrollTop });
  }, [state.scrollTo, layout, size.w]);

  // A notebook opens where it was asked to, or where it was left.
  const opened = useRef(false);
  useLayoutEffect(() => {
    if (opened.current || size.w === 0 || props.presenting) return;
    opened.current = true;
    const jump = useApp.getState().jump;
    if (jump && jump.notebook === doc.id) {
      clearJump();
      if (doc.page(jump.page)) goToPage(session, jump.page);
    } else if (state.scrollTo === null && doc.manifest.lastPage && doc.page(doc.manifest.lastPage) && doc.manifest.lastPage !== pages[0].id) {
      goToPage(session, doc.manifest.lastPage);
    }
  }, [size.w]);

  // A page that is gone can't stay current.
  useEffect(() => {
    if (!pages.some((page) => page.id === state.currentPage)) session.setState({ currentPage: pages[0].id });
  }, [pages, state.currentPage]);

  // Input

  const itemAt = useCallback((at: PagePoint): PageItem | null => {
    const page = doc.page(at.pageID);
    if (!page) return null;
    const pad = 4 / layoutRef.current.zoom;
    const tape = [...page.items].reverse().find((item) => item.kind === "tape" && itemContains(item, at, pad));
    return tape ?? [...page.items].reverse().find((item) => item.kind !== "tape" && itemContains(item, at, pad)) ?? null;
  }, [doc]);

  const controller = useMemo(() => new InkController({
    doc, session,
    settings: () => useApp.getState().settings,
    pageAt, toPage,
    surface: (pageID) => surfaces.current.get(pageID),
    zoom: () => layoutRef.current.zoom,
    setOverlay,
    panBy, zoomAt,
    tap: (at) => {
      if (session.getState().tool.kind !== "text") return false;
      const page = doc.page(at.pageID);
      if (!page) return false;
      const width = Math.min(260, page.edgeless ? 260 : Math.max(page.size.w - at.x - 16, 80));
      const item: PageItem = { id: uuid(), kind: "text", string: "", fontSize: 17, x: at.x + width / 2, y: at.y + 14, w: width, h: 28, rotation: 0 };
      doc.addItem(at.pageID, item, "Add Text");
      setTool(session, { kind: "lasso" });
      session.setState({ selectedItem: { pageID: at.pageID, itemID: item.id }, editingItem: item.id });
      return true;
    },
    itemAt,
    act: (action) => runPenAction(action, doc, session),
  }), [doc, session]);

  useEffect(() => () => controller.dispose(), [controller]);

  useImperativeHandle(ref, () => ({
    controller, zoomAt, toPage, panBy,
    viewSize: () => {
      const element = container.current;
      return { w: element?.clientWidth ?? 0, h: element?.clientHeight ?? 0 };
    },
    centre: () => {
      const element = container.current;
      if (!element) return null;
      const box = element.getBoundingClientRect();
      return pageAt(box.left + box.width / 2, box.top + box.height / 2, true);
    },
    element: container.current,
  }), [controller, zoomAt, toPage, pageAt, panBy]);

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      // A pinch on a trackpad, or the wheel with Control, zooms about the pointer.
      if (event.ctrlKey) {
        event.preventDefault();
        zoomAt(Math.exp(-event.deltaY * 0.01), event.clientX, event.clientY);
      } else if (layoutRef.current.board) {
        event.preventDefault();
        panBy(event.shiftKey ? event.deltaY : event.deltaX, event.shiftKey ? 0 : event.deltaY);
      }
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [zoomAt, panBy]);

  const overHot = (target: EventTarget | null) => target instanceof Element && target.closest("[data-hot]") !== null;

  const register = useCallback((pageID: string, surface: PageSurface | null) => {
    if (surface) surfaces.current.set(pageID, surface);
    else surfaces.current.delete(pageID);
  }, []);

  const followLink = useCallback((item: LinkItem) => {
    if (item.target.to === "web") void openURL(item.target.url);
    else if (item.target.to === "page") {
      if (doc.page(item.target.page)) goToPage(session, item.target.page);
      else notify("That page is no longer in this notebook.", "trouble");
    } else {
      void openNotebook(item.target.notebook, item.target.page).then((found) => {
        if (!found) notify("That notebook is no longer in the library.", "trouble");
      });
    }
  }, [doc, session]);

  const toggleTape = useCallback((id: string) => {
    session.setState((s) => ({ liftedTapes: s.liftedTapes.includes(id) ? s.liftedTapes.filter((tape) => tape !== id) : [...s.liftedTapes, id] }));
  }, [session]);

  const doneEditing = useCallback(() => session.setState({ editingItem: null }), [session]);

  // What is in view

  const margin = 700;
  const visible = layout.rects.filter((rect) => board || (rect.top < scroll.y + size.h + margin && rect.top + rect.h > scroll.y - margin));
  const hot = interactive && state.tool.kind !== "lasso" && state.tool.kind !== "text";
  const selection = state.selection;
  const cursor = state.tool.kind === "hand" ? "grab" : state.tool.kind === "eraser" ? "none" : state.tool.kind === "text" ? "text" : state.tool.kind === "lasso" ? "default" : "crosshair";

  const pageTop = (rect: PageRect): ReactNode => {
    const page = rect.page;
    const marks: ReactNode[] = [];
    const px = 1 / zoom;
    if (overlay.lasso?.pageID === page.id) {
      marks.push(<polyline key="lasso" points={overlay.lasso.points.map((p) => `${p.x},${p.y}`).join(" ")} fill="rgba(39,71,184,0.08)" stroke="var(--accent)" strokeWidth={1.5 * px} strokeDasharray={`${5 * px} ${4 * px}`} />);
    }
    if (overlay.eraser?.pageID === page.id) {
      marks.push(<circle key="eraser" cx={overlay.eraser.x} cy={overlay.eraser.y} r={overlay.eraser.radius} fill="rgba(255,255,255,0.5)" stroke="#1B2230" strokeWidth={px} />);
    }
    if (overlay.band?.pageID === page.id) {
      const band = overlay.band.rect;
      marks.push(<rect key="band" x={band.x} y={band.y} width={band.w} height={band.h} fill="rgba(232,176,35,0.45)" stroke="#E8B023" strokeWidth={px} />);
    }
    for (const mark of state.findMarks) {
      if (mark.pageID !== page.id) continue;
      mark.rects.forEach((r, index) => marks.push(
        <rect key={`find${marks.length}-${index}`} x={r[0]} y={r[1]} width={r[2]} height={r[3]} fill="rgba(232,176,35,0.4)" stroke={mark.current ? "#1B2230" : "#E8B023"} strokeWidth={(mark.current ? 1.5 : 1) * px} />,
      ));
    }
    let bar: ReactNode = null;
    if (selection?.pageID === page.id) {
      const wanted = new Set(selection.ids);
      const box = inkBounds(doc.ink(page.id).filter((stroke) => wanted.has(stroke.id)));
      if (box) {
        const moving = overlay.moving;
        const scale = moving?.scale ?? 1;
        // While a corner is dragged the box grows from the corner opposite; while moved it follows the ink.
        const shown = moving && scale === 1 ? { ...box, x: box.x + moving.dx, y: box.y + moving.dy } : box;
        const handle = 9 * px;
        marks.push(
          <g key="selection" style={{ pointerEvents: "auto" }}>
            <rect x={shown.x} y={shown.y} width={shown.w} height={shown.h} fill="rgba(232,176,35,0.07)" stroke="#1B2230" strokeWidth={1.5 * px} style={{ cursor: "move" }} data-testid="selection-box" />
            <rect x={shown.x} y={shown.y} width={shown.w} height={shown.h} fill="none" stroke="#E8B023" strokeWidth={1.5 * px} strokeDasharray={`${5 * px} ${4 * px}`} pointerEvents="none" />
            {!moving && ([["nw", shown.x, shown.y], ["ne", shown.x + shown.w, shown.y], ["se", shown.x + shown.w, shown.y + shown.h], ["sw", shown.x, shown.y + shown.h]] as const).map(([name, hx, hy]) => (
              <rect key={name} data-selection-handle={name} x={hx - handle / 2} y={hy - handle / 2} width={handle} height={handle} rx={2 * px} fill="var(--board)" stroke="#1B2230" strokeWidth={1.5 * px} style={{ cursor: name === "nw" || name === "se" ? "nwse-resize" : "nesw-resize" }} />
            ))}
          </g>,
        );
        if (!moving && props.selectionBar) {
          bar = (
            <div data-hot style={{ position: "absolute", left: (box.x + box.w / 2) * zoom, top: Math.max(box.y * zoom - 54, page.edgeless ? -Infinity : 4), transform: "translateX(-50%)", zIndex: 5 }}>
              {props.selectionBar({ pageID: page.id, rect: box })}
            </div>
          );
        }
      }
    }
    const picked = state.selectedItem?.pageID === page.id ? page.items.find((item) => item.id === state.selectedItem!.itemID) : undefined;
    const ruler = state.ruler?.pageID === page.id ? state.ruler : null;
    const strip = state.zoomWindow?.pageID === page.id && state.zoomWindow.w && state.zoomWindow.h ? state.zoomWindow : null;
    const cropping = state.croppingItem ? page.items.find((item) => item.id === state.croppingItem) : undefined;
    return (
      <>
        <svg width={1} height={1} style={{ position: "absolute", left: 0, top: 0, overflow: "visible", pointerEvents: "none" }}>
          <g transform={`scale(${zoom})`}>{marks}</g>
        </svg>
        {ruler && <RulerView ruler={ruler} zoom={zoom} session={session} toPage={(x, y) => toPage(page.id, x, y)} />}
        {picked && state.editingItem !== picked.id && state.croppingItem !== picked.id && interactive && (
          <>
            <ItemFrame
              item={picked}
              zoom={zoom}
              toPage={(x, y) => toPage(page.id, x, y)}
              onDraft={setDraft}
              onCommit={(next, label) => doc.updateItem(page.id, next.id, label, (target) => Object.assign(target, { x: next.x, y: next.y, w: next.w, h: next.h, rotation: next.rotation }))}
              onOpen={() => { if (picked.kind === "text") session.setState({ editingItem: picked.id }); }}
            />
            {!draft && props.itemBar && (
              <div data-hot style={{ position: "absolute", left: picked.x * zoom, top: (picked.y + picked.h / 2) * zoom + 14, transform: "translateX(-50%)", zIndex: 5 }}>
                {props.itemBar(page.id, picked)}
              </div>
            )}
          </>
        )}
        {strip && <StripMark strip={strip} zoom={zoom} page={page} session={session} toPage={(x, y) => toPage(page.id, x, y)} />}
        {cropping && cropping.kind === "image" && (
          <CropView doc={doc} pageID={page.id} item={cropping} zoom={zoom} toPage={(x, y) => toPage(page.id, x, y)} onDone={() => session.setState({ croppingItem: null })} />
        )}
        {bar}
      </>
    );
  };

  return (
    <div
      ref={container}
      className="editor-canvas"
      data-testid="editor-canvas"
      style={{ position: "relative", width: "100%", height: "100%", overflow: board ? "hidden" : "auto", touchAction: "none", background: props.presenting ? "#000" : board && current ? paperCSS(current.paperColor) : "var(--desk)", cursor }}
      onPointerDown={(event) => { if (!overHot(event.target)) controller.down(event.nativeEvent); }}
      onPointerMove={(event) => controller.move(event.nativeEvent)}
      onPointerUp={(event) => controller.up(event.nativeEvent)}
      onPointerCancel={(event) => controller.cancel(event.nativeEvent)}
      onPointerLeave={() => controller.leave()}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div style={{ position: "relative", width: layout.contentW, height: layout.contentH }}>
        {visible.map((rect) => (
          <PageView
            key={rect.page.id}
            doc={doc}
            page={rect.page}
            zoom={zoom}
            left={rect.left}
            top={rect.top}
            viewport={{ x: scroll.x - rect.left, y: scroll.y - rect.top, w: size.w, h: size.h }}
            register={register}
            until={state.replayUntil}
            inkVersion={doc.inkVersion(rect.page.id)}
            under={
              <>
                <ItemsLayer doc={doc} page={rect.page} zoom={zoom} layer="under" hot={hot} editing={state.editingItem} lifted={state.liftedTapes} draft={draft} onDoneEditing={doneEditing} onFollowLink={followLink} onToggleTape={toggleTape} />
                {props.pageExtras?.(rect.page, zoom)}
              </>
            }
            over={<ItemsLayer doc={doc} page={rect.page} zoom={zoom} layer="over" hot={hot} editing={state.editingItem} lifted={state.liftedTapes} draft={draft} onDoneEditing={doneEditing} onFollowLink={followLink} onToggleTape={toggleTape} />}
            top_={pageTop(rect)}
          />
        ))}
        {interactive && !board && !single && layout.rects.length > 0 && (
          <button
            type="button"
            className="btn"
            data-hot
            data-testid="add-page"
            style={{ position: "absolute", left: "50%", transform: "translateX(-50%)", top: layout.contentH - ADD_CARD - PAD + GAP + 8 }}
            onClick={() => {
              const added = doc.addPage(pages[pages.length - 1].id);
              goToPage(session, added.id);
            }}
          >
            <Plus /> Add Page
          </button>
        )}
      </div>
      {overlay.laser && overlay.laser.length > 0 && <LaserTrail points={overlay.laser} />}
    </div>
  );
});

/** The laser pointer: a tomato dot with a tail that fades behind it. */
function LaserTrail(props: { points: { x: number; y: number; at: number }[] }) {
  const now = performance.now();
  const head = props.points[props.points.length - 1];
  return (
    <svg style={{ position: "fixed", inset: 0, width: "100vw", height: "100vh", pointerEvents: "none", zIndex: 50 }}>
      {props.points.slice(1).map((point, index) => {
        const before = props.points[index];
        const age = Math.min((now - point.at) / 1200, 1);
        return <line key={index} x1={before.x} y1={before.y} x2={point.x} y2={point.y} stroke="#FF3B1F" strokeOpacity={(1 - age) * 0.8} strokeWidth={5 * (1 - age) + 1} strokeLinecap="round" />;
      })}
      <circle cx={head.x} cy={head.y} r={6} fill="#FF3B1F" />
      <circle cx={head.x} cy={head.y} r={11} fill="none" stroke="#FF3B1F" strokeOpacity={0.4} strokeWidth={3} />
    </svg>
  );
}

/** A ruler lying on the page. Drag it to move, its end to turn; a line drawn along either edge comes out straight. */
function RulerView(props: { ruler: { x: number; y: number; angle: number; pageID: string }; zoom: number; session: Session; toPage: (x: number, y: number) => Point }) {
  const { ruler, zoom } = props;
  const drag = useRef<{ turn: boolean; start: Point; origin: typeof ruler } | null>(null);
  const length = 520, depth = 48;
  const begin = (turn: boolean) => (event: React.PointerEvent) => {
    event.stopPropagation();
    capturePointer(event.currentTarget as HTMLElement, event.pointerId);
    drag.current = { turn, start: props.toPage(event.clientX, event.clientY), origin: ruler };
  };
  const move = (event: React.PointerEvent) => {
    const state = drag.current;
    if (!state) return;
    const at = props.toPage(event.clientX, event.clientY);
    if (state.turn) {
      let angle = Math.atan2(at.y - state.origin.y, at.x - state.origin.x);
      const step = Math.PI / 12, nearest = Math.round(angle / step) * step;
      if (Math.abs(angle - nearest) < 0.035) angle = nearest;
      props.session.setState({ ruler: { ...state.origin, angle } });
    } else {
      props.session.setState({ ruler: { ...state.origin, x: state.origin.x + at.x - state.start.x, y: state.origin.y + at.y - state.start.y } });
    }
  };
  const end = () => { drag.current = null; };
  const degrees = Math.round((((-ruler.angle * 180) / Math.PI) % 180 + 180) % 180);
  return (
    <div
      data-hot
      data-testid="ruler"
      style={{ position: "absolute", left: ruler.x * zoom, top: ruler.y * zoom, width: length * zoom, height: depth * zoom, transformOrigin: "0 0", transform: `rotate(${ruler.angle}rad)`, pointerEvents: "none" }}
    >
      <div
        onPointerDown={begin(false)} onPointerMove={move} onPointerUp={end} onPointerCancel={end}
        style={{
          position: "absolute", inset: 0, pointerEvents: "auto", cursor: "move", touchAction: "none",
          background: "rgba(248,246,241,0.82)", borderTop: "1px solid rgba(27,34,48,0.5)", borderBottom: "1px solid rgba(27,34,48,0.5)",
          backgroundImage: `repeating-linear-gradient(90deg, rgba(27,34,48,0.45) 0 1px, transparent 1px ${10 * zoom}px)`, backgroundSize: `100% ${6 * zoom}px`, backgroundRepeat: "no-repeat",
          display: "grid", placeItems: "center", color: "#1B2230", fontSize: 12, fontVariantNumeric: "tabular-nums",
        }}
      >
        {degrees}°
      </div>
      <div
        onPointerDown={begin(true)} onPointerMove={move} onPointerUp={end} onPointerCancel={end}
        title="Turn the ruler"
        style={{ position: "absolute", right: -6, top: "50%", width: 20, height: 20, marginTop: -10, borderRadius: 3, background: "var(--board)", border: "1.5px solid #1B2230", pointerEvents: "auto", cursor: "grab", touchAction: "none" }}
      />
    </div>
  );
}

/** The strip the zoom window shows, outlined on its page, with a grip to drag it by. Only the grip takes the pointer, so writing under the outline still works. */
function StripMark(props: { strip: { x: number; y: number; w?: number; h?: number }; zoom: number; page: Page; session: Session; toPage: (x: number, y: number) => Point }) {
  const { strip, zoom } = props;
  const drag = useRef<{ start: Point; origin: { x: number; y: number } } | null>(null);
  const w = (strip.w ?? 0) * zoom, h = (strip.h ?? 0) * zoom;
  return (
    <div data-testid="zoom-strip" style={{ position: "absolute", left: strip.x * zoom, top: strip.y * zoom, width: w, height: h, outline: "2px solid var(--mustard)", boxShadow: "0 0 0 1px var(--ink)", pointerEvents: "none", zIndex: 4 }}>
      <div
        data-hot
        data-testid="zoom-strip-grip"
        title="Drag the zoom window's strip"
        onPointerDown={(event) => {
          event.stopPropagation();
          capturePointer(event.currentTarget, event.pointerId);
          drag.current = { start: props.toPage(event.clientX, event.clientY), origin: { x: strip.x, y: strip.y } };
        }}
        onPointerMove={(event) => {
          const state = drag.current, now = props.session.getState().zoomWindow;
          if (!state || !now) return;
          const at = props.toPage(event.clientX, event.clientY);
          const moved = clampStrip({ x: state.origin.x + at.x - state.start.x, y: state.origin.y + at.y - state.start.y, w: strip.w ?? 0, h: strip.h ?? 0 }, props.page);
          props.session.setState({ zoomWindow: { ...now, x: moved.x, y: moved.y } });
        }}
        onPointerUp={() => { drag.current = null; }}
        onPointerCancel={() => { drag.current = null; }}
        style={{ position: "absolute", left: 0, top: -16, width: 26, height: 16, background: "var(--mustard)", border: "1px solid var(--ink)", cursor: "move", pointerEvents: "auto", touchAction: "none" }}
      />
    </div>
  );
}
