// The library's own files, beside the notebook packages: folders, smart shelves, settings and writing history.

import { dayKey } from "../model/days";
import { uuid } from "../model/ids";
import { starterPens, type EraserMode, type ToolPreset } from "../model/tools";
import { readText, type FS } from "../platform/fs";

export interface Folder {
  id: string;
  name: string;
  parent: string | null;
}

export interface SmartShelf {
  id: string;
  name: string;
  tags: string[];
  /** Whether a notebook needs every tag or any one of them. */
  match: "all" | "any";
}

export type PenAction = "none" | "eraser" | "lasso" | "lastTool" | "undo" | "redo" | "inkDish";
export type TrayShortcut = "picture" | "text" | "sticker" | "link" | "tape" | "ruler" | "zoomWindow" | "inkToText" | "shapes";
export const allTrayShortcuts: TrayShortcut[] = ["picture", "text", "sticker", "link", "tape", "ruler", "zoomWindow", "inkToText", "shapes"];
export const trayShortcutNames: Record<TrayShortcut, string> = {
  picture: "Picture", text: "Text Box", sticker: "Sticker", link: "Link", tape: "Study Tape", ruler: "Ruler",
  zoomWindow: "Zoom Window", inkToText: "Handwriting to Text", shapes: "Shapes",
};

export interface Settings {
  appearance: "system" | "light" | "dark";
  leftHanded: boolean;
  drawWith: "pen" | "penAndFinger";
  pageFlow: "continuous" | "single";
  pens: ToolPreset[];
  eraserMode: EraserMode;
  eraserWidth: number;
  trayShortcuts: TrayShortcut[];
  drawAndHold: boolean;
  scribbleErase: boolean;
  loopSelect: boolean;
  /** What the pen's barrel button and its second button do. */
  barrelButton: PenAction;
  secondButton: PenAction;
  twoFingerTap: PenAction;
  threeFingerTap: PenAction;
  trashDays: 7 | 30 | 90;
  writingHistory: boolean;
  language: "system" | "en" | "es" | "fr" | "de";
  librarySort: "modified" | "created" | "title";
  libraryLayout: "shelf" | "list";
  /** A salted hash of the PIN that opens locked notebooks when Windows Hello can't. */
  pinHash: string | null;
  pinSalt: string | null;
  lastOpened: string | null;
  sidebarOpen: boolean;
  typeAsYouWrite: boolean;
}

export function defaultSettings(): Settings {
  return {
    appearance: "system", leftHanded: false, drawWith: "penAndFinger", pageFlow: "continuous", pens: starterPens(),
    eraserMode: "stroke", eraserWidth: 14, trayShortcuts: ["picture", "text", "shapes", "tape"],
    drawAndHold: true, scribbleErase: true, loopSelect: true,
    barrelButton: "eraser", secondButton: "lasso", twoFingerTap: "undo", threeFingerTap: "redo",
    trashDays: 30, writingHistory: true, language: "system", librarySort: "modified", libraryLayout: "shelf",
    pinHash: null, pinSalt: null, lastOpened: null, sidebarOpen: true, typeAsYouWrite: false,
  };
}

async function readJSON<T>(fs: FS, path: string): Promise<T | null> {
  const text = await readText(fs, path);
  if (text === null) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    try {
      await fs.rename(path, `${path}.corrupt-${Date.now()}`);
    } catch {
      // Left in place.
    }
    return null;
  }
}

export async function loadSettings(fs: FS): Promise<Settings> {
  const saved = await readJSON<Partial<Settings>>(fs, "settings.json");
  const defaults = defaultSettings();
  if (!saved || typeof saved !== "object") return defaults;
  const merged = { ...defaults, ...saved } as Settings;
  if (!Array.isArray(merged.pens) || merged.pens.length === 0) merged.pens = defaults.pens;
  if (!Array.isArray(merged.trayShortcuts)) merged.trayShortcuts = defaults.trayShortcuts;
  if (![7, 30, 90].includes(merged.trashDays)) merged.trashDays = 30;
  return merged;
}

export async function saveSettings(fs: FS, settings: Settings): Promise<void> {
  await fs.write("settings.json", JSON.stringify(settings, null, 1));
}

export async function loadFolders(fs: FS): Promise<Folder[]> {
  const saved = await readJSON<{ folders?: unknown }>(fs, "folders.json");
  if (!saved || !Array.isArray(saved.folders)) return [];
  const folders = (saved.folders as Partial<Folder>[])
    .filter((folder) => folder && typeof folder.id === "string" && typeof folder.name === "string")
    .map((folder) => ({ id: folder.id!, name: folder.name!, parent: typeof folder.parent === "string" ? folder.parent : null }));
  return mendFolders(folders);
}

