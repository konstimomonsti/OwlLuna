// OneNote pages as OwlLuna pages: the pure half of the importer (the Rust side reads OneNote; this decides what each
// thing becomes). Nothing here touches files or OneNote, so all of it is tested on fixture JSON.
//
// The mapping, in short:
//  - a OneNote notebook is a folder (section groups nest as folders); a section is one notebook of ours;
//  - a page has no fixed size in OneNote, so it is as large as its content: at least Letter, and 36 pt of margin
//    beyond the furthest thing on it, so nothing is cut off;
//  - paper is blank, narrow ruled (rule lines) or grid (rule lines both ways); the paper colour is the nearest of
//    ours to the page colour;
//  - the title is a bold text box at the title's place with the date line under it, as OneNote shows;
//  - an outline is one text box at its place and width: a line a paragraph, four spaces of indent a level, a list
//    style (bullet / number / check) when the whole outline uses one and "• ", "3." or "☐" prefixes when it doesn't.
//    Its font size, weight, slant, underline, colour and highlight are the paragraphs' dominant ones;
//  - a table is one line a row, cells joined by " | ";
//  - a picture is a picture item; the words OneNote read from it are its `text` (so they are searchable);
//  - ink is strokes: pen, pencil or highlighter (the colour at the app's highlighter opacity), width and pressure kept;
//  - what has no equivalent (attached files, audio and video, pictures in a format we can't draw) is listed, and the
//    page then gets a PDF copy behind it so nothing is lost without a trace.

import { uuid, fnv1a } from "../model/ids";
import { encodeInk, type Stroke } from "../model/ink";
import {
  clothHex, highlightHex, textHighlights, textTintHex,
  type ClothColor, type PageItem, type PictureItem, type TextFace, type TextHighlight, type TextItem, type TextList, type TextTint,
} from "../model/notebook";
import { paperColors, paperRGB, type PaperColor, type PaperTemplate } from "../model/paper";
import { clampWidth, colorFromHex, withOpacity, type InkKind } from "../model/tools";
import { locale } from "../i18n";

// ---- What the Rust side sends --------------------------------------------------------------------------------------

export interface ONPageRef { id: string; name: string; dateTime: string | null; lastModified: string | null; level: number; isUnread: boolean; isInRecycleBin: boolean }
export interface ONSection {
  id: string; name: string; color: string | null; path: string | null; lastModified: string | null;
  locked: boolean; encrypted: boolean; readOnly: boolean; isInRecycleBin: boolean; isDeletedPages: boolean; pages: ONPageRef[];
}
export interface ONGroup { id: string; name: string; color: string | null; lastModified: string | null; isRecycleBin: boolean; groups: ONGroup[]; sections: ONSection[] }
export interface ONNotebook { id: string; name: string; nickname: string | null; path: string | null; color: string | null; lastModified: string | null; groups: ONGroup[]; sections: ONSection[] }
export interface ONLocalNotebook { name: string; path: string; isOpen: boolean }

export interface ONParagraph {
  text: string; level: number; list: "bullet" | "number" | "none"; numberText: string | null; todo: boolean | null;
  fontSize: number | null; bold: boolean; italic: boolean; underline: boolean; strike: boolean;
  color: string | null; highlight: string | null; face: string | null; table: boolean; quickStyle: number | null;
}
export interface ONOutline { x: number; y: number; w: number; h: number; z: number; paragraphs: ONParagraph[] }
export interface ONPicture {
  x: number; y: number; w: number; h: number; z: number; format: string; data: string; alt: string | null; ocr: string | null; isPrintOut: boolean; inline: boolean;
}
export interface ONStroke { points: [number, number, number][]; color: string; width: number; kind: "pen" | "highlighter" | "pencil"; times: number[] }
export interface ONInk { source: string; x: number; y: number; w: number; h: number; z: number; lastModified: string | null; recognized: string | null; strokes: ONStroke[] }
export interface ONUnsupported { kind: string; name: string | null; x: number; y: number; w: number; h: number }
export interface ONPageContent {
  id: string; name: string; created: string | null; lastModified: string | null; lang: string | null;
  title: { text: string; x: number; y: number; w: number; fontSize: number | null } | null;
  ruleLines: { horizontal: boolean; vertical: boolean; spacing: number; color: string | null } | null;
  background: string | null;
  extent: { x: number; y: number; w: number; h: number };
  outlines: ONOutline[]; images: ONPicture[]; ink: ONInk[]; unsupported: ONUnsupported[]; warnings: string[];
}

