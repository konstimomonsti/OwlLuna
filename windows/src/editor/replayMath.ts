// The arithmetic of replaying a recording against the ink written while it ran. Pure, so it can be tested without audio.

import { strokeHit, type Point, type Stroke } from "../model/ink";
import type { Recording } from "../model/notebook";
import { t } from "../i18n";

/** The moment of the notebook's writing that the audio is at, in milliseconds since 1970. */
export function replayMoment(recording: Pick<Recording, "startedAt">, audioSeconds: number): number {
  return recording.startedAt + Math.max(audioSeconds, 0) * 1000;
}

/** Whether a stroke was begun while the recording ran. */
export function writtenDuring(stroke: Pick<Stroke, "at">, recording: Pick<Recording, "startedAt" | "duration">): boolean {
  return stroke.at >= recording.startedAt && stroke.at <= recording.startedAt + recording.duration;
}

/**
 * The page the view should be on at a moment: the page of the stroke begun most recently by then, among those written
 * during the recording. Null before the first of them, when the view stays where it is.
 */
export function pageAtMoment(inks: { pageID: string; strokes: Stroke[] }[], recording: Pick<Recording, "startedAt" | "duration">, moment: number): string | null {
  let best: { at: number; pageID: string } | null = null;
  for (const { pageID, strokes } of inks) {
    for (const stroke of strokes) {
      if (stroke.at > moment || !writtenDuring(stroke, recording)) continue;
      if (!best || stroke.at >= best.at) best = { at: stroke.at, pageID };
    }
  }
  return best?.pageID ?? null;
}

/** Where in the audio, in seconds, a stroke was written; null for ink from outside the recording. */
export function seekTarget(stroke: Pick<Stroke, "at">, recording: Pick<Recording, "startedAt" | "duration">): number | null {
  if (!writtenDuring(stroke, recording)) return null;
  return Math.min(Math.max((stroke.at - recording.startedAt) / 1000, 0), recording.duration / 1000);
}

/** The topmost stroke under a point that was written during the recording, if any. Later strokes lie over earlier ones. */
export function strokeAtPoint(strokes: Stroke[], point: Point, radius: number, recording: Pick<Recording, "startedAt" | "duration">): Stroke | null {
  for (let index = strokes.length - 1; index >= 0; index--) {
    const stroke = strokes[index];
    if (writtenDuring(stroke, recording) && strokeHit(stroke, point, radius)) return stroke;
  }
  return null;
}

/** "3:07", or "1:02:09" past an hour. */
export function clock(seconds: number): string {
  const whole = Math.max(Math.floor(Number.isFinite(seconds) ? seconds : 0), 0);
  const h = Math.floor(whole / 3600), m = Math.floor((whole % 3600) / 60), s = whole % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

/** The media types the recorder tries, best first. */
export const RECORDING_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"] as const;

export function pickRecordingType(supported: (type: string) => boolean): string | undefined {
  return RECORDING_TYPES.find((type) => supported(type));
}

/** The file extension for a recording's media type. */
export function recordingExtension(mime: string): string {
  if (mime.startsWith("audio/ogg")) return "ogg";
  if (mime.startsWith("audio/mp4")) return "m4a";
  return "webm";
}

/** Names the next recording after those the notebook has. */
export function nextRecordingName(recordings: Pick<Recording, "name">[]): string {
  let n = recordings.length + 1;
  const names = new Set(recordings.map((recording) => recording.name));
  while (names.has(t("Recording {number}", { number: n }))) n++;
  return t("Recording {number}", { number: n });
}
