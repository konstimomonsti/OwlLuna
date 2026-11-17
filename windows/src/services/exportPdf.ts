// Export to PDF with pdf-lib. Pages that came from a PDF are copied from it, so they stay vector and selectable; paper,
// ink, text, links and tape are drawn as PDF graphics. The parts that need a browser (decoding pictures, rasterising a
// sticker) are passed in, so the rest runs, and is tested, without one.

import {
  BlendMode, PDFDocument, PDFName, PDFString, StandardFonts, clip, concatTransformationMatrix, endPath, popGraphicsState, pushGraphicsState, rectangle, rgb,
  type PDFDict, type PDFFont, type PDFImage, type PDFPage,
} from "pdf-lib";
import { itemBounds, pageRegion } from "../canvas/board";
import { mathRuns, LINE_HEIGHT, textLines, wrapLine } from "../canvas/textLayout";
import { boardOps, templateOps, type RGBA, type TemplateOp } from "../canvas/templates";
import { displayColor, inkLooks, strokePath } from "../canvas/strokeGeometry";
import type { Stroke } from "../model/ink";
import {
  highlightHex, tapeHex, textTintHex, type LinkItem, type Manifest, type Page, type PageItem, type PictureItem, type TapeItem, type TextFace, type TextItem,
} from "../model/notebook";
import { isDarkPaper, paperRGB } from "../model/paper";
import type { FS } from "../platform/fs";
import { assetPath } from "../storage/package";
import { t } from "../i18n";

export interface PdfHooks {
  /** Turns a picture the PDF can't hold (WebP, GIF) into PNG bytes. */
  toPNG?(data: Uint8Array): Promise<Uint8Array | null>;
  /** A sticker drawn to a PNG that many pixels wide. */
  rasterSticker?(name: string, pixels: number): Promise<Uint8Array | null>;
  /** A text box that has characters the standard fonts lack, drawn to a PNG at this scale. */
  rasterText?(item: TextItem, darkPaper: boolean, scale: number): Promise<Uint8Array | null>;
}

export interface PdfSource {
  fs: FS;
  id: string;
  manifest: Manifest;
  ensureInk(pageID: string): Promise<Stroke[]>;
}

export interface PdfOptions {
  /** The pages to export, in the order given. */
  pageIDs: string[];
  /** Draws the paper's rules; off, the paper is its colour only. */
  templates?: boolean;
  /** Writes recognised words as invisible text, for search in a PDF reader. */
  searchable?: boolean;
  /** Tape as opaque as on screen; off, it lets the page show through a little. */
  flattenTape?: boolean;
  /** Recognised words by page. */
  words?: Record<string, { text: string }>;
  hooks?: PdfHooks;
  onProgress?(done: number, total: number): void;
}

const rgbOf = (hex: string) => rgb(parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255);
const colorOf = (color: RGBA) => rgb(color[0], color[1], color[2]);

/** The standard font for a text box's face and style. */
export function standardFontFor(face: TextFace | undefined, bold: boolean, italic: boolean): StandardFonts {
  if (face === "mono") return bold ? (italic ? StandardFonts.CourierBoldOblique : StandardFonts.CourierBold) : italic ? StandardFonts.CourierOblique : StandardFonts.Courier;
  if (face === "serif" || face === "fraunces") return bold ? (italic ? StandardFonts.TimesRomanBoldItalic : StandardFonts.TimesRomanBold) : italic ? StandardFonts.TimesRomanItalic : StandardFonts.TimesRoman;
  return bold ? (italic ? StandardFonts.HelveticaBoldOblique : StandardFonts.HelveticaBold) : italic ? StandardFonts.HelveticaOblique : StandardFonts.Helvetica;
}

/** Whether the standard fonts can write this text (they hold WinAnsi). */
export function canEncode(font: PDFFont, text: string): boolean {
  try {
    font.encodeText(text);
    return true;
  } catch {
    return false;
  }
}

