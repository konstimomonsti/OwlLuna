// Draw and hold, scribble to erase, loop to select. Ported from OwlLuna/Canvas/ShapeSnap.swift and
// PencilGestures.swift. Pure geometry, so it is tested without a canvas.

import { pointInPolygon, type Point } from "../model/ink";
import type { ShapeKind } from "../model/tools";

export type SnappedShape =
  | { kind: "line"; a: Point; b: Point }
  | { kind: "arrow"; a: Point; b: Point; head: number }
  | { kind: "polyline"; points: Point[] }
  | { kind: "polygon"; points: Point[] }
  | { kind: "ellipse"; center: Point; rx: number; ry: number; rotation: number };

/** How long the pen has to rest at the end of a stroke, in milliseconds. */
export const holdDuration = 450;
/** How far the pen may drift and still be resting, in screen pixels. */
export const holdSlop = 6;

const deg = Math.PI / 180;
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 0.0001) return dist(p, a);
  const t = Math.min(Math.max(((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared, 0), 1);
  return dist(p, { x: a.x + t * dx, y: a.y + t * dy });
}

export function boundsOf(points: Point[]): { x: number; y: number; w: number; h: number } {
  if (points.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  let minX = points[0].x, maxX = minX, minY = points[0].y, maxY = minY;
  for (const point of points) {
    minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function pathLength(points: Point[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += dist(points[i - 1], points[i]);
  return total;
}

function resampled(points: Point[], limit: number): Point[] {
  if (points.length <= limit) return points;
  const out: Point[] = [];
  for (let i = 0; i < limit; i++) out.push(points[Math.round((i * (points.length - 1)) / (limit - 1))]);
  return out;
}

/** The middle of the points, and the angle of the line they spread furthest along. */
export function principalAxis(points: Point[]): { mean: Point; angle: number } {
  const n = Math.max(points.length, 1);
  const mean = { x: points.reduce((sum, p) => sum + p.x, 0) / n, y: points.reduce((sum, p) => sum + p.y, 0) / n };
  let xx = 0, yy = 0, xy = 0;
  for (const p of points) {
    const dx = p.x - mean.x, dy = p.y - mean.y;
    xx += dx * dx; yy += dy * dy; xy += dx * dy;
  }
  return { mean, angle: 0.5 * Math.atan2(2 * xy, xx - yy) };
}

/** Within three degrees of level or upright, a line is made exactly so. */
function squared(a: Point, b: Point): [Point, Point] {
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  const quarter = Math.PI / 2;
  const nearest = Math.round(angle / quarter) * quarter;
  if (Math.abs(angle - nearest) >= 3 * deg) return [a, b];
  const level = Math.abs(Math.cos(nearest)) > 0.5;
  return level ? [a, { x: b.x, y: a.y }] : [a, { x: a.x, y: b.y }];
}

/** Ramer, Douglas and Peucker: the fewest points that stay within `tolerance` of the path. */
export function simplified(points: Point[], tolerance: number): Point[] {
  if (points.length < 3) return points.slice();
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = keep[points.length - 1] = true;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [from, to] = stack.pop()!;
    let worst = 0, at = -1;
    for (let i = from + 1; i < to; i++) {
      const d = distanceToSegment(points[i], points[from], points[to]);
      if (d > worst) { worst = d; at = i; }
    }
    if (at !== -1 && worst > tolerance) {
      keep[at] = true;
      stack.push([from, at], [at, to]);
    }
  }
  return points.filter((_, index) => keep[index]);
}

const direction = (a: Point, b: Point) => Math.atan2(b.y - a.y, b.x - a.x);

function remainder(angle: number): number {
  let out = angle % (2 * Math.PI);
  if (out > Math.PI) out -= 2 * Math.PI;
  if (out < -Math.PI) out += 2 * Math.PI;
  return out;
}

/** The arrow these corners make tail first: a lone hook no longer than a third of the line, or a barb either side no longer than half. */
function pointed(corners: Point[], least: number): SnappedShape | null {
  if (corners.length !== 3 && corners.length !== 5) return null;
  const tail = corners[0], tip = corners[1];
  const barbs = corners.length === 3 ? [corners[2]] : [corners[2], corners[4]];
  if (corners.length === 5 && dist(corners[3], tip) > 0.4 * dist(corners[2], tip)) return null;
  const back = direction(tip, tail), shaft = dist(tail, tip);
  const turns = barbs.map((barb) => remainder(direction(tip, barb) - back));
  const heads = barbs.map((barb) => dist(tip, barb));
  const limit = (barbs.length === 1 ? 1 / 3 : 0.5) * shaft;
  if (!turns.every((turn) => Math.abs(turn) >= least && Math.abs(turn) <= 65 * deg)) return null;
  if (!heads.every((head) => head <= limit)) return null;
  if (turns.length === 2 && turns[0] * turns[1] >= 0) return null;
  const [a, b] = squared(tail, tip);
  return { kind: "arrow", a, b, head: heads.reduce((sum, head) => sum + head, 0) / heads.length };
}

function arrow(input: Point[], least = 10 * deg): SnappedShape | null {
  const corners = input.slice();
  const bend = corners.length === 4 ? remainder(direction(corners[1], corners[2]) - direction(corners[0], corners[1])) : Math.PI;
  if (Math.abs(bend) < 20 * deg) corners.splice(1, 1);
  return pointed(corners, least) ?? (corners.length === 5 ? pointed(corners.slice().reverse(), least) : null);
}

function closedAtStart(points: Point[], diagonal: number): Point[] {
  const first = points[0];
  let far = 0;
  for (let i = 0; i < points.length; i++) if (dist(points[i], first) > dist(points[far], first)) far = i;
  let back = far;
  for (let i = far; i < points.length; i++) if (dist(points[i], first) < dist(points[back], first)) back = i;
  for (let i = back; i < points.length; i++) if (dist(points[i], first) > 0.25 * diagonal) return points;
  return points.slice(0, back + 1);
}

function perimeter(corners: Point[]): number {
  return corners.reduce((sum, corner, index) => sum + dist(corner, corners[(index + 1) % corners.length]), 0);
}

/** A stroke that starts in the middle of a side leaves a corner there that isn't one. */
function withoutStraightCorners(corners: Point[]): Point[] {
  const result = corners.slice();
  let changed = true;
  while (changed && result.length > 3) {
    changed = false;
    for (let index = 0; index < result.length; index++) {
      const before = result[(index + result.length - 1) % result.length], here = result[index], after = result[(index + 1) % result.length];
      let turn = Math.abs(direction(before, here) - direction(here, after));
      if (turn > Math.PI) turn = 2 * Math.PI - turn;
      if (turn < 22 * deg || dist(before, here) < (0.08 * perimeter(result)) / result.length) {
        result.splice(index, 1);
        changed = true;
        break;
      }
    }
  }
  return result;
}

/** Mean distance from the drawn points to the outline through `corners`. */
function fit(points: Point[], corners: Point[], closed: boolean): number {
  if (corners.length < 2) return Infinity;
  const count = closed ? corners.length : corners.length - 1;
  let total = 0;
  for (const point of points) {
    let best = Infinity;
    for (let index = 0; index < count; index++) best = Math.min(best, distanceToSegment(point, corners[index], corners[(index + 1) % corners.length]));
    total += best;
  }
  return total / points.length;
}

export function rotatePoint(point: Point, centre: Point, angle: number): Point {
  const dx = point.x - centre.x, dy = point.y - centre.y;
  return { x: centre.x + dx * Math.cos(angle) - dy * Math.sin(angle), y: centre.y + dx * Math.sin(angle) + dy * Math.cos(angle) };
}

/** Four corners that are all close to square become a true rectangle, level if it was drawn nearly level. */
function rectangleFrom(corners: Point[]): Point[] | null {
  for (let index = 0; index < 4; index++) {
    const before = corners[(index + 3) % 4], here = corners[index], after = corners[(index + 1) % 4];
    const ax = before.x - here.x, ay = before.y - here.y, bx = after.x - here.x, by = after.y - here.y;
    const cosine = (ax * bx + ay * by) / Math.max(Math.hypot(ax, ay) * Math.hypot(bx, by), 0.001);
    if (Math.abs(cosine) >= 0.3) return null;
  }
  let longest: [Point, Point] = [corners[0], corners[1]];
  for (let index = 0; index < 4; index++) {
    if (dist(corners[index], corners[(index + 1) % 4]) > dist(longest[0], longest[1])) longest = [corners[index], corners[(index + 1) % 4]];
  }
  let angle = direction(longest[0], longest[1]);
  const quarter = Math.PI / 2;
  const nearest = Math.round(angle / quarter) * quarter;
  if (Math.abs(angle - nearest) < 7 * deg) angle = 0;
  else angle -= nearest;
  const centre = { x: corners.reduce((sum, c) => sum + c.x, 0) / 4, y: corners.reduce((sum, c) => sum + c.y, 0) / 4 };
  const level = corners.map((corner) => rotatePoint(corner, centre, -angle));
  const box = boundsOf(level);
  const xs = level.map((p) => p.x).sort((a, b) => a - b), ys = level.map((p) => p.y).sort((a, b) => a - b);
  const rect = { x: (xs[0] + xs[1]) / 2, y: (ys[0] + ys[1]) / 2, w: (xs[2] + xs[3] - xs[0] - xs[1]) / 2, h: (ys[2] + ys[3] - ys[0] - ys[1]) / 2 };
  if (rect.w <= 0.2 * box.w || rect.h <= 0.2 * box.h) return null;
  return [
    { x: rect.x, y: rect.y }, { x: rect.x + rect.w, y: rect.y }, { x: rect.x + rect.w, y: rect.y + rect.h }, { x: rect.x, y: rect.y + rect.h },
  ].map((corner) => rotatePoint(corner, centre, angle));
}

/** The ellipse round the points, level or along their longer direction, whichever they sit closer to. */
function bestEllipse(points: Point[], box: { x: number; y: number; w: number; h: number }): { shape: SnappedShape; error: number } {
  const measure = (pts: Point[], b: typeof box) => {
    const a = Math.max(b.w / 2, 1), c = Math.max(b.h / 2, 1);
    const midX = b.x + b.w / 2, midY = b.y + b.h / 2;
    const total = pts.reduce((sum, p) => sum + Math.abs(Math.hypot((p.x - midX) / a, (p.y - midY) / c) - 1), 0);
    return ((total / pts.length) * (a + c)) / 2;
  };
  const shape = (b: typeof box, centre: Point, rotation: number): SnappedShape => {
    let rx = b.w / 2, ry = b.h / 2;
    const round = Math.abs(rx - ry) / Math.max(rx, ry, 1) < 0.14;
    if (round) rx = ry = (rx + ry) / 2;
    return { kind: "ellipse", center: centre, rx, ry, rotation: round ? 0 : rotation };
  };
  const level = measure(points, box);
  const centre = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
  const { mean, angle } = principalAxis(points);
  if (Math.abs(angle) <= 8 * deg || Math.abs(Math.abs(angle) - Math.PI / 2) <= 8 * deg) return { shape: shape(box, centre, 0), error: level };
  const turned = points.map((p) => rotatePoint(p, mean, -angle));
  const turnedBox = boundsOf(turned);
  const tilted = measure(turned, turnedBox);
  if (tilted >= 0.8 * level) return { shape: shape(box, centre, 0), error: level };
  const turnedCentre = rotatePoint({ x: turnedBox.x + turnedBox.w / 2, y: turnedBox.y + turnedBox.h / 2 }, mean, angle);
  return { shape: shape(turnedBox, turnedCentre, angle), error: tilted };
}

/** The shape a hand-drawn stroke looks like, or null if it doesn't look like one. */
export function recognizeShape(raw: Point[]): SnappedShape | null {
  const points = resampled(raw, 240);
  if (points.length < 4) return null;
  const first = points[0], last = points[points.length - 1];
  const box = boundsOf(points);
  const diagonal = Math.hypot(box.w, box.h);
  if (diagonal < 24) return null;
  const gap = dist(first, last);
  // Measured in long steps, so a hand's small tremor doesn't count as distance travelled.
  let length = 0, from = first;
  const stride = Math.max(diagonal / 24, 6);
  for (let i = 1; i < points.length; i++) {
    if (dist(from, points[i]) >= stride || i === points.length - 1) {
      length += dist(from, points[i]);
      from = points[i];
    }
  }

  if (gap > Math.max(0.2 * diagonal, 16)) {
    const wander = Math.max(...points.map((p) => distanceToSegment(p, first, last)));
    if (gap / Math.max(length, 1) >= 0.93 && wander <= Math.max(0.07 * gap, 4)) {
      const fine = simplified(points, Math.max(0.4 * wander, 4));
      if (wander >= 8) {
        const hooked = arrow(fine, 15 * deg);
        if (hooked && hooked.kind === "arrow" && (fine.length === 5 || hooked.head >= 16)) return hooked;
      }
      const [a, b] = squared(first, last);
      return { kind: "line", a, b };
    }
    // Straight pieces keep the same corners when looked at more closely; a curve keeps gaining them.
    const tolerance = Math.max(0.045 * diagonal, 6);
    const corners = simplified(points, tolerance), closer = simplified(points, tolerance / 3);
    const fits = fit(points, corners, false) <= 0.022 * diagonal + 1.5;
    if (fits && corners.length >= 3 && corners.length <= 4 && closer.length === 5) {
      const small = arrow(closer);
      if (small) return small;
    }
    if (corners.length < 3 || corners.length > 8 || closer.length > corners.length + 1 || !fits) return null;
    return arrow(corners) ?? { kind: "polyline", points: corners };
  }

  const ellipse = bestEllipse(points, box);
  const ellipseError = ellipse.error / diagonal;
  const outline = closedAtStart(points, diagonal);
  let corners = simplified([...outline, first], Math.max(0.05 * diagonal, 6));
  if (corners.length > 1) corners.pop();
  corners = withoutStraightCorners(corners);
  const polygonError = corners.length >= 3 ? fit(outline, corners, true) / diagonal : Infinity;

  if (corners.length >= 3 && corners.length <= 4 && polygonError <= 0.035 && polygonError <= ellipseError) {
    return { kind: "polygon", points: corners.length === 4 ? rectangleFrom(corners) ?? corners : corners };
  }
  if (corners.length >= 5 && corners.length <= 12 && polygonError <= 0.02 && polygonError < 0.5 * ellipseError) return { kind: "polygon", points: corners };
  if (ellipseError <= 0.045) return ellipse.shape;
  return null;
}

/** Where an arrow's barbs end: `head` back from the tip, 30 degrees either side of the shaft. */
export function arrowBarbs(a: Point, b: Point, head: number): [Point, Point] {
  const back = direction(b, a);
  return [
    { x: b.x + Math.cos(back + 30 * deg) * head, y: b.y + Math.sin(back + 30 * deg) * head },
    { x: b.x + Math.cos(back - 30 * deg) * head, y: b.y + Math.sin(back - 30 * deg) * head },
  ];
}

function alongSegment(a: Point, b: Point, spacing = 6): Point[] {
  const count = Math.max(1, Math.ceil(dist(a, b) / spacing));
  return Array.from({ length: count + 1 }, (_, index) => ({ x: a.x + ((b.x - a.x) * index) / count, y: a.y + ((b.y - a.y) * index) / count }));
}

function alongPath(corners: Point[], closed: boolean): Point[] {
  const out: Point[] = [];
  const count = closed ? corners.length : corners.length - 1;
  for (let index = 0; index < count; index++) {
    const piece = alongSegment(corners[index], corners[(index + 1) % corners.length]);
    out.push(...(index === 0 ? piece : piece.slice(1)));
  }
  return out;
}

export function ellipsePoints(center: Point, rx: number, ry: number, rotation: number): Point[] {
  const count = Math.max(24, Math.min(160, Math.ceil((Math.PI * (rx + ry)) / 5)));
  const out: Point[] = [];
  for (let index = 0; index <= count; index++) {
    const angle = (index / count) * Math.PI * 2;
    out.push(rotatePoint({ x: center.x + Math.cos(angle) * rx, y: center.y + Math.sin(angle) * ry }, center, rotation));
  }
  return out;
}

/** The lines a shape is drawn with, each to become a stroke of even width. */
export function shapePolylines(shape: SnappedShape): Point[][] {
  switch (shape.kind) {
    case "line": return [alongSegment(shape.a, shape.b)];
    case "arrow": {
      const [left, right] = arrowBarbs(shape.a, shape.b, shape.head);
      return [alongSegment(shape.a, shape.b), alongPath([left, shape.b, right], false)];
    }
    case "polyline": return [alongPath(shape.points, false)];
    case "polygon": return [alongPath(shape.points, true)];
    case "ellipse": return [ellipsePoints(shape.center, shape.rx, shape.ry, shape.rotation)];
  }
}

/** The shape the Shapes tool drags out between two corners. Shift keeps it regular. */
export function draggedShape(kind: ShapeKind, from: Point, to: Point, regular = false): SnappedShape {
  let end = to;
  if (regular) {
    if (kind === "line" || kind === "arrow") {
      const angle = Math.round(direction(from, to) / (Math.PI / 12)) * (Math.PI / 12), length = dist(from, to);
      end = { x: from.x + Math.cos(angle) * length, y: from.y + Math.sin(angle) * length };
    } else {
      const side = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y));
      end = { x: from.x + Math.sign(to.x - from.x || 1) * side, y: from.y + Math.sign(to.y - from.y || 1) * side };
    }
  }
  const minX = Math.min(from.x, end.x), maxX = Math.max(from.x, end.x), minY = Math.min(from.y, end.y), maxY = Math.max(from.y, end.y);
  switch (kind) {
    case "line": return { kind: "line", a: from, b: end };
    case "arrow": return { kind: "arrow", a: from, b: end, head: Math.min(Math.max(dist(from, end) * 0.18, 8), 28) };
    case "circle": return { kind: "ellipse", center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 }, rx: (maxX - minX) / 2, ry: (maxY - minY) / 2, rotation: 0 };
    case "rectangle": return { kind: "polygon", points: [{ x: minX, y: minY }, { x: maxX, y: minY }, { x: maxX, y: maxY }, { x: minX, y: maxY }] };
    case "triangle": return { kind: "polygon", points: [{ x: (minX + maxX) / 2, y: minY }, { x: maxX, y: maxY }, { x: minX, y: maxY }] };
  }
}

// Scribble to erase

const minimumReversals = 5;
const density = 4;
const cover = 0.5;
const reach = 6;

/** Turns back along the stroke's longer direction, counted once the stroke has come back a good part of its length. */
export function reversals(points: Point[]): number {
  if (points.length < 3) return 0;
  const { mean, angle } = principalAxis(points);
  const along = points.map((p) => (p.x - mean.x) * Math.cos(angle) + (p.y - mean.y) * Math.sin(angle));
  const least = Math.min(...along), most = Math.max(...along);
  const step = Math.max(0.35 * (most - least), 8);
  let low = along[0], high = along[0], heading = 0, turns = 0;
  for (const value of along) {
    if (heading === 0) {
      low = Math.min(low, value);
      high = Math.max(high, value);
      if (value - low >= step) { heading = 1; high = value; }
      else if (high - value >= step) { heading = -1; low = value; }
    } else if (heading === 1) {
      if (value > high) high = value;
      else if (high - value >= step) { heading = -1; low = value; turns++; }
    } else {
      if (value < low) low = value;
      else if (value - low >= step) { heading = 1; high = value; turns++; }
    }
  }
  return turns;
}

/** A stroke that goes back and forth along its own length, again and again. */
export function isZigzag(points: Point[]): boolean {
  if (points.length < 8) return false;
  const box = boundsOf(points);
  const diagonal = Math.hypot(box.w, box.h);
  if (diagonal < 20 || pathLength(points) < density * diagonal) return false;
  return reversals(points) >= minimumReversals;
}

export function convexHull(points: Point[]): Point[] {
  const sorted = points.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  if (sorted.length < 3) return sorted;
  const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Point[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Point[] = [];
  for (const p of sorted.reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** The stroke as an outline, if its ends meet and it goes round some room: once round, or a little more. */
export function loopOutline(points: Point[]): Point[] | null {
  if (points.length < 8) return null;
  const first = points[0], last = points[points.length - 1];
  const box = boundsOf(points);
  const diagonal = Math.hypot(box.w, box.h);
  if (diagonal < 24 || dist(first, last) > Math.max(0.3 * diagonal, 20)) return null;
  let twice = 0, previous = last;
  for (const point of points) {
    twice += previous.x * point.y - point.x * previous.y;
    previous = point;
  }
  if (Math.abs(twice) / 2 < 0.3 * box.w * box.h) return null;
  if (pathLength(points) > 3 * (box.w + box.h)) return null;
  return points;
}

/**
 * The places in `strokes` of the ones the scribble scratches out; none if it is not a scribble or lies on bare paper.
 * Shading is left alone: an earlier zigzag under this one, or an outline this one is filling in.
 */
export function scribbleErased(scribble: Point[], strokes: Point[][]): number[] {
  if (!isZigzag(scribble)) return [];
  const hull = convexHull(scribble);
  const raw = boundsOf(scribble);
  const box = { x: raw.x - reach, y: raw.y - reach, w: raw.w + reach * 2, h: raw.h + reach * 2 };
  const isUnder = (point: Point) => {
    if (point.x < box.x || point.x > box.x + box.w || point.y < box.y || point.y > box.y + box.h) return false;
    if (pointInPolygon(point, hull)) return true;
    for (let i = 1; i < scribble.length; i++) if (distanceToSegment(point, scribble[i - 1], scribble[i]) <= reach) return true;
    return false;
  };
  const out: number[] = [];
  strokes.forEach((points, index) => {
    if (points.length === 0) return;
    const under = points.filter(isUnder).length;
    if (under < cover * points.length || isZigzag(points)) return;
    if (loopOutline(points) !== null) {
      const inside = scribble.filter((p) => pointInPolygon(p, points)).length;
      if (inside >= 0.7 * scribble.length) return;
    }
    out.push(index);
  });
  return out;
}
