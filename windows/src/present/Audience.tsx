// The audience's window: the page the presenter is on, fitted to the window, and the laser. No notes, no controls.
// It opens the notebook read-only from the library's files; the presenter saves before telling it a page changed.

import { Maximize } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { pageRegion, renderPageToCanvas } from "../canvas/thumbnail";
import "../design/study.css";
import { libraryFS, isTauri } from "../platform/host";
import { loadInk, loadManifest } from "../storage/package";
import { openLink } from "./channel";
import { fitBox, fromFraction, type PresentMessage } from "./logic";
import { setLanguage, t, useLanguage } from "../i18n";
import { loadSettings } from "../storage/libraryFiles";

const TRAIL_MS = 1200;

type PageMessage = Extract<PresentMessage, { type: "page" }>;

async function closeWindow(): Promise<void> {
  if (isTauri) {
    try {
      const window = await import("@tauri-apps/api/window");
      await window.getCurrentWindow().close();
      return;
    } catch {
      // Fall through to the page's own way.
    }
  }
  globalThis.close();
}

export default function Audience() {
  useLanguage();
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  const [rendered, setRendered] = useState<HTMLCanvasElement | null>(null);
  const [message, setMessage] = useState<PageMessage | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const show = useRef<HTMLCanvasElement>(null);
  const laser = useRef<HTMLCanvasElement>(null);
  const trail = useRef<{ x: number; y: number; at: number }[]>([]);
  const box = useRef({ left: 0, top: 0, width: 0, height: 0 });
  const link = useRef<ReturnType<typeof openLink> | null>(null);

  useEffect(() => {
    document.title = "OwlLuna";
    // This window has no library state of its own, so it reads the language setting from the files.
    void loadSettings(libraryFS()).then((settings) => setLanguage(settings.language), () => {});
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    const connection = openLink((incoming) => {
      if (incoming.type === "page") setMessage(incoming);
      else if (incoming.type === "end") void closeWindow();
      else if (incoming.type === "laser") {
        const now = performance.now();
        for (const point of incoming.points) {
          const at = fromFraction(point, box.current);
          trail.current.push({ ...at, at: now });
        }
      }
    });
    link.current = connection;
    // The presenter may already be on a page; asking makes it say so.
    connection.send({ type: "hello" });
    return () => connection.close();
  }, []);

  // The page is drawn again when the presenter changes it or the window changes size.
  const sizeKey = `${Math.round(size.w / 40)}x${Math.round(size.h / 40)}`;
  useEffect(() => {
    if (!message) return;
    let live = true;
    void (async () => {
      try {
        const fs = libraryFS();
        const manifest = await loadManifest(fs, message.notebook);
        const page = manifest.pages.find((candidate) => candidate.id === message.pageID);
        if (!page) throw new Error(t("That page is not in the notebook."));
        const strokes = await loadInk(fs, message.notebook, message.pageID);
        const region = pageRegion(page, strokes);
        const scale = Math.min(size.w / region.w, size.h / region.h) * (window.devicePixelRatio || 1);
        const canvas = await renderPageToCanvas(fs, message.notebook, page, strokes, scale, { manifest, lifted: new Set(message.lifted ?? []) });
        if (live) {
          setRendered(canvas);
          setProblem(null);
        }
      } catch (error) {
        if (live) setProblem(error instanceof Error ? error.message : String(error));
      }
    })();
    return () => { live = false; };
  }, [message, sizeKey]);

  const fitted = rendered ? fitBox({ w: rendered.width, h: rendered.height }, size) : { left: 0, top: 0, width: 0, height: 0 };
  box.current = fitted;

  useEffect(() => {
    const target = show.current;
    if (!target || !rendered) return;
    target.width = rendered.width;
    target.height = rendered.height;
    target.getContext("2d")?.drawImage(rendered, 0, 0);
  }, [rendered]);

  // The laser's tail fades the way it does on the presenter's screen.
  useEffect(() => {
    let frame = 0;
    const draw = () => {
      const canvas = laser.current;
      const ctx = canvas?.getContext("2d");
      if (canvas && ctx) {
        const now = performance.now();
        trail.current = trail.current.filter((point) => now - point.at < TRAIL_MS);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const points = trail.current;
        for (let index = 1; index < points.length; index++) {
          const age = Math.min((now - points[index].at) / TRAIL_MS, 1);
          ctx.strokeStyle = `rgba(255, 59, 31, ${(1 - age) * 0.8})`;
          ctx.lineWidth = 5 * (1 - age) + 1;
          ctx.lineCap = "round";
          ctx.beginPath();
          ctx.moveTo(points[index - 1].x, points[index - 1].y);
          ctx.lineTo(points[index].x, points[index].y);
          ctx.stroke();
        }
        const head = points[points.length - 1];
        if (head) {
          ctx.fillStyle = "#FF3B1F";
          ctx.beginPath();
          ctx.arc(head.x, head.y, 6, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = "rgba(255, 59, 31, 0.4)";
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(head.x, head.y, 11, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, []);

  const fullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen().catch(() => {});
  };

  return (
    <div className="audience" data-testid="audience" data-page={message?.pageID ?? ""}>
      {!rendered && <div className="audience-wait display">{problem ?? t("Waiting for the presenter…")}</div>}
      <canvas ref={show} className="audience-page" data-testid="audience-page" style={{ left: fitted.left, top: fitted.top, width: fitted.width, height: fitted.height, display: rendered ? "block" : "none" }} />
      <canvas ref={laser} className="audience-laser" width={size.w} height={size.h} />
      {!isTauri && (
        <button type="button" className="audience-fullscreen btn small" onClick={fullscreen} data-testid="audience-fullscreen" aria-label={t("Full screen")} title={t("Full screen")}><Maximize /></button>
      )}
    </div>
  );
}