/** The text with what WinAnsi lacks swapped for a stand-in, for the invisible search layer. */
export function winAnsiSafe(font: PDFFont, text: string): string {
  let out = "";
  for (const char of text.replace(/\s+/g, " ")) out += canEncode(font, char) ? char : " ";
  return out;
}

interface Frame {
  /** The part of the page drawn, in the notebook's points. */
  ox: number;
  oy: number;
  w: number;
  h: number;
}

class Exporter {
  private doc!: PDFDocument;
  private fonts = new Map<StandardFonts, PDFFont>();
  private images = new Map<string, PDFImage | null>();
  private sources = new Map<string, Promise<PDFDocument | null>>();
  private pageByID = new Map<string, PDFPage>();

  constructor(private source: PdfSource, private options: PdfOptions) {}

  async run(): Promise<Uint8Array> {
    const { manifest } = this.source;
    this.doc = await PDFDocument.create();
    this.doc.setTitle(manifest.title);
    this.doc.setCreator("OwlLuna for Windows");
    this.doc.setProducer("OwlLuna for Windows");
    this.doc.setCreationDate(new Date());
    const wanted = this.options.pageIDs.map((id) => manifest.pages.find((page) => page.id === id)).filter((page): page is Page => page !== undefined);
    const strokes = new Map<string, Stroke[]>();
    const frames = new Map<string, Frame>();
    // Every page exists before any is drawn, so a link can point at one that comes later.
    for (const page of wanted) {
      const ink = await this.source.ensureInk(page.id);
      strokes.set(page.id, ink);
      const region = pageRegion(page, ink);
      frames.set(page.id, { ox: region.x, oy: region.y, w: region.w, h: region.h });
      this.pageByID.set(page.id, this.doc.addPage([region.w, region.h]));
    }
    let done = 0;
    for (const page of wanted) {
      await this.drawPage(page, strokes.get(page.id)!, frames.get(page.id)!, this.pageByID.get(page.id)!);
      this.options.onProgress?.(++done, wanted.length);
    }
    return this.doc.save();
  }

  private async font(name: StandardFonts): Promise<PDFFont> {
    let font = this.fonts.get(name);
    if (!font) {
      font = await this.doc.embedFont(name);
      this.fonts.set(name, font);
    }
    return font;
  }

  private async image(file: string): Promise<PDFImage | null> {
    if (this.images.has(file)) return this.images.get(file)!;
    let image: PDFImage | null = null;
    try {
      const data = await this.source.fs.read(assetPath(this.source.id, file));
      if (data) image = await this.embedPicture(data);
    } catch {
      image = null;
    }
    this.images.set(file, image);
    return image;
  }

  private async embedPicture(data: Uint8Array): Promise<PDFImage | null> {
    const png = data[0] === 0x89 && data[1] === 0x50, jpg = data[0] === 0xff && data[1] === 0xd8;
    if (png) return this.doc.embedPng(data);
    if (jpg) return this.doc.embedJpg(data);
    const converted = await this.options.hooks?.toPNG?.(data);
    return converted ? this.doc.embedPng(converted) : null;
  }

  private pdfSource(file: string): Promise<PDFDocument | null> {
    let pending = this.sources.get(file);
    if (!pending) {
      pending = this.source.fs.read(assetPath(this.source.id, file)).then((data) => (data ? PDFDocument.load(data, { ignoreEncryption: true }) : null)).catch(() => null);
      this.sources.set(file, pending);
    }
    return pending;
  }

  // One page

  private async drawPage(page: Page, ink: Stroke[], frame: Frame, out: PDFPage): Promise<void> {
    const dark = page.background.kind === "template" && isDarkPaper(page.paperColor);
    await this.drawPaper(page, frame, out);
    this.drawMarks(page, frame, out);
    for (const item of page.items) if (item.kind !== "tape") await this.drawItem(item, page, frame, out, dark);
    this.drawInk(ink, frame, out, dark);
    for (const item of page.items) if (item.kind === "tape") this.drawTape(item, frame, out);
    if (this.options.searchable && this.options.words?.[page.id]?.text) await this.drawInvisibleText(this.options.words[page.id].text, frame, out);
  }

