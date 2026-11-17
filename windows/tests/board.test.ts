import { describe, expect, it } from "vitest";
import { BOARD_MAX_ZOOM, BOARD_MIN_ZOOM, boardContentBounds, fitBoard, itemBounds } from "../src/canvas/board";
import { makeStroke } from "../src/model/ink";
import type { PageItem } from "../src/model/notebook";

const sticker = (patch: Partial<PageItem> = {}): PageItem => ({ id: "a", kind: "sticker", name: "star", x: 0, y: 0, w: 100, h: 50, rotation: 0, ...patch }) as PageItem;
const line = (x0: number, y0: number, x1: number, y1: number) => makeStroke("pen", 0, 2, [{ x: x0, y: y0 }, { x: x1, y: y1 }]);

describe("boardContentBounds", () => {
  it("is null for an empty board", () => {
    expect(boardContentBounds([], [])).toBeNull();
  });
  it("covers ink and items together, including negative coordinates", () => {
    const box = boardContentBounds([line(-200, -100, -150, -50)], [sticker({ x: 300, y: 200 })])!;
    expect(box.x).toBeLessThanOrEqual(-200);
    expect(box.y).toBeLessThanOrEqual(-100);
    expect(box.x + box.w).toBeGreaterThanOrEqual(350);
    expect(box.y + box.h).toBeGreaterThanOrEqual(225);
  });
  it("uses the turned box of a rotated item", () => {
    const box = itemBounds(sticker({ rotation: Math.PI / 2 }));
    expect(box.w).toBeCloseTo(50);
    expect(box.h).toBeCloseTo(100);
    const diagonal = itemBounds(sticker({ rotation: Math.PI / 4 }));
    expect(diagonal.w).toBeCloseTo((100 + 50) * Math.SQRT1_2);
    expect(diagonal.x + diagonal.w / 2).toBeCloseTo(0);
  });
});

describe("fitBoard", () => {
  const view = { w: 800, h: 600 };
  it("centres the content", () => {
    const { zoom, origin } = fitBoard({ x: 1000, y: 1000, w: 800, h: 400 }, view);
    expect(origin.x + view.w / zoom / 2).toBeCloseTo(1400);
    expect(origin.y + view.h / zoom / 2).toBeCloseTo(1200);
    expect(zoom).toBeCloseTo((800 - 96) / 800);
  });
  it("stops zooming in at 2 for a single dot", () => {
    const { zoom, origin } = fitBoard({ x: 10, y: 20, w: 0, h: 0 }, view);
    expect(zoom).toBe(2);
    expect(origin.x + view.w / zoom / 2).toBeCloseTo(10);
  });
  it("stops zooming in at 2 for tiny content", () => {
    expect(fitBoard({ x: 0, y: 0, w: 5, h: 5 }, view).zoom).toBe(2);
  });
  it("stops zooming out at the minimum for huge content, still centred", () => {
    const { zoom, origin } = fitBoard({ x: -1e6, y: -1e6, w: 2e6, h: 2e6 }, view);
    expect(zoom).toBe(BOARD_MIN_ZOOM);
    expect(origin.x + view.w / zoom / 2).toBeCloseTo(0);
    expect(origin.y + view.h / zoom / 2).toBeCloseTo(0);
  });
  it("copes with a view smaller than the padding", () => {
    const { zoom } = fitBoard({ x: 0, y: 0, w: 100, h: 100 }, { w: 40, h: 40 });
    expect(zoom).toBeGreaterThanOrEqual(BOARD_MIN_ZOOM);
    expect(zoom).toBeLessThanOrEqual(BOARD_MAX_ZOOM);
  });
});