// ---- Colours -------------------------------------------------------------------------------------------------------

export function rgbOf(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function distance(a: [number, number, number], b: [number, number, number]): number {
  // Weighted toward green, as the eye is: close enough for choosing among a dozen swatches.
  return 2 * (a[0] - b[0]) ** 2 + 4 * (a[1] - b[1]) ** 2 + 3 * (a[2] - b[2]) ** 2;
}

function nearest<T extends string>(hex: string | null | undefined, table: Record<T, string>, fallback: T): T {
  const rgb = hex ? rgbOf(hex) : null;
  if (!rgb) return fallback;
  let best = fallback, bestDistance = Infinity;
  for (const key of Object.keys(table) as T[]) {
    const other = rgbOf(table[key])!;
    const d = distance(rgb, other);
    if (d < bestDistance) { best = key; bestDistance = d; }
  }
  return best;
}

/** The cloth colour closest to a section's colour. */
export function nearestCloth(hex: string | null | undefined): ClothColor {
  const rgb = hex ? rgbOf(hex) : null;
  if (!rgb) return "navy";
  const [h, s, v] = hsv(rgb);
  // A pale blue is nearer to oat than to cobalt in RGB, but it is a blue section: a coloured section takes the
  // cloth of the nearest hue, lightness breaking ties. Greys and near-whites take the nearest in RGB.
  if (s < 0.18) return nearest(hex, clothHex, "navy");
  let best: ClothColor = "navy", bestScore = Infinity;
  for (const key of Object.keys(clothHex) as ClothColor[]) {
    const [ch, cs, cv] = hsv(rgbOf(clothHex[key])!);
    if (cs < 0.18) continue;
    const turn = Math.abs(h - ch);
    const score = Math.min(turn, 360 - turn) / 180 * 100 + Math.abs(v - cv) * 30 + Math.abs(s - cs) * 15;
    if (score < bestScore) { best = key; bestScore = score; }
  }
  return best;
}

function hsv([r, g, b]: [number, number, number]): [number, number, number] {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  return [h, max === 0 ? 0 : d / max, max / 255];
}

/** The paper colour closest to a page's background; white for OneNote's automatic. */
export function nearestPaper(hex: string | null | undefined): PaperColor {
  const rgb = hex ? rgbOf(hex) : null;
  if (!rgb) return "white";
  let best: PaperColor = "white", bestDistance = Infinity;
  for (const color of paperColors) {
    const [r, g, b] = paperRGB[color];
    const d = distance(rgb, [r * 255, g * 255, b * 255]);
    if (d < bestDistance) { best = color; bestDistance = d; }
  }
  return best;
}

function luminance(rgb: [number, number, number]): number {
  return (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
}

/** The text colour closest to one of OneNote's. Black, white-ish and unset become the ink colour. */
export function nearestTint(hex: string | null | undefined): TextTint | undefined {
  const rgb = hex ? rgbOf(hex) : null;
  if (!rgb) return undefined;
  // Greys and near-blacks are the plain ink; a very pale colour (OneNote's pale grey titles) would vanish on paper.
  const spread = Math.max(...rgb) - Math.min(...rgb);
  if (spread < 40 || luminance(rgb) > 0.85) return undefined;
  const best = nearest(hex, textTintHex, "ink");
  return best === "ink" ? undefined : best;
}

export function nearestHighlight(hex: string | null | undefined): TextHighlight | undefined {
  const rgb = hex ? rgbOf(hex) : null;
  if (!rgb) return undefined;
  return nearest(hex, highlightHex, textHighlights[0]);
}

export function faceOf(name: string | null | undefined): TextFace | undefined {
  if (!name) return undefined;
  const n = name.toLowerCase();
  if (/(consolas|courier|mono|lucida console|cascadia)/.test(n)) return "mono";
  if (/(times|cambria|georgia|garamond|serif|palatino|book antiqua|constantia)/.test(n) && !/sans/.test(n)) return "serif";
  return "system";
}

// ---- Text ----------------------------------------------------------------------------------------------------------

const INDENT = "    ";
const AVERAGE_GLYPH = 0.52;

function isBlank(p: ONParagraph): boolean {
  return p.text.trim() === "";
}

function uniformList(paragraphs: ONParagraph[]): TextList | null {
  const used = paragraphs.filter((p) => !isBlank(p));
  if (used.length === 0 || used.some((p) => p.text.includes("\n") || p.table)) return null;
  const kind = (p: ONParagraph): TextList | null => (p.todo !== null ? "check" : p.list === "number" ? "number" : p.list === "bullet" ? "bullet" : null);
  const first = kind(used[0]);
  return first && used.every((p) => kind(p) === first) ? first : null;
}

/** The most common value, weighted by how much text has it. */
function mostCommon<T>(paragraphs: ONParagraph[], pick: (p: ONParagraph) => T | null | undefined): T | undefined {
  const weights = new Map<T, number>();
  for (const p of paragraphs) {
    const value = pick(p);
    if (value === null || value === undefined) continue;
    weights.set(value, (weights.get(value) ?? 0) + Math.max(p.text.replace(/\s/g, "").length, 1));
  }
  let best: T | undefined, most = 0;
  for (const [value, weight] of weights) if (weight > most) { best = value; most = weight; }
  return best;
}

function share(paragraphs: ONParagraph[], test: (p: ONParagraph) => boolean): boolean {
  let yes = 0, all = 0;
  for (const p of paragraphs) {
    const weight = Math.max(p.text.replace(/\s/g, "").length, 1);
    all += weight;
    if (test(p)) yes += weight;
  }
  return all > 0 && yes * 2 > all;
}

export function textBoxHeight(lines: string[], width: number, size: number): number {
  const perLine = Math.max(Math.floor(width / (size * AVERAGE_GLYPH)), 1);
  const rows = lines.reduce((total, line) => total + Math.max(Math.ceil(line.length / perLine), 1), 0);
  return rows * size * 1.35 + 4;
}

function clampSize(size: number | undefined, fallback: number): number {
  const value = size && Number.isFinite(size) ? size : fallback;
  return Math.min(Math.max(Math.round(value * 2) / 2, 6), 96);
}

/** An outline as a text box, or null when it holds no text. */
export function outlineToText(outline: ONOutline): { item: TextItem; text: string } | null {
  const paragraphs = [...outline.paragraphs];
  while (paragraphs.length && isBlank(paragraphs[paragraphs.length - 1])) paragraphs.pop();
  while (paragraphs.length && isBlank(paragraphs[0])) paragraphs.shift();
  if (paragraphs.length === 0) return null;
  const list = uniformList(paragraphs);
  const lines: string[] = [];
  const ticked: number[] = [];
  let number = 0;
  for (const p of paragraphs) {
    const indent = INDENT.repeat(Math.min(p.level, 8));
    const parts = p.text.replace(/\r/g, "").split("\n");
    let prefix = "";
    if (!list && !isBlank(p)) {
      if (p.todo !== null) prefix = p.todo ? "☑ " : "☐ ";
      else if (p.list === "bullet") prefix = "• ";
      else if (p.list === "number") prefix = `${p.numberText || `${++number}.`} `;
    }
    if (list === "check" && p.todo) ticked.push(lines.length);
    if (p.list !== "number") number = 0;
    parts.forEach((part, index) => lines.push(index === 0 ? `${indent}${prefix}${part}` : `${indent}${prefix ? "  " : ""}${part}`));
  }
  const body = paragraphs.filter((p) => !isBlank(p));
  const size = clampSize(mostCommon(body, (p) => p.fontSize), 11);
  const longest = Math.max(...lines.map((l) => l.length), 1);
  // OneNote sizes an outline to its text in its own font; ours is a little wider, so there is slack.
  const natural = outline.w > 0 ? outline.w * 1.12 + 6 : Math.min(Math.max(longest * size * AVERAGE_GLYPH + 16, 80), 520);
  const w = Math.max(natural, 40);
  const h = Math.max(textBoxHeight(lines, w - (list ? size * 1.5 : 0), size), size * 1.5);
  const item: TextItem = {
    id: uuid(), kind: "text", x: outline.x + w / 2, y: outline.y + h / 2, w, h, rotation: 0,
    string: lines.join("\n"), fontSize: size,
  };
  if (share(body, (p) => p.bold)) item.bold = true;
  if (share(body, (p) => p.italic)) item.italic = true;
  if (share(body, (p) => p.underline)) item.underline = true;
  const tint = nearestTint(mostCommon(body, (p) => p.color));
  if (tint) item.tint = tint;
  const highlight = share(body, (p) => p.highlight !== null) ? nearestHighlight(mostCommon(body, (p) => p.highlight)) : undefined;
  if (highlight) item.highlight = highlight;
  const face = faceOf(mostCommon(body, (p) => p.face));
  if (face && face !== "system") item.face = face;
  if (list) item.list = list;
  if (list === "check" && ticked.length) item.checked = ticked;
  return { item, text: lines.join("\n") };
}

// ---- Ink -----------------------------------------------------------------------------------------------------------

function strokeColor(hex: string, kind: InkKind): number {
  const rgb = rgbOf(hex) ?? [0, 0, 0];
  const alpha = /^#[0-9a-f]{8}$/i.test(hex) ? parseInt(hex.slice(7, 9), 16) / 255 : 1;
  const base = colorFromHex(`#${rgb.map((v) => v.toString(16).padStart(2, "0")).join("")}`, 1);
  // A highlighter is drawn faint, as the app's own is; ink that already says how faint it is keeps that.
  if (kind === "highlighter") return withOpacity(base, alpha >= 0.99 ? 0.45 : alpha);
  return withOpacity(base, Math.max(alpha, 0.1));
}

/** Strokes from OneNote's ink, in drawing order with start times that never go backwards (replay and time-lapse need them). */
export function inkToStrokes(ink: ONInk[], fallbackAt: number): Stroke[] {
  const ordered = ink.map((entry, index) => ({ entry, index })).sort((a, b) => a.entry.z - b.entry.z || a.index - b.index);
  const out: Stroke[] = [];
  let last = -Infinity;
  for (const { entry } of ordered) {
    const base = entry.lastModified ? Date.parse(entry.lastModified) : NaN;
    for (const raw of entry.strokes) {
      if (raw.points.length === 0) continue;
      const kind: InkKind = raw.kind;
      const timed = raw.times.length === raw.points.length;
      const pts: number[] = [];
      raw.points.forEach((p, i) => {
        // Pressure that was never recorded comes through as zero: a middling pressure draws a steady line.
        const pressure = p[2] > 0.001 ? Math.min(p[2], 1) : 0.5;
        pts.push(p[0], p[1], pressure, timed ? raw.times[i] : i * 8);
      });
      const start = Math.max(Number.isFinite(base) ? base : fallbackAt, last + 1);
      last = start;
      out.push({ id: uuid(), ink: kind, color: strokeColor(raw.color, kind), width: clampWidth(kind, raw.width), pts, at: start });
    }
  }
  return out;
}

// ---- A page --------------------------------------------------------------------------------------------------------

export interface ConvertedAsset { item: PictureItem; data: string; ext: string }

export interface ConvertedPage {
  title: string;
  size: { w: number; h: number };
  template: PaperTemplate;
  paperColor: PaperColor;
  items: PageItem[];
  strokes: Stroke[];
  /** Pictures to store: the item gets its `file` once stored. */
  assets: ConvertedAsset[];
  /** Everything readable on the page, for the words cache. */
  words: string;
  unsupported: ONUnsupported[];
  warnings: string[];
  createdAt: number | null;
}

export interface ConvertOptions {
  /** Added to the title: " (updated in OneNote)". */
  titleSuffix?: string;
  formatDate?: (date: Date) => string;
}

function defaultDate(date: Date): string {
  const tag = locale();
  return `${date.toLocaleDateString(tag, { weekday: "long", year: "numeric", month: "long", day: "numeric" })}   ${date.toLocaleTimeString(tag, { hour: "2-digit", minute: "2-digit" })}`;
}

export function convertPage(content: ONPageContent, options: ConvertOptions = {}): ConvertedPage {
  const size = { w: Math.max(612, Math.ceil(content.extent.w + 36)), h: Math.max(792, Math.ceil(content.extent.h + 36)) };
  const template: PaperTemplate = content.ruleLines ? (content.ruleLines.vertical ? "grid" : "narrowRuled") : "blank";
  const items: PageItem[] = [];
  const assets: ConvertedAsset[] = [];
  const words: string[] = [];
  const created = content.created ? Date.parse(content.created) : NaN;

  const titleText = `${content.title?.text.trim() || content.name.trim()}${options.titleSuffix ?? ""}`;
  if (titleText.trim()) {
    const at = content.title ?? { x: 36, y: 43.2, w: 0, fontSize: 20 };
    const fontSize = clampSize(at.fontSize ?? 20, 20);
    const w = Math.min(Math.max(titleText.length * fontSize * 0.6 + 16, at.w, 140), Math.max(size.w - at.x - 18, 140));
    const h = textBoxHeight([titleText], w, fontSize);
    items.push({ id: uuid(), kind: "text", x: at.x + w / 2, y: at.y + h / 2, w, h, rotation: 0, string: titleText, fontSize, bold: true } satisfies TextItem);
    words.push(titleText);
    if (Number.isFinite(created)) {
      const dateLine = (options.formatDate ?? defaultDate)(new Date(created));
      const dh = 9.5 * 1.35 + 4;
      items.push({ id: uuid(), kind: "text", x: at.x + 160, y: at.y + h + 2 + dh / 2, w: 320, h: dh, rotation: 0, string: dateLine, fontSize: 9.5 } satisfies TextItem);
    }
  }

  for (const outline of [...content.outlines].sort((a, b) => a.z - b.z)) {
    const text = outlineToText(outline);
    if (text) {
      items.push(text.item);
      words.push(text.text);
    }
  }

  for (const image of [...content.images].sort((a, b) => a.z - b.z)) {
    const item: PictureItem = { id: uuid(), kind: "image", file: "", x: image.x + image.w / 2, y: image.y + image.h / 2, w: image.w, h: image.h, rotation: 0 };
    const text = [image.ocr, image.alt].filter((v): v is string => !!v && v.trim() !== "").join(" ").replace(/\s+/g, " ").trim();
    if (text) {
      item.text = text;
      words.push(text);
    }
    items.push(item);
    assets.push({ item, data: image.data, ext: image.format === "jpeg" ? "jpg" : image.format });
  }

  for (const ink of content.ink) if (ink.recognized) words.push(ink.recognized);
  const strokes = inkToStrokes(content.ink, Number.isFinite(created) ? created : Date.now());

  return {
    title: titleText,
    size,
    template,
    paperColor: nearestPaper(content.background),
    items,
    strokes,
    assets,
    words: words.join("\n").trim(),
    unsupported: content.unsupported,
    warnings: content.warnings,
    createdAt: Number.isFinite(created) ? created : null,
  };
}

/** Tallest page we make. OneNote pages can run to hundreds of thousands of points (a long printout), which no canvas holds. */
export const MAX_PAGE_HEIGHT = 4000;

/**
 * A page taller than `maxHeight` as several pages, cut where one picture ends and the next begins when there is such
 * a place in the last 1500 pt before the limit (printouts are stacked tiles), and through a picture, which is then
 * cropped into both pages, when not. Text goes to the part it starts in; a stroke to the part it starts in. Parts
 * after the first say which part they are.
 */
export function splitTall(page: ConvertedPage, maxHeight = MAX_PAGE_HEIGHT): ConvertedPage[] {
  const margin = 36;
  const content = page.size.h - margin;
  if (content <= maxHeight + 200) return [page];
  const bottoms = page.items.filter((i) => i.kind === "image").map((i) => i.y + i.h / 2).sort((a, b) => a - b);
  const cuts = [0];
  while (content - cuts[cuts.length - 1] > maxHeight + 200) {
    const top = cuts[cuts.length - 1];
    const target = top + maxHeight;
    const tile = [...bottoms].reverse().find((y) => y <= target && y >= target - 1500 && y > top + 500);
    cuts.push(tile ?? target);
  }
  cuts.push(content);
  const parts: ConvertedPage[] = [];
  for (let n = 0; n < cuts.length - 1; n++) {
    const start = cuts[n], end = cuts[n + 1];
    const items: PageItem[] = [];
    const assets: ConvertedAsset[] = [];
    for (const item of page.items) {
      const top = item.y - item.h / 2, bottom = item.y + item.h / 2;
      if (item.kind === "image") {
        const from = Math.max(top, start), to = Math.min(bottom, end);
        if (to - from < 1) continue;
        const source = page.assets.find((a) => a.item === item);
        const whole = from === top && to === bottom;
        const piece: PictureItem = { ...item, id: uuid(), y: (from + to) / 2 - start, h: to - from, ...(whole ? {} : { crop: [0, (from - top) / item.h, 1, (to - from) / item.h] as [number, number, number, number] }) };
        items.push(piece);
        if (source) assets.push({ ...source, item: piece });
      } else if (item.y >= start && item.y < end) {
        items.push({ ...item, id: uuid(), y: item.y - start });
      }
    }
    const strokes = page.strokes.filter((s) => s.pts[1] >= start && s.pts[1] < end || (n === cuts.length - 2 && s.pts[1] >= end))
      .map((s) => ({ ...s, pts: s.pts.map((v, i) => (i % 4 === 1 ? v - start : v)) }));
    if (n > 0) {
      items.push({ id: uuid(), kind: "text", x: 36 + 120, y: 14, w: 240, h: 17.5, rotation: 0, string: `${page.title} (${n + 1}/${cuts.length - 1})`, fontSize: 9.5, italic: true } satisfies TextItem);
    }
    parts.push({ ...page, size: { w: page.size.w, h: Math.max(Math.ceil(end - start + margin), 300) }, items, strokes, assets, words: n === 0 ? page.words : "" });
  }
  return parts;
}

/** Whether a page gets a PDF copy behind it: it has something we could not convert, or conversion warned. */
export function needsPdfCopy(page: Pick<ConvertedPage, "unsupported" | "warnings">, keepCopies: boolean): boolean {
  return keepCopies && (page.unsupported.length > 0 || page.warnings.length > 0);
}

// ---- Importing again -----------------------------------------------------------------------------------------------

/** What an imported page remembers about where it came from. Kept on the page as an extra key. */
export interface PageOrigin {
  pageID: string;
  lastModified: string | null;
  /** Hash of the page's ink and items as imported: a different hash later means the user has edited it. */
  importedHash: string;
  /** This page is OneNote's newer version, added beside a page the user had changed. */
  copy?: boolean;
  /** This page is the PDF copy of a OneNote page. */
  pdfCopy?: boolean;
  /** A very tall OneNote page is cut into pages: this is part 2, 3, ... of it (the first has no `part`). */
  part?: number;
}

export type Reimport = "new" | "unchanged" | "replace" | "keepBoth";

/**
 * What to do with a OneNote page when its section is imported again.
 *  - not imported before: new;
 *  - OneNote's last-modified time is the same: unchanged;
 *  - OneNote changed it and the user did not: replace it in place;
 *  - both changed: keep the user's page and add OneNote's new version after it.
 */
export function decideReimport(existing: { origin: PageOrigin; currentHash: string } | null, remoteLastModified: string | null): Reimport {
  if (!existing) return "new";
  if (existing.origin.lastModified === remoteLastModified) return "unchanged";
  return existing.currentHash === existing.origin.importedHash ? "replace" : "keepBoth";
}

const itemKeys = ["kind", "x", "y", "w", "h", "rotation", "string", "fontSize", "bold", "italic", "underline", "tint", "face", "list", "highlight", "checked", "file", "crop", "text", "name", "label", "color"] as const;

const round2 = (v: number) => Math.round(v * 100) / 100;

/** A hash of what the user can change on a page: its items and its ink. */
export function pageHash(items: PageItem[], strokes: Stroke[]): string {
  const canonical = items.map((item) => {
    const record = item as unknown as Record<string, unknown>;
    return itemKeys.map((key) => {
      const value = record[key];
      return typeof value === "number" ? round2(value) : value ?? null;
    });
  });
  // `encodeInk` rounds as the files do, so ink read back from disk hashes as it was written.
  return fnv1a(`${JSON.stringify(canonical)}|${encodeInk(strokes)}`);
}

export function bytesFromBase64(data: string): Uint8Array {
  const text = atob(data.replace(/\s+/g, ""));
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i);
  return out;
}
