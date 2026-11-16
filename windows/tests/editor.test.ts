import { describe, expect, it } from "vitest";
import { clampCrop, croppedItem } from "../src/editor/crop";
import { dropIndex } from "../src/editor/pageOrder";
import { advanceStrip, clampStrip, lineStepOf, magnification } from "../src/editor/zoomStrip";
import type { PictureItem } from "../src/model/notebook";

const picture = (patch: Partial<PictureItem> = {}): PictureItem => ({ id: "p", kind: "image", file: "a.png", x: 200, y: 100, w: 100, h: 80, rotation: 0, ...patch });

describe("croppedItem", () => {
  it("keeps the picture's scale and the visible part where it was", () => {
    const next = croppedItem(picture(), [0.5, 0, 0.5, 1]);
    // The right half is kept: it stays on the page where it was, so its centre moves right by a quarter of the width.
    expect(next.w).toBeCloseTo(50);
    expect(next.h).toBeCloseTo(80);
    expect(next.x).toBeCloseTo(225);
    expect(next.y).toBeCloseTo(100);
    expect(next.crop).toEqual([0.5, 0, 0.5, 1]);
  });
  it("works from an already cropped picture", () => {
    const first = croppedItem(picture(), [0.5, 0, 0.5, 1]);
    const widened = croppedItem(first, [0, 0, 1, 1]);
    expect(widened.w).toBeCloseTo(100);
    expect(widened.x).toBeCloseTo(200);
    expect(widened.crop).toBeUndefined();
  });
  it("moves the centre along the turned axes", () => {
    const next = croppedItem(picture({ rotation: Math.PI / 2 }), [0.5, 0, 0.5, 1]);
    // Local +x is page +y after a quarter turn.
    expect(next.x).toBeCloseTo(200);
    expect(next.y).toBeCloseTo(125);
  });
});

describe("clampCrop", () => {
  it("stays inside the picture and never collapses", () => {
    expect(clampCrop([-0.2, 0.9, 0.5, 0.5])).toEqual([0, 0.5, 0.5, 0.5]);
    expect(clampCrop([0.5, 0.5, 0, 0])[2]).toBeGreaterThan(0);
  });
});

describe("dropIndex", () => {
  const order = ["a", "b", "c", "d"];
  it("counts only the pages that stay", () => {
    expect(dropIndex(order, ["a"], 3)).toBe(2);
    expect(dropIndex(order, ["d"], 0)).toBe(0);
    expect(dropIndex(order, ["b"], 4)).toBe(3);
  });
  it("moves a group together", () => {
    expect(dropIndex(order, ["a", "b"], 4)).toBe(2);
  });
});

describe("zoom strip", () => {
  const page = { size: { w: 600, h: 800 }, background: { kind: "template", template: "narrowRuled" } };
  it("magnifies three times the zoom, never under two", () => {
    expect(magnification(1)).toBe(3);
    expect(magnification(0.5)).toBe(2);
  });
  it("stays on the page", () => {
    expect(clampStrip({ x: -5, y: 790, w: 200, h: 60 }, page)).toEqual({ x: 0, y: 740, w: 200, h: 60 });
    expect(clampStrip({ x: -5, y: -9, w: 200, h: 60 }, { ...page, edgeless: true })).toEqual({ x: -5, y: -9, w: 200, h: 60 });
  });
  it("advances by 60% of its width, then wraps to the next line", () => {
    const first = advanceStrip({ x: 0, y: 100, w: 200, h: 60 }, page, 28);
    expect(first.x).toBeCloseTo(120);
    expect(first.y).toBe(100);
    const near = advanceStrip({ x: 300, y: 100, w: 200, h: 60 }, page, 28);
    expect(near.x).toBe(400);
    const wrapped = advanceStrip({ x: 400, y: 100, w: 200, h: 60 }, page, 28);
    expect(wrapped).toEqual({ x: 0, y: 128, w: 200, h: 60 });
  });
  it("steps a line by the ruling scaled to the page, or 30 points", () => {
    expect(lineStepOf(page)).toBeCloseTo(28 * (600 / 800));
    expect(lineStepOf({ size: { w: 600 }, background: { kind: "template", template: "blank" } })).toBe(30);
    expect(lineStepOf({ size: { w: 600 }, background: { kind: "pdf" } })).toBe(30);
  });
});
