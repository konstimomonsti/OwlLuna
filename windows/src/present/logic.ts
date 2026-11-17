// The parts of presenting that are only arithmetic: where a laser point lands in another window, the timer, and
// which page comes next. The messages between the presenter's window and the audience's are described here too.

import type { Page } from "../model/notebook";

/** A point as a fraction of the page's box, so it lands in the same place whatever size the other window draws the page at. */
export interface Fraction { x: number; y: number }

export interface Box { left: number; top: number; width: number; height: number }

export function toFraction(point: { x: number; y: number }, box: Box): Fraction {
  return { x: box.width > 0 ? (point.x - box.left) / box.width : 0, y: box.height > 0 ? (point.y - box.top) / box.height : 0 };
}

export function fromFraction(fraction: Fraction, box: Box): { x: number; y: number } {
  return { x: box.left + fraction.x * box.width, y: box.top + fraction.y * box.height };
}

/** The largest box of a page's proportions that fits in a window, centred in it. */
export function fitBox(page: { w: number; h: number }, window: { w: number; h: number }): Box {
  if (page.w <= 0 || page.h <= 0 || window.w <= 0 || window.h <= 0) return { left: 0, top: 0, width: 0, height: 0 };
  const scale = Math.min(window.w / page.w, window.h / page.h);
  const width = page.w * scale, height = page.h * scale;
  return { left: (window.w - width) / 2, top: (window.h - height) / 2, width, height };
}

// Timer

export interface TimerState {
  /** Milliseconds counted before the current run. */
  before: number;
  /** When the current run began, or null while paused. */
  since: number | null;
}

export function startTimer(now: number): TimerState {
  return { before: 0, since: now };
}

export function timerElapsed(timer: TimerState, now: number): number {
  return timer.before + (timer.since === null ? 0 : Math.max(now - timer.since, 0));
}

export function pauseTimer(timer: TimerState, now: number): TimerState {
  return timer.since === null ? timer : { before: timerElapsed(timer, now), since: null };
}

export function resumeTimer(timer: TimerState, now: number): TimerState {
  return timer.since === null ? { before: timer.before, since: now } : timer;
}

export function resetTimer(timer: TimerState, now: number): TimerState {
  return { before: 0, since: timer.since === null ? null : now };
}

/** "07:42", or "1:02:09" past an hour. */
export function formatTimer(ms: number): string {
  const whole = Math.max(Math.floor(ms / 1000), 0);
  const h = Math.floor(whole / 3600), m = Math.floor((whole % 3600) / 60), s = whole % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

// Pages

/** The page one step on, or null at the end. */
export function neighbourPage(pages: Pick<Page, "id">[], currentID: string, direction: 1 | -1): string | null {
  const index = pages.findIndex((page) => page.id === currentID);
  if (index === -1) return pages[0]?.id ?? null;
  return pages[index + direction]?.id ?? null;
}

// Messages

export type PresentMessage =
  | { type: "page"; notebook: string; pageID: string; inkVersion: number; lifted?: string[] }
  | { type: "laser"; points: Fraction[] }
  | { type: "end" }
  /** From an audience window that has just opened and wants to know what to show. */
  | { type: "hello" };

export interface Envelope {
  from: string;
  n: number;
  message: PresentMessage;
}

export const CHANNEL = "owlluna-present";

export function isEnvelope(value: unknown): value is Envelope {
  const v = value as Envelope | null;
  return !!v && typeof v === "object" && typeof v.from === "string" && typeof v.n === "number" && !!v.message && typeof v.message.type === "string";
}

/** Lets each message through once, however many ways it arrived. */
export class Dedupe {
  private seen = new Map<string, number>();
  fresh(envelope: Envelope): boolean {
    const last = this.seen.get(envelope.from) ?? -1;
    if (envelope.n <= last) return false;
    this.seen.set(envelope.from, envelope.n);
    return true;
  }
}

/** Collects laser points and hands them over at most `perSecond` times a second. */
export class LaserBatch {
  private points: Fraction[] = [];
  private last = -Infinity;
  constructor(private perSecond = 30) {}

  /** Adds a point. Returns the points to send now, or null when it is too soon. */
  add(point: Fraction, now: number): Fraction[] | null {
    this.points.push(point);
    return now - this.last >= 1000 / this.perSecond ? this.flush(now) : null;
  }

  /** The points waiting, if any, and the batch starts again. */
  flush(now: number): Fraction[] | null {
    if (this.points.length === 0) return null;
    const out = this.points;
    this.points = [];
    this.last = now;
    return out;
  }

  get waiting(): number {
    return this.points.length;
  }
}
