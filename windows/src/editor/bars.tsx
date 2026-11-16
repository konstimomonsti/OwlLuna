// The bars that float over a page: one for lassoed ink, one for a picked-up item. Boards with square-cut corners.

import {
  AlignCenter, AlignLeft, AlignRight, Bold, BringToFront, CheckSquare, Copy, CopyPlus, Crop, Highlighter, Italic, Layers, Languages, List, ListOrdered,
  Palette, Pencil, Scissors, SendToBack, Trash2, Type, Underline,
} from "lucide-react";
import { useState } from "react";
import { anchorBelow, IconButton, Menu, MenuBreak, MenuRow, type MenuAnchor } from "../design/controls";
import { uuid } from "../model/ids";
import { transformStroke, type Rect } from "../model/ink";
import {
  highlightHex, tapeColors, tapeHex, textFaces, textHighlights, textTintHex, textTints, type PageItem, type TextFace, type TextItem,
} from "../model/notebook";
import { colorName, hexCSS, inks, tints, withTint } from "../model/tools";
import { copyClipping } from "./clipboard";
import type { NotebookDocument } from "./document";
import type { Session } from "./session";

function selected(doc: NotebookDocument, session: Session) {
  const selection = session.getState().selection;
  if (!selection) return null;
  const wanted = new Set(selection.ids);
  return { pageID: selection.pageID, wanted, strokes: doc.ink(selection.pageID).filter((stroke) => wanted.has(stroke.id)) };
}

export function copySelection(doc: NotebookDocument, session: Session): boolean {
  const state = session.getState();
  const ink = selected(doc, session);
  if (ink && ink.strokes.length) {
    copyClipping({ strokes: ink.strokes, items: [], notebook: doc.id });
    return true;
  }
  if (state.selectedItem) {
    const item = doc.page(state.selectedItem.pageID)?.items.find((candidate) => candidate.id === state.selectedItem!.itemID);
    if (item) {
      copyClipping({ strokes: [], items: [item], notebook: doc.id });
      return true;
    }
  }
  return false;
}

export function deleteSelection(doc: NotebookDocument, session: Session, label = "Delete"): boolean {
  const state = session.getState();
  const ink = selected(doc, session);
  if (ink && ink.strokes.length) {
    doc.removeStrokes(ink.pageID, ink.wanted, label);
    session.setState({ selection: null });
    return true;
  }
  if (state.selectedItem && !state.editingItem) {
    doc.removeItems(state.selectedItem.pageID, new Set([state.selectedItem.itemID]), label);
    session.setState({ selectedItem: null });
    return true;
  }
  return false;
}

export function duplicateSelection(doc: NotebookDocument, session: Session): boolean {
  const state = session.getState();
  const ink = selected(doc, session);
  if (ink && ink.strokes.length) {
    const copies = ink.strokes.map((stroke) => transformStroke(stroke, 16, 16, 1, { x: 0, y: 0 }, true));
    doc.addStrokes(ink.pageID, copies, "Duplicate");
    session.setState({ selection: { pageID: ink.pageID, ids: copies.map((stroke) => stroke.id) } });
    return true;
  }
  if (state.selectedItem) {
    const { pageID, itemID } = state.selectedItem;
    const item = doc.page(pageID)?.items.find((candidate) => candidate.id === itemID);
    if (item) {
      const copy = { ...structuredClone(item), id: uuid(), x: item.x + 16, y: item.y + 16 };
      doc.addItem(pageID, copy, "Duplicate");
      session.setState({ selectedItem: { pageID, itemID: copy.id } });
      return true;
    }
  }
  return false;
}

