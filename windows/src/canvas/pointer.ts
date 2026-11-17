// Small pointer helpers shared by the canvas and the controls over it.

import type { Point } from "../model/ink";

/** Takes the pointer for an element. Quietly does nothing when the pointer is already gone, as a cancelled pen or a synthetic event is. */
export function capturePointer(element: Element | null | undefined, pointerID: number): void {
  try {
    (element as HTMLElement | null | undefined)?.setPointerCapture?.(pointerID);
  } catch {
    // No active pointer with that id: nothing to capture.
  }
}

/**
 * The points to test along the way from `from` to `to`, in steps of at most `step`, not counting `from` (it was
 * tested already) but counting `to`. A swipe faster than the pointer is sampled is still rubbed end to end.
 */
export function stepsAlong(from: Point, to: Point, step: number): Point[] {
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  if (!(step > 0) || distance === 0) return [{ ...to }];
  const count = Math.max(1, Math.ceil(distance / step));
  const out: Point[] = [];
  for (let i = 1; i <= count; i++) out.push({ x: from.x + ((to.x - from.x) * i) / count, y: from.y + ((to.y - from.y) * i) / count });
  return out;
}
