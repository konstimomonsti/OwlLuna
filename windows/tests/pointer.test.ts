import { describe, expect, it } from "vitest";
import { capturePointer, stepsAlong } from "../src/canvas/pointer";

describe("stepsAlong", () => {
  it("ends exactly at the target and never steps further than asked", () => {
    const steps = stepsAlong({ x: 0, y: 0 }, { x: 100, y: 0 }, 10);
    expect(steps).toHaveLength(10);
    expect(steps[steps.length - 1]).toEqual({ x: 100, y: 0 });
    let last = { x: 0, y: 0 };
    for (const point of steps) {
      expect(Math.hypot(point.x - last.x, point.y - last.y)).toBeLessThanOrEqual(10.0001);
      last = point;
    }
  });
  it("gives just the target when the pointer has not moved", () => {
    expect(stepsAlong({ x: 5, y: 5 }, { x: 5, y: 5 }, 4)).toEqual([{ x: 5, y: 5 }]);
  });
  it("covers diagonal moves", () => {
    const steps = stepsAlong({ x: 0, y: 0 }, { x: 30, y: 40 }, 5);
    expect(steps).toHaveLength(10);
  });
  it("does not loop for a zero step", () => {
    expect(stepsAlong({ x: 0, y: 0 }, { x: 10, y: 0 }, 0)).toEqual([{ x: 10, y: 0 }]);
  });
});

describe("capturePointer", () => {
  it("swallows the error of a missing pointer", () => {
    const element = { setPointerCapture: () => { throw new Error("NotFoundError"); } } as unknown as Element;
    expect(() => capturePointer(element, 7)).not.toThrow();
    expect(() => capturePointer(null, 7)).not.toThrow();
  });
});
