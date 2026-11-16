// Things the editor does to a notebook that take more than one step: placing pictures, pasting, adding pages.

import type { PagePoint } from "../canvas/inkController";
import { uuid } from "../model/ids";
import type { LinkTarget, PageItem, PictureItem } from "../model/notebook";
import { notify } from "../state/app";
import { addAsset } from "../storage/package";
import { heldClipping, placed, readClipping, type Clipping } from "./clipboard";
import type { NotebookDocument } from "./document";
import { setTool, type Session } from "./session";

const pictureTypes: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

export async function pictureSize(data: Uint8Array): Promise<{ w: number; h: number } | null> {
  try {
    const bitmap = await createImageBitmap(new Blob([data.slice()]));
    const size = { w: bitmap.width, h: bitmap.height };
    bitmap.close();
    return size.w > 0 && size.h > 0 ? size : null;
  } catch {
    return null;
  }
}

function pick(session: Session, pageID: string, itemID: string): void {
  setTool(session, { kind: "lasso" });
  session.setState({ selectedItem: { pageID, itemID }, selection: null });
}

/** Puts a picture on the page, no bigger than three fifths of it, and picks it up. */
export async function placePicture(doc: NotebookDocument, session: Session, data: Uint8Array, extension: string, at: PagePoint): Promise<PictureItem | null> {
  const size = await pictureSize(data);
  const page = doc.page(at.pageID);
  if (!size || !page) {
    notify("That picture couldn't be read.", "trouble");
    return null;
  }
  const file = await addAsset(doc.fs, doc.id, data, extension === "jpeg" ? "jpg" : extension);
  const room = page.edgeless ? 480 : page.size.w * 0.6;
  const scale = Math.min(1, room / size.w, (page.edgeless ? 480 : page.size.h * 0.6) / size.h);
  const item: PictureItem = { id: uuid(), kind: "image", file, x: at.x, y: at.y, w: size.w * scale, h: size.h * scale, rotation: 0 };
  doc.addItem(at.pageID, item, "Add Picture");
  pick(session, at.pageID, item.id);
  return item;
}

export function placeSticker(doc: NotebookDocument, session: Session, name: string, at: PagePoint): void {
  const item: PageItem = { id: uuid(), kind: "sticker", name, x: at.x, y: at.y, w: 72, h: 72, rotation: 0 };
  doc.addItem(at.pageID, item, "Add Sticker");
  pick(session, at.pageID, item.id);
}

export function placeLink(doc: NotebookDocument, session: Session, target: LinkTarget, label: string, at: PagePoint): void {
  const item: PageItem = { id: uuid(), kind: "link", target, label, x: at.x, y: at.y, w: 180, h: 30, rotation: 0 };
  doc.addItem(at.pageID, item, "Add Link");
  pick(session, at.pageID, item.id);
}

export function placeText(doc: NotebookDocument, session: Session, text: string, at: PagePoint, edit = false): PageItem {
  const lines = text.split("\n");
  const longest = Math.max(...lines.map((line) => line.length), 8);
  const w = Math.min(Math.max(longest * 8.5, 120), 420);
  const h = Math.max(lines.length, 1) * 17 * 1.35 + 4;
  const item: PageItem = { id: uuid(), kind: "text", string: text, fontSize: 17, x: at.x, y: at.y, w, h, rotation: 0 };
  doc.addItem(at.pageID, item, "Add Text");
  pick(session, at.pageID, item.id);
  if (edit) session.setState({ editingItem: item.id });
  return item;
}

/** Places a clipping on a page. Pictures from another notebook are copied in with it. */
export async function pasteClipping(doc: NotebookDocument, session: Session, clipping: Clipping, at: PagePoint, read: (notebook: string, file: string) => Promise<Uint8Array | null>): Promise<boolean> {
  const { strokes, items } = placed(clipping, at);
  if (strokes.length === 0 && items.length === 0) return false;
  if (clipping.notebook !== doc.id) {
    for (const item of items) {
      if (item.kind !== "image") continue;
      const data = await read(clipping.notebook, item.file);
      if (!data) continue;
      item.file = await addAsset(doc.fs, doc.id, data, extensionOf(item.file) || "png");
    }
  }
  doc.transact("Paste", (draft) => {
    if (strokes.length) draft.setInk(at.pageID, [...draft.ink(at.pageID), ...strokes]);
    const page = draft.manifest.pages.find((candidate) => candidate.id === at.pageID);
    if (items.length && page) page.items.push(...items);
  });
  setTool(session, { kind: "lasso" });
  session.setState({
    selection: strokes.length ? { pageID: at.pageID, ids: strokes.map((stroke) => stroke.id) } : null,
    selectedItem: !strokes.length && items.length === 1 ? { pageID: at.pageID, itemID: items[0].id } : null,
  });
  return true;
}

/** Pastes what the system clipboard holds: a picture, ink or items copied from OwlLuna, or words as a text box. */
export async function pasteFromClipboard(doc: NotebookDocument, session: Session, data: DataTransfer | null, at: PagePoint, read: (notebook: string, file: string) => Promise<Uint8Array | null>): Promise<boolean> {
  for (const file of [...(data?.files ?? [])]) {
    const extension = pictureTypes[file.type];
    if (extension) return (await placePicture(doc, session, new Uint8Array(await file.arrayBuffer()), extension, at)) !== null;
  }
  const text = data?.getData("text/plain") ?? "";
  const clipping = readClipping(text) ?? (text === "" ? heldClipping() : null);
  if (clipping) return pasteClipping(doc, session, clipping, at, read);
  if (text.trim() !== "") {
    placeText(doc, session, text.replace(/\r\n/g, "\n").trimEnd(), at);
    return true;
  }
  return false;
}
