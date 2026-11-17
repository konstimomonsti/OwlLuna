import { describe, expect, it } from "vitest";
import { decodeInk, encodeInk, eraseFromStroke, makeStroke, pointCount, strokeHit, strokesInLasso, transformStroke, strokeBounds } from "../src/model/ink";
import { decodeManifest, duplicatedPage, encodeManifest, newManifest, usedAssets, webAddress } from "../src/model/notebook";
import { graded, intervalAfter, newCard, dueCards, decodeCards, encodeCards } from "../src/model/flashcard";
import { dayKey, daysBetween, dateOfKey, weekOf, addDays } from "../src/model/days";
import { clampWidth, colorName, opacityOf, widthAt, widthTravel, withOpacity, withTint, paletteFor, hexCSS } from "../src/model/tools";
import { familyOf, paperTemplates, familyTemplates, paperFamilies, pageSizePoints } from "../src/model/paper";
import { fnv1a } from "../src/model/ids";

const line = (x0: number, y0: number, x1: number, y1: number, n = 21) =>
  makeStroke("pen", 0x1b2230ff, 2, Array.from({ length: n }, (_, i) => ({ x: x0 + ((x1 - x0) * i) / (n - 1), y: y0 + ((y1 - y0) * i) / (n - 1) })), 1000);

describe("ink", () => {
  it("round-trips through its file", () => {
    const strokes = [line(0, 0, 100, 0), { ...line(5, 5, 9, 90), ink: "highlighter" as const }];
    const back = decodeInk(encodeInk(strokes));
    expect(back).toHaveLength(2);
    expect(back[0].id).toBe(strokes[0].id);
    expect(back[0].pts).toEqual(strokes[0].pts);
    expect(back[1].ink).toBe("highlighter");
    expect(back[0].even).toBe(true);
  });
  it("leaves out strokes it cannot draw and refuses what is not ink", () => {
    const good = line(0, 0, 10, 10);
    const text = JSON.stringify({ version: 1, strokes: [good, { ink: "laserbeam", pts: [0, 0, 0, 0] }, { ink: "pen", pts: [1, 2, 3] }, { ink: "pen", pts: [0, 0, null, 0] }, null] });
    expect(decodeInk(text).map((s) => s.id)).toEqual([good.id]);
    expect(() => decodeInk("{}")).toThrow();
    expect(() => decodeInk("nope")).toThrow();
  });
  it("hits a stroke within its width and the eraser's", () => {
    const stroke = line(0, 0, 100, 0);
    expect(strokeHit(stroke, { x: 50, y: 3 }, 2.5)).toBe(true);
    expect(strokeHit(stroke, { x: 50, y: 10 }, 2.5)).toBe(false);
    expect(strokeHit(stroke, { x: 120, y: 0 }, 5)).toBe(false);
  });
  it("erases the middle of a stroke into two", () => {
    const stroke = line(0, 0, 100, 0);
    const parts = eraseFromStroke(stroke, { x: 50, y: 0 }, 6)!;
    expect(parts).toHaveLength(2);
    expect(Math.max(...parts[0].pts.filter((_, i) => i % 4 === 0))).toBeLessThan(44);
    expect(Math.min(...parts[1].pts.filter((_, i) => i % 4 === 0))).toBeGreaterThan(56);
    expect(parts[1].pts[3]).toBe(0);
    expect(parts[1].at).toBeGreaterThan(stroke.at);
    expect(new Set(parts.map((p) => p.id)).size).toBe(2);
    expect(eraseFromStroke(stroke, { x: 50, y: 40 }, 6)).toBeNull();
  });
  it("erases a whole short stroke to nothing", () => {
    expect(eraseFromStroke(line(0, 0, 4, 0, 3), { x: 2, y: 0 }, 10)).toEqual([]);
  });
  it("cuts a stroke the eraser crosses between two far points", () => {
    const sparse = line(0, 0, 100, 0, 2);
    expect(eraseFromStroke(sparse, { x: 50, y: 0 }, 3)).toEqual([]);
  });
  it("lassoes strokes mostly inside the loop", () => {
    const inside = line(10, 10, 40, 40), outside = line(200, 200, 240, 240), straddling = line(40, 25, 300, 25);
    const loop = [{ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 60, y: 60 }, { x: 0, y: 60 }];
    expect(strokesInLasso([inside, outside, straddling], loop)).toEqual([inside]);
    expect(strokesInLasso([inside], loop.slice(0, 2))).toEqual([]);
  });
  it("moves and scales", () => {
    const moved = transformStroke(line(0, 0, 10, 0), 5, 7);
    expect(moved.pts.slice(0, 2)).toEqual([5, 7]);
    const scaled = transformStroke(line(10, 10, 20, 10), 0, 0, 2, { x: 10, y: 10 });
    expect(scaled.pts[scaled.pts.length - 4]).toBe(30);
    expect(scaled.width).toBe(4);
    expect(pointCount(scaled)).toBe(21);
    expect(strokeBounds(line(0, 0, 10, 0)).w).toBeCloseTo(14);
  });
});

