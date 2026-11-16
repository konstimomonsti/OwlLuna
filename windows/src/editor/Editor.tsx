// The editor: a quiet desk round the page. A bar above, the tool tray below, and the pages between.

import {
  Bookmark, BookmarkCheck, ChevronLeft, Columns2, Ellipsis, FileDown, Focus, Hand, LayoutGrid, Maximize, Mic, MonitorPlay, PenLine, Plus, Redo2, ScrollText,
  Search, StickyNote, Undo2, X, ZoomIn, ListTree, Layers, FileText, Image as ImageIcon, Link2, Type, Tally1, FilePlus2, GalleryVertical, GalleryHorizontal, House, Maximize2, Palette, TextSelect, FileInput, ImagePlus,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useStore } from "zustand";
import { stickerDataURL, stickers } from "../canvas/stickers";
import { anchorBelow, IconButton, Menu, MenuBreak, MenuRow, type MenuAnchor } from "../design/controls";
import { paperColorNames, paperColors, paperCSS, templateNames, type PaperTemplate } from "../model/paper";
import { pickFiles } from "../platform/host";
import { closeTab, notify, renameNotebook, setSplit, showLibrary, showTab, updateSettings, useApp } from "../state/app";
import "../design/editor-panels.css";
import { assetPath } from "../storage/package";
import { extensionOf, pasteFromClipboard, placeLink, placePicture, placeSticker, updateLink } from "./actions";
import { copySelection, deleteSelection, duplicateSelection, InkBar, ItemBar } from "./bars";
import { BoardControls, backToStart, showEverything } from "./BoardControls";
import type { NotebookDocument } from "./document";
import { EditorCanvas, type EditorCanvasHandle } from "./EditorCanvas";
import { ExportSheet } from "./ExportSheet";
import { addPdfPagesTo, addPicturePageTo } from "./importFiles";
import { PdfTextLayer } from "../canvas/PdfTextLayer";
import { refreshWords } from "../services/words";
import { FindPanel } from "./FindPanel";
import { LinkSheet } from "./LinkSheet";
import { Navigator } from "./Navigator";
import { Outline } from "./Outline";
import { PaperDrawer } from "./PaperDrawer";
import { goToPage, sessionFor, setTool, type Session } from "./session";
import { ToolTray } from "./ToolTray";
import { ZoomWindow } from "./ZoomWindow";
import type { LinkItem } from "../model/notebook";

function typing(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
}