export function InkBar(props: { doc: NotebookDocument; session: Session; bounds: { pageID: string; rect: Rect }; onToText: () => void; onMakeCard: () => void }) {
  const { doc, session } = props;
  const [menu, setMenu] = useState<MenuAnchor | null>(null);
  const recolour = (color: number) => {
    const ink = selected(doc, session);
    if (!ink) return;
    doc.transact("Change Colour", (draft) => {
      draft.setInk(ink.pageID, draft.ink(ink.pageID).map((stroke) => (ink.wanted.has(stroke.id) ? { ...stroke, color: withTint(stroke.color, color) } : stroke)));
    });
  };
  return (
    <div className="float-bar board" data-testid="ink-bar" role="toolbar" aria-label="Selected ink">
      <IconButton label="Cut (Ctrl+X)" onClick={() => { if (copySelection(doc, session)) deleteSelection(doc, session, "Cut"); }} testid="ink-cut"><Scissors /></IconButton>
      <IconButton label="Copy (Ctrl+C)" onClick={() => copySelection(doc, session)} testid="ink-copy"><Copy /></IconButton>
      <IconButton label="Duplicate (Ctrl+D)" onClick={() => duplicateSelection(doc, session)} testid="ink-duplicate"><CopyPlus /></IconButton>
      <IconButton label="Colour" onClick={(event) => setMenu(anchorBelow(event.currentTarget))} testid="ink-colour"><Palette /></IconButton>
      <IconButton label="Handwriting to Text" onClick={props.onToText} testid="ink-to-text"><Languages /></IconButton>
      <IconButton label="Make a Flashcard" onClick={props.onMakeCard} testid="ink-card"><Layers /></IconButton>
      <IconButton label="Delete" tone="tomato" onClick={() => deleteSelection(doc, session)} testid="ink-delete"><Trash2 /></IconButton>
      {menu && (
        <Menu anchor={menu} title="Colour" onClose={() => setMenu(null)} width={232}>
          <div className="pen-options" onPointerDown={(event) => event.stopPropagation()}>
            <div className="swatches">
              {[...inks, ...tints].map((color) => (
                <button key={color} type="button" className="swatch" style={{ background: hexCSS(color) }} title={colorName(color)} aria-label={colorName(color)} onClick={() => { recolour(color); setMenu(null); }} />
              ))}
            </div>
          </div>
        </Menu>
      )}
    </div>
  );
}

const faceNames: Record<TextFace, string> = { system: "Sans", serif: "Serif", mono: "Mono", fraunces: "Fraunces" };
const sizes = [12, 14, 17, 20, 24, 32, 44];

