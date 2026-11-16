import { describe, expect, it } from "vitest";
import { bandsOf, mergeLines, multiply, snapToLine, textBoxes } from "../src/canvas/pdfText";
import { makeStroke, type Stroke } from "../src/model/ink";
import { newManifest, newPage, type PageItem } from "../src/model/notebook";
import { exportText } from "../src/services/exportText";
import { picturePageSize, explainPdfError, pdfPages, titleOfFile, isPdfName, isPictureName } from "../src/services/pdfImport";
import { buildTimeline, strokesAt, writingTime } from "../src/services/timelapse";
import { inkSignature, mergeWordText, stalePages, textOfBoxes, wordsKey } from "../src/services/words";

const defaults = { template: "blank", paperColor: "white", pageSize: "letter" } as const;

function timed(at: number, length: number, points = 5): Stroke {
  const stroke = makeStroke("pen", 0x000000ff, 2, Array.from({ length: points }, (_, i) => ({ x: i * 10, y: 0 })), at);
  // Spread the points over `length` milliseconds.
  for (let i = 0; i < points; i++) stroke.pts[i * 4 + 3] = (length * i) / (points - 1);
  return stroke;
}

describe("pdf text geometry", () => {
  it("composes matrices", () => {
    expect(multiply([1, 0, 0, 1, 5, 6], [2, 0, 0, 2, 1, 1])).toEqual([2, 0, 0, 2, 6, 7]);
  });
  it("places a text item in page points, upright, with its top above the baseline", () => {
    // A 600x800 page at scale 1: PDF space is flipped.
    const viewport = [1, 0, 0, -1, 0, 800];
    const [box] = textBoxes([{ str: "Hello", transform: [12, 0, 0, 12, 50, 700], width: 30, height: 12 }], viewport);
    expect(box.x).toBeCloseTo(50);
    expect(box.y + box.h * 0.82).toBeCloseTo(100);
    expect(box.h).toBeCloseTo(12);
    expect(box.w).toBeCloseTo(30);
    expect(box.angle).toBeCloseTo(0);
  });
  it("skips blank items and joins one line's items", () => {
    const viewport = [1, 0, 0, -1, 0, 800];
    const boxes = textBoxes([
      { str: "Hello", transform: [12, 0, 0, 12, 50, 700], width: 30, height: 12 },
      { str: " ", transform: [12, 0, 0, 12, 80, 700], width: 3, height: 12 },
      { str: "world", transform: [12, 0, 0, 12, 90, 700.5], width: 30, height: 12 },
      { str: "next line", transform: [12, 0, 0, 12, 50, 680], width: 50, height: 12 },
    ], viewport);
    expect(boxes).toHaveLength(3);
    const lines = mergeLines(boxes);
    expect(lines).toHaveLength(2);
    expect(lines[0].x).toBeCloseTo(50);
    expect(lines[0].w).toBeCloseTo(70);
    expect(textOfBoxes(boxes)).toBe("Hello world\nnext line");
  });
  it("merges selection rectangles into one band per line", () => {
    const bands = bandsOf([{ x: 10, y: 10, w: 30, h: 12 }, { x: 40, y: 10.5, w: 30, h: 12 }, { x: 10, y: 30, w: 50, h: 12 }, { x: 0, y: 0, w: 0, h: 0 }]);
    expect(bands).toHaveLength(2);
    expect(bands[0]).toMatchObject({ x: 10, w: 60 });
  });
});

describe("snapToLine", () => {
  const lines = [{ x: 50, y: 100, w: 300, h: 14 }, { x: 50, y: 130, w: 300, h: 14 }];
  it("lays a straight band along the line the stroke began on", () => {
    const snap = snapToLine([{ x: 80, y: 109 }, { x: 150, y: 115 }, { x: 220, y: 104 }], lines)!;
    expect(snap.from).toEqual({ x: 80, y: 107 });
    expect(snap.to).toEqual({ x: 220, y: 107 });
    expect(snap.height).toBe(14);
  });
  it("picks the line nearest the start when the stroke wanders to another", () => {
    const snap = snapToLine([{ x: 80, y: 138 }, { x: 150, y: 108 }], lines)!;
    expect(snap.from.y).toBe(137);
  });
  it("does nothing when the stroke begins off the text", () => {
    expect(snapToLine([{ x: 80, y: 200 }, { x: 150, y: 200 }], lines)).toBeNull();
    expect(snapToLine([{ x: 10, y: 107 }, { x: 150, y: 107 }], lines)).toBeNull();
    expect(snapToLine([], lines)).toBeNull();
  });
  it("makes a short mark for a dab", () => {
    const snap = snapToLine([{ x: 100, y: 105 }], lines)!;
    expect(snap.to.x).toBeGreaterThan(snap.from.x);
  });
});

describe("words cache", () => {
  const pdfPage = newPage(defaults, { background: { kind: "pdf", file: "a.pdf", index: 0 } });
  const plain = newPage(defaults);
  it("keys change with the page's paper and, once read, its ink", () => {
    expect(wordsKey(pdfPage)).toBe(wordsKey({ ...pdfPage }));
    expect(wordsKey(pdfPage)).not.toBe(wordsKey({ ...pdfPage, background: { kind: "pdf", file: "a.pdf", index: 1 } }));
    expect(wordsKey(plain, "1:a")).not.toBe(wordsKey(plain, "2:b"));
  });
  it("says which pages need reading", () => {
    expect(stalePages([pdfPage, plain], {}).map((page) => page.id)).toEqual([pdfPage.id]);
    expect(stalePages([pdfPage, plain], { [pdfPage.id]: { key: wordsKey(pdfPage), text: "x" } })).toEqual([]);
    expect(stalePages([pdfPage, plain], {}, { [plain.id]: "1:a" }).map((page) => page.id)).toEqual([pdfPage.id, plain.id]);
  });
  it("merges parts and signs ink", () => {
    expect(mergeWordText("one  two", undefined, " three\n", "")).toBe("one two three");
    expect(inkSignature([])).toBe("");
    expect(inkSignature([timed(1, 10)])).toMatch(/^1:/);
  });
});

