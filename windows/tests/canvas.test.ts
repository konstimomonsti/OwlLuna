import { describe, expect, it } from "vitest";
import { makeStroke, type Point } from "../src/model/ink";
import { displayColor, hasPressure, polygonPath, strokeOutline, strokePath } from "../src/canvas/strokeGeometry";
import { boardOps, lineGap, templateOps, templateLabels } from "../src/canvas/templates";
import { draggedShape, isZigzag, loopOutline, recognizeShape, scribbleErased, shapePolylines, simplified } from "../src/canvas/shapeSnap";
import { inkKinds } from "../src/model/tools";
import { paperColors, paperTemplates, pageSizePoints } from "../src/model/paper";

const wobble = (i: number) => Math.sin(i * 12.9898) * 0.8;
function path(corners: Point[], closed = false, step = 3): Point[] {
  const out: Point[] = [];
  const count = closed ? corners.length : corners.length - 1;
  for (let c = 0; c < count; c++) {
    const a = corners[c], b = corners[(c + 1) % corners.length];
    const n = Math.max(2, Math.round(Math.hypot(b.x - a.x, b.y - a.y) / step));
    for (let i = 0; i < n; i++) out.push({ x: a.x + ((b.x - a.x) * i) / n + wobble(out.length), y: a.y + ((b.y - a.y) * i) / n + wobble(out.length + 7) });
  }
  const last = closed ? corners[0] : corners[corners.length - 1];
  out.push({ x: last.x, y: last.y });
  return out;
}
const circle = (cx: number, cy: number, rx: number, ry = rx, turns = 1) =>
  Array.from({ length: 80 }, (_, i) => ({ x: cx + Math.cos((i / 79) * Math.PI * 2 * turns) * rx + wobble(i), y: cy + Math.sin((i / 79) * Math.PI * 2 * turns) * ry + wobble(i + 3) }));

describe("stroke outlines", () => {
  it("gives every ink kind a filled outline round its line", () => {
    for (const ink of inkKinds) {
      const stroke = { ...makeStroke(ink, 0x1b2230ff, 6, path([{ x: 10, y: 10 }, { x: 110, y: 40 }])), even: undefined };
      const polys = strokeOutline(stroke);
      expect(polys.length, ink).toBeGreaterThan(0);
      const xs = polys.flatMap((poly) => poly.filter((_, i) => i % 2 === 0));
      expect(Math.min(...xs), ink).toBeLessThan(14);
      expect(Math.max(...xs), ink).toBeGreaterThan(104);
      expect(polys.flat().every(Number.isFinite), ink).toBe(true);
      expect(strokePath(stroke), ink).toMatch(/^M[-\d.]+ [-\d.]+/);
    }
  });
  it("draws a single point as a dot of the pen's width", () => {
    const dot = makeStroke("pen", 0xff, 8, [{ x: 50, y: 50 }]);
    const [poly] = strokeOutline(dot);
    const xs = poly.filter((_, i) => i % 2 === 0);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(8, 0);
  });
  it("keeps a straightened shape at one width", () => {
    const line = makeStroke("pen", 0xff, 4, path([{ x: 0, y: 50 }, { x: 200, y: 50 }]).map((p) => ({ x: p.x, y: 50 })));
    const ys = strokeOutline(line)[0].filter((_, i) => i % 2 === 1);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(4, 0);
  });
  it("tells real pressure from a mouse's", () => {
    const flat = makeStroke("pen", 0xff, 2, [{ x: 0, y: 0 }, { x: 5, y: 5 }]);
    expect(hasPressure(flat)).toBe(false);
    expect(hasPressure({ ...flat, pts: [0, 0, 0.2, 0, 5, 5, 0.9, 8] })).toBe(true);
  });
  it("caches a path against its stroke and closes each piece", () => {
    const stroke = makeStroke("highlighter", 0xff, 12, path([{ x: 0, y: 0 }, { x: 90, y: 0 }]));
    expect(strokePath(stroke)).toBe(strokePath(stroke));
    expect(polygonPath([0, 0, 10, 0, 10, 10], false)).toBe("M0 0L10 0L10 10Z");
    expect(polygonPath([0, 0, 10, 0])).toBe("");
  });
  it("lightens dark ink on dark paper and leaves the rest", () => {
    expect(displayColor(0x1b2230ff, false)).toBe(0x1b2230ff);
    const light = displayColor(0x1b2230ff, true);
    expect((light >>> 24) & 0xff).toBeGreaterThan(190);
    expect(light & 0xff).toBe(0xff);
    expect(displayColor(0xffd426ff, true)).toBe(0xffd426ff);
    const blue = displayColor(0x2747b880, true);
    expect((blue >>> 8) & 0xff).toBeGreaterThan((blue >>> 24) & 0xff);
    expect(blue & 0xff).toBe(0x80);
  });
});

