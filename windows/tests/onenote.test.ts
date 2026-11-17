import { describe, expect, it } from "vitest";
import { decodeManifest, type Manifest, type Page, type TextItem } from "../src/model/notebook";
import { MemoryFS, readText } from "../src/platform/fs";
import {
  convertPage, decideReimport, inkToStrokes, splitTall, nearestCloth, nearestPaper, needsPdfCopy, outlineToText, pageHash,
  type ONOutline, type ONPageContent, type ONParagraph, type PageOrigin,
} from "../src/services/onenote";
import { allSections, importSections, sectionProblem, type ImportEnv, type ImportOptions, type OneNoteApi } from "../src/services/onenoteImport";
import { loadInk, loadManifest, loadWords } from "../src/storage/package";
import { opacityOf } from "../src/model/tools";

const para = (text: string, extra: Partial<ONParagraph> = {}): ONParagraph => ({
  text, level: 0, list: "none", numberText: null, todo: null, fontSize: 11, bold: false, italic: false, underline: false, strike: false,
  color: null, highlight: null, face: null, table: false, quickStyle: null, ...extra,
});
const outline = (paragraphs: ONParagraph[], extra: Partial<ONOutline> = {}): ONOutline => ({ x: 36, y: 90, w: 300, h: 100, z: 0, paragraphs, ...extra });

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function content(extra: Partial<ONPageContent> = {}): ONPageContent {
  return {
    id: "{P1}", name: "Algebra", created: "2026-09-21T06:57:24.000Z", lastModified: "2026-10-09T15:50:02.000Z", lang: "de",
    title: { text: extra.name ?? "Algebra", x: 36, y: 43, w: 0, fontSize: 20 },
    ruleLines: null, background: null,
    extent: { x: 0, y: 0, w: 700, h: 900 },
    outlines: [outline([para("Hello")])],
    images: [], ink: [], unsupported: [], warnings: [],
    ...extra,
  };
}

describe("text conversion", () => {
  it("makes a text box at the outline's place with indent, soft breaks and a uniform bullet list", () => {
    const { item } = outlineToText(outline([para("one", { list: "bullet" }), para("two", { list: "bullet", level: 1 })]))!;
    expect(item.list).toBe("bullet");
    expect(item.string).toBe("one\n    two");
    expect(item.x - item.w / 2).toBeCloseTo(36);
    expect(item.y - item.h / 2).toBeCloseTo(90);
  });
  it("ticks the done lines of a to-do outline", () => {
    const { item } = outlineToText(outline([para("a", { todo: true }), para("b", { todo: false }), para("c", { todo: true })]))!;
    expect(item.list).toBe("check");
    expect(item.checked).toEqual([0, 2]);
  });
  it("prefixes lines when an outline mixes list styles, and keeps tables as rows", () => {
    const { item } = outlineToText(outline([para("plain"), para("pt", { list: "bullet" }), para("n", { list: "number", numberText: "3." }), para("a | b", { table: true }), para("x", { todo: true })]))!;
    expect(item.list).toBeUndefined();
    expect(item.string).toBe("plain\n• pt\n3. n\na | b\n☑ x");
  });
  it("takes the dominant style and maps font and colours", () => {
    const { item } = outlineToText(outline([
      para("a long bold highlighted paragraph here", { bold: true, fontSize: 14, color: "#C00000", highlight: "#FFFF00", face: "Times New Roman" }),
      para("x", { fontSize: 11 }),
    ]))!;
    expect(item.bold).toBe(true);
    expect(item.fontSize).toBe(14);
    expect(item.tint).toBe("tomato");
    expect(item.highlight).toBe("yellow");
    expect(item.face).toBe("serif");
  });
  it("drops empty outlines", () => {
    expect(outlineToText(outline([para(""), para("  ")]))).toBeNull();
  });
});

describe("colours", () => {
  it("finds the nearest cloth and paper", () => {
    expect(nearestCloth("#8AA8E4")).toBe("cobalt");
    expect(nearestCloth(null)).toBe("navy");
    expect(nearestPaper(null)).toBe("white");
    expect(nearestPaper("#FFF8C4")).toBe("yellow");
    expect(nearestPaper("#222222")).toBe("charcoal");
  });
});