  private async drawPaper(page: Page, frame: Frame, out: PDFPage): Promise<void> {
    const { background } = page;
    if (background.kind === "pdf") {
      const source = await this.pdfSource(background.file);
      if (source && background.index < source.getPageCount()) {
        const [embedded] = await this.doc.embedPdf(source, [background.index]);
        out.drawPage(embedded, { x: 0, y: 0, width: frame.w, height: frame.h });
        return;
      }
    }
    if (background.kind === "image") {
      const image = await this.image(background.file);
      out.drawRectangle({ x: 0, y: 0, width: frame.w, height: frame.h, color: rgb(1, 1, 1) });
      if (image) out.drawImage(image, { x: 0, y: 0, width: frame.w, height: frame.h });
      return;
    }
    const [r, g, b] = paperRGB[page.paperColor];
    out.drawRectangle({ x: 0, y: 0, width: frame.w, height: frame.h, color: rgb(r, g, b) });
    if (background.kind !== "template" || this.options.templates === false) return;
    const ops = page.edgeless
      ? boardOps(background.template, page.paperColor, { x: frame.ox, y: frame.oy, w: frame.w, h: frame.h }, 1)
      : templateOps(background.template, page.paperColor, page.size);
    await this.drawOps(ops, frame, out);
  }

  /** A point of the notebook page in the PDF page's own coordinates, which start bottom left. */
  private px(frame: Frame, x: number): number { return x - frame.ox; }
  private py(frame: Frame, y: number): number { return frame.h - (y - frame.oy); }

  private async drawOps(ops: TemplateOp[], frame: Frame, out: PDFPage): Promise<void> {
    for (const op of ops) {
      if (op.op === "lines") {
        for (let i = 0; i < op.segs.length; i += 4) {
          out.drawLine({
            start: { x: this.px(frame, op.segs[i]), y: this.py(frame, op.segs[i + 1]) },
            end: { x: this.px(frame, op.segs[i + 2]), y: this.py(frame, op.segs[i + 3]) },
            thickness: op.width, color: colorOf(op.color), opacity: op.color[3], dashArray: op.dash,
          });
        }
      } else if (op.op === "dots") {
        for (let i = 0; i < op.pts.length; i += 2) {
          out.drawCircle({ x: this.px(frame, op.pts[i]), y: this.py(frame, op.pts[i + 1]), size: op.radius, color: colorOf(op.color), opacity: op.color[3] });
        }
      } else if (op.op === "rects") {
        for (let i = 0; i < op.rects.length; i += 4) {
          const [x, y, w, h] = [op.rects[i], op.rects[i + 1], op.rects[i + 2], op.rects[i + 3]];
          const common = { x: this.px(frame, x), y: this.py(frame, y + h), width: w, height: h };
          if (op.fill) out.drawRectangle({ ...common, color: colorOf(op.color), opacity: op.color[3] });
          else out.drawRectangle({ ...common, borderColor: colorOf(op.color), borderOpacity: op.color[3], borderWidth: op.width });
        }
      } else {
        const font = await this.font(StandardFonts.HelveticaBold);
        const text = winAnsiSafe(font, op.text);
        const width = font.widthOfTextAtSize(text, op.size);
        out.drawText(text, { x: this.px(frame, op.x) - (op.align === "right" ? width : 0), y: this.py(frame, op.y), size: op.size, font, color: colorOf(op.color), opacity: op.color[3] });
      }
    }
  }