export function ItemBar(props: { doc: NotebookDocument; session: Session; pageID: string; item: PageItem; onCrop: () => void; onEditLink: () => void; onMakeCard: () => void }) {
  const { doc, session, pageID, item } = props;
  const [menu, setMenu] = useState<MenuAnchor | null>(null);
  const change = (label: string, work: (target: PageItem) => void) => doc.updateItem(pageID, item.id, label, work);
  const text = (label: string, work: (target: TextItem) => void) => change(label, (target) => { if (target.kind === "text") work(target); });
  const arrange = (toFront: boolean) => doc.updatePage(pageID, toFront ? "Bring to Front" : "Send to Back", (page) => {
    const index = page.items.findIndex((candidate) => candidate.id === item.id);
    if (index === -1) return;
    const [moved] = page.items.splice(index, 1);
    if (toFront) page.items.push(moved);
    else page.items.unshift(moved);
  });
  return (
    <div className="float-bar board" data-testid="item-bar" role="toolbar" aria-label="Selected item">
      {item.kind === "text" && (
        <>
          <IconButton label="Edit Text" onClick={() => session.setState({ editingItem: item.id })} testid="item-edit"><Pencil /></IconButton>
          <IconButton label="Bold" on={item.bold === true} onClick={() => text("Bold", (target) => { target.bold = !target.bold; })} testid="item-bold"><Bold /></IconButton>
          <IconButton label="Italic" on={item.italic === true} onClick={() => text("Italic", (target) => { target.italic = !target.italic; })}><Italic /></IconButton>
          <IconButton label="Underline" on={item.underline === true} onClick={() => text("Underline", (target) => { target.underline = !target.underline; })}><Underline /></IconButton>
          <IconButton label="Text Style" onClick={(event) => setMenu(anchorBelow(event.currentTarget))} testid="item-style"><Type /></IconButton>
        </>
      )}
      {item.kind === "image" && <IconButton label="Crop" onClick={props.onCrop} testid="item-crop"><Crop /></IconButton>}
      {item.kind === "link" && <IconButton label="Edit Link" onClick={props.onEditLink} testid="item-link"><Pencil /></IconButton>}
      {item.kind === "tape" && (
        <>
          {tapeColors.map((color) => (
            <button key={color} type="button" className={`swatch small${item.color === color ? " on" : ""}`} style={{ background: tapeHex[color] }} title={color} aria-label={`${color} tape`} aria-pressed={item.color === color} onClick={() => change("Tape Colour", (target) => { if (target.kind === "tape") target.color = color; })} />
          ))}
          <IconButton label="Make a Flashcard" onClick={props.onMakeCard} testid="tape-card"><Layers /></IconButton>
        </>
      )}
      {item.kind !== "tape" && (
        <>
          <IconButton label="Bring to Front" onClick={() => arrange(true)}><BringToFront /></IconButton>
          <IconButton label="Send to Back" onClick={() => arrange(false)}><SendToBack /></IconButton>
        </>
      )}
      <IconButton label="Duplicate (Ctrl+D)" onClick={() => duplicateSelection(doc, session)} testid="item-duplicate"><CopyPlus /></IconButton>
      <IconButton label="Delete" tone="tomato" onClick={() => deleteSelection(doc, session)} testid="item-delete"><Trash2 /></IconButton>
      {menu && item.kind === "text" && (
        <Menu anchor={menu} title="Text Style" onClose={() => setMenu(null)} width={268} testid="text-style">
          <div className="pen-options" onPointerDown={(event) => event.stopPropagation()}>
            <div className="row" style={{ flexWrap: "wrap", gap: 4 }}>
              {textFaces.map((face) => (
                <button key={face} type="button" className={`btn small${(item.face ?? "system") === face ? " primary" : ""}`} onClick={() => text("Typeface", (target) => { target.face = face; })}>{faceNames[face]}</button>
              ))}
            </div>
            <div className="row" style={{ flexWrap: "wrap", gap: 4 }}>
              {sizes.map((size) => (
                <button key={size} type="button" className={`btn small${item.fontSize === size ? " primary" : ""}`} onClick={() => text("Text Size", (target) => { target.fontSize = size; })}>{size}</button>
              ))}
            </div>
            <div className="swatches">
              {textTints.map((tint) => (
                <button key={tint} type="button" className={`swatch${(item.tint ?? "ink") === tint ? " on" : ""}`} style={{ background: textTintHex[tint] }} title={tint} aria-label={`${tint} text`} onClick={() => text("Text Colour", (target) => { target.tint = tint; })} />
              ))}
            </div>
            <div className="row" style={{ gap: 4 }}>
              <IconButton label="Align Left" on={(item.align ?? "leading") === "leading"} onClick={() => text("Align", (target) => { target.align = "leading"; })}><AlignLeft /></IconButton>
              <IconButton label="Align Centre" on={item.align === "center"} onClick={() => text("Align", (target) => { target.align = "center"; })}><AlignCenter /></IconButton>
              <IconButton label="Align Right" on={item.align === "trailing"} onClick={() => text("Align", (target) => { target.align = "trailing"; })}><AlignRight /></IconButton>
              <span className="tray-rule" />
              <IconButton label="Bulleted List" on={item.list === "bullet"} onClick={() => text("List", (target) => { target.list = target.list === "bullet" ? undefined : "bullet"; })}><List /></IconButton>
              <IconButton label="Numbered List" on={item.list === "number"} onClick={() => text("List", (target) => { target.list = target.list === "number" ? undefined : "number"; })}><ListOrdered /></IconButton>
              <IconButton label="Checklist" on={item.list === "check"} onClick={() => text("List", (target) => { target.list = target.list === "check" ? undefined : "check"; })} testid="style-checklist"><CheckSquare /></IconButton>
            </div>
            <div className="row" style={{ gap: 6 }}>
              <Highlighter style={{ width: 16, height: 16 }} />
              {textHighlights.map((color) => (
                <button key={color} type="button" className={`swatch small${item.highlight === color ? " on" : ""}`} style={{ background: highlightHex[color] }} title={`${color} highlight`} aria-label={`${color} highlight`} onClick={() => text("Highlight", (target) => { target.highlight = target.highlight === color ? undefined : color; })} />
              ))}
            </div>
            <p className="secondary" style={{ fontSize: 12 }}>Write a formula between dollar signs: $E = mc^2$</p>
          </div>
          <MenuBreak />
          <MenuRow onClick={() => { session.setState({ editingItem: item.id }); setMenu(null); }} icon={<Pencil />}>Edit Text</MenuRow>
        </Menu>
      )}
    </div>
  );
}