describe("ink", () => {
  const stroke = (kind: "pen" | "highlighter" | "pencil", color: string, pressure: number) => ({
    kind, color, width: 1.4, times: [], points: [[10, 10, pressure], [20, 20, pressure]] as [number, number, number][],
  });
  it("keeps pressure and width, fades the highlighter and orders strokes in time", () => {
    const strokes = inkToStrokes([
      { source: "drawing", x: 0, y: 0, w: 1, h: 1, z: 2, lastModified: "2026-09-21T08:31:47.000Z", recognized: null, strokes: [stroke("highlighter", "#FFEB3BFF", 0)] },
      { source: "drawing", x: 0, y: 0, w: 1, h: 1, z: 1, lastModified: "2026-09-21T08:31:47.000Z", recognized: null, strokes: [stroke("pen", "#0A141EFF", 0.7), stroke("pencil", "#000000FF", 0.3)] },
    ], 0);
    expect(strokes.map((s) => s.ink)).toEqual(["pen", "pencil", "highlighter"]);
    expect(strokes[0].pts[2]).toBeCloseTo(0.7);
    expect(strokes[0].width).toBeCloseTo(1.4);
    expect(strokes[0].color).toBe(0x0a141eff);
    expect(opacityOf(strokes[2].color)).toBeCloseTo(0.45, 1);
    expect(strokes[2].pts[2]).toBe(0.5);
    expect(strokes[1].at).toBeGreaterThan(strokes[0].at);
    expect(strokes[2].at).toBeGreaterThan(strokes[1].at);
    expect(strokes[0].pts.length).toBe(8);
    expect(strokes[0].pts[7]).toBe(8);
  });
});

describe("page conversion", () => {
  it("sizes the page from its content, at least Letter", () => {
    expect(convertPage(content()).size).toEqual({ w: 736, h: 936 });
    expect(convertPage(content({ extent: { x: 0, y: 0, w: 100, h: 100 } })).size).toEqual({ w: 612, h: 792 });
  });
  it("chooses paper from the rule lines and background", () => {
    expect(convertPage(content()).template).toBe("blank");
    expect(convertPage(content({ ruleLines: { horizontal: true, vertical: false, spacing: 28, color: null } })).template).toBe("narrowRuled");
    expect(convertPage(content({ ruleLines: { horizontal: true, vertical: true, spacing: 28, color: null } })).template).toBe("grid");
  });
  it("adds the title and the date line, pictures with their words, and words for search", () => {
    const page = convertPage(content({ images: [{ x: 10, y: 300, w: 100, h: 50, z: 1, format: "png", data: PNG, alt: null, ocr: "ocr words", isPrintOut: false, inline: false }] }), { formatDate: () => "DATE" });
    const texts = page.items.filter((i): i is TextItem => i.kind === "text").map((i) => i.string);
    expect(texts).toEqual(["Algebra", "DATE", "Hello"]);
    expect((page.items[0] as TextItem).bold).toBe(true);
    const picture = page.items.find((i) => i.kind === "image")!;
    expect(picture.kind === "image" && picture.text).toBe("ocr words");
    expect(page.assets[0].ext).toBe("png");
    expect(page.words).toContain("ocr words");
    expect(page.words).toContain("Hello");
  });
  it("decides on a PDF copy from unsupported content and warnings", () => {
    const clean = convertPage(content());
    const odd = convertPage(content({ unsupported: [{ kind: "MediaFile", name: null, x: 0, y: 0, w: 0, h: 0 }] }));
    const warned = convertPage(content({ warnings: ["x"] }));
    expect(needsPdfCopy(clean, true)).toBe(false);
    expect(needsPdfCopy(odd, true)).toBe(true);
    expect(needsPdfCopy(warned, true)).toBe(true);
    expect(needsPdfCopy(odd, false)).toBe(false);
  });
});

describe("very tall pages", () => {
  it("are cut into pages at picture boundaries, keeping every picture and stroke", () => {
    const images = Array.from({ length: 12 }, (_, i) => ({ x: 36, y: 100 + i * 843, w: 596, h: 843, z: i, format: "png", data: PNG, alt: null, ocr: null, isPrintOut: true, inline: false }));
    const ink = Array.from({ length: 12 }, (_, i) => ({
      source: "drawing", x: 100, y: 200 + i * 843, w: 10, h: 10, z: i, lastModified: null, recognized: null,
      strokes: [{ kind: "pen" as const, color: "#000000FF", width: 1.4, times: [], points: [[100, 200 + i * 843, 0.5], [110, 210 + i * 843, 0.5]] as [number, number, number][] }],
    }));
    const whole = convertPage(content({ images, ink, extent: { x: 0, y: 0, w: 640, h: 100 + 12 * 843 } }));
    const parts = splitTall(whole);
    expect(parts.length).toBeGreaterThan(2);
    expect(parts.every((p) => p.size.h <= 4300)).toBe(true);
    expect(parts.reduce((n, p) => n + p.strokes.length, 0)).toBe(12);
    expect(parts.reduce((n, p) => n + p.items.filter((i) => i.kind === "image").length, 0)).toBe(12);
    expect(parts.reduce((n, p) => n + p.assets.length, 0)).toBe(12);
    // Cut between tiles: no picture is cropped.
    expect(parts.flatMap((p) => p.items).some((i) => i.kind === "image" && i.crop)).toBe(false);
    expect(parts[1].items.some((i) => i.kind === "text" && i.string.includes("(2/"))).toBe(true);
    expect(splitTall(convertPage(content()))).toHaveLength(1);
  });
});

