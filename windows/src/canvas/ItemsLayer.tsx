// What lies on a page besides ink: pictures, stickers, text boxes and links under the ink, study tape over it.
// Drawn as elements in page points inside a layer the page scales.

import katex from "katex";
import "katex/dist/katex.min.css";
import { ExternalLink, FileText, BookOpen, RotateCw } from "lucide-react";
import { memo, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import type { NotebookDocument } from "../editor/document";
import { highlightHex, tapeHex, textTintHex, type LinkItem, type Page, type PageItem, type PictureItem, type TapeItem, type TextItem } from "../model/notebook";
import { isDarkPaper } from "../model/paper";
import { assetPath } from "../storage/package";
import { stickerDataURL, stickerNamed } from "./stickers";
import { faceCSS, LINE_HEIGHT, mathRuns, textLines } from "./textLayout";
import { capturePointer } from "./pointer";
import { t } from "../i18n";

const urls = new Map<string, string>();
const pendingURLs = new Map<string, Promise<string | null>>();

/** An address the browser can show a notebook's picture from. */
export function assetURL(doc: NotebookDocument, file: string): Promise<string | null> {
  const key = `${doc.id}/${file}`;
  const have = urls.get(key);
  if (have) return Promise.resolve(have);
  let pending = pendingURLs.get(key);
  if (!pending) {
    pending = doc.fs.read(assetPath(doc.id, file)).then((data) => {
      pendingURLs.delete(key);
      if (!data) return null;
      const type = file.endsWith(".png") ? "image/png" : file.endsWith(".webp") ? "image/webp" : file.endsWith(".gif") ? "image/gif" : file.endsWith(".svg") ? "image/svg+xml" : "image/jpeg";
      const url = URL.createObjectURL(new Blob([data.slice()], { type }));
      urls.set(key, url);
      return url;
    }, () => null);
    pendingURLs.set(key, pending);
  }
  return pending;
}

export function useAssetURL(doc: NotebookDocument, file: string | undefined): string | null {
  const [url, setURL] = useState<string | null>(() => (file ? urls.get(`${doc.id}/${file}`) ?? null : null));
  useEffect(() => {
    let live = true;
    if (!file) return setURL(null);
    setURL(urls.get(`${doc.id}/${file}`) ?? null);
    void assetURL(doc, file).then((found) => { if (live) setURL(found); });
    return () => { live = false; };
  }, [doc, file]);
  return url;
}

function frameStyle(item: PageItem): CSSProperties {
  return {
    position: "absolute", left: item.x - item.w / 2, top: item.y - item.h / 2, width: item.w, height: item.h,
    transform: item.rotation ? `rotate(${item.rotation}rad)` : undefined,
  };
}

function Picture(props: { doc: NotebookDocument; item: PictureItem }) {
  const url = useAssetURL(props.doc, props.item.file);
  const [x, y, w, h] = props.item.crop ?? [0, 0, 1, 1];
  return (
    <div style={{ ...frameStyle(props.item), overflow: "hidden" }} data-item={props.item.id}>
      {url && (
        <img
          src={url}
          alt={props.item.text ?? ""}
          draggable={false}
          style={{ position: "absolute", width: props.item.w / w, height: props.item.h / h, left: (-x * props.item.w) / w, top: (-y * props.item.h) / h, maxWidth: "none" }}
        />
      )}
    </div>
  );
}

export function mathHTML(source: string): string {
  try {
    return katex.renderToString(source, { throwOnError: false, output: "html" });
  } catch {
    return source;
  }
}

export function textStyle(item: TextItem, darkPaper: boolean): CSSProperties {
  const tint = item.tint ?? "ink";
  return {
    fontFamily: faceCSS[item.face ?? "system"],
    fontSize: item.fontSize,
    lineHeight: LINE_HEIGHT,
    fontWeight: item.bold ? 700 : 400,
    fontStyle: item.italic ? "italic" : "normal",
    textDecoration: item.underline ? "underline" : "none",
    textAlign: item.align === "center" ? "center" : item.align === "trailing" ? "right" : "left",
    color: tint === "ink" && darkPaper ? "#ECE6DA" : textTintHex[tint],
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
  };
}

function TextBox(props: { doc: NotebookDocument; pageID: string; item: TextItem; darkPaper: boolean; editing: boolean; hot: boolean; onDone: () => void }) {
  const { item } = props;
  const area = useRef<HTMLTextAreaElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState(item.string);
  useEffect(() => {
    if (props.editing) {
      setDraft(item.string);
      requestAnimationFrame(() => {
        area.current?.focus();
        area.current?.setSelectionRange(item.string.length, item.string.length);
      });
    }
  }, [props.editing]);
  // The box grows downwards with its words, and never shrinks under what the user sized it to hold.
  useLayoutEffect(() => {
    const element = props.editing ? area.current : box.current;
    if (!element) return;
    if (props.editing && area.current) {
      area.current.style.height = "auto";
      area.current.style.height = `${Math.max(area.current.scrollHeight, item.h)}px`;
    }
  });
  const commit = () => {
    const text = draft;
    const measured = area.current ? Math.ceil(area.current.scrollHeight) : item.h;
    if (text.trim() === "") {
      props.doc.removeItems(props.pageID, new Set([item.id]), item.string ? t("Delete Text") : t("Add Text"));
    } else if (text !== item.string || measured > item.h) {
      props.doc.updateItem(props.pageID, item.id, t("Edit Text"), (target) => {
        if (target.kind !== "text") return;
        const grow = Math.max(measured, target.h) - target.h;
        target.string = text;
        // Ticks follow their lines only while the lines stay put; a rewrite clears those past the end.
        if (target.checked) target.checked = target.checked.filter((line) => line < text.split("\n").length);
        target.h += grow;
        target.y += grow / 2;
      });
    }
    props.onDone();
  };
  const style = textStyle(item, props.darkPaper);
  const highlight = item.highlight ? `${highlightHex[item.highlight]}66` : undefined;
  if (props.editing) {
    return (
      <div style={frameStyle(item)} data-item={item.id} data-hot>
        <textarea
          ref={area}
          value={draft}
          spellCheck={false}
          data-testid="text-editor"
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Escape") (event.target as HTMLTextAreaElement).blur();
          }}
          onPointerDown={(event) => event.stopPropagation()}
          style={{ ...style, width: "100%", minHeight: "100%", padding: 0, margin: 0, border: 0, outline: "1.5px solid var(--accent)", outlineOffset: 3, background: "transparent", resize: "none", overflow: "hidden", display: "block", userSelect: "text", WebkitUserSelect: "text" }}
        />
      </div>
    );
  }
  const lines = textLines(item);
  const toggle = (index: number) => {
    props.doc.updateItem(props.pageID, item.id, t("Tick"), (target) => {
      if (target.kind !== "text") return;
      const ticked = new Set(target.checked ?? []);
      if (ticked.has(index)) ticked.delete(index);
      else ticked.add(index);
      target.checked = [...ticked].sort((a, b) => a - b);
    });
  };
  return (
    <div ref={box} style={{ ...frameStyle(item), ...style }} data-item={item.id}>
      {lines.map((line) => (
        <div key={line.index} style={{ display: "flex", gap: "0.45em", minHeight: `${LINE_HEIGHT}em`, opacity: line.checked ? 0.55 : 1 }}>
          {line.marker !== null && (
            line.checked !== null
              ? <span data-hot={props.hot ? "" : undefined} role="checkbox" aria-checked={line.checked} style={{ cursor: "pointer", pointerEvents: props.hot ? "auto" : "none", flex: "none" }} onClick={() => toggle(line.index)}>{line.marker}</span>
              : <span style={{ flex: "none", minWidth: "1em", fontVariantNumeric: "tabular-nums" }}>{line.marker}</span>
          )}
          <span style={{ flex: 1, minWidth: 0, textDecoration: line.checked ? "line-through" : undefined }}>
            <span style={{ background: highlight, boxDecorationBreak: "clone", WebkitBoxDecorationBreak: "clone" }}>
              {mathRuns(line.text).map((run, index) => run.math
                ? <span key={index} dangerouslySetInnerHTML={{ __html: mathHTML(run.text) }} />
                : <span key={index}>{run.text}</span>)}
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}

export function linkTitle(item: LinkItem, doc: NotebookDocument): string {
  if (item.label.trim()) return item.label;
  if (item.target.to === "web") {
    try {
      return new URL(item.target.url).hostname.replace(/^www\./, "");
    } catch {
      return item.target.url;
    }
  }
  if (item.target.to === "notebook") return item.target.name;
  const index = doc.pageIndex(item.target.page);
  return index === -1 ? t("Missing page") : t("Page {number}", { number: index + 1 });
}

function LinkChip(props: { doc: NotebookDocument; item: LinkItem; hot: boolean; onFollow: (item: LinkItem) => void }) {
  const { item } = props;
  const Icon = item.target.to === "web" ? ExternalLink : item.target.to === "notebook" ? BookOpen : FileText;
  return (
    <div
      style={{
        ...frameStyle(item), display: "flex", alignItems: "center", gap: 6, padding: "0 8px", borderRadius: 4,
        background: "#F7F1E3", border: "1px solid rgba(27,34,48,0.35)", color: "#2747B8", fontSize: Math.min(Math.max(item.h * 0.48, 9), 15),
        fontWeight: 600, cursor: props.hot ? "pointer" : undefined, pointerEvents: props.hot ? "auto" : "none", overflow: "hidden",
      }}
      data-item={item.id}
      data-hot={props.hot ? "" : undefined}
      role="link"
      onClick={() => props.onFollow(item)}
    >
      <Icon style={{ width: "1.1em", height: "1.1em", flex: "none" }} />
      <span className="truncate" style={{ textDecoration: "underline" }}>{linkTitle(item, props.doc)}</span>
    </div>
  );
}

function Tape(props: { item: TapeItem; lifted: boolean; hot: boolean; onToggle: (id: string) => void }) {
  const { item } = props;
  const color = tapeHex[item.color];
  // Opaque washi; lifted, it leaves a dashed outline.
  return (
    <div
      style={{
        ...frameStyle(item), cursor: props.hot ? "pointer" : undefined, pointerEvents: props.hot ? "auto" : "none",
        background: props.lifted ? "transparent" : `repeating-linear-gradient(135deg, ${color} 0 7px, ${color}DD 7px 14px)`,
        border: props.lifted ? `1.5px dashed ${color}` : `1px solid rgba(27,34,48,0.25)`,
        boxShadow: props.lifted ? undefined : "0 1px 0 rgba(27,34,48,0.18)",
        transition: "background 0.15s ease-out",
      }}
      data-item={item.id}
      data-hot={props.hot ? "" : undefined}
      data-testid="tape"
      role="button"
      aria-label={props.lifted ? t("Study tape, lifted") : t("Study tape")}
      aria-pressed={props.lifted}
      onClick={() => props.onToggle(item.id)}
    />
  );
}

export interface ItemsLayerProps {
  doc: NotebookDocument;
  page: Page;
  zoom: number;
  layer: "under" | "over";
  /** Whether tape, links and tick boxes answer a tap. Not while the lasso is picking things up. */
  hot: boolean;
  editing: string | null;
  lifted: string[];
  /** An item shown as it is being dragged, in place of the saved one. */
  draft?: PageItem | null;
  onDoneEditing: () => void;
  onFollowLink: (item: LinkItem) => void;
  onToggleTape: (id: string) => void;
}

export const ItemsLayer = memo(function ItemsLayer(props: ItemsLayerProps) {
  const dark = props.page.background.kind === "template" && isDarkPaper(props.page.paperColor);
  const items = props.page.items.filter((item) => (item.kind === "tape") === (props.layer === "over"));
  if (items.length === 0) return null;
  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: 0, height: 0, transform: `scale(${props.zoom})`, transformOrigin: "0 0", pointerEvents: "none" }}>
      {items.map((saved) => {
        const item = props.draft && props.draft.id === saved.id ? props.draft : saved;
        switch (item.kind) {
          case "image": return <Picture key={item.id} doc={props.doc} item={item} />;
          case "sticker": {
            const sticker = stickerNamed(item.name);
            return sticker ? <img key={item.id} src={stickerDataURL(sticker)} alt={t(sticker.label)} draggable={false} style={frameStyle(item)} data-item={item.id} /> : null;
          }
          case "text": return <TextBox key={item.id} doc={props.doc} pageID={props.page.id} item={item} darkPaper={dark} editing={props.editing === item.id} hot={props.hot} onDone={props.onDoneEditing} />;
          case "link": return <LinkChip key={item.id} doc={props.doc} item={item} hot={props.hot} onFollow={props.onFollowLink} />;
          case "tape": return <Tape key={item.id} item={item} lifted={props.lifted.includes(item.id)} hot={props.hot} onToggle={props.onToggleTape} />;
        }
      })}
    </div>
  );
});