  private drawMarks(page: Page, frame: Frame, out: PDFPage): void {
    for (const mark of page.marks ?? []) {
      for (const [x, y, w, h] of mark.rects) {
        out.drawRectangle({ x: this.px(frame, x), y: this.py(frame, y + h), width: w, height: h, color: rgbOf(highlightHex[mark.color]), opacity: 0.6, blendMode: BlendMode.Multiply });
      }
    }
  }

  private drawInk(ink: Stroke[], frame: Frame, out: PDFPage, dark: boolean): void {
    // The highlighter goes under the pens, as it does on screen.
    const ordered = [...ink.filter((stroke) => inkLooks[stroke.ink].multiply), ...ink.filter((stroke) => !inkLooks[stroke.ink].multiply)];
    for (const stroke of ordered) {
      const look = inkLooks[stroke.ink];
      const colour = displayColor(stroke.color, dark);
      const path = strokePath(stroke);
      if (!path) continue;
      out.drawSvgPath(path, {
        x: -frame.ox, y: frame.h + frame.oy,
        color: rgb(((colour >>> 24) & 255) / 255, ((colour >>> 16) & 255) / 255, ((colour >>> 8) & 255) / 255),
        opacity: (colour & 255) / 255 * look.alpha,
        blendMode: look.multiply && !dark ? BlendMode.Multiply : BlendMode.Normal,
      });
    }
  }

  /** Runs `draw` with the origin at the item's centre and the axes turned with it, y up. */
  private within(out: PDFPage, item: PageItem, frame: Frame, draw: () => void | Promise<void>): Promise<void> | void {
    const cos = Math.cos(item.rotation), sin = Math.sin(item.rotation);
    out.pushOperators(pushGraphicsState(), concatTransformationMatrix(cos, -sin, sin, cos, this.px(frame, item.x), this.py(frame, item.y)));
    const finish = () => out.pushOperators(popGraphicsState());
    const result = draw();
    if (result instanceof Promise) return result.then(finish, (error) => { finish(); throw error; });
    finish();
  }

  private async drawItem(item: PageItem, page: Page, frame: Frame, out: PDFPage, dark: boolean): Promise<void> {
    switch (item.kind) {
      case "image": return this.drawPicture(item, frame, out);
      case "sticker": return this.drawSticker(item, frame, out);
      case "text": return this.drawText(item, frame, out, dark);
      case "link": return this.drawLink(item, page, frame, out);
      case "tape": return;
    }
  }

  private async drawPicture(item: PictureItem, frame: Frame, out: PDFPage): Promise<void> {
    const image = await this.image(item.file);
    if (!image) return;
    const [cx, cy, cw, ch] = item.crop ?? [0, 0, 1, 1];
    const W = item.w / cw, H = item.h / ch;
    await this.within(out, item, frame, () => {
      if (item.crop) out.pushOperators(rectangle(-item.w / 2, -item.h / 2, item.w, item.h), clip(), endPath());
      out.drawImage(image, { x: -item.w / 2 - cx * W, y: item.h / 2 + cy * H - H, width: W, height: H });
    });
  }

  private async drawSticker(item: PageItem, frame: Frame, out: PDFPage): Promise<void> {
    if (item.kind !== "sticker") return;
    const data = await this.options.hooks?.rasterSticker?.(item.name, Math.ceil(Math.max(item.w, item.h) * 4));
    if (!data) return;
    const image = await this.doc.embedPng(data);
    await this.within(out, item, frame, () => out.drawImage(image, { x: -item.w / 2, y: -item.h / 2, width: item.w, height: item.h }));
  }