describe("importing again", () => {
  const origin: PageOrigin = { pageID: "p", lastModified: "t1", importedHash: "h" };
  it("decides new, unchanged, replace and keep both", () => {
    expect(decideReimport(null, "t1")).toBe("new");
    expect(decideReimport({ origin, currentHash: "h" }, "t1")).toBe("unchanged");
    expect(decideReimport({ origin, currentHash: "other" }, "t1")).toBe("unchanged");
    expect(decideReimport({ origin, currentHash: "h" }, "t2")).toBe("replace");
    expect(decideReimport({ origin, currentHash: "other" }, "t2")).toBe("keepBoth");
  });
  it("hashes items and ink so a change shows", () => {
    const page = convertPage(content());
    const a = pageHash(page.items, []);
    expect(pageHash(page.items, [])).toBe(a);
    expect(pageHash([{ ...(page.items[0] as TextItem), string: "changed" }], [])).not.toBe(pageHash([page.items[0]], []));
  });
});

// A full import, on fixtures and a memory file system.

const section = (pages: { id: string; name: string; lm: string }[], extra = {}) => ({
  id: "{S1}", name: "Maths", color: "#8AA8E4", path: null, lastModified: null, locked: false, encrypted: false, readOnly: false,
  isInRecycleBin: false, isDeletedPages: false,
  pages: pages.map((p) => ({ id: p.id, name: p.name, dateTime: null, lastModified: p.lm, level: 1, isUnread: false, isInRecycleBin: false })),
  ...extra,
});
const options: ImportOptions = { mode: "editable", keepPdfCopies: true, includeDeleted: false };

function harness(pagesByID: Record<string, ONPageContent>) {
  const fs = new MemoryFS();
  const manifests = new Map<string, Manifest>();
  const calls = { pdf: 0, pages: 0 };
  const api: OneNoteApi = {
    page: async (id) => { calls.pages++; if (!pagesByID[id]) throw new Error("hrObjectDoesNotExist"); return structuredClone(pagesByID[id]); },
    publishPdf: async () => { calls.pdf++; return "x.pdf"; },
    readFile: async () => new Uint8Array([37, 80, 68, 70]),
    cleanup: async () => {},
  };
  const env: ImportEnv = {
    fs, api,
    findExisting: (sectionID) => [...manifests.values()].find((m) => (m as unknown as { oneNote?: { sectionID: string } }).oneNote?.sectionID === sectionID) ?? null,
    isOpen: () => false,
    ensureFolder: async () => "folder-1",
    pdfSizes: async () => [{ w: 612, h: 792 }],
    written: (m) => manifests.set(m.id, structuredClone(m)),
  };
  return { fs, env, manifests, calls };
}

const job = (pages: { id: string; name: string; lm: string }[], extra = {}) => ({ notebookID: "{N1}", notebook: "School", groups: ["Year 2"], section: section(pages, extra) });