describe("templates", () => {
  it("draws every template on every paper without a stray number", () => {
    for (const template of paperTemplates) {
      for (const color of paperColors) {
        for (const size of Object.values(pageSizePoints)) {
          const ops = templateOps(template, color, size);
          if (template === "blank") expect(ops).toEqual([]);
          else expect(ops.length, template).toBeGreaterThan(0);
          for (const op of ops) {
            const numbers = op.op === "lines" ? op.segs : op.op === "dots" ? op.pts : op.op === "rects" ? op.rects : [op.x, op.y, op.size];
            expect(numbers.every(Number.isFinite), template).toBe(true);
            expect(op.color.every((value) => value >= 0 && value <= 1), template).toBe(true);
          }
        }
      }
    }
  });
  it("rules narrow paper every 28 units from 120, with a margin line at 104", () => {
    const size = { w: 800, h: 1000 };
    const [lines, margin] = templateOps("narrowRuled", "white", size) as any[];
    expect(lines.segs.slice(0, 4)).toEqual([0, 120, 800, 120]);
    expect(lines.segs[5] - lines.segs[1]).toBe(28);
    expect(Math.max(...lines.segs.filter((_: number, i: number) => i % 2 === 1))).toBeLessThan(980);
    expect(margin.segs).toEqual([104, 0, 104, 1000]);
    expect(lineGap("wideRuled")).toBe(38);
  });
  it("keeps every rule on the page", () => {
    for (const template of paperTemplates) {
      const size = pageSizePoints.a4;
      for (const op of templateOps(template, "white", size)) {
        if (op.op !== "lines") continue;
        for (let i = 0; i < op.segs.length; i += 2) {
          expect(op.segs[i], template).toBeGreaterThanOrEqual(-0.01);
          expect(op.segs[i], template).toBeLessThanOrEqual(size.w + 0.01);
          expect(op.segs[i + 1], template).toBeGreaterThanOrEqual(-0.01);
          expect(op.segs[i + 1], template).toBeLessThanOrEqual(size.h + 0.01);
        }
      }
    }
  });
  it("labels the planners", () => {
    const labels = templateLabels("en-US");
    expect(labels.hours).toHaveLength(15);
    expect(labels.hours[0]).toBe("7 AM");
    expect(labels.days).toEqual(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday", "Notes"]);
    const texts = templateOps("weekPlanner", "white", pageSizePoints.letter, labels).filter((op) => op.op === "text");
    expect(texts).toHaveLength(8);
    expect(templateOps("dayPlanner", "white", pageSizePoints.letter, labels).filter((op) => op.op === "text")).toHaveLength(15);
  });
  it("rules a whiteboard only where it shows, thinning the rules when zoomed out", () => {
    const near = boardOps("grid", "white", { x: -1000, y: 5000, w: 400, h: 300 }, 1) as any[];
    expect(near).toHaveLength(1);
    const xs = near[0].segs.filter((_: number, i: number) => i % 2 === 0);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(-1000 - 40);
    expect(Math.max(...xs)).toBeLessThanOrEqual(-600 + 40);
    const far = boardOps("grid", "white", { x: 0, y: 0, w: 4000, h: 3000 }, 0.1) as any[];
    expect(far[0].segs.length).toBeLessThan(near[0].segs.length * 4);
    expect(boardOps("music", "white", { x: 0, y: 0, w: 100, h: 100 }, 1)).toEqual([]);
    expect(boardOps("dotted", "white", { x: 0, y: 0, w: 100, h: 100 }, 1)[0].op).toBe("dots");
  });
});

describe("draw and hold", () => {
  it("straightens a line and levels one drawn nearly level", () => {
    const shape = recognizeShape(path([{ x: 10, y: 100 }, { x: 210, y: 103 }]))!;
    expect(shape.kind).toBe("line");
    if (shape.kind === "line") expect(shape.b.y).toBe(shape.a.y);
    const slanted = recognizeShape(path([{ x: 10, y: 10 }, { x: 150, y: 120 }]))!;
    expect(slanted.kind).toBe("line");
    if (slanted.kind === "line") expect(slanted.b.y).not.toBe(slanted.a.y);
  });
  it("reads a hooked line as an arrow", () => {
    const shape = recognizeShape(path([{ x: 10, y: 100 }, { x: 210, y: 100 }, { x: 180, y: 78 }]))!;
    expect(shape.kind).toBe("arrow");
    if (shape.kind === "arrow") {
      expect(shape.b.x).toBeCloseTo(210, -1);
      expect(shape.head).toBeGreaterThan(20);
    }
    const barbed = recognizeShape(path([{ x: 10, y: 100 }, { x: 210, y: 100 }, { x: 185, y: 80 }, { x: 210, y: 100 }, { x: 185, y: 120 }]))!;
    expect(barbed.kind).toBe("arrow");
  });
  it("reads rectangles, triangles and circles", () => {
    const rect = recognizeShape(path([{ x: 20, y: 22 }, { x: 180, y: 18 }, { x: 183, y: 120 }, { x: 18, y: 118 }], true))!;
    expect(rect.kind).toBe("polygon");
    if (rect.kind === "polygon") {
      expect(rect.points).toHaveLength(4);
      expect(rect.points[0].y).toBeCloseTo(rect.points[1].y, 5);
      expect(rect.points[1].x).toBeCloseTo(rect.points[2].x, 5);
    }
    const tri = recognizeShape(path([{ x: 100, y: 10 }, { x: 190, y: 150 }, { x: 10, y: 150 }], true))!;
    expect(tri.kind).toBe("polygon");
    if (tri.kind === "polygon") expect(tri.points).toHaveLength(3);
    const round = recognizeShape(circle(100, 100, 60, 57))!;
    expect(round.kind).toBe("ellipse");
    if (round.kind === "ellipse") {
      expect(round.rx).toBe(round.ry);
      expect(round.center.x).toBeCloseTo(100, 0);
    }
    const oval = recognizeShape(circle(100, 100, 90, 40))!;
    expect(oval.kind === "ellipse" && oval.rx > oval.ry * 1.8).toBe(true);
  });
  it("lets handwriting and tiny marks go", () => {
    expect(recognizeShape(path([{ x: 0, y: 0 }, { x: 8, y: 6 }]))).toBeNull();
    const wave = Array.from({ length: 120 }, (_, i) => ({ x: i * 2, y: 50 + Math.sin(i / 6) * 25 }));
    expect(recognizeShape(wave)).toBeNull();
    expect(recognizeShape([{ x: 0, y: 0 }, { x: 50, y: 50 }])).toBeNull();
  });
  it("draws shapes as lines to be stroked", () => {
    const arrow = shapePolylines({ kind: "arrow", a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, head: 20 });
    expect(arrow).toHaveLength(2);
    const barbs = arrow[1];
    expect(barbs[0].x).toBeCloseTo(100 - 20 * Math.cos(Math.PI / 6));
    expect(Math.abs(barbs[0].y)).toBeCloseTo(10);
    const box = shapePolylines(draggedShape("rectangle", { x: 0, y: 0 }, { x: 40, y: 20 }))[0];
    expect(box[0]).toEqual(box[box.length - 1]);
    const ring = shapePolylines(draggedShape("circle", { x: 0, y: 0 }, { x: 40, y: 40 }))[0];
    expect(ring.every((p) => Math.abs(Math.hypot(p.x - 20, p.y - 20) - 20) < 0.001)).toBe(true);
    const square = draggedShape("rectangle", { x: 0, y: 0 }, { x: 40, y: 22 }, true);
    expect(square.kind === "polygon" && square.points[2]).toEqual({ x: 40, y: 40 });
    const snapped = draggedShape("line", { x: 0, y: 0 }, { x: 100, y: 4 }, true);
    expect(snapped.kind === "line" && Math.abs(snapped.b.y)).toBeLessThan(0.001);
    expect(shapePolylines(draggedShape("triangle", { x: 0, y: 0 }, { x: 40, y: 40 }))[0].length).toBeGreaterThan(6);
  });
  it("simplifies a path to its corners", () => {
    expect(simplified(path([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }]), 5)).toHaveLength(3);
  });
});

