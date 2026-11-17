// The text of a PDF page as selectable, invisible text over the page, and the marks made on it. Marks are always
// shown; the text is laid out only in Select Text mode, so the pen is never in its way.

import { Copy, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { NotebookDocument } from "../editor/document";
import { Menu, MenuRow } from "../design/controls";
import { uuid } from "../model/ids";
import type { Rect } from "../model/ink";
import { highlightHex, textHighlights, type Page, type TextHighlight, type TextMark } from "../model/notebook";
import { bandsOf, pdfTextBoxes, type TextBox } from "./pdfText";
import { t } from "../i18n";
import { swatchName } from "../i18n/names";

let measurer: CanvasRenderingContext2D | null = null;

/** How much a box's text must be stretched sideways to be as wide as the PDF's own glyphs were. */
function stretchOf(box: TextBox): number {
  measurer ??= document.createElement("canvas").getContext("2d");
  if (!measurer || box.w <= 0) return 1;
  measurer.font = `${box.h}px sans-serif`;
  const natural = measurer.measureText(box.str).width;
  return natural > 0 ? box.w / natural : 1;
}

export function PdfTextLayer(props: { doc: NotebookDocument; page: Page; zoom: number; selecting: boolean }) {
  const { doc, page, zoom } = props;
  const root = useRef<HTMLDivElement>(null);
  const [boxes, setBoxes] = useState<TextBox[]>([]);
  const [bar, setBar] = useState<{ x: number; y: number; bands: Rect[]; text: string } | null>(null);
  const [markMenu, setMarkMenu] = useState<{ mark: TextMark; x: number; y: number } | null>(null);

  useEffect(() => {
    if (!props.selecting) return;
    let live = true;
    void pdfTextBoxes(doc.fs, doc.id, page).then((found) => { if (live) setBoxes(found); });
    return () => { live = false; };
  }, [props.selecting, doc, page.background, page.size.w, page.size.h]);

  const stretched = useMemo(() => boxes.map((box) => ({ box, stretch: stretchOf(box) })), [boxes]);

  // A selection made in this page's text gets a small bar over it.
  useEffect(() => {
    if (!props.selecting) { setBar(null); return; }
    const onChange = () => {
      const element = root.current, selection = window.getSelection();
      if (!element || !selection || selection.isCollapsed || selection.rangeCount === 0) return setBar(null);
      const range = selection.getRangeAt(0);
      if (!element.contains(range.commonAncestorContainer)) return setBar(null);
      const origin = element.getBoundingClientRect();
      const rects: Rect[] = [...range.getClientRects()]
        .filter((rect) => rect.width > 1 && rect.height > 1)
        .map((rect) => ({ x: (rect.left - origin.left) / zoom, y: (rect.top - origin.top) / zoom, w: rect.width / zoom, h: rect.height / zoom }));
      const bands = bandsOf(rects);
      if (!bands.length) return setBar(null);
      const first = bands[0];
      setBar({ x: origin.left + first.x * zoom, y: origin.top + first.y * zoom, bands, text: selection.toString().replace(/\s+/g, " ").trim() });
    };
    document.addEventListener("selectionchange", onChange);
    return () => document.removeEventListener("selectionchange", onChange);
  }, [props.selecting, zoom]);

  const highlight = (color: TextHighlight) => {
    if (!bar || !bar.text) return;
    const mark: TextMark = { id: uuid(), color, rects: bar.bands.map((band) => [band.x, band.y, band.w, band.h]), text: bar.text };
    doc.updatePage(page.id, t("Highlight"), (draft) => { draft.marks = [...(draft.marks ?? []), mark]; });
    window.getSelection()?.removeAllRanges();
    setBar(null);
  };

  const copy = (text: string) => {
    void navigator.clipboard?.writeText(text).catch(() => {});
  };

  const markAt = (clientX: number, clientY: number): TextMark | null => {
    const element = root.current;
    if (!element) return null;
    const origin = element.getBoundingClientRect();
    const x = (clientX - origin.left) / zoom, y = (clientY - origin.top) / zoom;
    for (const mark of [...(page.marks ?? [])].reverse()) {
      if (mark.rects.some(([rx, ry, rw, rh]) => x >= rx && x <= rx + rw && y >= ry && y <= ry + rh)) return mark;
    }
    return null;
  };

  return (
    <>
      <div
        ref={root}
        data-testid="pdf-text-layer"
        style={{ position: "absolute", left: 0, top: 0, width: 0, height: 0, transform: `scale(${zoom})`, transformOrigin: "0 0", pointerEvents: "none" }}
      >
        {(page.marks ?? []).map((mark) => mark.rects.map(([x, y, w, h], index) => (
          <div
            key={`${mark.id}-${index}`}
            data-mark={mark.id}
            style={{ position: "absolute", left: x, top: y, width: w, height: h, background: `${highlightHex[mark.color]}99`, mixBlendMode: "multiply", pointerEvents: "none" }}
          />
        )))}
        {props.selecting && stretched.map(({ box, stretch }, index) => (
          <span
            key={index}
            data-hot
            style={{
              position: "absolute", left: box.x, top: box.y, height: box.h, fontSize: box.h, lineHeight: `${box.h}px`, fontFamily: "sans-serif",
              whiteSpace: "pre", color: "transparent", transformOrigin: "0 0", transform: `rotate(${box.angle}rad) scaleX(${stretch})`,
              pointerEvents: "auto", userSelect: "text", WebkitUserSelect: "text", cursor: "text",
            }}
            onClick={(event) => {
              if (!window.getSelection()?.isCollapsed) return;
              const mark = markAt(event.clientX, event.clientY);
              if (mark) setMarkMenu({ mark, x: event.clientX, y: event.clientY });
            }}
          >
            {box.str}
          </span>
        ))}
      </div>
      {bar && createPortal(
        <div
          className="plate float-bar pdf-select-bar"
          data-testid="select-bar"
          style={{ position: "fixed", left: bar.x, top: Math.max(bar.y - 46, 4), zIndex: 960 }}
          onPointerDown={(event) => event.preventDefault()}
          onMouseDown={(event) => event.preventDefault()}
        >
          <button type="button" className="btn flat small" onClick={() => copy(bar.text)} data-testid="select-copy"><Copy /> {t("Copy")}</button>
          {textHighlights.map((color) => (
            <button
              key={color}
              type="button"
              className="swatch small"
              style={{ background: highlightHex[color] }}
              title={t("Highlight {color}", { color: swatchName(color) })}
              aria-label={t("Highlight {color}", { color: swatchName(color) })}
              onClick={() => highlight(color)}
              data-testid={`select-highlight-${color}`}
            />
          ))}
        </div>,
        document.body,
      )}
      {markMenu && (
        <Menu anchor={{ x: markMenu.x, y: markMenu.y }} title={t("Highlight")} onClose={() => setMarkMenu(null)} testid="mark-menu">
          <MenuRow icon={<Copy />} onClick={() => { copy(markMenu.mark.text); setMarkMenu(null); }} testid="mark-copy">{t("Copy Text")}</MenuRow>
          <MenuRow
            icon={<Trash2 />}
            destructive
            onClick={() => {
              const id = markMenu.mark.id;
              setMarkMenu(null);
              doc.updatePage(page.id, t("Remove Highlight"), (draft) => { draft.marks = (draft.marks ?? []).filter((mark) => mark.id !== id); });
            }}
            testid="mark-remove"
          >
            {t("Remove Highlight")}
          </MenuRow>
        </Menu>
      )}
    </>
  );
}
