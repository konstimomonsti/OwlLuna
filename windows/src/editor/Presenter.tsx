// Presenting: the page large with a laser, the next page small, the notes for this page, a timer, and a second window
// for the audience that shows only the page.

import { ChevronLeft, ChevronRight, Maximize, MonitorUp, Pause, PenLine, Pointer, Play, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useStore } from "zustand";
import { pageThumbnailURL } from "../canvas/thumbnail";
import { IconButton } from "../design/controls";
import "../design/study.css";
import type { ToolChoice } from "../model/tools";
import { isTauri } from "../platform/host";
import { openLink, type PresentLink } from "../present/channel";
import { formatTimer, LaserBatch, neighbourPage, pauseTimer, resetTimer, resumeTimer, startTimer, timerElapsed, toFraction, type TimerState } from "../present/logic";
import { notify, useApp } from "../state/app";
import type { NotebookDocument } from "./document";
import { EditorCanvas } from "./EditorCanvas";
import { dropSession, goToPage, sessionFor, setTool } from "./session";
import { fnv1a } from "../model/ids";
import { t } from "../i18n";

function typing(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
}

export function Presenter(props: { doc: NotebookDocument; startPage: string; pen: ToolChoice | null; onDone: (pageID: string) => void }) {
  const { doc } = props;
  useSyncExternalStore(doc.subscribe, doc.getVersion);
  const pens = useApp((state) => state.settings.pens);
  const key = `present:${doc.id}`;
  // The presenter has a session of its own, so the editor's tool and view are as they were left.
  const [session] = useState(() => {
    dropSession(key);
    const made = sessionFor(key, props.startPage, pens[0]?.id);
    const pen: ToolChoice | null = props.pen ?? (pens[0] ? { kind: "pen", penID: pens[0].id } : null);
    made.setState({ currentPage: props.startPage, tool: { kind: "laser" }, previousTool: pen ?? { kind: "hand" }, fit: "page" });
    return made;
  });
  useEffect(() => () => dropSession(key), [key]);

  const state = useStore(session);
  const pages = doc.manifest.pages;
  const index = Math.max(doc.pageIndex(state.currentPage), 0);
  const page = pages[index];
  const nextID = neighbourPage(pages, page.id, 1);
  const stage = useRef<HTMLDivElement>(null);
  const link = useRef<PresentLink | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const lastPen = useRef<ToolChoice | null>(props.pen);

  // Navigation

  const go = useCallback((direction: 1 | -1) => {
    const id = neighbourPage(doc.manifest.pages, session.getState().currentPage, direction);
    if (id) goToPage(session, id);
  }, [doc, session]);

  const finish = useCallback(() => {
    props.onDone(session.getState().currentPage);
  }, [props.onDone, session]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (typing(event.target) || document.querySelector(".scrim") || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === "Escape") { event.preventDefault(); finish(); }
      else if (event.key === "ArrowRight" || event.key === "PageDown" || event.code === "Space") { event.preventDefault(); go(1); }
      else if (event.key === "ArrowLeft" || event.key === "PageUp") { event.preventDefault(); go(-1); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [go, finish]);

  // The audience

  const lifted = state.liftedTapes.join(",");
  const itemsKey = fnv1a(JSON.stringify([page.items, page.background, page.size]));
  const inkVersion = doc.inkVersion(page.id);
  const latest = useRef({ pageID: page.id, lifted: state.liftedTapes, inkVersion });
  latest.current = { pageID: page.id, lifted: state.liftedTapes, inkVersion };

  const tell = useCallback(async () => {
    // The audience reads the notebook's files, so what is on screen is written first.
    await doc.save().catch(() => {});
    const now = latest.current;
    link.current?.send({ type: "page", notebook: doc.id, pageID: now.pageID, inkVersion: doc.inkVersion(now.pageID), lifted: now.lifted });
  }, [doc]);
  const tellRef = useRef(tell);
  tellRef.current = tell;

  useEffect(() => {
    const connection = openLink((message) => { if (message.type === "hello") void tellRef.current(); });
    link.current = connection;
    void tellRef.current();
    return () => {
      connection.send({ type: "end" });
      connection.close();
      link.current = null;
    };
  }, []);

  useEffect(() => {
    void tell();
  }, [page.id, inkVersion, lifted, itemsKey, tell]);

  const openAudience = async () => {
    try {
      if (isTauri) {
        const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
        const existing = await WebviewWindow.getByLabel("audience");
        if (existing) {
          await existing.setFocus();
          return;
        }
        const made = new WebviewWindow("audience", { url: "index.html#audience", title: "OwlLuna", width: 1280, height: 720 });
        void made.once("tauri://error", () => notify(t("The audience window couldn't be opened."), "trouble"));
      } else {
        const opened = window.open(location.pathname + "#audience", "owlluna-audience");
        if (!opened) notify(t("The audience window was blocked. Allow pop-ups for this page."), "trouble");
      }
    } catch (error) {
      notify(t("The audience window couldn't be opened: {error}", { error: error instanceof Error ? error.message : String(error) }), "trouble");
    }
  };

  const toggleFullscreen = async () => {
    try {
      const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
      const audience = await WebviewWindow.getByLabel("audience");
      if (!audience) {
        notify(t("Open the audience window first."));
        return;
      }
      await audience.setFullscreen(!fullscreen);
      setFullscreen(!fullscreen);
    } catch (error) {
      notify(t("Full screen couldn't be changed: {error}", { error: error instanceof Error ? error.message : String(error) }), "trouble");
    }
  };

  // The laser, sent to the audience as fractions of the page, about thirty times a second

  const batch = useRef(new LaserBatch(30));
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sendLaser = (points: ReturnType<LaserBatch["flush"]>) => {
    if (points) link.current?.send({ type: "laser", points });
  };
  const laserPoint = (event: React.PointerEvent) => {
    if (session.getState().tool.kind !== "laser" || !(event.buttons & 1)) return;
    const element = stage.current?.querySelector("[data-page]");
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const point = toFraction({ x: event.clientX, y: event.clientY }, { left: rect.left, top: rect.top, width: rect.width, height: rect.height });
    sendLaser(batch.current.add(point, performance.now()));
    if (batch.current.waiting > 0 && !flushTimer.current) {
      flushTimer.current = setTimeout(() => { flushTimer.current = null; sendLaser(batch.current.flush(performance.now())); }, 40);
    }
  };
  useEffect(() => () => { if (flushTimer.current) clearTimeout(flushTimer.current); }, []);

  // Notes

  const [notes, setNotes] = useState(page.notes ?? "");
  const pending = useRef<{ pageID: string; text: string } | null>(null);
  const saveNotes = useCallback(() => {
    const draft = pending.current;
    if (!draft) return;
    pending.current = null;
    if ((doc.page(draft.pageID)?.notes ?? "") !== draft.text) {
      doc.updatePage(draft.pageID, t("Edit Notes"), (target) => { if (draft.text) target.notes = draft.text; else delete target.notes; });
    }
  }, [doc]);
  // Notes not yet saved are kept when the page turns or the presenter ends.
  useEffect(() => {
    setNotes(page.notes ?? "");
    return saveNotes;
  }, [page.id, saveNotes]);

  // The timer

  const [timer, setTimer] = useState<TimerState>(() => startTimer(Date.now()));
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(tick);
  }, []);

  // The next page as a small picture

  const [next, setNext] = useState<string | null>(null);
  const nextInk = nextID ? doc.inkVersion(nextID) : 0;
  useEffect(() => {
    let live = true;
    setNext(null);
    if (nextID) void pageThumbnailURL(doc, nextID, 320).then((url) => { if (live) setNext(url); });
    return () => { live = false; };
  }, [doc, nextID, nextInk]);

  const laser = state.tool.kind === "laser";
  if (state.tool.kind === "pen") lastPen.current = state.tool;
  const writing = lastPen.current ?? (pens[0] ? ({ kind: "pen", penID: pens[0].id } as ToolChoice) : null);

  return (
    <div className="presenter" data-testid="presenter" data-page={page.id}>
      <header className="presenter-bar">
        <span className="meta" data-testid="presenter-page">{t("Page {page} of {total}", { page: index + 1, total: pages.length })}</span>
        <div className="bar-group">
          <IconButton label={t("Previous Page")} disabled={index === 0} onClick={() => go(-1)} testid="presenter-prev"><ChevronLeft /></IconButton>
          <IconButton label={t("Next Page")} disabled={!nextID} onClick={() => go(1)} testid="presenter-next"><ChevronRight /></IconButton>
        </div>
        <div className="bar-group">
          <IconButton label={t("Laser Pointer")} on={laser} onClick={() => setTool(session, { kind: "laser" })} testid="presenter-laser"><Pointer /></IconButton>
          <IconButton label={t("Write on the Page")} on={!laser} disabled={!writing} onClick={() => writing && setTool(session, writing)} testid="presenter-pen"><PenLine /></IconButton>
        </div>
        <div className="grow" />
        <button type="button" className="btn in-bar small" onClick={() => void openAudience()} data-testid="open-audience"><MonitorUp /> {t("Open Audience Window")}</button>
        {isTauri && <IconButton label={t("Audience Full Screen")} on={fullscreen} onClick={() => void toggleFullscreen()} testid="audience-fullscreen-toggle"><Maximize /></IconButton>}
        <button type="button" className="btn primary small" onClick={finish} data-testid="presenter-done">{t("Done")}</button>
      </header>
      <div className="presenter-body">
        <div
          ref={stage}
          className="presenter-stage"
          onPointerDownCapture={laserPoint}
          onPointerMoveCapture={laserPoint}
          onPointerUpCapture={() => { if (flushTimer.current) { clearTimeout(flushTimer.current); flushTimer.current = null; } sendLaser(batch.current.flush(performance.now())); }}
        >
          <EditorCanvas doc={doc} session={session} presenting />
        </div>
        <aside className="presenter-side">
          <section>
            <span className="label">{t("Next")}</span>
            {nextID ? (
              <div className="presenter-next" data-testid="presenter-next-page">{next ? <img src={next} alt={t("The next page")} draggable={false} /> : <div className="presenter-next-blank" />}</div>
            ) : (
              <p className="secondary" data-testid="presenter-last">{t("This is the last page.")}</p>
            )}
          </section>
          <section className="presenter-notes">
            <span className="label">{t("Notes")}</span>
            <textarea
              className="field"
              value={notes}
              placeholder={t("Notes only you can see")}
              onChange={(event) => { setNotes(event.target.value); pending.current = { pageID: page.id, text: event.target.value }; }}
              onBlur={saveNotes}
              data-testid="presenter-notes"
            />
          </section>
          <section className="presenter-timer">
            <span className="label">{t("Time")}</span>
            <div className="row">
              <span className="display presenter-clock" data-testid="presenter-timer">{formatTimer(timerElapsed(timer, now))}</span>
              <div className="grow" />
              <IconButton label={timer.since === null ? t("Resume Timer") : t("Pause Timer")} onClick={() => setTimer((current) => (current.since === null ? resumeTimer(current, Date.now()) : pauseTimer(current, Date.now())))} testid="timer-toggle">
                {timer.since === null ? <Play /> : <Pause />}
              </IconButton>
              <IconButton label={t("Reset Timer")} onClick={() => setTimer((current) => resetTimer(current, Date.now()))} testid="timer-reset"><RotateCcw /></IconButton>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
