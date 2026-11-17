// A time-lapse: a video of a page's ink appearing as it was written. The timeline is pure; the video is drawn on a
// canvas at 30 frames a second and recorded as it plays.

import { STRIDE, type Stroke } from "../model/ink";
import type { Page } from "../model/notebook";
import type { FS } from "../platform/fs";
import { pageRegion } from "../canvas/board";
import { drawPaper, drawStrokes, pageIsDark } from "../canvas/renderPage";
import { backdrops } from "../canvas/backdrops";
import { t } from "../i18n";

export const IDLE_CAP_MS = 400;
export const MIN_TOTAL_MS = 4000;
export const MAX_TOTAL_MS = 20000;

export interface TimelineStroke {
  stroke: Stroke;
  /** When it begins and how long it takes, in the video's milliseconds. */
  start: number;
  duration: number;
  /** How long it took to write, in real milliseconds. */
  written: number;
}

export interface Timeline {
  strokes: TimelineStroke[];
  /** The video's length in milliseconds. */
  total: number;
}

/** How long a stroke took to write: the time of its last point. */
export function writingTime(stroke: Stroke): number {
  return stroke.pts.length >= STRIDE ? stroke.pts[stroke.pts.length - STRIDE + 3] : 0;
}

/**
 * Lays strokes on a timeline in the order they were written, keeping the pauses between them short (at most 0.4 s) and
 * scaling the whole to between 4 and 20 seconds: faster when it was long, slower when it was very short.
 */
export function buildTimeline(strokes: Stroke[]): Timeline {
  const ordered = [...strokes].sort((a, b) => a.at - b.at);
  const placed: TimelineStroke[] = [];
  let cursor = 0, previousEnd: number | null = null;
  for (const stroke of ordered) {
    const written = writingTime(stroke);
    const gap = previousEnd === null ? 0 : Math.max(stroke.at - previousEnd, 0);
    cursor += Math.min(gap, IDLE_CAP_MS);
    placed.push({ stroke, start: cursor, duration: written, written });
    cursor += written;
    previousEnd = stroke.at + written;
  }
  const natural = cursor;
  if (natural <= 0) return { strokes: placed.map((item) => ({ ...item, start: 0, duration: 0 })), total: MIN_TOTAL_MS };
  const total = Math.min(Math.max(natural, MIN_TOTAL_MS), MAX_TOTAL_MS);
  const factor = total / natural;
  return {
    strokes: placed.map((item) => ({ ...item, start: item.start * factor, duration: item.duration * factor })),
    total,
  };
}

/** The ink as it stands `t` milliseconds into the video: strokes begun, with the one being written cut short. */
export function strokesAt(timeline: Timeline, t: number): Stroke[] {
  const out: Stroke[] = [];
  for (const item of timeline.strokes) {
    if (item.start > t) break;
    if (t >= item.start + item.duration || item.duration <= 0) {
      out.push(item.stroke);
      continue;
    }
    // Real time into the stroke, which its points are stamped in.
    const elapsed = ((t - item.start) / item.duration) * item.written;
    let end = 0;
    while (end < item.stroke.pts.length && item.stroke.pts[end + 3] <= elapsed) end += STRIDE;
    if (end >= STRIDE) out.push({ ...item.stroke, id: item.stroke.id + "~", pts: item.stroke.pts.slice(0, end) });
  }
  return out;
}

export interface TimelapseSource {
  fs: FS;
  id: string;
}

/** The container the browser can record with, or null when it can't record video at all. */
export function recordingType(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  for (const type of ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"]) if (MediaRecorder.isTypeSupported(type)) return type;
  return null;
}

/** Records a WebM of the page's ink being written. Takes as long as the video plays. */
export async function recordTimelapse(source: TimelapseSource, page: Page, strokes: Stroke[], onProgress?: (fraction: number) => void): Promise<Uint8Array> {
  const type = recordingType();
  if (!type) throw new Error(t("This system can't record video."));
  if (strokes.length === 0) throw new Error(t("This page has no writing to play back."));
  const region = pageRegion(page, strokes);
  const scale = Math.min(1280 / region.w, 720 / region.h, 2);
  const width = Math.max(2, Math.round(region.w * scale) & ~1), height = Math.max(2, Math.round(region.h * scale) & ~1);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  const backdrop = await backdrops.ready(source.fs, source.id, page.background, page.size, scale);
  // The paper is drawn once and kept; each frame starts from it.
  const paper = document.createElement("canvas");
  paper.width = width;
  paper.height = height;
  const paperCtx = paper.getContext("2d")!;
  paperCtx.scale(width / region.w, height / region.h);
  paperCtx.translate(-region.x, -region.y);
  drawPaper(paperCtx, page, { visible: region, pixelsPerPoint: scale, backdrop });

  const timeline = buildTimeline(strokes);
  const dark = pageIsDark(page);
  const frame = (t: number) => {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(paper, 0, 0);
    ctx.setTransform(width / region.w, 0, 0, height / region.h, -region.x * (width / region.w), -region.y * (height / region.h));
    drawStrokes(ctx, strokesAt(timeline, t), { darkPaper: dark, layer: "all" });
  };

  const stream = canvas.captureStream(30);
  const recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 4_000_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
  const stopped = new Promise<void>((resolve) => { recorder.onstop = () => resolve(); });
  frame(0);
  recorder.start(250);
  const begun = performance.now();
  await new Promise<void>((resolve) => {
    const tick = setInterval(() => {
      const t = performance.now() - begun;
      frame(Math.min(t, timeline.total));
      onProgress?.(Math.min(t / (timeline.total + 600), 1));
      // A beat of the finished page at the end.
      if (t >= timeline.total + 600) { clearInterval(tick); resolve(); }
    }, 1000 / 30);
  });
  recorder.stop();
  await stopped;
  stream.getTracks().forEach((track) => track.stop());
  return new Uint8Array(await new Blob(chunks, { type: "video/webm" }).arrayBuffer());
}