describe("pdf import helpers", () => {
  it("titles from file names and recognises the files", () => {
    expect(titleOfFile("C:\\Users\\me\\Lecture 3.final.pdf")).toBe("Lecture 3.final");
    expect(titleOfFile("/tmp/.pdf")).toBe("Untitled");
    expect(isPdfName("A.PDF")).toBe(true);
    expect(isPictureName("x.JPEG")).toBe(true);
    expect(isPictureName("x.pdf")).toBe(false);
  });
  it("sizes picture pages to Letter's width", () => {
    expect(picturePageSize({ w: 1000, h: 500 })).toEqual({ w: 612, h: 306 });
  });
  it("makes one page per PDF page, at its own size", () => {
    const pages = pdfPages("f.pdf", [{ w: 300, h: 400 }, { w: 500, h: 250 }]);
    expect(pages.map((page) => page.size)).toEqual([{ w: 300, h: 400 }, { w: 500, h: 250 }]);
    expect(pages[1].background).toEqual({ kind: "pdf", file: "f.pdf", index: 1 });
  });
  it("explains a password-protected PDF plainly", () => {
    const error = new Error("No password given");
    error.name = "PasswordException";
    expect(explainPdfError(error).message).toMatch(/password-protected/);
    expect(explainPdfError(new Error("boom")).message).toMatch(/couldn't be read/);
  });
});

describe("exportText", () => {
  const first = newPage(defaults), second = newPage(defaults, { background: { kind: "pdf", file: "a.pdf", index: 0 } });
  const items: PageItem[] = [
    { id: "b", kind: "text", string: "Lower", fontSize: 17, x: 100, y: 300, w: 100, h: 20, rotation: 0 },
    { id: "a", kind: "text", string: "milk\neggs", fontSize: 17, x: 100, y: 100, w: 100, h: 40, rotation: 0, list: "check", checked: [1] },
    { id: "l", kind: "link", label: "Docs", target: { to: "web", url: "https://example.com/" }, x: 100, y: 200, w: 100, h: 20, rotation: 0 },
    { id: "g", kind: "link", label: "", target: { to: "page", page: second.id }, x: 100, y: 250, w: 100, h: 20, rotation: 0 },
  ];
  first.items = items;
  second.marks = [{ id: "m", color: "yellow", rects: [[0, 0, 1, 1]], text: "an important line" }];
  const manifest = newManifest({ title: "Notes", defaults, pages: [first, second] });
  const words = { [first.id]: { text: "hand written" }, [second.id]: { text: "whole pdf text" } };

  it("writes Markdown with page headings, ticks, links and highlights", () => {
    const text = exportText(manifest, [first.id, second.id], { markdown: true, words });
    expect(text.startsWith("# Notes\n\n## Page 1\n\n")).toBe(true);
    expect(text).toContain("- [ ] milk\n- [x] eggs");
    expect(text.indexOf("milk")).toBeLessThan(text.indexOf("[Docs](https://example.com/)"));
    expect(text.indexOf("[Docs]")).toBeLessThan(text.indexOf("Lower"));
    expect(text).toContain("[Page 2](#page-2)");
    expect(text).toContain("*Handwriting:* hand written");
    expect(text).toContain("## Page 2\n\n> an important line");
    expect(text).not.toContain("whole pdf text");
  });
  it("writes plain text for chosen pages only", () => {
    const text = exportText(manifest, [second.id], { markdown: false });
    expect(text).toBe("Notes\n\nPage 2\n\nHighlighted: an important line\n");
  });
});

describe("timeline", () => {
  it("lays strokes in written order and caps pauses at 0.4 s", () => {
    const early = timed(1000, 1000), late = timed(1000 + 1000 + 60_000, 1000);
    const timeline = buildTimeline([late, early]);
    expect(timeline.strokes[0].stroke).toBe(early);
    // Natural length: 1000 + 400 + 1000 = 2400 ms, stretched to the 4 s minimum.
    expect(timeline.total).toBe(4000);
    const factor = 4000 / 2400;
    expect(timeline.strokes[1].start).toBeCloseTo(1400 * factor);
  });
  it("speeds a long session up to 20 s", () => {
    const strokes = Array.from({ length: 30 }, (_, i) => timed(i * 5000, 3000));
    expect(buildTimeline(strokes).total).toBe(20000);
  });
  it("leaves a length between 4 and 20 s as it was", () => {
    const timeline = buildTimeline([timed(0, 5000), timed(5000, 5000)]);
    expect(timeline.total).toBe(10000);
    expect(timeline.strokes[1].start).toBeCloseTo(5000);
  });
  it("shows ink only up to the moment, and a stroke partly written", () => {
    const stroke = timed(0, 1000);
    const timeline = buildTimeline([stroke, timed(100_000, 1000)]);
    expect(strokesAt(timeline, -1)).toEqual([]);
    const part = strokesAt(timeline, timeline.strokes[0].start + timeline.strokes[0].duration / 2);
    expect(part).toHaveLength(1);
    expect(part[0].pts.length).toBeLessThan(stroke.pts.length);
    expect(part[0].pts.length).toBeGreaterThan(0);
    expect(strokesAt(timeline, timeline.total)).toHaveLength(2);
    expect(writingTime(stroke)).toBe(1000);
  });
  it("copes with no ink", () => {
    expect(buildTimeline([]).total).toBe(4000);
  });
});