describe("manifest", () => {
  it("round-trips and keeps keys it does not know", () => {
    const manifest = newManifest({ title: "Physics", tags: ["school"] });
    const raw = JSON.parse(encodeManifest(manifest));
    raw.futureThing = { a: 1 };
    raw.pages[0].futurePageKey = "kept";
    const back = decodeManifest(JSON.stringify(raw)) as any;
    expect(back.title).toBe("Physics");
    expect(back.futureThing).toEqual({ a: 1 });
    expect(back.pages[0].futurePageKey).toBe("kept");
    expect(back.pages[0].size).toEqual(pageSizePoints.letter);
  });
  it("mends what it can and refuses what is not a manifest", () => {
    const back = decodeManifest(JSON.stringify({ id: "A", pages: [{ id: "p", size: { w: "x" }, paperColor: "neon", items: [{ kind: "ufo" }, { kind: "tape", x: 1, y: 2, w: 3, h: 4 }] }, { id: "p" }, null], tags: ["a", "a", 3, " "] }));
    expect(back.pages).toHaveLength(1);
    expect(back.pages[0].paperColor).toBe("white");
    expect(back.pages[0].items).toHaveLength(1);
    expect(back.tags).toEqual(["a"]);
    expect(back.title).toBe("Untitled");
    expect(back.cover.style).toBe("cloth");
    expect(() => decodeManifest("[]")).toThrow();
    expect(() => decodeManifest(JSON.stringify({ id: "A", pages: [], version: 99 }))).toThrow(/newer/);
  });
  it("never leaves a notebook without a page", () => {
    expect(decodeManifest(JSON.stringify({ id: "A", pages: [] })).pages).toHaveLength(1);
    const board = decodeManifest(JSON.stringify({ id: "A", kind: "whiteboard", pages: [] }));
    expect(board.pages[0].edgeless).toBe(true);
  });
  it("duplicates a page with new identities", () => {
    const manifest = newManifest({ title: "x" });
    const page = { ...manifest.pages[0], bookmark: true, date: "2026-01-01", items: [{ id: "i1", kind: "tape" as const, color: "rose" as const, x: 0, y: 0, w: 10, h: 10, rotation: 0 }] };
    const copy = duplicatedPage(page);
    expect(copy.id).not.toBe(page.id);
    expect(copy.items[0].id).not.toBe("i1");
    expect(copy.bookmark).toBeUndefined();
    expect(copy.date).toBeUndefined();
    expect(page.items[0].id).toBe("i1");
  });
  it("knows the assets in use", () => {
    const manifest = newManifest({ title: "x" });
    manifest.pages[0].background = { kind: "pdf", file: "a.pdf", index: 0 };
    manifest.pages[0].items.push({ id: "i", kind: "image", file: "b.png", x: 0, y: 0, w: 1, h: 1, rotation: 0 });
    manifest.papers = [{ id: "p", name: "Mine", background: { kind: "image", file: "c.png" }, size: { w: 1, h: 1 } }];
    expect([...usedAssets(manifest)].sort()).toEqual(["a.pdf", "b.png", "c.png"]);
  });
  it("reads web addresses", () => {
    expect(webAddress("example.com")).toBe("https://example.com/");
    expect(webAddress(" http://a.b/c ")).toBe("http://a.b/c");
    expect(webAddress("localhost")).toBe("https://localhost/");
    expect(webAddress("nonsense")).toBeNull();
    expect(webAddress("javascript:alert(1)")).toBeNull();
    expect(webAddress("two words.com")).toBeNull();
    expect(webAddress("")).toBeNull();
  });
});

