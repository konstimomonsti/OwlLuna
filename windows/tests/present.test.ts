import { describe, expect, it } from "vitest";
import { placeBelow, placeOver, strokesToRead, textBoxSize } from "../src/editor/inkText";
import { makeStroke } from "../src/model/ink";
import { Dedupe, fitBox, formatTimer, fromFraction, isEnvelope, LaserBatch, neighbourPage, pauseTimer, resetTimer, resumeTimer, startTimer, timerElapsed, toFraction } from "../src/present/logic";

describe("laser points between windows", () => {
  const presenter = { left: 100, top: 50, width: 600, height: 800 };
  const audience = { left: 0, top: 120, width: 1200, height: 1600 };

  it("turns a point on the page into fractions of it", () => {
    expect(toFraction({ x: 400, y: 450 }, presenter)).toEqual({ x: 0.5, y: 0.5 });
    expect(toFraction({ x: 100, y: 50 }, presenter)).toEqual({ x: 0, y: 0 });
  });

  it("lands in the same place of a page drawn at another size", () => {
    const there = fromFraction(toFraction({ x: 250, y: 250 }, presenter), audience);
    expect(there).toEqual({ x: 300, y: 520 });
  });

  it("allows points off the page, and survives an empty box", () => {
    expect(toFraction({ x: 50, y: 50 }, presenter).x).toBeLessThan(0);
    expect(toFraction({ x: 5, y: 5 }, { left: 0, top: 0, width: 0, height: 0 })).toEqual({ x: 0, y: 0 });
  });

  it("fits a page to a window and centres it", () => {
    expect(fitBox({ w: 600, h: 800 }, { w: 1000, h: 800 })).toEqual({ left: 200, top: 0, width: 600, height: 800 });
    expect(fitBox({ w: 600, h: 800 }, { w: 300, h: 1000 })).toEqual({ left: 0, top: 300, width: 300, height: 400 });
    expect(fitBox({ w: 0, h: 800 }, { w: 300, h: 1000 }).width).toBe(0);
  });

  it("sends at most about thirty batches a second", () => {
    const batch = new LaserBatch(30);
    expect(batch.add({ x: 0, y: 0 }, 1000)).toEqual([{ x: 0, y: 0 }]);
    expect(batch.add({ x: 0.1, y: 0 }, 1010)).toBeNull();
    expect(batch.add({ x: 0.2, y: 0 }, 1020)).toBeNull();
    expect(batch.waiting).toBe(2);
    const sent = batch.add({ x: 0.3, y: 0 }, 1040);
    expect(sent).toHaveLength(3);
    expect(batch.flush(1050)).toBeNull();
  });
});

describe("the presenter's timer", () => {
  it("counts while running, holds while paused, and carries on from where it was", () => {
    let timer = startTimer(1000);
    expect(timerElapsed(timer, 4000)).toBe(3000);
    timer = pauseTimer(timer, 4000);
    expect(timerElapsed(timer, 9000)).toBe(3000);
    timer = resumeTimer(timer, 10_000);
    expect(timerElapsed(timer, 12_000)).toBe(5000);
  });
  it("resets to zero and keeps running or staying paused", () => {
    const running = resetTimer(startTimer(0), 5000);
    expect(timerElapsed(running, 6000)).toBe(1000);
    const paused = resetTimer(pauseTimer(startTimer(0), 5000), 6000);
    expect(timerElapsed(paused, 99_000)).toBe(0);
    expect(paused.since).toBeNull();
  });
  it("formats minutes and seconds, then hours", () => {
    expect(formatTimer(0)).toBe("00:00");
    expect(formatTimer(61_000)).toBe("01:01");
    expect(formatTimer(3_599_999)).toBe("59:59");
    expect(formatTimer(3_725_000)).toBe("1:02:05");
    expect(formatTimer(-5)).toBe("00:00");
  });
});

describe("turning pages", () => {
  const pages = [{ id: "a" }, { id: "b" }, { id: "c" }];
  it("goes to the next and previous page and stops at the ends", () => {
    expect(neighbourPage(pages, "a", 1)).toBe("b");
    expect(neighbourPage(pages, "b", -1)).toBe("a");
    expect(neighbourPage(pages, "c", 1)).toBeNull();
    expect(neighbourPage(pages, "a", -1)).toBeNull();
  });
  it("starts from the first page when the current one is gone", () => {
    expect(neighbourPage(pages, "zzz", 1)).toBe("a");
    expect(neighbourPage([], "a", 1)).toBeNull();
  });
});

describe("messages between windows", () => {
  it("lets each message through once", () => {
    const dedupe = new Dedupe();
    const message = { from: "p", n: 1, message: { type: "end" as const } };
    expect(dedupe.fresh(message)).toBe(true);
    expect(dedupe.fresh(message)).toBe(false);
    expect(dedupe.fresh({ ...message, n: 2 })).toBe(true);
    expect(dedupe.fresh({ ...message, n: 1 })).toBe(false);
    expect(dedupe.fresh({ from: "q", n: 1, message: { type: "hello" } })).toBe(true);
  });
  it("recognises its own envelopes", () => {
    expect(isEnvelope({ from: "p", n: 1, message: { type: "end" } })).toBe(true);
    expect(isEnvelope({ type: "end" })).toBe(false);
    expect(isEnvelope(null)).toBe(false);
  });
});

describe("handwriting to text placement", () => {
  const page = { size: { w: 612, h: 792 }, edgeless: undefined };
  const bounds = { x: 100, y: 200, w: 300, h: 40 };

  it("sizes a box for its words", () => {
    expect(textBoxSize("hi").w).toBe(120);
    expect(textBoxSize("x".repeat(200)).w).toBe(420);
    expect(textBoxSize("a\nb\nc").h).toBeGreaterThan(textBoxSize("a").h * 2);
  });

  it("places a box below the writing, left edges together", () => {
    const box = placeBelow(bounds, "hello there", page);
    expect(box.x - box.w / 2).toBeCloseTo(100);
    expect(box.y - box.h / 2).toBeGreaterThan(240);
  });

  it("puts a box where the writing was, top left corner together", () => {
    const box = placeOver(bounds, "hello there", page);
    expect(box.x - box.w / 2).toBeCloseTo(100);
    expect(box.y - box.h / 2).toBeCloseTo(200);
    expect(box.w).toBe(300);
  });

  it("keeps boxes on the page, but not on a whiteboard", () => {
    const low = placeBelow({ x: 100, y: 780, w: 50, h: 10 }, "hello", page);
    expect(low.y + low.h / 2).toBeLessThanOrEqual(792);
    const board = placeBelow({ x: 100, y: 780, w: 50, h: 10 }, "hello", { size: { w: 612, h: 792 }, edgeless: true });
    expect(board.y - board.h / 2).toBeGreaterThan(780);
  });

  it("reads the selection if there is one, else the page's ink", () => {
    const a = makeStroke("pen", 0, 2, [{ x: 0, y: 0 }, { x: 5, y: 5 }]);
    const b = makeStroke("pen", 0, 2, [{ x: 9, y: 9 }, { x: 15, y: 15 }]);
    const inkOf = (id: string) => (id === "p1" ? [a, b] : []);
    expect(strokesToRead(inkOf, null, "p1")).toEqual({ pageID: "p1", strokes: [a, b] });
    expect(strokesToRead(inkOf, { pageID: "p1", ids: [b.id] }, "p2")).toEqual({ pageID: "p1", strokes: [b] });
  });
});