/** A folder whose parent is gone, or that sits inside itself, comes back to the top. */
export function mendFolders(folders: Folder[]): Folder[] {
  const byID = new Map(folders.map((folder) => [folder.id, folder]));
  return folders.map((folder) => {
    const seen = new Set([folder.id]);
    let parent = folder.parent;
    while (parent !== null) {
      const next = byID.get(parent);
      if (!next || seen.has(parent)) return { ...folder, parent: null };
      seen.add(parent);
      parent = next.parent;
    }
    return folder;
  });
}

export async function saveFolders(fs: FS, folders: Folder[]): Promise<void> {
  await fs.write("folders.json", JSON.stringify({ version: 1, folders }, null, 1));
}

/** The folder and every folder inside it. */
export function folderAndDescendants(folders: Folder[], id: string): Set<string> {
  const out = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const folder of folders) {
      if (folder.parent !== null && out.has(folder.parent) && !out.has(folder.id)) {
        out.add(folder.id);
        grew = true;
      }
    }
  }
  return out;
}

/** "School › Physics". */
export function folderPath(folders: Folder[], id: string | null): string {
  const names: string[] = [];
  const byID = new Map(folders.map((folder) => [folder.id, folder]));
  let at = id;
  while (at !== null) {
    const folder = byID.get(at);
    if (!folder || names.length > 32) break;
    names.unshift(folder.name);
    at = folder.parent;
  }
  return names.join(" › ");
}

export function newFolder(name: string, parent: string | null): Folder {
  return { id: uuid(), name: name.trim() || "New Folder", parent };
}

export async function loadShelves(fs: FS): Promise<SmartShelf[]> {
  const saved = await readJSON<{ shelves?: unknown }>(fs, "shelves.json");
  if (!saved || !Array.isArray(saved.shelves)) return [];
  return (saved.shelves as Partial<SmartShelf>[])
    .filter((shelf) => shelf && typeof shelf.id === "string" && typeof shelf.name === "string" && Array.isArray(shelf.tags))
    .map((shelf) => ({ id: shelf.id!, name: shelf.name!, tags: shelf.tags!.filter((tag) => typeof tag === "string"), match: shelf.match === "any" ? "any" : "all" }));
}

export async function saveShelves(fs: FS, shelves: SmartShelf[]): Promise<void> {
  await fs.write("shelves.json", JSON.stringify({ version: 1, shelves }, null, 1));
}

export function shelfMatches(shelf: SmartShelf, tags: string[]): boolean {
  if (shelf.tags.length === 0) return false;
  const have = new Set(tags.map((tag) => tag.toLowerCase()));
  const wanted = shelf.tags.map((tag) => tag.toLowerCase());
  return shelf.match === "all" ? wanted.every((tag) => have.has(tag)) : wanted.some((tag) => have.has(tag));
}

/** The writing history: how much was written each day, and in which notebooks. Kept on this device. */
export interface Activity {
  version: 1;
  days: Record<string, { strokes: number; notebooks: string[] }>;
}

export async function loadActivity(fs: FS): Promise<Activity> {
  const saved = await readJSON<Activity>(fs, "activity.json");
  if (!saved || typeof saved.days !== "object" || !saved.days) return { version: 1, days: {} };
  const days: Activity["days"] = {};
  for (const [key, value] of Object.entries(saved.days)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || !value) continue;
    days[key] = { strokes: Math.max(0, Math.floor(Number(value.strokes) || 0)), notebooks: Array.isArray(value.notebooks) ? value.notebooks.filter((id) => typeof id === "string") : [] };
  }
  return { version: 1, days };
}

export async function saveActivity(fs: FS, activity: Activity): Promise<void> {
  await fs.write("activity.json", JSON.stringify(activity));
}

export function recordWriting(activity: Activity, notebookID: string, strokes: number, date: Date = new Date()): Activity {
  const key = dayKey(date);
  const day = activity.days[key] ?? { strokes: 0, notebooks: [] };
  return {
    version: 1,
    days: {
      ...activity.days,
      [key]: { strokes: day.strokes + strokes, notebooks: day.notebooks.includes(notebookID) ? day.notebooks : [...day.notebooks, notebookID] },
    },
  };
}
