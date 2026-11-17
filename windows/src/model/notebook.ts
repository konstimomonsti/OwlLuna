// A notebook's manifest: its pages, cover, paper and where it sits in the library.
// Unknown keys are kept as they were read, so a newer build's notebook survives an older one.

import { uuid, seedOf } from "./ids";
import { asPageSize, asPaperColor, asTemplate, pageSizePoints, type PageSize, type PaperColor, type PaperTemplate } from "./paper";

export type Background =
  | { kind: "template"; template: PaperTemplate }
  | { kind: "pdf"; file: string; index: number }
  | { kind: "image"; file: string };

export const textTints = ["ink", "tomato", "cobalt", "moss", "plum"] as const;
export type TextTint = (typeof textTints)[number];
export const textTintHex: Record<TextTint, string> = {
  ink: "#1B2230", tomato: "#C9452F", cobalt: "#2747B8", moss: "#3D5A40", plum: "#5A2F52",
};
export const textFaces = ["system", "serif", "mono", "fraunces"] as const;
export type TextFace = (typeof textFaces)[number];
export const textHighlights = ["yellow", "green", "pink", "blue"] as const;
export type TextHighlight = (typeof textHighlights)[number];
export const highlightHex: Record<TextHighlight, string> = {
  yellow: "#FFD426", green: "#7ED98B", pink: "#FF8FB8", blue: "#7CC4FF",
};
export type TextList = "bullet" | "number" | "check";
export const tapeColors = ["mustard", "rose", "sage", "sky"] as const;
export type TapeColor = (typeof tapeColors)[number];
export const tapeHex: Record<TapeColor, string> = { mustard: "#E8B023", rose: "#E3A6A1", sage: "#A9BFA2", sky: "#9CC3E6" };

export type LinkTarget =
  | { to: "page"; page: string }
  | { to: "notebook"; notebook: string; page?: string; name: string }
  | { to: "web"; url: string };

interface ItemBase {
  id: string;
  /** The centre, in page points. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Radians, clockwise. */
  rotation: number;
}

export interface PictureItem extends ItemBase {
  kind: "image";
  file: string;
  /** The part of the picture shown, as fractions of it: x, y, width, height. */
  crop?: [number, number, number, number];
  /** Words read from the picture, for search. */
  text?: string;
}
export interface StickerItem extends ItemBase { kind: "sticker"; name: string }
export interface TextItem extends ItemBase {
  kind: "text";
  string: string;
  fontSize: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  tint?: TextTint;
  align?: "leading" | "center" | "trailing";
  face?: TextFace;
  list?: TextList;
  highlight?: TextHighlight;
  /** The lines of a checklist that are ticked. */
  checked?: number[];
}
export interface LinkItem extends ItemBase { kind: "link"; label: string; target: LinkTarget }
export interface TapeItem extends ItemBase { kind: "tape"; color: TapeColor }
export type PageItem = PictureItem | StickerItem | TextItem | LinkItem | TapeItem;

/** Highlighted or underlined text on a PDF page: the rectangles of its lines, in page points. */
export interface TextMark {
  id: string;
  color: TextHighlight;
  rects: [number, number, number, number][];
  text: string;
}

export interface Page {
  id: string;
  background: Background;
  paperColor: PaperColor;
  size: { w: number; h: number };
  items: PageItem[];
  bookmark?: boolean;
  /** "yyyy-MM-dd" on a daily-journal page. */
  date?: string;
  /** Presenter notes, shown only to the presenter. */
  notes?: string;
  marks?: TextMark[];
  /** A whiteboard's page has no edges. */
  edgeless?: boolean;
  /** A hash of the page's ink, naming its thumbnail. */
  inkHash?: string;
}