type Grip = "move" | "nw" | "ne" | "se" | "sw" | "turn";

/**
 * The frame round a picked-up item: drag it to move, a corner to resize, the knob above to turn. Mustard dashes over
 * an ink line, so it shows on any paper.
 */
export function ItemFrame(props: {
  item: PageItem;
  zoom: number;
  toPage: (clientX: number, clientY: number) => { x: number; y: number };
  onDraft: (item: PageItem | null) => void;
  onCommit: (item: PageItem, label: string) => void;
  onOpen: () => void;
}) {
  const { item, zoom } = props;
  const drag = useRef<{ grip: Grip; start: { x: number; y: number }; origin: PageItem; moved: boolean } | null>(null);
  const [draft, setDraft] = useState<PageItem | null>(null);
  const shown = draft ?? item;
  const keepShape = item.kind === "image" || item.kind === "sticker";

  const begin = (grip: Grip) => (event: ReactPointerEvent) => {
    event.stopPropagation();
    event.preventDefault();
    capturePointer(event.currentTarget as HTMLElement, event.pointerId);
    drag.current = { grip, start: props.toPage(event.clientX, event.clientY), origin: item, moved: false };
  };
  const move = (event: ReactPointerEvent) => {
    const state = drag.current;
    if (!state) return;
    const at = props.toPage(event.clientX, event.clientY);
    const origin = state.origin;
    let next: PageItem = origin;
    if (state.grip === "move") {
      next = { ...origin, x: origin.x + at.x - state.start.x, y: origin.y + at.y - state.start.y };
    } else if (state.grip === "turn") {
      let angle = Math.atan2(at.y - origin.y, at.x - origin.x) + Math.PI / 2;
      // Near a quarter turn it clicks square.
      const quarter = Math.PI / 2, nearest = Math.round(angle / quarter) * quarter;
      if (Math.abs(angle - nearest) < 0.06) angle = nearest;
      next = { ...origin, rotation: angle };
    } else {
      const sx = state.grip.includes("e") ? 1 : -1, sy = state.grip.includes("s") ? 1 : -1;
      const cos = Math.cos(origin.rotation), sin = Math.sin(origin.rotation);
      // The corner opposite stays where it is.
      const anchor = { x: origin.x + (-sx * origin.w / 2) * cos - (-sy * origin.h / 2) * sin, y: origin.y + (-sx * origin.w / 2) * sin + (-sy * origin.h / 2) * cos };
      const dx = at.x - anchor.x, dy = at.y - anchor.y;
      const localX = dx * cos + dy * sin, localY = -dx * sin + dy * cos;
      let w = Math.max(sx * localX, 12), h = Math.max(sy * localY, 10);
      if (keepShape !== event.shiftKey) {
        const scale = Math.max(w / origin.w, h / origin.h);
        w = origin.w * scale;
        h = origin.h * scale;
      }
      const cx = (sx * w) / 2, cy = (sy * h) / 2;
      next = { ...origin, w, h, x: anchor.x + cx * cos - cy * sin, y: anchor.y + cx * sin + cy * cos };
    }
    state.moved = true;
    setDraft(next);
    props.onDraft(next);
  };
  const end = () => {
    const state = drag.current;
    drag.current = null;
    if (state?.moved && draft) props.onCommit(draft, state.grip === "move" ? t("Move") : state.grip === "turn" ? t("Rotate") : t("Resize"));
    setDraft(null);
    props.onDraft(null);
  };

  const w = shown.w * zoom, h = shown.h * zoom;
  const knob = (grip: Grip, style: CSSProperties) => (
    <div
      onPointerDown={begin(grip)} onPointerMove={move} onPointerUp={end} onPointerCancel={end}
      data-testid={`grip-${grip}`}
      style={{ position: "absolute", width: 14, height: 14, margin: -7, background: "var(--board)", border: "1.5px solid var(--ink)", borderRadius: 3, touchAction: "none", ...style }}
    />
  );
  return (
    <div
      data-hot
      data-testid="item-frame"
      style={{ position: "absolute", left: shown.x * zoom - w / 2, top: shown.y * zoom - h / 2, width: w, height: h, transform: shown.rotation ? `rotate(${shown.rotation}rad)` : undefined, pointerEvents: "auto" }}
    >
      <div
        onPointerDown={begin("move")} onPointerMove={move} onPointerUp={end} onPointerCancel={end}
        onDoubleClick={props.onOpen}
        style={{ position: "absolute", inset: -3, cursor: "move", touchAction: "none", outline: "1.5px solid var(--ink)", boxShadow: "0 0 0 1.5px var(--mustard)", outlineOffset: 0, borderRadius: 2 }}
      >
        <div style={{ position: "absolute", inset: 0, border: "1.5px dashed var(--mustard)", borderRadius: 2 }} />
      </div>
      {knob("nw", { left: -3, top: -3, cursor: "nwse-resize" })}
      {knob("ne", { left: w + 3, top: -3, cursor: "nesw-resize" })}
      {knob("se", { left: w + 3, top: h + 3, cursor: "nwse-resize" })}
      {knob("sw", { left: -3, top: h + 3, cursor: "nesw-resize" })}
      <div
        onPointerDown={begin("turn")} onPointerMove={move} onPointerUp={end} onPointerCancel={end}
        title={t("Rotate")}
        style={{ position: "absolute", left: w / 2 - 12, top: -38, width: 24, height: 24, display: "grid", placeItems: "center", background: "var(--board)", border: "1.5px solid var(--ink)", borderRadius: 3, cursor: "grab", touchAction: "none", color: "var(--ink)" }}
      >
        <RotateCw style={{ width: 14, height: 14 }} />
      </div>
    </div>
  );
}
