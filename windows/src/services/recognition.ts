// Handwriting recognition, text in images, and Windows Hello, all done by Windows through the Rust side.
// Outside the Windows app each of them rejects with a message the caller can show.

import { invoke, isTauri } from "../platform/host";
import { STRIDE, type Stroke } from "../model/ink";

export interface RecognisedLine {
  text: string;
  candidates: string[];
  /** x, y, width, height in page points. */
  bounds: [number, number, number, number];
}

export interface RecognisedInk {
  text: string;
  lines: RecognisedLine[];
}

export interface OcrResult {
  text: string;
  /** Bounds in pixels of the image sent. */
  lines: { text: string; bounds: [number, number, number, number] }[];
}

export type AppLanguage = "system" | "en" | "es" | "fr" | "de";

const TAGS: Record<string, string> = { en: "en-US", es: "es-ES", fr: "fr-FR", de: "de-DE" };

/** The language tag Windows wants for the app's language setting; undefined for "system" (use what Windows has). */
export function languageTag(language: string | undefined): string | undefined {
  return language ? TAGS[language] : undefined;
}

export const MAX_POINTS = 200;

/** A stroke's x and y only, at most `max` points: the first and last always kept, the rest evenly spread. */
export function decimate(stroke: Pick<Stroke, "pts">, max = MAX_POINTS): [number, number][] {
  const count = Math.floor(stroke.pts.length / STRIDE);
  const at = (i: number): [number, number] => [stroke.pts[i * STRIDE], stroke.pts[i * STRIDE + 1]];
  if (count <= max) return Array.from({ length: count }, (_, i) => at(i));
  const out: [number, number][] = [];
  for (let k = 0; k < max; k++) out.push(at(Math.round((k * (count - 1)) / (max - 1))));
  return out;
}

function needsWindows(what: string): Error {
  return new Error(`${what} needs the Windows app.`);
}

/** Reads handwriting. Rejects outside the Windows app, and with Windows' own advice if no recognizer is installed. */
export async function recogniseInk(strokes: Stroke[], language?: string): Promise<RecognisedInk> {
  if (!isTauri) throw needsWindows("Handwriting recognition");
  const points = strokes.map((stroke) => decimate(stroke)).filter((stroke) => stroke.length > 0);
  try {
    return await invoke<RecognisedInk>("ink_recognize", { strokes: points, language: languageTag(language) ?? null });
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
}

/** Whether a handwriting recognizer is installed in Windows. */
export async function recognitionAvailable(): Promise<boolean> {
  if (!isTauri) return false;
  try {
    return (await invoke<string[]>("ink_recognizers")).length > 0;
  } catch {
    return false;
  }
}

/** Reads the text in a PNG or JPEG. */
export async function ocrImage(data: Uint8Array, language?: string): Promise<OcrResult> {
  if (!isTauri) throw needsWindows("Reading text in images");
  const tag = languageTag(language);
  try {
    return await invoke<OcrResult>("ocr_image", data, { headers: tag ? { "x-language": tag } : {} });
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
}

/** Whether Windows Hello can verify the user on this PC. */
export async function helloAvailable(): Promise<boolean> {
  if (!isTauri) return false;
  try {
    return (await invoke<boolean>("hello_available")) === true;
  } catch {
    return false;
  }
}