export const coverStyles = ["cloth", "print", "firstPage"] as const;
export type CoverStyle = (typeof coverStyles)[number];
export const clothColors = ["oxblood", "tomato", "mustard", "moss", "jade", "cobalt", "navy", "plum", "slate", "rose", "oat"] as const;
export type ClothColor = (typeof clothColors)[number];
export const clothHex: Record<ClothColor, string> = {
  oxblood: "#6E2A2A", tomato: "#C9452F", mustard: "#D6A02A", moss: "#3D5A40", jade: "#2F7D6B", cobalt: "#2F4DA0",
  navy: "#1E2A45", plum: "#5A2F52", slate: "#56606B", rose: "#C98A86", oat: "#CDBF9F",
};
/** Text on the cloth itself: ink on the pale cloths, white on the rest. */
export function onCloth(color: ClothColor): string {
  return color === "mustard" || color === "rose" || color === "oat" ? "#1B2230" : "#FFFFFF";
}
export const risoInks = ["pink", "yellow", "teal", "blue", "black"] as const;
export type RisoInk = (typeof risoInks)[number];
export const risoHex: Record<RisoInk, string> = { pink: "#FF48B0", yellow: "#FFE800", teal: "#00838A", blue: "#0078BF", black: "#1C1C21" };
export const risoPaperStock = "#F7F4EC";
export const risoPairs: [RisoInk, RisoInk][] = [
  ["teal", "blue"], ["pink", "yellow"], ["blue", "yellow"], ["teal", "pink"], ["black", "pink"], ["blue", "pink"],
];

export interface CoverSpec {
  style: CoverStyle;
  cloth: ClothColor;
  inks: [RisoInk, RisoInk];
  seed: number;
}

export interface PageDefaults {
  template: PaperTemplate;
  paperColor: PaperColor;
  pageSize: PageSize;
}

/** The user's own paper: a PDF page or a picture kept in the notebook, offered beside the templates. */
export interface NotebookPaper {
  id: string;
  name: string;
  background: Background;
  size: { w: number; h: number };
}

export interface Recording {
  id: string;
  /** In `recordings/`. */
  file: string;
  /** When it began, in milliseconds since 1970. */
  startedAt: number;
  /** Milliseconds. */
  duration: number;
  name: string;
}

export interface Manifest {
  version: 1;
  id: string;
  title: string;
  kind: "notebook" | "whiteboard";
  createdAt: number;
  modifiedAt: number;
  cover: CoverSpec;
  defaults: PageDefaults;
  pages: Page[];
  tags: string[];
  /** The folder it is shelved in, or null for the top shelf. */
  folder: string | null;
  favourite: boolean;
  locked: boolean;
  /** When it went to Recently Deleted, or null. */
  trashedAt: number | null;
  /** The daily journal: one page a day. */
  journal?: boolean;
  papers?: NotebookPaper[];
  recordings?: Recording[];
  /** The page last open, to come back to. */
  lastPage?: string;
}

export const MANIFEST_VERSION = 1;

export function seededCloth(id: string): ClothColor {
  return clothColors[seedOf(id) % clothColors.length];
}

export function defaultCover(id: string, style: CoverStyle = "cloth"): CoverSpec {
  const seed = seedOf(id);
  return { style, cloth: seededCloth(id), inks: risoPairs[seed % risoPairs.length], seed };
}

export function newPage(defaults: PageDefaults, overrides: Partial<Page> = {}): Page {
  return {
    id: uuid(),
    background: { kind: "template", template: defaults.template },
    paperColor: defaults.paperColor,
    size: { ...pageSizePoints[defaults.pageSize] },
    items: [],
    ...overrides,
  };
}

export const whiteboardSize = { w: 612, h: 792 };