describe("flashcards", () => {
  const now = new Date(2026, 9, 3, 12);
  it("starts due today and grows 1, 3, then by ease", () => {
    let card = newCard({ text: "q" }, { text: "a" }, { now });
    expect(card.due).toBe("2026-10-03");
    card = graded(card, "good", now);
    expect(card.interval).toBe(1);
    expect(card.due).toBe("2026-10-04");
    card = graded(card, "good", addDays(now, 1));
    expect(card.interval).toBe(3);
    card = graded(card, "good", addDays(now, 4));
    expect(card.interval).toBe(8);
    expect(card.reviews).toBe(3);
  });
  it("easy starts at four days and raises ease", () => {
    const card = graded(newCard({ text: "q" }, { text: "a" }, { now }), "easy", now);
    expect(card.interval).toBe(4);
    expect(card.ease).toBeCloseTo(2.65);
  });
  it("again resets, lowers ease to a floor and counts a lapse", () => {
    let card = { ...newCard({ text: "q" }, { text: "a" }, { now }), interval: 10, ease: 1.4, due: "2026-10-03" };
    card = graded(card, "again", now);
    expect(card.interval).toBe(0);
    expect(card.ease).toBeCloseTo(1.3);
    expect(card.lapses).toBe(1);
    expect(card.due).toBe("2026-10-03");
  });
  it("again on a new card is no lapse", () => {
    const card = graded(newCard({ text: "q" }, { text: "a" }, { now }), "again", now);
    expect(card.lapses).toBe(0);
    expect(card.ease).toBe(2.5);
  });
  it("never shortens a card studied early, and caps at a year", () => {
    const early = { ...newCard({ text: "q" }, { text: "a" }, { now }), interval: 10, due: "2026-10-08" };
    expect(intervalAfter("good", early, now)).toBe(13);
    expect(graded(early, "easy", now).ease).toBe(2.5);
    const old = { ...early, interval: 300, due: "2026-10-03" };
    expect(intervalAfter("good", old, now)).toBe(365);
    expect(intervalAfter("easy", old, now)).toBe(365);
  });
  it("lists due cards oldest first and round-trips", () => {
    const a = { ...newCard({ text: "a" }, { text: "" }, { now }), due: "2026-10-02" };
    const b = { ...newCard({ text: "b" }, { text: "" }, { now }), due: "2026-10-01" };
    const c = { ...newCard({ text: "c" }, { text: "" }, { now }), due: "2026-10-09" };
    expect(dueCards([a, b, c], "2026-10-03").map((card) => card.front.text)).toEqual(["b", "a"]);
    expect(decodeCards(encodeCards([a, b]))).toEqual([a, b]);
    expect(decodeCards(JSON.stringify({ cards: [{ id: "x", ease: 0.2, interval: -4 }, { nope: 1 }] }))[0]).toMatchObject({ ease: 1.3, interval: 0, front: { text: "" } });
  });
});

describe("days", () => {
  it("keys days and counts between them", () => {
    expect(dayKey(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(daysBetween("2026-02-27", "2026-03-02")).toBe(3);
    expect(daysBetween("2026-03-28", "2026-03-30")).toBe(2);
    expect(daysBetween("x", "2026-03-30")).toBeNull();
    expect(dateOfKey("2026-02-31")).toBeNull();
    expect(dateOfKey("2026-02-28")!.getDate()).toBe(28);
  });
  it("lays out a Monday-first week", () => {
    const week = weekOf(new Date(2026, 10, 18));
    expect(week).toHaveLength(7);
    expect(week[0]).toBe("2026-11-16");
    expect(week[6]).toBe("2026-11-22");
    expect(weekOf(new Date(2026, 10, 22))[0]).toBe("2026-11-16");
  });
});

describe("tools and paper", () => {
  it("clamps widths and maps travel both ways", () => {
    expect(clampWidth("fineliner", 0.01)).toBe(0.25);
    expect(clampWidth("pen", 999)).toBe(25.7);
    const width = widthAt(0.4, "pen");
    expect(widthTravel({ id: "", ink: "pen", color: 0, width })).toBeCloseTo(0.4);
  });
  it("handles opacity and tint in the last byte of the colour", () => {
    const faint = withOpacity(0xffd426ff, 0.5);
    expect(opacityOf(faint)).toBeCloseTo(0.5, 1);
    expect(opacityOf(withOpacity(faint, 0))).toBeCloseTo(0.1, 1);
    expect(withTint(faint, 0x2747b8ff) & 0xff).toBe(faint & 0xff);
    expect(hexCSS(0x2747b8ff)).toBe("#2747b8");
    expect(withOpacity(0xffffffff, 1)).toBe(0xffffffff);
  });
  it("names colours", () => {
    expect(colorName(0x1b2230ff)).toBe("Black");
    expect(colorName(0xc9452fff)).toBe("Red");
    expect(colorName(0x2747b8ff)).toBe("Blue");
    expect(colorName(0xe8b023ff)).toBe("Mustard");
    expect(colorName(0x7a5230ff)).toBe("Brown");
    expect(paletteFor("highlighter")[0]).toBe(0xffd426ff);
  });
  it("puts each of the fourteen templates in one family", () => {
    expect(paperTemplates).toHaveLength(14);
    const all = paperFamilies.flatMap((family) => familyTemplates[family]);
    expect([...all].sort()).toEqual([...paperTemplates].sort());
    expect(familyOf("cornell")).toBe("planning");
  });
  it("hashes like FNV-1a", () => {
    expect(fnv1a("")).toBe("cbf29ce484222325");
    expect(fnv1a("a")).toBe("af63dc4c8601ec8c");
  });
});