  private async drawText(item: TextItem, frame: Frame, out: PDFPage, dark: boolean): Promise<void> {
    const font = await this.font(standardFontFor(item.face, item.bold === true, item.italic === true));
    const tint = item.tint ?? "ink";
    const colour = rgbOf(tint === "ink" && dark ? "#ECE6DA" : textTintHex[tint]);
    const lines = textLines(item).map((line) => ({ ...line, text: mathRuns(line.text).map((run) => run.text).join("") }));
    const marker = (line: (typeof lines)[number]) => (line.marker === "☑" ? "[x]" : line.marker === "☐" ? "[ ]" : line.marker);
    // A box with characters the standard fonts lack is drawn as a picture instead of crashing or losing them.
    if (lines.some((line) => !canEncode(font, line.text) || !canEncode(font, marker(line) ?? ""))) {
      const data = await this.options.hooks?.rasterText?.(item, dark, 4);
      if (data) {
        const image = await this.doc.embedPng(data);
        await this.within(out, item, frame, () => out.drawImage(image, { x: -item.w / 2, y: -item.h / 2, width: item.w, height: item.h }));
        return;
      }
      for (const line of lines) line.text = winAnsiSafe(font, line.text);
    }
    const size = item.fontSize, lineHeight = size * LINE_HEIGHT;
    await this.within(out, item, frame, () => {
      let top = 0;
      for (const line of lines) {
        const label = marker(line);
        const indent = label ? Math.max(font.widthOfTextAtSize(label, size), size) + size * 0.45 : 0;
        const room = Math.max(item.w - indent, 8);
        const rows = wrapLine(line.text, room, (text) => font.widthOfTextAtSize(text, size));
        rows.forEach((row, index) => {
          const baseline = item.h / 2 - (top + lineHeight * 0.5 + size * 0.32);
          const width = font.widthOfTextAtSize(row, size);
          const left = -item.w / 2 + indent + (item.align === "center" ? (room - width) / 2 : item.align === "trailing" ? room - width : 0);
          if (item.highlight && row.trim()) {
            out.drawRectangle({ x: left, y: item.h / 2 - top - lineHeight, width, height: lineHeight, color: rgbOf(highlightHex[item.highlight]), opacity: 0.4, blendMode: BlendMode.Multiply });
          }
          if (label && index === 0) out.drawText(label, { x: -item.w / 2, y: baseline, size, font, color: colour });
          if (row) out.drawText(row, { x: left, y: baseline, size, font, color: colour, opacity: line.checked ? 0.55 : 1 });
          if ((item.underline || line.checked) && row) {
            const y = line.checked ? baseline + size * 0.3 : baseline - size * 0.12;
            out.drawLine({ start: { x: left, y }, end: { x: left + width, y }, thickness: Math.max(size / 14, 0.6), color: colour });
          }
          top += lineHeight;
        });
      }
    });
  }

  private async drawLink(item: LinkItem, page: Page, frame: Frame, out: PDFPage): Promise<void> {
    const font = await this.font(StandardFonts.HelveticaBold);
    const size = Math.min(Math.max(item.h * 0.48, 9), 15);
    const text = winAnsiSafe(font, linkLabel(item, this.source.manifest));
    await this.within(out, item, frame, () => {
      out.drawRectangle({ x: -item.w / 2, y: -item.h / 2, width: item.w, height: item.h, color: rgbOf("#F7F1E3"), borderColor: rgb(0.1, 0.13, 0.19), borderOpacity: 0.35, borderWidth: 1 });
      out.drawText(text, { x: -item.w / 2 + 8, y: -size * 0.32, size, font, color: rgbOf("#2747B8"), maxWidth: item.w - 12 });
    });
    const box = itemBounds(item);
    const rect = [this.px(frame, box.x), this.py(frame, box.y + box.h), this.px(frame, box.x + box.w), this.py(frame, box.y)];
    const context = this.doc.context;
    let annotation: PDFDict | null = null;
    if (item.target.to === "web") {
      annotation = context.obj({ Type: "Annot", Subtype: "Link", Rect: rect, Border: [0, 0, 0], A: { Type: "Action", S: "URI", URI: PDFString.of(item.target.url) } });
    } else if (item.target.to === "page") {
      const target = this.pageByID.get(item.target.page);
      if (target) annotation = context.obj({ Type: "Annot", Subtype: "Link", Rect: rect, Border: [0, 0, 0], Dest: [target.ref, PDFName.of("Fit")] });
    }
    if (annotation) out.node.addAnnot(context.register(annotation));
    void page;
  }