export function newManifest(options: {
  title: string;
  kind?: "notebook" | "whiteboard";
  defaults?: PageDefaults;
  cover?: Partial<CoverSpec>;
  folder?: string | null;
  tags?: string[];
  journal?: boolean;
  now?: number;
  pages?: Page[];
}): Manifest {
  const id = uuid();
  const now = options.now ?? Date.now();
  const defaults = options.defaults ?? { template: "narrowRuled", paperColor: "white", pageSize: "letter" };
  const kind = options.kind ?? "notebook";
  const first = kind === "whiteboard"
    ? newPage({ ...defaults, template: defaults.template }, { edgeless: true, size: { ...whiteboardSize } })
    : newPage(defaults);
  return {
    version: MANIFEST_VERSION,
    id,
    title: options.title,
    kind,
    createdAt: now,
    modifiedAt: now,
    cover: { ...defaultCover(id), ...options.cover },
    defaults,
    pages: options.pages ?? [first],
    tags: options.tags ?? [],
    folder: options.folder ?? null,
    favourite: false,
    locked: false,
    trashedAt: null,
    ...(options.journal ? { journal: true } : {}),
  };
}

/** A copy of a page with a new identity and no day or bookmark, for duplicating. Items get new identities too. */
export function duplicatedPage(page: Page): Page {
  const copy: Page = JSON.parse(JSON.stringify(page));
  copy.id = uuid();
  delete copy.date;
  delete copy.bookmark;
  copy.items = copy.items.map((item) => ({ ...item, id: uuid() }));
  copy.marks = copy.marks?.map((mark) => ({ ...mark, id: uuid() }));
  return copy;
}

export function inkPath(pageID: string): string {
  return `ink/${pageID}.json`;
}

function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function decodeBackground(raw: unknown): Background {
  const value = raw as Record<string, unknown> | null;
  if (value && value.kind === "pdf" && typeof value.file === "string") return { kind: "pdf", file: value.file, index: Math.max(0, Math.floor(finite(value.index, 0))) };
  if (value && value.kind === "image" && typeof value.file === "string") return { kind: "image", file: value.file };
  return { kind: "template", template: asTemplate(value?.template) };
}

const itemKinds = new Set(["image", "sticker", "text", "link", "tape"]);

function decodeItem(raw: unknown): PageItem | null {
  const item = raw as Record<string, unknown> | null;
  if (!item || typeof item.kind !== "string" || !itemKinds.has(item.kind)) return null;
  const base = {
    ...item,
    id: typeof item.id === "string" ? item.id : uuid(),
    x: finite(item.x, 0), y: finite(item.y, 0),
    w: Math.max(finite(item.w, 40), 1), h: Math.max(finite(item.h, 40), 1),
    rotation: finite(item.rotation, 0),
  };
  switch (item.kind) {
    case "image": return typeof item.file === "string" ? (base as unknown as PictureItem) : null;
    case "sticker": return typeof item.name === "string" ? (base as unknown as StickerItem) : null;
    case "text": return { ...base, string: typeof item.string === "string" ? item.string : "", fontSize: finite(item.fontSize, 17) } as unknown as TextItem;
    case "link": {
      const target = item.target as Record<string, unknown> | undefined;
      if (!target || (target.to !== "page" && target.to !== "notebook" && target.to !== "web")) return null;
      return { ...base, label: typeof item.label === "string" ? item.label : "" } as unknown as LinkItem;
    }
    case "tape": return { ...base, color: (tapeColors as readonly string[]).includes(item.color as string) ? item.color : "mustard" } as unknown as TapeItem;
  }
  return null;
}

function decodePage(raw: unknown, defaults: PageDefaults): Page | null {
  const page = raw as Record<string, unknown> | null;
  if (!page || typeof page.id !== "string") return null;
  const size = page.size as Record<string, unknown> | undefined;
  const fallback = pageSizePoints[defaults.pageSize];
  return {
    ...(page as object),
    id: page.id,
    background: decodeBackground(page.background),
    paperColor: asPaperColor(page.paperColor),
    size: { w: Math.max(finite(size?.w, fallback.w), 16), h: Math.max(finite(size?.h, fallback.h), 16) },
    items: Array.isArray(page.items) ? page.items.map(decodeItem).filter((item): item is PageItem => item !== null) : [],
  } as Page;
}