describe("a section import", () => {
  it("writes pages, ink, pictures, words and the origin keys, manifest last", async () => {
    const ink = [{ source: "drawing", x: 50, y: 400, w: 10, h: 10, z: 1, lastModified: "2026-09-21T08:31:47.000Z", recognized: null, strokes: [{ kind: "pen" as const, color: "#000000FF", width: 1.4, times: [], points: [[50, 400, 0.5], [60, 410, 0.5]] as [number, number, number][] }] }];
    const images = [{ x: 10, y: 300, w: 100, h: 50, z: 1, format: "png", data: PNG, alt: null, ocr: "ocr words", isPrintOut: false, inline: false }];
    const h = harness({
      "{A}": content({ id: "{A}", ink, images }),
      "{B}": content({ id: "{B}", name: "Odd", unsupported: [{ kind: "InsertedFile", name: "x.pdf", x: 0, y: 0, w: 0, h: 0 }] }),
    });
    const summary = await importSections(h.env, [job([{ id: "{A}", name: "Algebra", lm: "t1" }, { id: "{B}", name: "Odd", lm: "t1" }])], options);
    expect(summary.sections).toBe(1);
    expect(summary.notebooks).toBe(1);
    expect(summary.pagesImported).toBe(2);
    expect(summary.pdfCopies).toBe(1);
    expect(h.calls.pdf).toBe(1);
    const manifest = [...h.manifests.values()][0];
    expect(manifest.title).toBe("Maths");
    expect(manifest.cover.cloth).toBe("cobalt");
    expect(manifest.tags).toEqual(["School"]);
    expect(manifest.folder).toBe("folder-1");
    // Pages: Algebra, Odd, then Odd's PDF copy.
    expect(manifest.pages).toHaveLength(3);
    expect(manifest.pages[2].background.kind).toBe("pdf");
    expect(JSON.stringify(manifest.pages[2].items)).toContain("As shown in OneNote");
    const saved = await loadManifest(h.fs, manifest.id);
    expect((saved as unknown as { oneNote: { sectionID: string; notebookName: string } }).oneNote).toMatchObject({ sectionID: "{S1}", notebookName: "School" });
    expect((saved.pages[0] as Page & { oneNote: PageOrigin }).oneNote).toMatchObject({ pageID: "{A}", lastModified: "t1" });
    expect(await loadInk(h.fs, manifest.id, manifest.pages[0].id)).toHaveLength(1);
    const picture = saved.pages[0].items.find((i) => i.kind === "image");
    expect(picture && picture.kind === "image" && (await h.fs.read(`${manifest.id}.owlluna/assets/${picture.file}`))).toBeTruthy();
    const words = await loadWords(h.fs, manifest.id);
    expect(words.pages[manifest.pages[0].id].text).toContain("ocr words");
    // The manifest survives its own decoder with the extra keys.
    expect((decodeManifest((await readText(h.fs, `${manifest.id}.owlluna/manifest.json`))!) as unknown as { oneNote: unknown }).oneNote).toBeTruthy();
  });

  it("imports again without duplicating: unchanged, new, replaced and kept-both pages", async () => {
    const pages = {
      "{A}": content({ id: "{A}", name: "A" }), "{B}": content({ id: "{B}", name: "B" }), "{C}": content({ id: "{C}", name: "C" }),
    };
    const h = harness(pages);
    await importSections(h.env, [job([{ id: "{A}", name: "A", lm: "t1" }, { id: "{C}", name: "C", lm: "t1" }])], options);
    const first = [...h.manifests.values()][0];
    expect(first.pages).toHaveLength(2);
    // The user edits page C (not A).
    const c = first.pages[1];
    const edited = structuredClone(first);
    (edited.pages[1].items.find((i) => i.kind === "text" && !i.bold) as TextItem).string = "my own words";
    h.manifests.set(edited.id, edited);
    // OneNote now has a new page B between A and C, a changed A, and a changed C.
    pages["{A}"] = content({ id: "{A}", name: "A", outlines: [outline([para("new A text")])] });
    pages["{C}"] = content({ id: "{C}", name: "C", outlines: [outline([para("new C text")])] });
    const again = await importSections(h.env, [job([{ id: "{A}", name: "A", lm: "t2" }, { id: "{B}", name: "B", lm: "t1" }, { id: "{C}", name: "C", lm: "t2" }])], options);
    expect(again.pagesImported).toBe(1);
    expect(again.pagesUpdated).toBe(1);
    expect(again.pagesKeptBoth).toBe(1);
    const manifest = [...h.manifests.values()][0];
    expect(manifest.id).toBe(first.id);
    expect(manifest.pages).toHaveLength(4);
    const names = manifest.pages.map((p) => (p.items.find((i) => i.kind === "text" && i.bold) as TextItem).string);
    expect(names).toEqual(["A", "B", "C", "C (updated in OneNote)"]);
    expect(manifest.pages[0].id).toBe(first.pages[0].id);
    expect(JSON.stringify(manifest.pages[0].items)).toContain("new A text");
    expect(manifest.pages[2].id).toBe(c.id);
    expect(JSON.stringify(manifest.pages[2].items)).toContain("my own words");
    // And a third import with nothing new changes nothing.
    const third = await importSections(h.env, [job([{ id: "{A}", name: "A", lm: "t2" }, { id: "{B}", name: "B", lm: "t1" }, { id: "{C}", name: "C", lm: "t2" }])], options);
    expect(third.pagesImported + third.pagesUpdated + third.pagesKeptBoth).toBe(0);
    expect(third.pagesUnchanged).toBe(3);
    expect([...h.manifests.values()][0].pages).toHaveLength(4);
  });

  it("skips locked sections and the recycle bin, and reports pages that could not be read", async () => {
    const h = harness({});
    const summary = await importSections(h.env, [
      job([], { locked: true, encrypted: true, name: "Secret", id: "{S9}" }),
      job([{ id: "{X}", name: "Gone", lm: "t" }], { id: "{S2}", name: "Broken" }),
    ], { ...options, keepPdfCopies: false });
    expect(summary.skipped[0].name).toContain("Secret");
    expect(summary.warnings.some((w) => w.message.includes("hrObjectDoesNotExist"))).toBe(true);
    expect(summary.pagesImported).toBe(0);
  });

  it("stops after the current page when cancelled and keeps what is done", async () => {
    const pages = { "{A}": content({ id: "{A}" }), "{B}": content({ id: "{B}" }) };
    const h = harness(pages);
    const signal = { cancelled: false };
    const summary = await importSections(h.env, [job([{ id: "{A}", name: "A", lm: "t" }, { id: "{B}", name: "B", lm: "t" }])], options, (p) => { if (p.pageIndex === 1) signal.cancelled = true; }, signal);
    expect(summary.cancelled).toBe(true);
    expect(summary.pagesImported).toBe(1);
    expect([...h.manifests.values()][0].pages).toHaveLength(1);
  });

  it("exact mode makes a PDF notebook per section", async () => {
    const h = harness({});
    // importPdf needs pdf.js, which is not available here: the section is reported rather than thrown.
    const summary = await importSections(h.env, [job([{ id: "{A}", name: "A", lm: "t" }])], { ...options, mode: "exact" });
    expect(summary.sections + summary.skipped.length).toBe(1);
  });

  it("lists sections with their group path and leaves out the recycle bin", () => {
    const notebook = {
      id: "{N}", name: "N", nickname: null, path: null, color: null, lastModified: null,
      sections: [section([], { id: "{a}", name: "a" })],
      groups: [
        { id: "{g}", name: "G", color: null, lastModified: null, isRecycleBin: false, groups: [], sections: [section([], { id: "{b}", name: "b" })] },
        { id: "{r}", name: "bin", color: null, lastModified: null, isRecycleBin: true, groups: [], sections: [section([], { id: "{c}", name: "c" })] },
      ],
    };
    expect(allSections([notebook], false).map((j) => [j.section.name, j.groups])).toEqual([["a", []], ["b", ["G"]]]);
    expect(allSections([notebook], true)).toHaveLength(3);
    expect(sectionProblem(section([], { locked: true }), false)).toBeTruthy();
    expect(sectionProblem(section([]), false)).toBeNull();
  });
});

