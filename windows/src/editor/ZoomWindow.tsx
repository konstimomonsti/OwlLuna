// The zoom window: a strip of the page shown large, to write in with big movements. What is written lands in the
// strip on the page. Done by mounting a second view of the same page, and a second ink controller that maps the
// window's pixels into the strip.

import { ChevronLeft, ChevronRight, CornerDownLeft, X } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import { InkController, runPenAction, type Overlay, type PagePoint } from "../canvas/inkController";
import { ItemsLayer } from "../canvas/ItemsLayer";
import { PageView } from "../canvas/PageView";
import type { PageSurface } from "../canvas/pageSurface";
import { IconButton } from "../design/controls";
import { useApp } from "../state/app";
import type { NotebookDocument } from "./document";
import type { Session } from "./session";
import { advanceStrip, clampStrip, lineStepOf, magnification, ZOOM_WINDOW_HEIGHT, type Strip } from "./zoomStrip";
import { t } from "../i18n";

export function ZoomWindow(props: { doc: NotebookDocument; session: Session; version: number }) {
  const { doc, session } = props;
  const state = useStore(session);
  const zw = state.zoomWindow;
  const page = zw ? doc.page(zw.pageID) : undefined;
  const view = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [overlay, setOverlay] = useState<Overlay>({});
  const surface = useRef<PageSurface | null>(null);
  const mag = magnification(state.zoom);
  const strip: Strip | null = zw && width > 0 ? { x: zw.x, y: zw.y, w: width / mag, h: ZOOM_WINDOW_HEIGHT / mag } : null;
  const stripRef = useRef(strip);
  stripRef.current = strip;
  const magRef = useRef(mag);
  magRef.current = mag;

  useLayoutEffect(() => {
    const element = view.current;
    if (!element) return;
    const measure = () => setWidth(element.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // The strip's size follows the window and the zoom; the page marks it, and it is kept on the page.
  useEffect(() => {
    if (!zw || !strip || !page) return;
    const clamped = clampStrip(strip, page);
    if (Math.abs((zw.w ?? 0) - strip.w) > 0.01 || Math.abs((zw.h ?? 0) - strip.h) > 0.01 || clamped.x !== zw.x || clamped.y !== zw.y) {
      session.setState({ zoomWindow: { ...zw, x: clamped.x, y: clamped.y, w: strip.w, h: strip.h } });
    }
  }, [zw?.x, zw?.y, zw?.w, zw?.h, strip?.w, strip?.h, page?.size.w, page?.size.h]);

  // A page that is gone closes the window.
  useEffect(() => {
    if (zw && !page) session.setState({ zoomWindow: null });
  }, [zw, page, session]);

  const move = (patch: (strip: Strip) => Strip) => {
    const current = stripRef.current, now = session.getState().zoomWindow;
    const target = doc.page(now?.pageID ?? "");
    if (!current || !now || !target) return;
    const next = clampStrip(patch(current), target);
    session.setState({ zoomWindow: { ...now, x: next.x, y: next.y } });
  };

  const controller = useMemo(() => {
    const toPage = (_pageID: string, clientX: number, clientY: number) => {
      const box = view.current?.getBoundingClientRect(), now = session.getState().zoomWindow;
      if (!box || !now) return { x: 0, y: 0 };
      return { x: now.x + (clientX - box.left) / magRef.current, y: now.y + (clientY - box.top) / magRef.current };
    };
    return new InkController({
      doc, session,
      settings: () => useApp.getState().settings,
      pageAt: (clientX, clientY): PagePoint | null => {
        const pageID = session.getState().zoomWindow?.pageID;
        return pageID ? { pageID, ...toPage(pageID, clientX, clientY) } : null;
      },
      toPage,
      surface: () => surface.current ?? undefined,
      zoom: () => magRef.current,
      setOverlay,
      panBy: (dx, dy) => move((strip) => ({ ...strip, x: strip.x + dx / magRef.current, y: strip.y + dy / magRef.current })),
      zoomAt: () => {},
      tap: () => false,
      itemAt: () => null,
      act: (action) => runPenAction(action, doc, session),
    });
  }, [doc, session]);
  useEffect(() => () => controller.dispose(), [controller]);

  if (!zw || !page) return <div className="zoom-window" ref={view} style={{ display: "none" }} />;

  const pageOf = page;
  const x = strip?.x ?? zw.x, y = strip?.y ?? zw.y;
  const line = lineStepOf(pageOf);
  const px = 1 / mag;

  const lifted = (event: React.PointerEvent) => {
    controller.up(event.nativeEvent);
    // A pen lifted in the last fifth of the window means the line is nearly full: the strip moves on.
    const box = view.current?.getBoundingClientRect();
    if (box && event.pointerType !== "touch" && state.tool.kind === "pen" && event.clientX - box.left > box.width * 0.8) {
      move((strip) => advanceStrip(strip, pageOf, line));
    }
  };

  return (
    <div className="zoom-window" data-testid="zoom-window">
      <div className="zoom-tools">
        <IconButton label={t("Move Left")} onClick={() => move((strip) => ({ ...strip, x: strip.x - strip.w * 0.5 }))} testid="zoom-left"><ChevronLeft /></IconButton>
        <IconButton label={t("Move Right")} onClick={() => move((strip) => ({ ...strip, x: strip.x + strip.w * 0.5 }))} testid="zoom-right"><ChevronRight /></IconButton>
        <IconButton label={t("Next Line")} onClick={() => move((strip) => ({ ...strip, x: 0, y: strip.y + line }))} testid="zoom-next-line"><CornerDownLeft /></IconButton>
        <div className="grow" />
        <IconButton label={t("Close Zoom Window")} onClick={() => session.setState({ zoomWindow: null })} testid="zoom-close"><X /></IconButton>
      </div>
      <div
        ref={view}
        className="zoom-view"
        data-testid="zoom-view"
        style={{ position: "relative", flex: 1, minWidth: 0, overflow: "hidden", touchAction: "none", cursor: "crosshair", background: "var(--desk)" }}
        onPointerDown={(event) => controller.down(event.nativeEvent)}
        onPointerMove={(event) => controller.move(event.nativeEvent)}
        onPointerUp={lifted}
        onPointerCancel={(event) => controller.cancel(event.nativeEvent)}
        onPointerLeave={() => controller.leave()}
        onContextMenu={(event) => event.preventDefault()}
      >
        <PageView
          doc={doc}
          page={pageOf}
          zoom={mag}
          left={-x * mag}
          top={-y * mag}
          viewport={{ x: x * mag, y: y * mag, w: width, h: ZOOM_WINDOW_HEIGHT }}
          register={(_id, made) => { surface.current = made; }}
          until={state.replayUntil}
          inkVersion={doc.inkVersion(pageOf.id)}
          under={<ItemsLayer doc={doc} page={pageOf} zoom={mag} layer="under" hot={false} editing={null} lifted={state.liftedTapes} draft={null} onDoneEditing={() => {}} onFollowLink={() => {}} onToggleTape={() => {}} />}
          over={<ItemsLayer doc={doc} page={pageOf} zoom={mag} layer="over" hot={false} editing={null} lifted={state.liftedTapes} draft={null} onDoneEditing={() => {}} onFollowLink={() => {}} onToggleTape={() => {}} />}
          top_={
            <svg width={1} height={1} style={{ position: "absolute", left: 0, top: 0, overflow: "visible", pointerEvents: "none" }}>
              <g transform={`scale(${mag})`}>
                {overlay.lasso && <polyline points={overlay.lasso.points.map((p) => `${p.x},${p.y}`).join(" ")} fill="rgba(39,71,184,0.08)" stroke="var(--accent)" strokeWidth={1.5 * px} strokeDasharray={`${5 * px} ${4 * px}`} />}
                {overlay.eraser && <circle cx={overlay.eraser.x} cy={overlay.eraser.y} r={overlay.eraser.radius} fill="rgba(255,255,255,0.5)" stroke="#1B2230" strokeWidth={px} />}
              </g>
            </svg>
          }
        />
        <div className="zoom-edge" aria-hidden />
      </div>
    </div>
  );
}