/** Reads a manifest, mending what it can. Throws when it isn't a manifest, so the caller can set the file aside. */
export function decodeManifest(text: string): Manifest {
  const raw = JSON.parse(text) as Record<string, unknown>;
  if (!raw || typeof raw !== "object" || typeof raw.id !== "string" || !Array.isArray(raw.pages)) throw new Error("not a notebook manifest");
  if (typeof raw.version === "number" && raw.version > MANIFEST_VERSION) throw new Error("this notebook was made by a newer OwlLuna");
  const rawDefaults = (raw.defaults ?? {}) as Record<string, unknown>;
  const defaults: PageDefaults = {
    template: rawDefaults.template === undefined ? "narrowRuled" : asTemplate(rawDefaults.template),
    paperColor: asPaperColor(rawDefaults.paperColor),
    pageSize: asPageSize(rawDefaults.pageSize),
  };
  const rawCover = (raw.cover ?? {}) as Record<string, unknown>;
  const fallbackCover = defaultCover(raw.id);
  const inksRaw = Array.isArray(rawCover.inks) ? rawCover.inks : [];
  const cover: CoverSpec = {
    style: (coverStyles as readonly string[]).includes(rawCover.style as string) ? (rawCover.style as CoverStyle) : "cloth",
    cloth: (clothColors as readonly string[]).includes(rawCover.cloth as string) ? (rawCover.cloth as ClothColor) : fallbackCover.cloth,
    inks: inksRaw.length === 2 && inksRaw.every((ink) => (risoInks as readonly string[]).includes(ink as string))
      ? (inksRaw as [RisoInk, RisoInk]) : fallbackCover.inks,
    seed: finite(rawCover.seed, fallbackCover.seed) >>> 0,
  };
  const pages = raw.pages.map((page) => decodePage(page, defaults)).filter((page): page is Page => page !== null);
  const seen = new Set<string>();
  const unique = pages.filter((page) => (seen.has(page.id) ? false : (seen.add(page.id), true)));
  const kind = raw.kind === "whiteboard" ? "whiteboard" : "notebook";
  if (unique.length === 0) unique.push(kind === "whiteboard" ? newPage(defaults, { edgeless: true, size: { ...whiteboardSize } }) : newPage(defaults));
  const createdAt = finite(raw.createdAt, Date.now());
  return {
    ...(raw as object),
    version: MANIFEST_VERSION,
    id: raw.id,
    title: typeof raw.title === "string" ? raw.title : "Untitled",
    kind,
    createdAt,
    modifiedAt: finite(raw.modifiedAt, createdAt),
    cover,
    defaults,
    pages: unique,
    tags: Array.isArray(raw.tags) ? [...new Set(raw.tags.filter((tag): tag is string => typeof tag === "string" && tag.trim() !== ""))] : [],
    folder: typeof raw.folder === "string" ? raw.folder : null,
    favourite: raw.favourite === true,
    locked: raw.locked === true,
    trashedAt: typeof raw.trashedAt === "number" ? raw.trashedAt : null,
  } as Manifest;
}

export function encodeManifest(manifest: Manifest): string {
  return JSON.stringify(manifest, null, 1);
}

/** The files in `assets/` a manifest still uses. */
export function usedAssets(manifest: Manifest): Set<string> {
  const used = new Set<string>();
  const note = (background: Background) => {
    if (background.kind !== "template") used.add(background.file);
  };
  for (const page of manifest.pages) {
    note(page.background);
    for (const item of page.items) if (item.kind === "image") used.add(item.file);
  }
  for (const paper of manifest.papers ?? []) note(paper.background);
  return used;
}

/** A web address as the user typed it, with https added, or null when it isn't one. */
export function webAddress(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;
  const full = trimmed.includes("://") ? trimmed : "https://" + trimmed;
  try {
    const url = new URL(full);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname.includes(".") && url.hostname !== "localhost") return null;
    return url.toString();
  } catch {
    return null;
  }
}
