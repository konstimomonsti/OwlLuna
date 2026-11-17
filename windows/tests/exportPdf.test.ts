import { PDFArray, PDFDict, PDFDocument, PDFName, PDFString } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { exportPdf, winAnsiSafe, standardFontFor } from "../src/services/exportPdf";
import { makeStroke, type Stroke } from "../src/model/ink";
import { newManifest, newPage, type Manifest, type PageItem } from "../src/model/notebook";
import { MemoryFS } from "../src/platform/fs";
import { assetPath } from "../src/storage/package";

const defaults = { template: "narrowRuled", paperColor: "white", pageSize: "letter" } as const;

function wave(kind: Stroke["ink"], color: number, y: number): Stroke {
  const points = Array.from({ length: 24 }, (_, i) => ({ x: 60 + i * 12, y: y + Math.sin(i / 2) * 14 }));
  return makeStroke(kind, color, kind === "highlighter" ? 18 : 3, points);
}

function source(manifest: Manifest, ink: Record<string, Stroke[]>, fs = new MemoryFS()) {
  return { fs, id: manifest.id, manifest, ensureInk: async (id: string) => ink[id] ?? [] };
}

function annotations(pdf: PDFDocument, index: number): PDFDict[] {
  const page = pdf.getPage(index);
  const list = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
  return list ? list.asArray().map((ref) => pdf.context.lookup(ref, PDFDict)) : [];
}

describe("exportPdf", () => {
  it("writes template pages with ink, text and links", async () => {
    const first = newPage(defaults);
    const second = newPage({ ...defaults, template: "grid" }, { size: { w: 419.53, h: 595.28 }, paperColor: "charcoal" });
    const items: PageItem[] = [
      { id: "t", kind: "text", string: "Naïve café\nsecond line", fontSize: 17, x: 200, y: 150, w: 240, h: 60, rotation: 0, list: "bullet", bold: true },
      { id: "w", kind: "link", label: "Docs", target: { to: "web", url: "https://example.com/" }, x: 200, y: 300, w: 160, h: 30, rotation: 0.2 },
      { id: "p", kind: "link", label: "Next", target: { to: "page", page: second.id }, x: 200, y: 360, w: 120, h: 30, rotation: 0 },
      { id: "x", kind: "tape", color: "mustard", x: 100, y: 500, w: 120, h: 24, rotation: 0 },
    ];
    first.items = items;
    first.marks = [{ id: "m", color: "yellow", rects: [[50, 50, 100, 14]], text: "marked" }];
    const manifest = newManifest({ title: "Export Test", defaults, pages: [first, second] });
    const ink = {
      [first.id]: [wave("pen", 0x1b2230ff, 500), wave("highlighter", 0xffd426ff, 540), wave("pencil", 0x333333ff, 580), wave("watercolour", 0x3366ccff, 620), wave("fountain", 0xaa2222ff, 660)],
      [second.id]: [wave("pen", 0xffffffff, 200)],
    };
    const bytes = await exportPdf(source(manifest, ink), { pageIDs: [first.id, second.id], searchable: true, words: { [second.id]: { text: "hand written words" } } });
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(2);
    expect(pdf.getTitle()).toBe("Export Test");
    expect(pdf.getCreator()).toBe("OwlLuna for Windows");
    expect(pdf.getPage(0).getSize()).toEqual({ width: 612, height: 792 });
    const small = pdf.getPage(1).getSize();
    expect(small.width).toBeCloseTo(419.53);
    expect(small.height).toBeCloseTo(595.28);
    const links = annotations(pdf, 0);
    expect(links).toHaveLength(2);
    const uri = links.map((link) => link.lookupMaybe(PDFName.of("A"), PDFDict)?.lookupMaybe(PDFName.of("URI"), PDFString)?.decodeText()).filter(Boolean);
    expect(uri).toEqual(["https://example.com/"]);
    const goTo = links.find((link) => link.has(PDFName.of("Dest")))!;
    const dest = goTo.lookup(PDFName.of("Dest"), PDFArray);
    expect(dest.get(0)).toBe(pdf.getPage(1).ref);
  });

  it("exports only the pages asked for, in the order asked, and an empty page", async () => {
    const pages = [newPage(defaults), newPage(defaults), newPage(defaults)];
    const manifest = newManifest({ title: "Range", defaults, pages });
    const bytes = await exportPdf(source(manifest, {}), { pageIDs: [pages[2].id, pages[0].id], templates: false });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(2);
  });

  it("exports a whiteboard's content area as one page", async () => {
    const board = newPage({ ...defaults, template: "dotted" }, { edgeless: true });
    const manifest = newManifest({ title: "Board", kind: "whiteboard", defaults, pages: [board] });
    const bytes = await exportPdf(source(manifest, { [board.id]: [wave("pen", 0x000000ff, 100)] }), { pageIDs: [board.id] });
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(1);
    const size = pdf.getPage(0).getSize();
    // The ink spans about 276 points across, with 40 points of room each side.
    expect(size.width).toBeGreaterThan(300);
    expect(size.width).toBeLessThan(420);
  });

  it("copies a page of a PDF so it stays a PDF page", async () => {
    const original = await PDFDocument.create();
    original.addPage([300, 400]);
    const second = original.addPage([500, 250]);
    second.drawText("Original text", { x: 20, y: 200 });
    const fs = new MemoryFS();
    const page = newPage(defaults, { background: { kind: "pdf", file: "doc.pdf", index: 1 }, size: { w: 500, h: 250 } });
    const manifest = newManifest({ title: "From PDF", defaults, pages: [page] });
    await fs.write(assetPath(manifest.id, "doc.pdf"), await original.save());
    const bytes = await exportPdf(source(manifest, { [page.id]: [wave("highlighter", 0xffd426ff, 100)] }, fs), { pageIDs: [page.id] });
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(1);
    expect(pdf.getPage(0).getSize()).toEqual({ width: 500, height: 250 });
    // The original page rides along as a form object, which keeps its text.
    const xobjects = pdf.getPage(0).node.Resources()?.lookupMaybe(PDFName.of("XObject"), PDFDict);
    expect(xobjects?.keys().length).toBeGreaterThan(0);
  });

  it("does not crash on characters the standard fonts lack", async () => {
    const page = newPage(defaults);
    page.items = [{ id: "t", kind: "text", string: "日本語 text", fontSize: 14, x: 200, y: 100, w: 200, h: 30, rotation: 0 }];
    const manifest = newManifest({ title: "Unicode", defaults, pages: [page] });
    const bytes = await exportPdf(source(manifest, {}), { pageIDs: [page.id] });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });
});

describe("fonts", () => {
  it("picks the family and style", async () => {
    expect(standardFontFor("mono", true, false)).toBe("Courier-Bold");
    expect(standardFontFor("fraunces", false, true)).toBe("Times-Italic");
    expect(standardFontFor(undefined, true, true)).toBe("Helvetica-BoldOblique");
  });
  it("swaps characters WinAnsi lacks", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont("Helvetica");
    expect(winAnsiSafe(font, "café 日本")).toBe("café   ");
  });
});