describe("pencil gestures", () => {
  const zigzag = (x0: number, x1: number, y: number, passes = 8) =>
    path(Array.from({ length: passes + 1 }, (_, i) => ({ x: i % 2 === 0 ? x0 : x1, y: y + i * 2 })));
  it("knows a scribble from writing", () => {
    expect(isZigzag(zigzag(0, 100, 50))).toBe(true);
    expect(isZigzag(path([{ x: 0, y: 0 }, { x: 100, y: 0 }]))).toBe(false);
    expect(isZigzag(circle(50, 50, 40))).toBe(false);
    expect(isZigzag(zigzag(0, 100, 50, 3))).toBe(false);
  });
  it("erases what lies under a scribble and nothing else", () => {
    const word = path([{ x: 20, y: 52 }, { x: 80, y: 56 }]);
    const elsewhere = path([{ x: 300, y: 300 }, { x: 380, y: 300 }]);
    const halfUnder = path([{ x: 60, y: 55 }, { x: 400, y: 55 }]);
    expect(scribbleErased(zigzag(0, 100, 50), [word, elsewhere, halfUnder])).toEqual([0]);
    expect(scribbleErased(path([{ x: 0, y: 50 }, { x: 100, y: 50 }]), [word])).toEqual([]);
    expect(scribbleErased(zigzag(0, 100, 50), [elsewhere])).toEqual([]);
  });
  it("leaves shading alone: an outline being filled in, or an earlier zigzag", () => {
    const outline = circle(50, 58, 70, 30);
    expect(scribbleErased(zigzag(10, 90, 50), [outline])).toEqual([]);
    expect(scribbleErased(zigzag(0, 100, 50), [zigzag(5, 95, 51)])).toEqual([]);
  });
  it("reads a loop once round, not a line or a spiral", () => {
    expect(loopOutline(circle(100, 100, 50))).not.toBeNull();
    expect(loopOutline(path([{ x: 0, y: 0 }, { x: 100, y: 0 }]))).toBeNull();
    expect(loopOutline(circle(100, 100, 50, 50, 4))).toBeNull();
    expect(loopOutline(circle(100, 100, 50).slice(0, 40))).toBeNull();
  });
});