export function Editor(props: { doc: NotebookDocument; active: boolean; secondary?: boolean }) {
  const { doc } = props;
  useSyncExternalStore(doc.subscribe, doc.getVersion);
  const pens = useApp((state) => state.settings.pens);
  const session = sessionFor(doc.id, doc.manifest.pages[0].id, pens[0]?.id);
  const state = useStore(session);
  const settings = useApp((app) => app.settings);
  const tabs = useApp((app) => app.tabs);
  const manifests = useApp((app) => app.manifests);
  const split = useApp((app) => app.split);
  const canvas = useRef<EditorCanvasHandle>(null);
  const [menu, setMenu] = useState<{ kind: "more" | "add" | "zoom" | "stickers" | "paper"; anchor: MenuAnchor } | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [linkSheet, setLinkSheet] = useState<{ editing: { pageID: string; item: LinkItem } | null } | null>(null);

  const pages = doc.manifest.pages;
  const index = Math.max(doc.pageIndex(state.currentPage), 0);
  const page = pages[index];
  const board = doc.manifest.kind === "whiteboard";

  // A pen that was removed can't stay in hand.
  useEffect(() => {
    if (state.tool.kind === "pen" && !pens.some((pen) => pen.id === (state.tool as { penID: string }).penID) && pens[0]) setTool(session, { kind: "pen", penID: pens[0].id });
  }, [pens, state.tool]);

  // The page last open is remembered when the editor is left.
  useEffect(() => () => {
    const last = session.getState().currentPage;
    if (doc.manifest.lastPage !== last && doc.page(last)) doc.touch((manifest) => { manifest.lastPage = last; });
  }, [doc, session]);

  const viewSize = useCallback(() => canvas.current?.viewSize() ?? { w: 0, h: 0 }, []);
  const centre = useCallback(() => canvas.current?.centre() ?? { pageID: page.id, x: page.size.w / 2, y: page.size.h / 2 }, [page]);
  const readAsset = useCallback((notebook: string, file: string) => doc.fs.read(assetPath(notebook, file)), [doc]);

  const addPicture = useCallback(async () => {
    const files = await pickFiles([{ name: "Pictures", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }], true);
    let offset = 0;
    for (const file of files) {
      const at = centre();
      await placePicture(doc, session, file.data, extensionOf(file.name) || "png", { ...at, x: at.x + offset, y: at.y + offset });
      offset += 18;
    }
  }, [doc, session, centre]);

  const turn = useCallback((direction: 1 | -1) => {
    const next = pages[doc.pageIndex(session.getState().currentPage) + direction];
    if (next) goToPage(session, next.id);
  }, [doc, pages, session]);

  const toggleBookmark = useCallback(() => {
    const target = doc.page(session.getState().currentPage);
    if (target) doc.updatePage(target.id, target.bookmark ? "Remove Bookmark" : "Bookmark", (draft) => { if (draft.bookmark) delete draft.bookmark; else draft.bookmark = true; });
  }, [doc, session]);

  // Keyboard

  useEffect(() => {
    if (!props.active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (document.querySelector(".scrim")) return;
      const controller = canvas.current?.controller;
      if (event.code === "Space" && !typing(event.target)) {
        if (controller) controller.spaceDown = true;
        event.preventDefault();
        return;
      }
      if (typing(event.target)) return;
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      const done = () => event.preventDefault();
      if (mod && !event.shiftKey && !event.altKey && key === "z") { doc.undo(); return done(); }
      if (mod && ((event.shiftKey && key === "z") || key === "y")) { doc.redo(); return done(); }
      if (mod && key === "c") { if (copySelection(doc, session)) done(); return; }
      if (mod && key === "x") { if (copySelection(doc, session)) { deleteSelection(doc, session, "Cut"); done(); } return; }
      if (mod && key === "d") { if (duplicateSelection(doc, session)) done(); return; }
      if (mod && key === "a" && !board) {
        const ids = doc.ink(page.id).map((stroke) => stroke.id);
        if (ids.length) { setTool(session, { kind: "lasso" }); session.setState({ selection: { pageID: page.id, ids } }); }
        return done();
      }
      if (board && mod && !event.shiftKey && (key === "0" || key === "1")) { showEverything(doc, session, viewSize()); return done(); }
      if (board && mod && key === "9") { canvas.current?.zoomAt(1 / session.getState().zoom); return done(); }
      if (!board && mod && key === "0") { session.setState({ fit: "width" }); return done(); }
      if (!board && mod && key === "9") { session.setState({ fit: "page" }); return done(); }
      if (mod && (key === "=" || key === "+")) { canvas.current?.zoomAt(1.25); return done(); }
      if (mod && key === "-") { canvas.current?.zoomAt(0.8); return done(); }
      if (mod && event.shiftKey && key === "f") { session.setState((s) => ({ focus: !s.focus })); return done(); }
      if (mod && !event.shiftKey && key === "f") { session.setState({ panel: "find" }); return done(); }
      if (mod && key === "b") { toggleBookmark(); return done(); }
      if (mod && key === "enter" && !event.altKey) { const added = doc.addPage(session.getState().currentPage); goToPage(session, added.id); return done(); }
      if (mod) return;
      if (key === "delete" || key === "backspace") { if (deleteSelection(doc, session)) done(); return; }
      if (key === "escape") {
        const s = session.getState();
        if (s.selection || s.selectedItem) session.setState({ selection: null, selectedItem: null, editingItem: null });
        else if (s.panel) session.setState({ panel: null });
        else if (s.focus) session.setState({ focus: false });
        return;
      }
      if (board && key === "home") { backToStart(session); return done(); }
      if (board && key.startsWith("arrow")) {
        const step = event.shiftKey ? 400 : 80;
        const dx = key === "arrowleft" ? -step : key === "arrowright" ? step : 0, dy = key === "arrowup" ? -step : key === "arrowdown" ? step : 0;
        canvas.current?.panBy(dx, dy);
        return done();
      }
      if (key === "pagedown" || (settings.pageFlow === "single" && key === "arrowright")) { turn(1); return done(); }
      if (key === "pageup" || (settings.pageFlow === "single" && key === "arrowleft")) { turn(-1); return done(); }
      // A digit takes the pen in that place; letters take the other tools.
      if (/^[1-8]$/.test(key) && pens[Number(key) - 1]) { setTool(session, { kind: "pen", penID: pens[Number(key) - 1].id }); return; }
      if (key === "e") setTool(session, { kind: "eraser" });
      else if (key === "l") setTool(session, { kind: "lasso" });
      else if (key === "h") setTool(session, { kind: "hand" });
      else if (key === "t") setTool(session, { kind: "text" });
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space" && canvas.current?.controller) canvas.current.controller.spaceDown = false;
    };
    const onPaste = (event: ClipboardEvent) => {
      if (typing(event.target) || document.querySelector(".scrim")) return;
      event.preventDefault();
      void pasteFromClipboard(doc, session, event.clipboardData, centre(), readAsset).catch(() => notify("That couldn't be pasted.", "trouble"));
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("paste", onPaste);
    };
  }, [props.active, doc, session, pens, page, board, settings.pageFlow, turn, toggleBookmark, centre, readAsset, viewSize]);

  // PDF text is read into the words cache once the writing has paused, and when the notebook is left.
  const version = doc.getVersion();
  useEffect(() => {
    const timer = setTimeout(() => void refreshWords(doc).catch(() => {}), 4000);
    return () => clearTimeout(timer);
  }, [doc, version]);
  useEffect(() => () => void refreshWords(doc).catch(() => {}), [doc]);

  const toggleZoomWindow = useCallback(() => {
    if (session.getState().zoomWindow) return session.setState({ zoomWindow: null });
    const at = centre();
    session.setState({ zoomWindow: { pageID: at.pageID, x: Math.max(at.x - 150, 0), y: Math.max(at.y - 20, 0) } });
  }, [session, centre]);

  const others = tabs.filter((id) => id !== doc.id);
  const close = () => setMenu(null);

  return (
    <div className={`editor${state.focus ? " focus" : ""}${state.zoomWindow ? " zoomed" : ""}`} data-testid="editor" data-notebook={doc.id}>
      {!state.focus && (
        <header className="editor-bar">
          {!props.secondary && <IconButton label="Library" onClick={showLibrary} testid="back-to-library"><ChevronLeft /></IconButton>}
          {renaming ? (
            <input
              className="field title-field"
              autoFocus
              defaultValue={doc.manifest.title}
              data-testid="title-field"
              onFocus={(event) => event.target.select()}
              onBlur={(event) => { void renameNotebook(doc.id, event.target.value); setRenaming(false); }}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === "Enter") (event.target as HTMLInputElement).blur();
                if (event.key === "Escape") setRenaming(false);
              }}
            />
          ) : (
            <button type="button" className="title-button display truncate" title="Rename" onClick={() => setRenaming(true)} data-testid="notebook-title">{doc.manifest.title}</button>
          )}
          <span className={`save-state meta ${doc.saveState}`} data-testid="save-state" data-state={doc.saveState} title={doc.saveError ?? ""}>
            {doc.saveState === "saved" ? "Saved" : doc.saveState === "saving" ? "Saving…" : doc.saveState === "failed" ? "Not saved" : "Unsaved"}
          </span>
          {!props.secondary && tabs.length > 1 && (
            <div className="tabs" role="tablist">
              {tabs.map((id) => (
                <div key={id} className={`tab${id === doc.id ? " on" : ""}`} role="tab" aria-selected={id === doc.id}>
                  <button type="button" className="truncate" onClick={() => showTab(id)} data-testid="tab">{manifests[id]?.title ?? "Notebook"}</button>
                  <button type="button" aria-label={`Close ${manifests[id]?.title ?? "notebook"}`} onClick={() => void closeTab(id)}><X /></button>
                </div>
              ))}
            </div>
          )}
          <div className="grow" />
          <div className="bar-group">
            <IconButton label={doc.undoLabel ? `Undo ${doc.undoLabel} (Ctrl+Z)` : "Undo (Ctrl+Z)"} disabled={!doc.canUndo} onClick={() => doc.undo()} testid="undo"><Undo2 /></IconButton>
            <IconButton label={doc.redoLabel ? `Redo ${doc.redoLabel} (Ctrl+Y)` : "Redo (Ctrl+Y)"} disabled={!doc.canRedo} onClick={() => doc.redo()} testid="redo"><Redo2 /></IconButton>
          </div>
          {!board && (
            <button type="button" className="btn in-bar small meta" onClick={() => session.setState({ panel: state.panel === "navigator" ? null : "navigator" })} title="Pages" data-testid="page-count">
              {index + 1} / {pages.length}
            </button>
          )}
          <button type="button" className="btn in-bar small meta" onClick={(event) => setMenu({ kind: "zoom", anchor: anchorBelow(event.currentTarget, "end") })} title="Zoom" data-testid="zoom-level">
            {Math.round(state.zoom * 100)}%
          </button>
          {board && (
            <IconButton label="Paper" onClick={(event) => setMenu({ kind: "paper", anchor: anchorBelow(event.currentTarget, "end") })} testid="board-paper"><Palette /></IconButton>
          )}
          {page.background.kind === "pdf" && (
            <IconButton label="Select Text" on={state.textSelect} onClick={() => session.setState({ textSelect: !state.textSelect })} testid="select-text"><TextSelect /></IconButton>
          )}
          <IconButton label={page.bookmark ? "Remove Bookmark (Ctrl+B)" : "Bookmark This Page (Ctrl+B)"} on={page.bookmark === true} onClick={toggleBookmark} testid="bookmark">
            {page.bookmark ? <BookmarkCheck /> : <Bookmark />}
          </IconButton>
          <IconButton label="Add" onClick={(event) => setMenu({ kind: "add", anchor: anchorBelow(event.currentTarget, "end") })} testid="add-menu"><Plus /></IconButton>
          <IconButton label="More" onClick={(event) => setMenu({ kind: "more", anchor: anchorBelow(event.currentTarget, "end") })} testid="more-menu"><Ellipsis /></IconButton>
          {props.secondary && <IconButton label="Close Side by Side" onClick={() => setSplit(null)}><X /></IconButton>}
        </header>
      )}

      {state.panel === "find" && !state.focus && <FindPanel doc={doc} session={session} version={doc.getVersion()} active={props.active} />}

      <div className="editor-stage">
        {state.panel === "navigator" && !board && !state.focus && <Navigator doc={doc} session={session} version={doc.getVersion()} />}
        <EditorCanvas
          ref={canvas}
          pageExtras={(target, zoom) => (target.background.kind === "pdf" ? <PdfTextLayer doc={doc} page={target} zoom={zoom} selecting={state.textSelect} /> : null)}
          doc={doc}
          session={session}
          selectionBar={(bounds) => <InkBar doc={doc} session={session} bounds={bounds} onToText={() => notify("Handwriting to Text arrives with the Windows services.")} onMakeCard={() => notify("Flashcards arrive with the study tools.")} />}
          itemBar={(pageID, item) => <ItemBar doc={doc} session={session} pageID={pageID} item={item} onCrop={() => session.setState({ croppingItem: item.id })} onEditLink={() => { if (item.kind === "link") setLinkSheet({ editing: { pageID, item } }); }} onMakeCard={() => {}} />}
        />
        {board && !state.focus && <BoardControls doc={doc} session={session} canvas={canvas} />}
        {state.panel === "paper" && !board && !state.focus && <PaperDrawer doc={doc} session={session} version={doc.getVersion()} />}
        {state.panel === "outline" && !state.focus && <Outline doc={doc} session={session} version={doc.getVersion()} />}
        {state.focus && (
          <div className="focus-exit">
            <IconButton label="Leave Focus (Esc)" onClick={() => session.setState({ focus: false })} testid="leave-focus"><X /></IconButton>
          </div>
        )}
      </div>

      {state.zoomWindow && !state.focus && <ZoomWindow doc={doc} session={session} version={doc.getVersion()} />}

      <ToolTray
        session={session}
        actions={{
          addPicture: () => void addPicture(),
          addSticker: (anchor) => setMenu({ kind: "stickers", anchor }),
          addLink: () => setLinkSheet({ editing: null }),
          toggleRuler: () => session.setState((s) => ({ ruler: s.ruler ? null : { pageID: s.currentPage, ...rulerStart(centre()), angle: 0 } })),
          toggleZoomWindow,
          inkToText: () => notify("Handwriting to Text arrives with the Windows services."),
        }}
      />

      {menu?.kind === "zoom" && (
        <Menu anchor={menu.anchor} title="Zoom" onClose={close}>
          {board ? (
            <>
              <MenuRow icon={<Maximize2 />} keys="Ctrl+1" onClick={() => { showEverything(doc, session, viewSize()); close(); }} testid="zoom-show-everything">Show Everything</MenuRow>
              <MenuRow icon={<House />} keys="Home" onClick={() => { backToStart(session); close(); }} testid="zoom-back-to-start">Back to Start</MenuRow>
            </>
          ) : (
            <>
              <MenuRow icon={<GalleryVertical />} keys="Ctrl+0" chosen={state.fit === "width"} onClick={() => { session.setState({ fit: "width" }); close(); }}>Fit Width</MenuRow>
              <MenuRow icon={<Maximize />} keys="Ctrl+9" chosen={state.fit === "page"} onClick={() => { session.setState({ fit: "page" }); close(); }}>Fit Page</MenuRow>
            </>
          )}
          <MenuBreak />
          {(board ? [0.1, 0.25, 0.5, 1, 2, 4] : [0.5, 1, 1.5, 2, 3, 5]).map((level) => (
            <MenuRow key={level} icon={<ZoomIn />} chosen={(board || !state.fit) && Math.abs(state.zoom - level) < 0.005} onClick={() => { canvas.current?.zoomAt(level / state.zoom); close(); }} testid={`zoom-${Math.round(level * 100)}`}>{Math.round(level * 100)}%</MenuRow>
          ))}
        </Menu>
      )}

      {menu?.kind === "paper" && board && (
        <Menu anchor={menu.anchor} title="Paper" onClose={close} testid="paper-menu">
          {(["blank", "dotted", "grid", "narrowRuled", "wideRuled"] as PaperTemplate[]).map((template) => (
            <MenuRow
              key={template}
              chosen={page.background.kind === "template" && page.background.template === template}
              onClick={() => { doc.updatePage(page.id, "Change Paper", (draft) => { draft.background = { kind: "template", template }; }); close(); }}
              testid={`paper-${template}`}
            >
              {templateNames[template]}
            </MenuRow>
          ))}
          <MenuBreak />
          {paperColors.map((color) => (
            <MenuRow
              key={color}
              icon={<span style={{ width: 16, height: 16, borderRadius: 3, background: paperCSS(color), border: "1px solid var(--rule)", display: "block" }} />}
              chosen={page.paperColor === color}
              onClick={() => { doc.updatePage(page.id, "Change Paper", (draft) => { draft.paperColor = color; }); close(); }}
              testid={`paper-color-${color}`}
            >
              {paperColorNames[color]}
            </MenuRow>
          ))}
        </Menu>
      )}

      {menu?.kind === "add" && (
        <Menu anchor={menu.anchor} title="Add" onClose={close} testid="add-menu-card">
          {!board && <MenuRow icon={<FilePlus2 />} keys="Ctrl+Enter" onClick={() => { const added = doc.addPage(page.id); goToPage(session, added.id); close(); }} testid="add-page-row">Page After This One</MenuRow>}
          {!board && <MenuBreak />}
          <MenuRow icon={<ImageIcon />} onClick={() => { close(); void addPicture(); }}>Picture…</MenuRow>
          {!board && <MenuRow icon={<FileInput />} onClick={() => { close(); void addPdfPagesTo(doc, page.id).then((first) => { if (first) goToPage(session, first); }); }} testid="add-pdf-pages">Pages from PDF…</MenuRow>}
          {!board && <MenuRow icon={<ImagePlus />} onClick={() => { close(); void addPicturePageTo(doc, page.id).then((first) => { if (first) goToPage(session, first); }); }} testid="add-picture-page">Picture as Page…</MenuRow>}
          <MenuRow icon={<Type />} onClick={() => { setTool(session, { kind: "text" }); close(); }}>Text Box</MenuRow>
          <MenuRow icon={<StickyNote />} onClick={() => setMenu({ kind: "stickers", anchor: menu.anchor })}>Sticker</MenuRow>
          <MenuRow icon={<Link2 />} onClick={() => { close(); setLinkSheet({ editing: null }); }} testid="add-link-row">Link…</MenuRow>
          <MenuRow icon={<Tally1 />} onClick={() => { setTool(session, { kind: "tape" }); close(); }}>Study Tape</MenuRow>
        </Menu>
      )}

      {menu?.kind === "stickers" && (
        <Menu anchor={menu.anchor} title="Stickers" onClose={close} width={292} testid="sticker-menu">
          <div className="sticker-grid">
            {stickers.map((sticker) => (
              <button key={sticker.name} type="button" title={sticker.label} aria-label={sticker.label} data-testid={`sticker-${sticker.name}`} onClick={() => { placeSticker(doc, session, sticker.name, centre()); close(); }}>
                <img src={stickerDataURL(sticker)} alt="" draggable={false} />
              </button>
            ))}
          </div>
        </Menu>
      )}

      {menu?.kind === "more" && (
        <Menu anchor={menu.anchor} title={doc.manifest.title} onClose={close} testid="more-menu-card">
          {!board && <MenuRow icon={<LayoutGrid />} onClick={() => { session.setState({ panel: "navigator" }); close(); }}>Pages</MenuRow>}
          <MenuRow icon={<ScrollText />} onClick={() => { if (board) setMenu({ kind: "paper", anchor: menu.anchor }); else { session.setState({ panel: "paper" }); close(); } }}>Paper…</MenuRow>
          <MenuRow icon={<Search />} keys="Ctrl+F" onClick={() => { session.setState({ panel: "find" }); close(); }}>Find in Notebook</MenuRow>
          <MenuRow icon={<ListTree />} onClick={() => { session.setState({ panel: "outline" }); close(); }}>Outline and Bookmarks</MenuRow>
          <MenuBreak />
          {page.background.kind === "pdf" && (
            <MenuRow icon={<TextSelect />} chosen={state.textSelect} onClick={() => { session.setState({ textSelect: !state.textSelect }); close(); }} testid="more-select-text">Select Text</MenuRow>
          )}
          <MenuRow icon={<ZoomIn />} chosen={state.zoomWindow !== null} onClick={() => { toggleZoomWindow(); close(); }} testid="more-zoom-window">Zoom Window</MenuRow>
          <MenuRow icon={<Layers />} onClick={() => { session.setState({ panel: "cards" }); close(); }}>Flashcards</MenuRow>
          <MenuRow icon={<Mic />} onClick={() => { session.setState({ panel: "recordings" }); close(); }}>Recordings</MenuRow>
          <MenuRow icon={<MonitorPlay />} keys="Ctrl+Alt+Enter" onClick={() => { close(); notify("Presenting arrives with a later step."); }}>Present</MenuRow>
          <MenuRow icon={<FileDown />} onClick={() => { close(); setExporting(true); }} testid="more-export">Export…</MenuRow>
          <MenuBreak />
          <MenuRow icon={<PenLine />} chosen={settings.drawWith === "pen"} onClick={() => { updateSettings({ drawWith: "pen" }); close(); }}>Draw With Pen Only</MenuRow>
          <MenuRow icon={<Hand />} chosen={settings.drawWith === "penAndFinger"} onClick={() => { updateSettings({ drawWith: "penAndFinger" }); close(); }}>Draw With Pen and Finger</MenuRow>
          {!board && <MenuBreak />}
          {!board && <MenuRow icon={<GalleryVertical />} chosen={settings.pageFlow === "continuous"} onClick={() => { updateSettings({ pageFlow: "continuous" }); close(); }}>Scroll Pages</MenuRow>}
          {!board && <MenuRow icon={<GalleryHorizontal />} chosen={settings.pageFlow === "single"} onClick={() => { updateSettings({ pageFlow: "single" }); close(); }}>One Page at a Time</MenuRow>}
          <MenuBreak />
          <MenuRow icon={<Focus />} keys="Ctrl+Shift+F" onClick={() => { session.setState({ focus: true }); close(); }}>Focus</MenuRow>
          {!props.secondary && others.length > 0 && (
            <MenuRow icon={<Columns2 />} chosen={split !== null} onClick={() => { setSplit(split ? null : others[0]); close(); }}>Side by Side</MenuRow>
          )}
          <MenuRow icon={<FileText />} onClick={() => { setRenaming(true); close(); }}>Rename…</MenuRow>
        </Menu>
      )}
      {exporting && <ExportSheet doc={doc} session={session} onClose={() => setExporting(false)} />}
      {linkSheet && (
        <LinkSheet
          doc={doc}
          editing={linkSheet.editing?.item ?? null}
          onClose={() => setLinkSheet(null)}
          onSave={(target, label) => {
            if (linkSheet.editing) updateLink(doc, linkSheet.editing.pageID, linkSheet.editing.item.id, target, label);
            else placeLink(doc, session, target, label, centre());
            setLinkSheet(null);
          }}
        />
      )}
    </div>
  );
}

function rulerStart(at: { x: number; y: number }): { x: number; y: number } {
  return { x: at.x - 260, y: at.y - 24 };
}

export type { Session };