// Real pages read from OneNote by the ignored Rust test (ONENOTE_DUMP_DIR), when that folder is given.
const dump = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.ONENOTE_DUMP_DIR;
describe.skipIf(!dump)("real OneNote pages", () => {
  it("converts every dumped page and the ink lies inside the page", async () => {
    const fsName = "node:fs";
    const fs = (await import(/* @vite-ignore */ fsName)) as { readdirSync(p: string): string[]; readFileSync(p: string, e: string): string };
    const files = fs.readdirSync(dump!).filter((f: string) => f.endsWith(".json"));
    expect(files.length).toBeGreaterThan(0);
    let strokes = 0, items = 0;
    for (const file of files) {
      const page = convertPage(JSON.parse(fs.readFileSync(`${dump}/${file}`, "utf8")) as ONPageContent);
      strokes += page.strokes.length;
      items += page.items.length;
      for (const s of page.strokes.slice(0, 200)) {
        expect(s.pts.every(Number.isFinite)).toBe(true);
        expect(s.pts[0]).toBeGreaterThan(-5);
        expect(s.pts[0]).toBeLessThan(page.size.w + 5);
        expect(s.pts[1]).toBeLessThan(page.size.h + 5);
      }
    }
    console.log(`real pages converted: ${files.length}, strokes ${strokes}, items ${items}`);
  });
});