  private drawTape(item: TapeItem, frame: Frame, out: PDFPage): void {
    const opacity = this.options.flattenTape === false ? 0.85 : 1;
    const cos = Math.cos(item.rotation), sin = Math.sin(item.rotation);
    out.pushOperators(pushGraphicsState(), concatTransformationMatrix(cos, -sin, sin, cos, this.px(frame, item.x), this.py(frame, item.y)));
    out.drawRectangle({ x: -item.w / 2, y: -item.h / 2, width: item.w, height: item.h, color: rgbOf(tapeHex[item.color]), opacity, borderColor: rgb(0.1, 0.13, 0.19), borderOpacity: 0.25, borderWidth: 0.8 });
    out.pushOperators(popGraphicsState());
  }

  private async drawInvisibleText(text: string, frame: Frame, out: PDFPage): Promise<void> {
    const font = await this.font(StandardFonts.Helvetica);
    const safe = winAnsiSafe(font, text).slice(0, 6000);
    out.drawText(safe, { x: 4, y: frame.h - 10, size: 6, font, opacity: 0, maxWidth: Math.max(frame.w - 8, 20), lineHeight: 7 });
  }
}

function linkLabel(item: LinkItem, manifest: Pick<Manifest, "pages">): string {
  if (item.label.trim()) return item.label;
  if (item.target.to === "web") {
    try { return new URL(item.target.url).hostname.replace(/^www\./, ""); } catch { return item.target.url; }
  }
  if (item.target.to === "notebook") return item.target.name;
  const target = item.target;
  const index = manifest.pages.findIndex((page) => page.id === target.page);
  return index === -1 ? t("Missing page") : t("Page {number}", { number: index + 1 });
}

/** The PDF's bytes for the chosen pages of a notebook. */
export function exportPdf(source: PdfSource, options: PdfOptions): Promise<Uint8Array> {
  return new Exporter(source, options).run();
}

/** Hooks that use the browser: for the app; tests leave them out. */
export function browserHooks(): PdfHooks {
  const toBlob = (canvas: HTMLCanvasElement) => new Promise<Uint8Array | null>((resolve) => {
    canvas.toBlob(async (blob) => resolve(blob ? new Uint8Array(await blob.arrayBuffer()) : null), "image/png");
  });
  return {
    async toPNG(data) {
      try {
        const bitmap = await createImageBitmap(new Blob([data.slice()]));
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
        bitmap.close();
        return toBlob(canvas);
      } catch {
        return null;
      }
    },
    async rasterSticker(name, pixels) {
      const { stickerDataURL, stickerNamed } = await import("../canvas/stickers");
      const sticker = stickerNamed(name);
      if (!sticker) return null;
      const image = new Image();
      image.src = stickerDataURL(sticker);
      try { await image.decode(); } catch { return null; }
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = Math.max(8, Math.min(pixels, 1024));
      canvas.getContext("2d")!.drawImage(image, 0, 0, canvas.width, canvas.height);
      return toBlob(canvas);
    },
    async rasterText(item, darkPaper, scale) {
      const { drawItems } = await import("../canvas/renderItems");
      const { newPage } = await import("../model/notebook");
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(item.w * scale));
      canvas.height = Math.max(1, Math.round(item.h * scale));
      const ctx = canvas.getContext("2d")!;
      ctx.scale(scale, scale);
      ctx.translate(item.w / 2 - item.x, item.h / 2 - item.y);
      const page = newPage({ template: "blank", paperColor: darkPaper ? "charcoal" : "white", pageSize: "letter" }, { items: [{ ...item, rotation: 0 }] });
      await drawItems(ctx, { read: async () => null } as never, "", page, "under");
      return toBlob(canvas);
    },
  };
}
